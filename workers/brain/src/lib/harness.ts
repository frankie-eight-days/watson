/**
 * harness.ts — the agentic-loop adapter (Hermes eligibility hedge).
 *
 * Watson's president is meant to run on the "Nous Hermes Agent harness". Since
 * that harness is an unknown at the venue, we program every agent against a
 * `HarnessAdapter` SEAM. `TerraLoopHarness` is our own concrete implementation
 * on top of `model.ts`; if the real harness shows up we drop it in behind the
 * same interface and nothing else changes.
 *
 * The loop: model → (tool calls?) → run tools → feed results → repeat until the
 * model stops asking for tools (or maxTurns). Every reasoning step emits a
 * `thought`, every tool use emits a correlated `tool_call`/`tool_result` pair,
 * and model-consuming steps carry token/cost usage.
 *
 * OFFLINE FALLBACK: if the model call throws (no network / bad key at the
 * venue), the harness emits a recoverable `error` + a canned `thought` and
 * returns, so the EVENT PIPE is still proven end-to-end. See `fallbackText`.
 */

import type { Emitter } from '@watson/shared';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { Effort, ModelClient, ParsedToolCall } from './model';

/** A tool the harness can call on the agent's behalf. */
export interface HarnessTool<Ctx = unknown> {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: Ctx): Promise<unknown>;
}

export interface HarnessRunArgs<Ctx = unknown> {
  system: string;
  /** Either a single user string or a full chat transcript to continue. */
  input: string | ChatCompletionMessageParam[];
  tools?: HarnessTool<Ctx>[];
  emitter: Emitter;
  model: string;
  effort?: Effort;
  /** Passed verbatim to each tool's `execute`. */
  ctx?: Ctx;
  /** Max model round-trips before we force-stop the loop (default 6). */
  maxTurns?: number;
  /**
   * Steering seam: called at the TOP of every loop turn. Any strings returned
   * are injected as user-role messages (and emitted as `steering` events) so a
   * human at the console can redirect a running agent. Wave-1 stub returns [].
   */
  getSteering?: () => Promise<string[]>;
}

export interface HarnessResult {
  text: string;
  usage: { tokensIn: number; tokensOut: number };
  turns: number;
  /** The full transcript, so callers can persist chat history. */
  messages: ChatCompletionMessageParam[];
  /** True if the offline canned fallback produced this result. */
  fallback: boolean;
}

/** The seam. Real "Nous Hermes harness" can implement this later. */
export interface HarnessAdapter {
  run<Ctx = unknown>(args: HarnessRunArgs<Ctx>): Promise<HarnessResult>;
}

/** Our concrete loop, driven by `model.ts`, running on terra (or any model). */
export class TerraLoopHarness implements HarnessAdapter {
  constructor(private readonly model: ModelClient) {}

  async run<Ctx = unknown>(args: HarnessRunArgs<Ctx>): Promise<HarnessResult> {
    const maxTurns = args.maxTurns ?? 6;
    const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: args.system }];
    if (typeof args.input === 'string') {
      messages.push({ role: 'user', content: args.input });
    } else {
      messages.push(...args.input);
    }

    const usage = { tokensIn: 0, tokensOut: 0 };
    let lastText = '';

    for (let turn = 0; turn < maxTurns; turn++) {
      // --- steering injection point ---
      if (args.getSteering) {
        const steers = await args.getSteering().catch(() => [] as string[]);
        for (const s of steers) {
          messages.push({ role: 'user', content: s });
          args.emitter.emit('steering', { text: s });
        }
      }

      let result;
      try {
        result = await this.model.call({
          model: args.model,
          messages,
          effort: args.effort,
          tools: args.tools?.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        });
      } catch (err) {
        // Offline / venue-failure fallback: keep the pipe alive.
        const msg = err instanceof Error ? err.message : String(err);
        args.emitter.emit('error', {
          message: `model call failed, using canned fallback: ${msg}`,
          recoverable: true,
        });
        const text = fallbackText(messages);
        args.emitter.emit('thought', { text, title: 'canned (offline)' });
        messages.push({ role: 'assistant', content: text });
        return { text, usage, turns: turn + 1, messages, fallback: true };
      }

      usage.tokensIn += result.usage.tokensIn;
      usage.tokensOut += result.usage.tokensOut;
      messages.push(result.message);

      if (result.text) {
        lastText = result.text;
        args.emitter.emit(
          'thought',
          { text: result.text },
          { tokensIn: result.usage.tokensIn, tokensOut: result.usage.tokensOut, model: args.model },
        );
      }

      if (result.toolCalls.length === 0) {
        return { text: lastText, usage, turns: turn + 1, messages, fallback: false };
      }

      // Run each requested tool, emitting the correlated call/result pair.
      for (const call of result.toolCalls) {
        await this.runTool(call, args, messages);
      }
    }

    return { text: lastText, usage, turns: maxTurns, messages, fallback: false };
  }

  private async runTool<Ctx>(
    call: ParsedToolCall,
    args: HarnessRunArgs<Ctx>,
    messages: ChatCompletionMessageParam[],
  ): Promise<void> {
    const tool = args.tools?.find((t) => t.name === call.name);
    args.emitter.emit('tool_call', { tool: call.name, args: call.args, callId: call.callId });

    let ok = true;
    let resultBody: unknown;
    let error: string | undefined;
    try {
      if (!tool) throw new Error(`unknown tool: ${call.name}`);
      resultBody = await tool.execute(call.args, args.ctx as Ctx);
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : String(err);
    }

    args.emitter.emit('tool_result', {
      tool: call.name,
      callId: call.callId,
      ok,
      ...(ok ? { result: resultBody } : { error }),
    });

    messages.push({
      role: 'tool',
      tool_call_id: call.callId,
      content: JSON.stringify(ok ? (resultBody ?? null) : { error }),
    });
  }
}

/** A deterministic, plausible response when the live model is unreachable. */
function fallbackText(messages: ChatCompletionMessageParam[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const q = typeof lastUser?.content === 'string' ? lastUser.content : '';
  return (
    `Understood. (Offline harness fallback — the live model was unreachable.) ` +
    `I have your request${q ? `: "${q.slice(0, 120)}"` : ''}. ` +
    `To scope this engagement I would confirm the target repo, the metric we are ` +
    `trying to move, and any constraints, then COMMENCE.`
  );
}
