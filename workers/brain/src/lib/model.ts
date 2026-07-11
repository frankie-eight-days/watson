/**
 * model.ts — the ONE model client. Every agent's intelligence flows through
 * `callModel`. Swapping the venue proxy or a model id is a one-line/env change
 * because the entire OpenAI API surface is confined to this module.
 *
 * API surface choice: **Chat Completions** (`client.chat.completions.create`).
 * Rationale: it is the most portable tool-calling surface (works verbatim
 * against OpenAI and virtually every OpenAI-compatible venue proxy), has a
 * stable request/response shape across SDK majors, and gives us `usage`
 * (prompt/completion tokens) directly for the observability cost columns. If a
 * venue mandates the Responses API instead, only this file changes.
 */

import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

/** Reasoning effort levels. terra runs high; luna runs cheap/low. */
export type Effort = 'low' | 'medium' | 'high' | 'max';

export interface ModelConfig {
  apiKey: string;
  /** Optional venue-proxy base URL (OpenAI-compatible). */
  baseUrl?: string;
  /** High-effort model id (Hermes, orchestrators, MAD/synthesis). */
  terra: string;
  /** Cheap fan-out model id (screening, grading). */
  luna: string;
}

/** A tool exposed to the model, JSON-Schema parameters. */
export interface ModelToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A tool call the model wants us to run, parsed from the response. */
export interface ParsedToolCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface CallModelArgs {
  model: string;
  messages: ChatCompletionMessageParam[];
  effort?: Effort;
  tools?: ModelToolDef[];
  /** Hard cap on output tokens (optional). */
  maxTokens?: number;
}

export interface CallModelResult {
  text: string;
  toolCalls: ParsedToolCall[];
  usage: { tokensIn: number; tokensOut: number };
  /** Raw assistant message — push back into `messages` to continue a tool loop. */
  message: ChatCompletionMessageParam;
}

/** OpenAI reasoning models accept low|medium|high; we fold 'max' → 'high'. */
function reasoningEffort(effort?: Effort): 'low' | 'medium' | 'high' | undefined {
  if (!effort) return undefined;
  return effort === 'max' ? 'high' : effort;
}

export class ModelClient {
  private readonly client: OpenAI;
  readonly terra: string;
  readonly luna: string;

  constructor(cfg: ModelConfig) {
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
    });
    this.terra = cfg.terra;
    this.luna = cfg.luna;
  }

  /**
   * One model round-trip. Returns the assistant text, any tool calls the model
   * requested (correlated by callId), token usage, and the raw assistant
   * message so a harness can continue an agentic loop by appending tool results.
   */
  async call(args: CallModelArgs): Promise<CallModelResult> {
    const tools: ChatCompletionTool[] | undefined = args.tools?.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const effort = reasoningEffort(args.effort);

    const res = await this.client.chat.completions.create({
      model: args.model,
      messages: args.messages,
      ...(tools ? { tools } : {}),
      ...(effort ? { reasoning_effort: effort } : {}),
      ...(args.maxTokens ? { max_completion_tokens: args.maxTokens } : {}),
    });

    const choice = res.choices[0];
    const message = choice?.message;
    const text = message?.content ?? '';

    const toolCalls: ParsedToolCall[] = [];
    for (const tc of message?.tool_calls ?? []) {
      if (tc.type !== 'function') continue;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        parsed = { _raw: tc.function.arguments };
      }
      toolCalls.push({ callId: tc.id, name: tc.function.name, args: parsed });
    }

    return {
      text,
      toolCalls,
      usage: {
        tokensIn: res.usage?.prompt_tokens ?? 0,
        tokensOut: res.usage?.completion_tokens ?? 0,
      },
      message: (message as ChatCompletionMessageParam) ?? { role: 'assistant', content: text },
    };
  }
}

/** Build a ModelClient from a Watson env bag, applying the PLAN model defaults. */
export function modelClientFromEnv(env: {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  MODEL_TERRA?: string;
  MODEL_LUNA?: string;
}): ModelClient {
  return new ModelClient({
    apiKey: env.OPENAI_API_KEY ?? '',
    baseUrl: env.OPENAI_BASE_URL,
    terra: env.MODEL_TERRA ?? 'gpt-5.6-terra',
    luna: env.MODEL_LUNA ?? 'gpt-5.6-luna',
  });
}
