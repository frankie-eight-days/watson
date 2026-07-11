/**
 * loadFixture.mjs — load a JSON-lines fixture into the dev deployment.
 *
 * Usage (from watson/):  node scripts/loadFixture.mjs [fixturePath]
 *   fixturePath defaults to fixtures/mock-engagement.jsonl; it may be given
 *   relative to the repo root or as an absolute path (e.g. fixtures/demo-run.jsonl).
 * Reads CONVEX_URL from the env or .env.local. Idempotent: clears the fixture
 * engagement (derived from the first event's engagementId) first, then ingests
 * every event preserving its embedded seq.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv() {
  if (process.env.CONVEX_URL) return process.env.CONVEX_URL;
  try {
    const txt = readFileSync(resolve(root, '.env.local'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*CONVEX_URL\s*=\s*(\S+)/);
      if (m) return m[1];
    }
  } catch {}
  throw new Error('CONVEX_URL not found in env or .env.local');
}

const url = loadEnv();
const client = new ConvexHttpClient(url);

const fixtureArg = process.argv[2] ?? 'fixtures/mock-engagement.jsonl';
const jsonlPath = resolve(root, fixtureArg);
const events = readFileSync(jsonlPath, 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const engagementId = events[0]?.engagementId ?? 'eng_vb_001';
console.log(`Loading ${events.length} events for ${engagementId} -> ${url}`);

const cleared = await client.mutation(api.fixture.clearEngagement, { engagementId });
console.log(`Cleared ${cleared.cleared} prior events.`);

const CHUNK = 50;
let total = 0;
for (let i = 0; i < events.length; i += CHUNK) {
  const batch = events.slice(i, i + CHUNK);
  const res = await client.mutation(api.fixture.loadFixtureBatch, { events: batch });
  total += res.ingested;
  console.log(`  batch ${i}-${i + batch.length - 1}: ingested ${res.ingested}`);
}

const roll = await client.query(api.observability.engagementCostRollup, { engagementId });
console.log(`Done. total ingested=${total}`);
console.log(`Verify: events=${roll.events} agents=${roll.agents} costUsd=${roll.costUsd}`);
