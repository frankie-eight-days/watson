/**
 * GitHub PR machinery for the Watson bench fork.
 *
 * Creates a branch on the fork, commits a set of files via the Git Data API
 * (single tree + commit so multiple files land in ONE commit), and opens a real
 * PR with a templated body citing the pitch, papers, and baseline-vs-candidate
 * numbers. Used by the /pr HTTP endpoint. Token is the GITHUB_TOKEN Worker secret.
 */

const API = "https://api.github.com";

export interface PrFile {
  path: string;
  content: string;
}

export interface Citation {
  title: string;
  url: string;
}

export interface OpenPrInput {
  owner: string;
  repo: string;
  base: string; // base branch, e.g. "main"
  branchName: string;
  pitchTitle: string;
  patchDescription: string;
  files: PrFile[];
  /**
   * If set, open the PR directly FROM this already-pushed branch (full real
   * diff, no synthetic commit). Takes precedence over `branchName`/`files`.
   */
  headBranch?: string;
  metricBefore?: number;
  metricAfter?: number;
  citations?: Citation[];
  runLogUrl?: string;
  draft?: boolean;
  title?: string; // PR title override
}

export interface OpenPrResult {
  ok: boolean;
  prUrl?: string;
  prNumber?: number;
  branch?: string;
  commitSha?: string;
  error?: string;
}

async function gh(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "watson-sandbox-runner",
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function renderBody(input: OpenPrInput): string {
  const { pitchTitle, patchDescription, metricBefore, metricAfter, citations, runLogUrl } = input;
  const lines: string[] = [];
  lines.push(`## Pitch: ${pitchTitle}`);
  lines.push("");
  lines.push(patchDescription.trim());
  lines.push("");

  if (metricBefore != null || metricAfter != null) {
    lines.push("## Results — demo profile (Total Assets, USD)");
    lines.push("");
    lines.push("| | Total Assets |");
    lines.push("|---|---|");
    if (metricBefore != null) lines.push(`| Baseline (N) | $${metricBefore.toFixed(2)} |`);
    if (metricAfter != null) lines.push(`| Candidate (M) | $${metricAfter.toFixed(2)} |`);
    if (metricBefore != null && metricAfter != null) {
      const delta = metricAfter - metricBefore;
      const pct = metricBefore !== 0 ? (delta / metricBefore) * 100 : 0;
      const sign = delta >= 0 ? "+" : "";
      lines.push(`| **Delta** | **${sign}$${delta.toFixed(2)} (${sign}${pct.toFixed(1)}%)** |`);
    }
    lines.push("");
  }

  if (citations && citations.length) {
    lines.push("## Papers");
    lines.push("");
    for (const c of citations) lines.push(`- [${c.title}](${c.url})`);
    lines.push("");
  }

  if (runLogUrl) {
    lines.push(`Run log: ${runLogUrl}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("_Opened by the Watson sandbox-runner PR machinery._");
  lines.push("🤖 Generated with [Claude Code](https://claude.com/claude-code)");
  return lines.join("\n");
}

/** Base64-encode UTF-8 content for the blobs API (Worker-safe, no Buffer). */
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface CommitFilesInput {
  owner: string;
  repo: string;
  base: string;
  branchName: string;
  files: PrFile[];
  message?: string;
}

export interface CommitFilesResult {
  ok: boolean;
  branch?: string;
  commitSha?: string;
  error?: string;
}

/**
 * Commit a set of files onto `branchName` on top of `base` in ONE commit
 * (blobs → tree → commit → ref, creating or force-updating the ref). NO PR.
 * Shared by /implement and the commit-files path of /pr.
 */
export async function commitFilesToBranch(
  token: string,
  input: CommitFilesInput,
): Promise<CommitFilesResult> {
  const { owner, repo, base, branchName, files } = input;
  try {
    // 1. Resolve base branch head commit + its tree.
    const baseRef = await gh(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/${base}`);
    if (baseRef.status >= 300) {
      return { ok: false, error: `base ref ${base}: ${baseRef.status} ${JSON.stringify(baseRef.json)}` };
    }
    const baseSha: string = baseRef.json.object.sha;

    const baseCommit = await gh(token, "GET", `/repos/${owner}/${repo}/git/commits/${baseSha}`);
    if (baseCommit.status >= 300) {
      return { ok: false, error: `base commit: ${baseCommit.status}` };
    }
    const baseTreeSha: string = baseCommit.json.tree.sha;

    // 2. Create blobs for each file.
    const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const f of files) {
      const blob = await gh(token, "POST", `/repos/${owner}/${repo}/git/blobs`, {
        content: toBase64(f.content),
        encoding: "base64",
      });
      if (blob.status >= 300) {
        return { ok: false, error: `blob ${f.path}: ${blob.status} ${JSON.stringify(blob.json)}` };
      }
      treeEntries.push({ path: f.path, mode: "100644", type: "blob", sha: blob.json.sha });
    }

    // 3. Create a tree on top of the base tree.
    const tree = await gh(token, "POST", `/repos/${owner}/${repo}/git/trees`, {
      base_tree: baseTreeSha,
      tree: treeEntries,
    });
    if (tree.status >= 300) {
      return { ok: false, error: `tree: ${tree.status} ${JSON.stringify(tree.json)}` };
    }

    // 4. Create a commit.
    const commitMsg = `${input.message ?? `Watson: author ${files.length} file(s) on ${branchName}`}\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>`;
    const commit = await gh(token, "POST", `/repos/${owner}/${repo}/git/commits`, {
      message: commitMsg,
      tree: tree.json.sha,
      parents: [baseSha],
    });
    if (commit.status >= 300) {
      return { ok: false, error: `commit: ${commit.status} ${JSON.stringify(commit.json)}` };
    }
    const commitSha: string = commit.json.sha;

    // 5. Create (or force fast-forward) the branch ref.
    const createRef = await gh(token, "POST", `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: commitSha,
    });
    if (createRef.status === 422) {
      const upd = await gh(token, "PATCH", `/repos/${owner}/${repo}/git/refs/heads/${branchName}`, {
        sha: commitSha,
        force: true,
      });
      if (upd.status >= 300) {
        return { ok: false, error: `update ref: ${upd.status} ${JSON.stringify(upd.json)}` };
      }
    } else if (createRef.status >= 300) {
      return { ok: false, error: `create ref: ${createRef.status} ${JSON.stringify(createRef.json)}` };
    }

    return { ok: true, branch: branchName, commitSha };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function openPr(token: string, input: OpenPrInput): Promise<OpenPrResult> {
  const { owner, repo, base, branchName, files } = input;
  try {
    // Direct mode: PR straight from an already-pushed branch (full real diff).
    if (input.headBranch) {
      const pr = await gh(token, "POST", `/repos/${owner}/${repo}/pulls`, {
        title: input.title ?? input.pitchTitle,
        head: input.headBranch,
        base,
        body: renderBody(input),
        draft: input.draft ?? false,
      });
      if (pr.status >= 300) {
        return { ok: false, error: `open pr: ${pr.status} ${JSON.stringify(pr.json)}`, branch: input.headBranch };
      }
      return { ok: true, prUrl: pr.json.html_url, prNumber: pr.json.number, branch: input.headBranch };
    }

    // Commit-files mode: land the files on branchName in one commit, then PR it.
    const committed = await commitFilesToBranch(token, {
      owner,
      repo,
      base,
      branchName,
      files,
      message: input.title ?? input.pitchTitle,
    });
    if (!committed.ok) return { ok: false, error: committed.error, branch: branchName };
    const commitSha = committed.commitSha!;

    // Open the PR.
    const pr = await gh(token, "POST", `/repos/${owner}/${repo}/pulls`, {
      title: input.title ?? `${input.pitchTitle}`,
      head: branchName,
      base,
      body: renderBody(input),
      draft: input.draft ?? false,
    });
    if (pr.status >= 300) {
      return {
        ok: false,
        error: `open pr: ${pr.status} ${JSON.stringify(pr.json)}`,
        branch: branchName,
        commitSha,
      };
    }

    return {
      ok: true,
      prUrl: pr.json.html_url,
      prNumber: pr.json.number,
      branch: branchName,
      commitSha,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
