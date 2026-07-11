/**
 * http.ts — the /emit HTTP endpoint (the emit contract, @watson/shared README).
 *
 * POST /emit  body: EmitBatchRequest { events: EmitEventInput[] }
 *            resp: EmitBatchResponse { ok, results:[{seq}], error? }, HTTP 200.
 * OPTIONS /emit  CORS preflight.
 *
 * Errors prefer HTTP 200 with { ok:false, results:[], error } so the
 * fire-and-forget client retries without treating it as a network failure.
 */

import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const emit = httpAction(async (ctx, request) => {
  try {
    const body = (await request.json()) as { events?: unknown };
    const events = body?.events;
    if (!Array.isArray(events)) {
      return json({ ok: false, results: [], error: 'body.events must be an array' });
    }
    const results = await ctx.runMutation(internal.ingest.ingestBatch, { events });
    return json({ ok: true, results });
  } catch (err) {
    return json({
      ok: false,
      results: [],
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

const http = httpRouter();

http.route({
  path: '/emit',
  method: 'POST',
  handler: emit,
});

http.route({
  path: '/emit',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS })),
});

export default http;
