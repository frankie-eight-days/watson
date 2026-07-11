/**
 * Watson sandbox-runner — Cloudflare Worker.
 *
 * Skeleton stage: proves the deploy pipeline AND the Sandbox SDK container path
 * before the real execution API is built. Per the "deploy from hour zero"
 * policy this is live on Cloudflare and redeployed continuously.
 *
 *   GET /health  — liveness, no container (always cheap)
 *   GET /ping    — spins a Sandbox container and runs `echo`, proving
 *                  clone/install/run infra works end-to-end
 */

import { getSandbox } from "@cloudflare/sandbox";

// Required: the Worker must re-export the Sandbox Durable Object class.
export { Sandbox } from "@cloudflare/sandbox";

export interface Env {
  Sandbox: DurableObjectNamespace;
  // Step: real execution API adds secrets GITHUB_TOKEN, CONVEX_SITE_URL via
  // `wrangler secret put`.
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "watson-sandbox-runner",
        stage: "skeleton+sandbox",
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

    return new Response(
      "watson-sandbox-runner: skeleton is live. Try GET /health or GET /ping\n",
      { status: 404, headers: { "content-type": "text/plain" } },
    );
  },
};
