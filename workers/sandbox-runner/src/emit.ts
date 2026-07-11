/**
 * Minimal Convex event emitter for the sandbox-runner.
 *
 * Consumes the FROZEN @watson/shared emit contract (packages/shared/README.md):
 * POST ${CONVEX_SITE_URL}/emit with body { events: EmitEventInput[] } where each
 * event is a WatsonEvent WITHOUT `seq` (server assigns seq). Fire-and-forget with
 * a tiny bounded retry — a Convex hiccup must never fail the sandbox run.
 *
 * We inline this (rather than importing @watson/shared) so the Worker bundle is
 * self-contained; the wire shape is what matters and it is pinned to the README.
 */

const EMIT_ENDPOINT_PATH = "/emit";

type AgentStatus = "spawned" | "running" | "waiting" | "done" | "failed";

export interface MetricPoint {
  x: number;
  y: number;
}

export interface EmitOptions {
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  model?: string;
}

/** One event as sent on the wire (WatsonEvent minus server-assigned seq). */
interface EmitEventInput {
  engagementId: string;
  agentId: string;
  ts: number;
  type: string;
  payload: unknown;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  model?: string;
}

export class ConvexEmitter {
  private readonly base: string;
  private readonly engagementId: string;
  private readonly agentId: string;

  constructor(opts: { convexSiteUrl: string; engagementId: string; agentId: string }) {
    this.base = opts.convexSiteUrl.replace(/\/$/, "");
    this.engagementId = opts.engagementId;
    this.agentId = opts.agentId;
  }

  async status(status: AgentStatus, detail?: string): Promise<void> {
    await this.send("status", { status, detail });
  }

  async metric(
    name: string,
    value: number,
    extra: { unit?: string; series?: MetricPoint[]; seriesLabel?: string } = {},
  ): Promise<void> {
    await this.send("metric", { name, value, ...extra });
  }

  async error(message: string, opts: { recoverable?: boolean; fatal?: boolean } = {}): Promise<void> {
    await this.send("error", { message, ...opts });
  }

  async thought(text: string, opts: EmitOptions = {}): Promise<void> {
    await this.send("thought", { text }, opts);
  }

  async artifact(payload: {
    kind: string;
    title: string;
    body?: string;
    url?: string;
    refId?: string;
  }): Promise<void> {
    await this.send("artifact", payload);
  }

  private async send(type: string, payload: unknown, opts: EmitOptions = {}): Promise<void> {
    const ev: EmitEventInput = {
      engagementId: this.engagementId,
      agentId: this.agentId,
      ts: Date.now(),
      type,
      payload,
    };
    if (opts.tokensIn != null) ev.tokensIn = opts.tokensIn;
    if (opts.tokensOut != null) ev.tokensOut = opts.tokensOut;
    if (opts.costUsd != null) ev.costUsd = opts.costUsd;
    if (opts.model != null) ev.model = opts.model;

    const body = JSON.stringify({ events: [ev] });
    const url = this.base + EMIT_ENDPOINT_PATH;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        if (res.ok) return;
      } catch {
        // swallow — fire-and-forget
      }
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
    // give up silently; the run must not fail on telemetry
  }
}
