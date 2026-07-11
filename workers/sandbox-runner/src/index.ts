/**
 * Watson sandbox-runner — Cloudflare Worker.
 *
 * Runs the Vending-Bench fork end-to-end in a Cloudflare Sandbox container
 * (clone -> npm install -> run the demo profile -> extract metric JSON), streams
 * progress + parsed metric points into Convex via the frozen emitEvent contract,
 * and returns the final metric. Also hosts the GitHub PR machinery.
 *
 *   GET  /health  — liveness, no container
 *   GET  /ping    — spins a container and runs `echo` (infra proof)
 *   POST /run     — { engagementId, agentId, experimentId, repoUrl, ref, command }
 *                   -> { ok, metric, logsTail }
 *   POST /pr      — { engagementId, pitchTitle, branchName, patchDescription,
 *                     files:[{path,content}], metricBefore, metricAfter, ... }
 *                   -> { ok, prUrl, prNumber, branch }
 */

import { getSandbox, type Sandbox as SandboxClass } from "@cloudflare/sandbox";
import { ConvexEmitter, type MetricPoint } from "./emit";
import { openPr, type OpenPrInput } from "./github";

export { Sandbox } from "@cloudflare/sandbox";

export interface Env {
  Sandbox: DurableObjectNamespace<SandboxClass>;
  OPENAI_API_KEY?: string;
  GITHUB_TOKEN?: string;
  CONVEX_SITE_URL?: string;
}

const DEFAULT_CONVEX = "https://friendly-sheep-865.convex.site";
const DEFAULT_OWNER = "frankie-eight-days";
const DEFAULT_REPO = "watson-vending-bench";

interface RunBody {
  engagementId: string;
  agentId: string;
  experimentId: string;
  repoUrl: string;
  ref?: string;
  command?: string;
  seriesLabel?: string; // "baseline" | "candidate" (default candidate)
}

const DEMO_COMMAND =
  "npm run run:demo";

/** Parse per-day progress lines: "──── Day 5/30 | Balance: $.. | Total Assets: $823.50 | ..." */
const DAY_RE = /Day\s+(\d+)\/(\d+)\s*\|\s*Balance:\s*\$[\d.]+\s*\|\s*Total Assets:\s*\$([\d.]+)/;

function tail(s: string, n = 4000): string {
  return s.length <= n ? s : s.slice(s.length - n);
}

/** Extract the last well-formed JSON object from a string (metric extractor stdout). */
function lastJsonObject(s: string): any | null {
  const start = s.lastIndexOf("{");
  // walk backwards trying candidate opening braces until one parses
  let idx = s.length;
  while (true) {
    const open = s.lastIndexOf("{", idx - 1);
    if (open < 0) break;
    const candidate = s.slice(open);
    // try to find matching end by trimming trailing noise
    for (let end = candidate.length; end > 0; end--) {
      const sub = candidate.slice(0, end);
      if (!sub.trimEnd().endsWith("}")) continue;
      try {
        return JSON.parse(sub);
      } catch {
        /* keep shrinking */
      }
    }
    idx = open;
  }
  void start;
  return null;
}

async function handleRun(req: Request, env: Env): Promise<Response> {
  let body: RunBody;
  try {
    body = (await req.json()) as RunBody;
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const { engagementId, agentId, experimentId, repoUrl } = body;
  if (!engagementId || !agentId || !experimentId || !repoUrl) {
    return Response.json(
      { ok: false, error: "missing required field(s): engagementId, agentId, experimentId, repoUrl" },
      { status: 400 },
    );
  }
  const ref = body.ref || "main";
  const command = body.command || DEMO_COMMAND;
  const seriesLabel = body.seriesLabel || "candidate";

  const emit = new ConvexEmitter({
    convexSiteUrl: env.CONVEX_SITE_URL || DEFAULT_CONVEX,
    engagementId,
    agentId,
  });

  const sandboxId = `run-${experimentId}`;
  const sandbox = getSandbox(env.Sandbox, sandboxId);
  const repoDir = "/workspace/repo";
  const runEnv: Record<string, string> = {};
  if (env.OPENAI_API_KEY) runEnv.OPENAI_API_KEY = env.OPENAI_API_KEY;

  const collectedSeries: MetricPoint[] = [];
  let stdoutBuf = "";
  let stderrBuf = "";

  try {
    await emit.status("running", `provisioning sandbox for ${experimentId}`);

    // 1. Clean any prior checkout, clone fresh.
    await sandbox.exec(`rm -rf ${repoDir}`);
    await emit.status("running", `cloning ${repoUrl} @ ${ref}`);
    const clone = await sandbox.exec(
      `git clone --depth 1 --branch ${ref} ${repoUrl} ${repoDir}`,
      { timeout: 120_000 },
    );
    if (!clone.success) {
      // fall back to default-branch clone + checkout (ref may be a sha)
      const clone2 = await sandbox.exec(`git clone ${repoUrl} ${repoDir}`, { timeout: 120_000 });
      if (!clone2.success) {
        await emit.error(`clone failed: ${tail(clone.stderr, 500)}`, { fatal: true });
        return Response.json(
          { ok: false, error: "clone failed", logsTail: tail(clone.stderr) },
          { status: 500 },
        );
      }
      await sandbox.exec(`git checkout ${ref}`, { cwd: repoDir, timeout: 60_000 });
    }

    // 2. Install deps.
    await emit.status("running", "npm install");
    const install = await sandbox.exec(`npm install --no-audit --no-fund`, {
      cwd: repoDir,
      timeout: 300_000,
    });
    stdoutBuf += install.stdout;
    stderrBuf += install.stderr;
    if (!install.success) {
      await emit.error(`npm install failed: ${tail(install.stderr, 500)}`, { fatal: true });
      return Response.json(
        { ok: false, error: "npm install failed", logsTail: tail(install.stderr) },
        { status: 500 },
      );
    }

    // 3. Run the experiment command, streaming per-day metric points.
    await emit.status("running", `executing: ${command}`);
    const totalDaysBox = { total: 30 };
    const run = await sandbox.exec(command, {
      cwd: repoDir,
      timeout: 600_000,
      env: runEnv,
      stream: true,
      onOutput: (streamName, data) => {
        if (streamName === "stdout") stdoutBuf += data;
        else stderrBuf += data;
        // parse day lines as they arrive (data may contain multiple lines)
        for (const line of data.split("\n")) {
          const m = DAY_RE.exec(line);
          if (m) {
            const day = Number(m[1]);
            totalDaysBox.total = Number(m[2]) || totalDaysBox.total;
            const assets = Number(m[3]);
            collectedSeries.push({ x: day, y: assets });
            // fire-and-forget incremental metric point (do not await in callback)
            void emit.metric("totalAssets", assets, {
              unit: "usd",
              series: collectedSeries.slice(),
              seriesLabel,
            });
          }
        }
      },
    });
    stdoutBuf = tail(stdoutBuf, 20_000);

    if (!run.success) {
      await emit.error(`run command exited ${run.exitCode}: ${tail(stderrBuf, 500)}`, {
        recoverable: true,
      });
      // continue — a partial run may still have produced a transcript
    }

    // 4. Extract the canonical metric JSON.
    await emit.status("running", "extracting metric");
    const metricRes = await sandbox.exec(
      `npx tsx scripts/extract-metric.ts --log-dir logs`,
      { cwd: repoDir, timeout: 60_000 },
    );
    const metric = lastJsonObject(metricRes.stdout);
    if (!metric) {
      await emit.error("metric extraction produced no JSON", { fatal: true });
      return Response.json(
        {
          ok: false,
          error: "metric extraction failed",
          logsTail: tail(stderrBuf + "\n" + metricRes.stderr),
        },
        { status: 500 },
      );
    }

    // 5. Emit the final metric with the full series + a summary status.
    const finalSeries: MetricPoint[] =
      Array.isArray(metric.series) && metric.series.length
        ? metric.series.map((p: any) => ({ x: Number(p.day), y: Number(p.totalAssets) }))
        : collectedSeries;
    await emit.metric("totalAssets", Number(metric.totalAssets) || 0, {
      unit: "usd",
      series: finalSeries,
      seriesLabel,
    });
    await emit.metric("daysCompleted", Number(metric.daysCompleted) || 0, { unit: "days" });
    await emit.status(
      "done",
      `totalAssets=$${metric.totalAssets} daysCompleted=${metric.daysCompleted}`,
    );

    return Response.json({
      ok: true,
      metric,
      logsTail: tail(stdoutBuf, 4000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await emit.error(`sandbox run crashed: ${msg}`, { fatal: true });
    return Response.json(
      { ok: false, error: msg, logsTail: tail(stderrBuf) },
      { status: 500 },
    );
  }
}

interface PrBody {
  engagementId?: string;
  pitchTitle: string;
  branchName: string;
  patchDescription: string;
  files: Array<{ path: string; content: string }>;
  metricBefore?: number;
  metricAfter?: number;
  citations?: Array<{ title: string; url: string }>;
  runLogUrl?: string;
  draft?: boolean;
  title?: string;
  owner?: string;
  repo?: string;
  base?: string;
}

async function handlePr(req: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_TOKEN) {
    return Response.json({ ok: false, error: "GITHUB_TOKEN secret not configured" }, { status: 500 });
  }
  let body: PrBody;
  try {
    body = (await req.json()) as PrBody;
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.pitchTitle || !body.branchName || !Array.isArray(body.files) || body.files.length === 0) {
    return Response.json(
      { ok: false, error: "missing required field(s): pitchTitle, branchName, files[]" },
      { status: 400 },
    );
  }

  const input: OpenPrInput = {
    owner: body.owner || DEFAULT_OWNER,
    repo: body.repo || DEFAULT_REPO,
    base: body.base || "main",
    branchName: body.branchName,
    pitchTitle: body.pitchTitle,
    patchDescription: body.patchDescription || "",
    files: body.files,
    metricBefore: body.metricBefore,
    metricAfter: body.metricAfter,
    citations: body.citations,
    runLogUrl: body.runLogUrl,
    draft: body.draft,
    title: body.title,
  };

  const result = await openPr(env.GITHUB_TOKEN, input);
  return Response.json(result, { status: result.ok ? 200 : 500 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "watson-sandbox-runner",
        stage: "run+pr",
        hasOpenAI: Boolean(env.OPENAI_API_KEY),
        hasGithub: Boolean(env.GITHUB_TOKEN),
        ts: Date.now(),
      });
    }

    if (url.pathname === "/ping") {
      try {
        const sandbox = getSandbox(env.Sandbox, "skeleton-ping");
        const result = await sandbox.exec("echo hello-from-sandbox");
        return Response.json({
          ok: result.success,
          stdout: result.stdout.trim(),
          exitCode: result.exitCode,
        });
      } catch (err) {
        return Response.json(
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          { status: 500 },
        );
      }
    }

    if (url.pathname === "/run" && request.method === "POST") {
      return handleRun(request, env);
    }

    if (url.pathname === "/pr" && request.method === "POST") {
      return handlePr(request, env);
    }

    return new Response(
      "watson-sandbox-runner. Routes: GET /health, GET /ping, POST /run, POST /pr\n",
      { status: 404, headers: { "content-type": "text/plain" } },
    );
  },
};
