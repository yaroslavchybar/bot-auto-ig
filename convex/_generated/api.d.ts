/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as errors from "../errors.js";
import type * as http from "../http.js";
import type * as httpRoutes_lists from "../httpRoutes/lists.js";
import type * as httpRoutes_messageTemplates from "../httpRoutes/messageTemplates.js";
import type * as httpRoutes_profiles from "../httpRoutes/profiles.js";
import type * as httpRoutes_shared from "../httpRoutes/shared.js";
import type * as httpRoutes_workflows from "../httpRoutes/workflows.js";
import type * as lists from "../lists.js";
import type * as messageTemplates from "../messageTemplates.js";
import type * as profiles_helpers from "../profiles/helpers.js";
import type * as profiles_mutations from "../profiles/mutations.js";
import type * as profiles_queries from "../profiles/queries.js";
import type * as proxies from "../proxies.js";
import type * as workflows_helpers from "../workflows/helpers.js";
import type * as workflows_mutations from "../workflows/mutations.js";
import type * as workflows_queries from "../workflows/queries.js";
import type * as workflows_scheduling from "../workflows/scheduling.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  errors: typeof errors;
  http: typeof http;
  "httpRoutes/lists": typeof httpRoutes_lists;
  "httpRoutes/messageTemplates": typeof httpRoutes_messageTemplates;
  "httpRoutes/profiles": typeof httpRoutes_profiles;
  "httpRoutes/shared": typeof httpRoutes_shared;
  "httpRoutes/workflows": typeof httpRoutes_workflows;
  lists: typeof lists;
  messageTemplates: typeof messageTemplates;
  "profiles/helpers": typeof profiles_helpers;
  "profiles/mutations": typeof profiles_mutations;
  "profiles/queries": typeof profiles_queries;
  proxies: typeof proxies;
  "workflows/helpers": typeof workflows_helpers;
  "workflows/mutations": typeof workflows_mutations;
  "workflows/queries": typeof workflows_queries;
  "workflows/scheduling": typeof workflows_scheduling;
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

export declare const components: {
  crons: import("@convex-dev/crons/_generated/component.js").ComponentApi<"crons">;
};
