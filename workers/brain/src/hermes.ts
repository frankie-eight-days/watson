/**
 * hermes.ts — the Hermes Durable Object. The president agent + control plane.
 *
 * One instance per engagement (keyed by engagement id via the DO name). Runs the
 * Bench WebSocket chat protocol, drives the terra harness for scoping turns, and
 * on COMMENCE kicks off workflows in sequence (Wave 1: the toy workflow), reads
 * the result, and reports back. EVERY step goes through emitEvent.
 *
 * Bench WS protocol:
 *   inbound : { type: 'user', text } | { type: 'commence', repoUrl }
 *   outbound: { type: 'hermes', text } | { type: 'status', phase|status, ... }
 *
 * Hermes is the ROOT agent: parentAgentId=null, tier='hermes', its `spawn`
 * emitted exactly once per engagement (guarded by state.hermesSpawned).
 */

import { Agent, type Connection, type ConnectionContext, type WSMessage } from 'agents';
import type { Emitter } from '@watson/shared';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import './lib/env';
import { BrainContext } from './lib/context';
import { TerraLoopHarness } from './lib/harness';
import { modelClientFromEnv } from './lib/model';
import { runWatercooler } from './workflows/watercooler';
import { runLibrary, type Pitch } from './workflows/library';
import { runLab } from './workflows/lab';

const PRESIDENT_PROMPT = `You are Hermes, the president of Watson — an AI research agency retained to make a client's coding agents run longer on a benchmark (a Vending-Bench fork). You run the engagement like a consulting principal.

On each turn: understand the client's ask, ask sharp clarifying questions (target repo, the metric to move, constraints, deadline), and confirm scope crisply. Be concise and decisive. Do NOT start real work in chat — when scope is clear, tell the client to hit COMMENCE and you will dispatch the research teams (watercooler ingestion, library paper pipeline, lab experiments).`;

const MAX_HISTORY = 24;

export interface HermesState {
  engagementId: string;
  repoUrl?: string;
  phase: 'bench' | 'ingestion' | 'library' | 'lab' | 'conference' | 'done';
  hermesSpawned: boolean;
  history: ChatCompletionMessageParam[];
}

export class HermesAgent extends Agent<Env, HermesState> {
  initialState: HermesState = {
    engagementId: '',
    phase: 'bench',
    hermesSpawned: false,
    history: [],
  };

  // ------------------------------------------------------------------ deps

  /**
   * Build a per-turn BrainContext + harness. The DO has no filesystem, so it
   * always emits in 'convex' mode to the Convex *.site* /emit endpoint. Each
   * turn gets a fresh context that is closed (flushed) at the end so no flush
   * timer leaks across the DO's lifetime.
   */
  private makeContext(): BrainContext {
    return new BrainContext({
      engagementId: this.name,
      convexUrl: this.env.CONVEX_SITE_URL,
      emitMode: 'convex',
      models: { terra: this.env.MODEL_TERRA, luna: this.env.MODEL_LUNA },
      fetchImpl: fetch,
    });
  }

  private harness(): TerraLoopHarness {
    return new TerraLoopHarness(modelClientFromEnv(this.env));
  }

  /**
   * Return Hermes's emitter for this context, self-emitting its `spawn`
   * (the root, parentAgentId=null) exactly once per engagement.
   */
  private async hermesEmitter(ctx: BrainContext): Promise<Emitter> {
    if (!this.state.hermesSpawned) {
      const { emitter } = await ctx.spawn({
        parentAgentId: null,
        role: 'president',
        tier: 'hermes',
        model: this.env.MODEL_TERRA,
        label: 'Hermes',
      });
      await ctx.status(emitter, 'running', 'engagement opened');
      this.setState({ ...this.state, hermesSpawned: true, engagementId: this.name });
      return emitter;
    }
    return ctx.emitterFor('hermes', this.env.MODEL_TERRA);
  }

  /**
   * Steering seam: pull any human messages targeting this agent and return them
   * for injection into the loop. Wave-1 STUB — returns []. TODO(Wave 2): read
   * Tab A's `steering` table (POST a Convex query to CONVEX_SITE_URL) filtered
   * by { engagementId, agentId, consumed:false }, mark them consumed, and return
   * their text. The injection point is already wired in TerraLoopHarness.
   */
  private async pollSteering(_agentId: string): Promise<string[]> {
    return [];
  }

  // --------------------------------------------------------------- lifecycle

  override async onConnect(connection: Connection, _ctx: ConnectionContext): Promise<void> {
    const ctx = this.makeContext();
    try {
      await this.hermesEmitter(ctx); // ensure Hermes spawn is emitted at engagement start
      await ctx.close();
    } catch (err) {
      console.error('onConnect emit failed:', err);
    }
    this.sendHermes(
      connection,
      `Hermes online for engagement "${this.name}". Tell me the target repo and the metric you want moved, then say COMMENCE.`,
    );
  }

  override async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    const msg = this.parse(message);
    if (!msg) {
      this.sendHermes(connection, 'Could not parse that message.');
      return;
    }

    if (msg.type === 'commence') {
      const repoUrl = typeof msg.repoUrl === 'string' ? msg.repoUrl : this.state.repoUrl;
      await this.commence(repoUrl);
      return;
    }

    if (msg.type === 'user') {
      const text = typeof msg.text === 'string' ? msg.text : '';
      await this.handleUserTurn(connection, text);
      return;
    }

    this.sendHermes(connection, `Unhandled message type "${String(msg.type)}".`);
  }

  // ---------------------------------------------------------------- turns

  private async handleUserTurn(connection: Connection, text: string): Promise<void> {
    const ctx = this.makeContext();
    const emitter = await this.hermesEmitter(ctx);
    await ctx.status(emitter, 'running');

    const history: ChatCompletionMessageParam[] = [
      ...this.state.history,
      { role: 'user', content: text },
    ];

    const result = await this.harness().run({
      system: PRESIDENT_PROMPT,
      input: history,
      emitter,
      model: this.env.MODEL_TERRA,
      effort: 'high',
      getSteering: () => this.pollSteering('hermes'),
    });

    const nextHistory = [
      ...history,
      { role: 'assistant', content: result.text } as ChatCompletionMessageParam,
    ].slice(-MAX_HISTORY);
    this.setState({ ...this.state, history: nextHistory });

    await ctx.status(emitter, 'waiting', 'awaiting client');
    this.sendHermes(connection, result.text || '(no response)');
    await ctx.close();
  }

  /**
   * COMMENCE: phase change → run the real workflow sequence → report. Hermes
   * dispatches watercooler (repo dossier) → library (Linkup pitches) → lab (top
   * pitch experiment via the cloud sandbox), reads each output, spawns a dynamic
   * specialist for the lab, and reviews the result. Every step emits. Callable
   * over native DO RPC (HTTP /commence) and from a WS `commence` message.
   */
  async commence(repoUrl?: string): Promise<{ phase: string; repoUrl?: string; report: string }> {
    const nextRepo = repoUrl ?? this.state.repoUrl ?? 'https://github.com/frankie-eight-days/watson-vending-bench';
    this.setState({ ...this.state, repoUrl: nextRepo, phase: 'ingestion' });

    const ctx = this.makeContext();
    const emitter = await this.hermesEmitter(ctx);
    const model = modelClientFromEnv(this.env);

    const lines: string[] = [];
    try {
      // ---- Phase 1: Watercooler (repo ingestion) ----
      await ctx.status(emitter, 'running', 'phase: watercooler');
      this.broadcast(JSON.stringify({ type: 'status', phase: 'watercooler', repoUrl: nextRepo }));
      await ctx.emit(emitter, 'thought', { text: `COMMENCE for ${nextRepo}. Dispatching the watercooler ingestion team.`, title: 'commence' });

      const wc = await runWatercooler(ctx, { parentAgentId: 'hermes', repoUrl: nextRepo, ref: 'main', model });
      await ctx.emit(emitter, 'thought', { text: `Ingestion done: "${wc.dossierTitle}". Weakness: ${wc.weakness}`, title: 'review' });
      lines.push(`Dossier: "${wc.dossierTitle}".`);

      // ---- Phase 2: Library (Linkup paper pipeline → pitches) ----
      this.setState({ ...this.state, phase: 'library' });
      await ctx.status(emitter, 'running', 'phase: library');
      this.broadcast(JSON.stringify({ type: 'status', phase: 'library' }));

      const lib = await runLibrary(ctx, {
        parentAgentId: 'hermes',
        dossierBody: wc.dossierBody,
        weakness: wc.weakness,
        linkupApiKey: this.env.LINKUP_API_KEY,
        exaApiKey: this.env.EXA_API_KEY,
        model,
      });
      const top: Pitch | undefined = lib.pitches[0];
      await ctx.emit(emitter, 'thought', { text: `Library returned ${lib.pitches.length} pitches. Top: "${top?.title}" (arXiv:${top?.arxiv}).`, title: 'review' });
      lines.push(`${lib.pitches.length} pitches; top "${top?.title}".`);

      // ---- Phase 3: Lab (top pitch → cloud sandbox experiment) ----
      if (top) {
        this.setState({ ...this.state, phase: 'lab' });
        await ctx.status(emitter, 'running', 'phase: lab');
        this.broadcast(JSON.stringify({ type: 'status', phase: 'lab' }));

        const lab = await runLab(ctx, {
          hermesAgentId: 'hermes',
          hermesEmitter: emitter,
          engagementId: this.name,
          pitch: top,
          repoUrl: nextRepo,
          ref: 'main',
          sandboxRunnerUrl: this.sandboxRunnerUrl(),
          baselineMean: 821.8,
          model,
        });
        lines.push(
          lab.ran
            ? `Lab: ${lab.verdict} — candidate $${lab.metric} vs baseline $821.80.`
            : `Lab: experiment pending (sandbox runner offline; retry when live).`,
        );
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      await ctx.emit(emitter, 'error', { message: `workflow sequence failed: ${m}`, fatal: false, recoverable: true });
      lines.push(`Error: ${m}`);
    }

    const report = `Engagement complete. ${lines.join(' ')}`;
    this.setState({ ...this.state, phase: 'done' });
    await ctx.status(emitter, 'done', 'workflow sequence complete');
    this.broadcast(JSON.stringify({ type: 'status', phase: 'done' }));
    this.broadcast(JSON.stringify({ type: 'hermes', text: report }));
    await ctx.close();

    return { phase: 'done', repoUrl: nextRepo, report };
  }

  /** Sandbox-runner base URL (var override, else the known deploy). */
  private sandboxRunnerUrl(): string {
    const fromEnv = (this.env as { SANDBOX_RUNNER_URL?: string }).SANDBOX_RUNNER_URL;
    return fromEnv ?? 'https://watson-sandbox-runner.frankkevinwalsh.workers.dev';
  }

  // ---------------------------------------------------------------- helpers

  private parse(message: WSMessage): Record<string, unknown> | null {
    if (typeof message !== 'string') return null;
    try {
      const v = JSON.parse(message);
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    } catch {
      return { type: 'user', text: message };
    }
  }

  private sendHermes(connection: Connection, text: string): void {
    connection.send(JSON.stringify({ type: 'hermes', text }));
  }
}
