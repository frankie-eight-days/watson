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
import { SteeringGate } from './lib/steering';
import { TerraLoopHarness } from './lib/harness';
import { modelClientFromEnv } from './lib/model';
import { runWatercooler } from './workflows/watercooler';
import { runLibrary, type Pitch } from './workflows/library';
import { runLab } from './workflows/lab';
import { extractJson } from './workflows/util';

const PRESIDENT_PROMPT = `You are Hermes, the president of Watson — an AI research agency retained to make a client's coding agents run longer on a benchmark (a Vending-Bench fork). You run the engagement like a consulting principal.

YOUR JOB IN CHAT is to establish two things before any work starts:
  (a) the TARGET REPO URL to work on, and
  (b) the METRIC / GOAL the client wants moved (e.g. "survive more days before bankruptcy", "higher end-of-run Total Assets").
Ask sharp, concise clarifying questions until you have both. As soon as you know both, reflect them back explicitly in this shape: "I've got it: repo <URL>, goal <goal>. Say COMMENCE when you're ready." Be decisive and brief. Do NOT start real work in chat — on COMMENCE you dispatch the research teams (watercooler ingestion, library paper pipeline, lab experiments).`;

const MAX_HISTORY = 24;

export interface HermesState {
  engagementId: string;
  repoUrl?: string;
  /** The client's goal/metric captured during chat scoping. */
  goal?: string;
  /** True once both repo + goal are established (UI can enable COMMENCE). */
  ready?: boolean;
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
      convexApiUrl: this.env.CONVEX_URL,
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
   * Steering seam: pull any unconsumed operator steering targeting `agentId`,
   * consume it, and return the texts. The harness (TerraLoopHarness) injects each
   * as a user-role message AND re-emits a `steering` event, so the console shows
   * the message landed and was applied. Safe: returns [] on any Convex error.
   */
  private async pollSteering(agentId: string): Promise<string[]> {
    try {
      const gate = new SteeringGate(this.env.CONVEX_URL, fetch.bind(globalThis));
      const rows = await gate.pending(agentId);
      const texts: string[] = [];
      for (const row of rows) {
        await gate.consume(row.steeringId);
        texts.push(`[Operator steering]: ${row.text}`);
      }
      return texts;
    } catch {
      return [];
    }
  }

  // --------------------------------------------------------------- lifecycle

  override async onConnect(connection: Connection, _ctx: ConnectionContext): Promise<void> {
    // Greet SYNCHRONOUSLY and FIRST so the greeting can never trail the user's
    // first message. Only greet a FRESH engagement (no history, not yet
    // commenced) — a reconnect to an in-progress/scoped engagement stays quiet.
    const fresh =
      !this.state.hermesSpawned &&
      (this.state.history?.length ?? 0) === 0 &&
      this.state.phase === 'bench';
    if (fresh) {
      this.sendHermes(
        connection,
        `Hermes online for engagement "${this.name}". Tell me the target repo and the metric you want moved, and I'll confirm scope before you COMMENCE.`,
      );
    }
    // Emit the Hermes spawn (best-effort, AFTER greeting so it never blocks it).
    try {
      const ctx = this.makeContext();
      await this.hermesEmitter(ctx);
      await ctx.close();
    } catch (err) {
      console.error('onConnect emit failed:', err);
    }
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

    // Reply to the client immediately, then capture scope best-effort (so a slow
    // or failed extraction never delays the chat turn).
    await ctx.status(emitter, 'waiting', 'awaiting client');
    this.sendHermes(connection, result.text || '(no response)');
    await this.captureScope(nextHistory);
    await ctx.close();
  }

  /**
   * Best-effort scope capture: a cheap luna extraction over the transcript pulls
   * the target repo URL + goal, persisted into DO state so COMMENCE (and the UI's
   * enable-COMMENCE affordance) can use them. Never throws; never clobbers a
   * known value with null.
   */
  private async captureScope(history: ChatCompletionMessageParam[]): Promise<void> {
    try {
      const transcript = history
        .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : ''}`)
        .join('\n')
        .slice(-4000);
      const res = await modelClientFromEnv(this.env).call({
        model: this.env.MODEL_LUNA,
        effort: 'low',
        maxTokens: 200,
        messages: [
          {
            role: 'system',
            content:
              'Extract the engagement scope from this consulting chat. Reply ONLY JSON: {"repoUrl": string|null, "goal": string|null, "ready": boolean}. repoUrl = the GitHub repo the client wants worked on (null if not stated). goal = a short phrase for the metric/outcome they want moved (null if not stated). ready = true only if BOTH repoUrl and goal are known.',
          },
          { role: 'user', content: transcript },
        ],
      });
      const parsed = extractJson<{ repoUrl?: string | null; goal?: string | null; ready?: boolean }>(res.text);
      if (!parsed) return;
      const repoUrl =
        typeof parsed.repoUrl === 'string' && /github\.com/i.test(parsed.repoUrl)
          ? parsed.repoUrl
          : this.state.repoUrl;
      const goal = typeof parsed.goal === 'string' && parsed.goal.trim() ? parsed.goal.trim() : this.state.goal;
      const ready = Boolean(repoUrl) && Boolean(goal);
      this.setState({ ...this.state, repoUrl, goal, ready });
    } catch (err) {
      console.error('captureScope failed (non-fatal):', err);
    }
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
    const goal = this.state.goal ?? 'make the coding agent survive longer (more days before bankruptcy, higher end-of-run Total Assets)';
    this.setState({ ...this.state, repoUrl: nextRepo, phase: 'ingestion' });

    const ctx = this.makeContext();
    const emitter = await this.hermesEmitter(ctx);
    const model = modelClientFromEnv(this.env);

    const lines: string[] = [];
    try {
      // ---- Phase 1: Watercooler (repo ingestion) ----
      await ctx.status(emitter, 'running', 'phase: watercooler');
      this.broadcast(JSON.stringify({ type: 'status', phase: 'watercooler', repoUrl: nextRepo }));
      await ctx.emit(emitter, 'thought', { text: `COMMENCE for ${nextRepo}. Client goal: ${goal}. Dispatching the watercooler ingestion team.`, title: 'commence' });

      const wc = await runWatercooler(ctx, { parentAgentId: 'hermes', repoUrl: nextRepo, ref: 'main', goal, model });
      await ctx.emit(emitter, 'thought', { text: `Ingestion done: "${wc.dossierTitle}". Weakness: ${wc.weakness}`, title: 'review' });
      lines.push(`Dossier: "${wc.dossierTitle}".`);

      // ---- Phase 2: Library (Linkup paper pipeline → pitches) ----
      this.setState({ ...this.state, phase: 'library' });
      await ctx.status(emitter, 'running', 'phase: library');
      this.broadcast(JSON.stringify({ type: 'status', phase: 'library' }));

      // Steering checkpoint between phases: operator can redirect delegation.
      const hermesSteer = await ctx.checkSteering(emitter, 'hermes');
      if (hermesSteer.length) {
        await ctx.emit(emitter, 'thought', { text: `Operator steering before library: ${hermesSteer.join(' | ')}. Threading it into the research director.`, title: 'steering' });
      }

      const lib = await runLibrary(ctx, {
        parentAgentId: 'hermes',
        dossierBody: wc.dossierBody,
        weakness: wc.weakness,
        goal,
        linkupApiKey: this.env.LINKUP_API_KEY,
        exaApiKey: this.env.EXA_API_KEY,
        steer: hermesSteer,
        model,
      });
      const top: Pitch | undefined = lib.pitches[0];
      await ctx.emit(emitter, 'thought', { text: `Library returned ${lib.pitches.length} pitches. Top: "${top?.title}" (arXiv:${top?.arxiv}). Dispatching all pitches to the lab in parallel.`, title: 'review' });
      lines.push(`${lib.pitches.length} pitches; top "${top?.title}".`);

      // ---- Phase 3: Lab (author code live per pitch, prove in the sandbox) ----
      if (lib.pitches.length) {
        this.setState({ ...this.state, phase: 'lab' });
        await ctx.status(emitter, 'running', 'phase: lab');
        this.broadcast(JSON.stringify({ type: 'status', phase: 'lab' }));

        const lab = await runLab(ctx, {
          hermesAgentId: 'hermes',
          hermesEmitter: emitter,
          engagementId: this.name,
          pitches: lib.pitches,
          repoUrl: nextRepo,
          sandboxRunnerUrl: this.sandboxRunnerUrl(),
          convexApiUrl: this.env.CONVEX_URL,
          goal,
          model,
        });
        const wins = lab.outcomes.filter((o) => o.verdict === 'validated');
        lines.push(
          `Lab: baseline $${lab.baseline?.toFixed(2)}; ${wins.length}/${lab.outcomes.length} pitches validated${lab.prUrls.length ? `; PR(s): ${lab.prUrls.join(', ')}` : ''}.`,
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
