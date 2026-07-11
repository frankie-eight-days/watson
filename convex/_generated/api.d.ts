/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents from "../agents.js";
import type * as domain from "../domain.js";
import type * as engagements from "../engagements.js";
import type * as events from "../events.js";
import type * as fixture from "../fixture.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as memory from "../memory.js";
import type * as metrics from "../metrics.js";
import type * as observability from "../observability.js";
import type * as runs from "../runs.js";
import type * as steering from "../steering.js";
import type * as util from "../util.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  domain: typeof domain;
  engagements: typeof engagements;
  events: typeof events;
  fixture: typeof fixture;
  http: typeof http;
  ingest: typeof ingest;
  memory: typeof memory;
  metrics: typeof metrics;
  observability: typeof observability;
  runs: typeof runs;
  steering: typeof steering;
  util: typeof util;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
