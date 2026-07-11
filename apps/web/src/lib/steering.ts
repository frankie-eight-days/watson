/**
 * steering.ts — the real steering write path.
 *
 * Calls Convex `steering:appendSteering` directly on the shared client (not a
 * hook, so it works regardless of where it's invoked and no-ops offline). The
 * mutation inserts an unconsumed steering row the brain polls AND emits a
 * `steering` event into the stream — which arrives back through our subscription
 * and renders in the console feed. The returned `seq` lets the caller dedupe its
 * optimistic echo against that real event.
 */
import { makeFunctionReference } from 'convex/server';
import { convex } from './convexClient';

const appendSteeringRef = makeFunctionReference<'mutation'>('steering:appendSteering');

export interface SteeringResult {
  steeringId: string;
  seq: number;
}

/** True when a live Convex connection exists to accept steering writes. */
export const canWriteSteering = (): boolean => convex !== null;

export async function appendSteering(args: {
  engagementId: string;
  agentId: string;
  text: string;
  from?: string;
}): Promise<SteeringResult> {
  if (!convex) throw new Error('No live Convex connection — steering is unavailable.');
  return (await convex.mutation(appendSteeringRef, args)) as SteeringResult;
}
