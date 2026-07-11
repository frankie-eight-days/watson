/**
 * steering.ts — the brain's read/consume side of human steering.
 *
 * The UI writes steering rows via Convex `steering:appendSteering`. The brain
 * polls `steering:pendingSteering` (by agentId) at natural checkpoints, consumes
 * each row, and injects its text into that agent's next model call. Convex
 * FUNCTIONS (not the /emit HTTP action) are reachable over the standard Convex
 * HTTP API at `${CONVEX_URL}/api/query|mutation` — note this is the *.cloud* URL,
 * distinct from the *.site* URL used by /emit.
 *
 * EVERY call is wrapped so a Convex hiccup NEVER breaks a run: on any error the
 * gate returns an empty list / silently no-ops. When there is no steering the
 * cost is exactly one cheap query per checkpoint.
 */

export interface SteeringRow {
  steeringId: string;
  text: string;
  from?: string;
}

export class SteeringGate {
  /** @param apiUrl the Convex *.cloud* base URL (e.g. https://x.convex.cloud). */
  constructor(
    private readonly apiUrl: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  private async call(kind: 'query' | 'mutation', path: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await this.fetchImpl(`${this.apiUrl.replace(/\/$/, '')}/api/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, args, format: 'json' }),
    });
    if (!res.ok) throw new Error(`convex ${kind} ${path} -> ${res.status}`);
    const data = (await res.json()) as { status?: string; value?: unknown; errorMessage?: string };
    if (data.status !== 'success') throw new Error(data.errorMessage ?? `convex ${path} failed`);
    return data.value;
  }

  /** Unconsumed steering rows for an agent (empty on any error). */
  async pending(agentId: string): Promise<SteeringRow[]> {
    try {
      const value = (await this.call('query', 'steering:pendingSteering', { agentId })) as
        | Array<{ steeringId: string; text: string; from?: string }>
        | undefined;
      if (!Array.isArray(value)) return [];
      return value.map((r) => ({ steeringId: r.steeringId, text: r.text, from: r.from }));
    } catch {
      return [];
    }
  }

  /** Mark a steering row consumed (silent no-op on error). */
  async consume(steeringId: string): Promise<void> {
    try {
      await this.call('mutation', 'steering:consumeSteering', { steeringId });
    } catch {
      /* best-effort */
    }
  }
}
