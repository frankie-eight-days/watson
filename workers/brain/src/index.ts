/**
 * index.ts — Worker entry for the Watson brain.
 *
 * Routes:
 *   GET  /health                        → liveness probe
 *   GET  /engagements/:id/bench   (WS)  → Bench WebSocket → HermesAgent DO (idFromName(:id))
 *   POST /engagements/:id/commence      → alternative COMMENCE trigger { repoUrl }
 */

import { getAgentByName } from 'agents';
import type { BrainEnv } from './lib/env';

export { HermesAgent } from './hermes';

const BENCH_RE = /^\/engagements\/([^/]+)\/bench\/?$/;
const COMMENCE_RE = /^\/engagements\/([^/]+)\/commence\/?$/;

export default {
  async fetch(request: Request, env: BrainEnv, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/health' || path === '/') {
      return Response.json({ ok: true, service: 'watson-brain', ts: Date.now() });
    }

    // Bench WebSocket upgrade → the engagement's Hermes DO.
    const bench = BENCH_RE.exec(path);
    if (bench) {
      const engagementId = decodeURIComponent(bench[1]);
      const hermes = await getAgentByName(env.HERMES, engagementId);
      return hermes.fetch(request);
    }

    // HTTP COMMENCE trigger.
    const commence = COMMENCE_RE.exec(path);
    if (commence && request.method === 'POST') {
      const engagementId = decodeURIComponent(commence[1]);
      const body = (await request.json().catch(() => ({}))) as { repoUrl?: string };
      const hermes = await getAgentByName(env.HERMES, engagementId);
      const res = await hermes.commence(body.repoUrl);
      return Response.json({ ok: true, engagementId, ...res });
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<BrainEnv>;
