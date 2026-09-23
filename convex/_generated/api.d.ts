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
import type * as crons from "../crons.js";
import type * as errors from "../errors.js";
import type * as http from "../http.js";
import type * as httpRoutes_automations from "../httpRoutes/automations.js";
import type * as httpRoutes_leadLists from "../httpRoutes/leadLists.js";
import type * as httpRoutes_lists from "../httpRoutes/lists.js";
import type * as httpRoutes_messageTemplates from "../httpRoutes/messageTemplates.js";
import type * as httpRoutes_profiles from "../httpRoutes/profiles.js";
import type * as httpRoutes_routines from "../httpRoutes/routines.js";
import type * as httpRoutes_scraper from "../httpRoutes/scraper.js";
import type * as httpRoutes_shared from "../httpRoutes/shared.js";
import type * as httpRoutes_warmup from "../httpRoutes/warmup.js";
import type * as instagramUsername from "../instagramUsername.js";
import type * as leadMemberships from "../leadMemberships.js";
import type * as leads from "../leads.js";
import type * as lists from "../lists.js";
import type * as messageTemplates from "../messageTemplates.js";
import type * as profiles_helpers from "../profiles/helpers.js";
import type * as profiles_mutations from "../profiles/mutations.js";
import type * as profiles_queries from "../profiles/queries.js";
import type * as proxies from "../proxies.js";
import type * as routinePolicy from "../routinePolicy.js";
import type * as routines from "../routines.js";
import type * as scraper from "../scraper.js";
import type * as scraperKeys from "../scraperKeys.js";
import type * as serverBridgeAuth from "../serverBridgeAuth.js";
import type * as warmup_helpers from "../warmup/helpers.js";
import type * as warmup_mutations from "../warmup/mutations.js";
import type * as warmup_queries from "../warmup/queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "automations/helpers": typeof automations_helpers;
  "automations/mutations": typeof automations_mutations;
  "automations/queries": typeof automations_queries;
  crons: typeof crons;
  errors: typeof errors;
  http: typeof http;
  "httpRoutes/automations": typeof httpRoutes_automations;
  "httpRoutes/leadLists": typeof httpRoutes_leadLists;
  "httpRoutes/lists": typeof httpRoutes_lists;
  "httpRoutes/messageTemplates": typeof httpRoutes_messageTemplates;
  "httpRoutes/profiles": typeof httpRoutes_profiles;
  "httpRoutes/routines": typeof httpRoutes_routines;
  "httpRoutes/scraper": typeof httpRoutes_scraper;
  "httpRoutes/shared": typeof httpRoutes_shared;
  "httpRoutes/warmup": typeof httpRoutes_warmup;
  instagramUsername: typeof instagramUsername;
  leadMemberships: typeof leadMemberships;
  leads: typeof leads;
  lists: typeof lists;
  messageTemplates: typeof messageTemplates;
  "profiles/helpers": typeof profiles_helpers;
  "profiles/mutations": typeof profiles_mutations;
  "profiles/queries": typeof profiles_queries;
  proxies: typeof proxies;
  routinePolicy: typeof routinePolicy;
  routines: typeof routines;
  scraper: typeof scraper;
  scraperKeys: typeof scraperKeys;
  serverBridgeAuth: typeof serverBridgeAuth;
  "warmup/helpers": typeof warmup_helpers;
  "warmup/mutations": typeof warmup_mutations;
  "warmup/queries": typeof warmup_queries;
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
