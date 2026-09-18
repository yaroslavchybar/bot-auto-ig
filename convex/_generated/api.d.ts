/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as automations_helpers from "../automations/helpers.js";
import type * as automations_mutations from "../automations/mutations.js";
import type * as automations_queries from "../automations/queries.js";
import type * as errors from "../errors.js";
import type * as http from "../http.js";
import type * as httpRoutes_automations from "../httpRoutes/automations.js";
import type * as httpRoutes_lists from "../httpRoutes/lists.js";
import type * as httpRoutes_messageTemplates from "../httpRoutes/messageTemplates.js";
import type * as httpRoutes_profiles from "../httpRoutes/profiles.js";
import type * as httpRoutes_shared from "../httpRoutes/shared.js";
import type * as lists from "../lists.js";
import type * as messageTemplates from "../messageTemplates.js";
import type * as profiles_helpers from "../profiles/helpers.js";
import type * as profiles_mutations from "../profiles/mutations.js";
import type * as profiles_queries from "../profiles/queries.js";
import type * as proxies from "../proxies.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "automations/helpers": typeof automations_helpers;
  "automations/mutations": typeof automations_mutations;
  "automations/queries": typeof automations_queries;
  errors: typeof errors;
  http: typeof http;
  "httpRoutes/automations": typeof httpRoutes_automations;
  "httpRoutes/lists": typeof httpRoutes_lists;
  "httpRoutes/messageTemplates": typeof httpRoutes_messageTemplates;
  "httpRoutes/profiles": typeof httpRoutes_profiles;
  "httpRoutes/shared": typeof httpRoutes_shared;
  lists: typeof lists;
  messageTemplates: typeof messageTemplates;
  "profiles/helpers": typeof profiles_helpers;
  "profiles/mutations": typeof profiles_mutations;
  "profiles/queries": typeof profiles_queries;
  proxies: typeof proxies;
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
