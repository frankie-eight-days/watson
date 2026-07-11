/**
 * env.ts — the Worker/DO environment bag.
 *
 * `wrangler types` generates the ambient global `Env` from wrangler.jsonc (the
 * HERMES DO binding + the vars). Secrets are NOT in wrangler.jsonc, so we merge
 * them into the global `Env` here via declaration merging. `BrainEnv` is just an
 * alias for that merged global `Env` — the Agents SDK constrains its Env type
 * param to this global, so using it keeps `getAgentByName`/DO stubs well-typed.
 *
 * Regenerate the base with `npm run cf-types` after editing wrangler.jsonc.
 */

declare global {
  interface Env {
    // ---- secrets (.dev.vars / `wrangler secret put`) ----
    OPENAI_API_KEY: string;
    LINKUP_API_KEY?: string;
    EXA_API_KEY?: string;
    // ---- optional var not always present in wrangler.jsonc ----
    OPENAI_BASE_URL?: string;
  }
}

/** The merged environment (generated bindings/vars + secrets above). */
export type BrainEnv = Env;
