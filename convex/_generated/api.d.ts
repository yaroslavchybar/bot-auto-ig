/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as httpRoutes_instagramAccounts from "../httpRoutes/instagramAccounts.js";
import type * as httpRoutes_keywords from "../httpRoutes/keywords.js";
import type * as httpRoutes_lists from "../httpRoutes/lists.js";
import type * as httpRoutes_messageTemplates from "../httpRoutes/messageTemplates.js";
import type * as httpRoutes_profiles from "../httpRoutes/profiles.js";
import type * as httpRoutes_scrapingAccounts from "../httpRoutes/scrapingAccounts.js";
import type * as httpRoutes_shared from "../httpRoutes/shared.js";
import type * as httpRoutes_workflowArtifacts from "../httpRoutes/workflowArtifacts.js";
import type * as httpRoutes_workflows from "../httpRoutes/workflows.js";
import type * as instagramAccounts from "../instagramAccounts.js";
import type * as keywords from "../keywords.js";
import type * as lists from "../lists.js";
import type * as messageTemplates from "../messageTemplates.js";
import type * as profiles_helpers from "../profiles/helpers.js";
import type * as profiles_mutations from "../profiles/mutations.js";
import type * as profiles_queries from "../profiles/queries.js";
import type * as profiles_scraping from "../profiles/scraping.js";
import type * as scrapingAccounts from "../scrapingAccounts.js";
import type * as workflowArtifacts from "../workflowArtifacts.js";
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
  auth: typeof auth;
  crons: typeof crons;
  http: typeof http;
  "httpRoutes/instagramAccounts": typeof httpRoutes_instagramAccounts;
  "httpRoutes/keywords": typeof httpRoutes_keywords;
  "httpRoutes/lists": typeof httpRoutes_lists;
  "httpRoutes/messageTemplates": typeof httpRoutes_messageTemplates;
  "httpRoutes/profiles": typeof httpRoutes_profiles;
  "httpRoutes/scrapingAccounts": typeof httpRoutes_scrapingAccounts;
  "httpRoutes/shared": typeof httpRoutes_shared;
  "httpRoutes/workflowArtifacts": typeof httpRoutes_workflowArtifacts;
  "httpRoutes/workflows": typeof httpRoutes_workflows;
  instagramAccounts: typeof instagramAccounts;
  keywords: typeof keywords;
  lists: typeof lists;
  messageTemplates: typeof messageTemplates;
  "profiles/helpers": typeof profiles_helpers;
  "profiles/mutations": typeof profiles_mutations;
  "profiles/queries": typeof profiles_queries;
  "profiles/scraping": typeof profiles_scraping;
  scrapingAccounts: typeof scrapingAccounts;
  workflowArtifacts: typeof workflowArtifacts;
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
  crons: {
    public: {
      del: FunctionReference<
        "mutation",
        "internal",
        { identifier: { id: string } | { name: string } },
        null
      >;
      get: FunctionReference<
        "query",
        "internal",
        { identifier: { id: string } | { name: string } },
        {
          args: Record<string, any>;
          functionHandle: string;
          id: string;
          name?: string;
          schedule:
            | { kind: "interval"; ms: number }
            | { cronspec: string; kind: "cron"; tz?: string };
        } | null
      >;
      list: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          args: Record<string, any>;
          functionHandle: string;
          id: string;
          name?: string;
          schedule:
            | { kind: "interval"; ms: number }
            | { cronspec: string; kind: "cron"; tz?: string };
        }>
      >;
      register: FunctionReference<
        "mutation",
        "internal",
        {
          args: Record<string, any>;
          functionHandle: string;
          name?: string;
          schedule:
            | { kind: "interval"; ms: number }
            | { cronspec: string; kind: "cron"; tz?: string };
        },
        string
      >;
    };
  };
};
