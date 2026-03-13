---
name: refactor-worker
description: Refactors code while preserving behavior — restructures, splits files, modernizes patterns, enforces size limits
---

# Refactor Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve:
- Restructuring code (DDD grouping, file splitting, module reorganization)
- Simplifying over-engineered patterns
- Enforcing file/function size limits
- Replacing deprecated patterns with modern ones
- Integrating new libraries (Sentry, pino)
- Translating log messages
- Removing dead code
- Adding error handling utilities

## Work Procedure

### Step 1: Understand the Feature Scope

1. Read the feature description, preconditions, expectedBehavior, and verificationSteps carefully.
2. Read `.factory/library/architecture.md` for DDD conventions and integration seams.
3. Read `AGENTS.md` for hard limits and coding conventions.
4. Identify ALL files that will be affected. List them explicitly before starting work.

### Step 2: Catalog Integration Seams

Before modifying any file, identify integration seams that must be preserved:
- **Import paths**: What other files import from the files you're changing?
- **API paths**: Are there HTTP routes, WebSocket message types, or event protocols?
- **Singleton state**: Is the module imported by multiple consumers that need the same instance?
- **Test references**: Do tests import from paths that will change?

Run `rg "from.*<module>" .` for each module you're restructuring to find all consumers.

### Step 3: Write/Update Tests (Red Phase)

If the feature adds NEW functionality (error handling utilities, retry logic, etc.):
1. Write failing tests FIRST that verify the expected behavior.
2. Tests go in the appropriate test directory (tests/convex/, python/tests/, server/*.test.ts).

If the feature is pure restructuring (moving files, splitting):
1. Ensure existing tests still import correctly after the move.
2. Update import paths in tests if needed.
3. Add any characterization tests needed to verify behavior preservation.

### Step 4: Implement the Refactoring

1. **Make one logical change at a time.** Don't restructure + modernize + add features simultaneously.
2. **For file splits:** Create the new files first with extracted code, then update the original to re-export or delegate.
3. **For DDD restructuring:** Move files to new locations, update ALL import paths (use grep to find every consumer).
4. **For pattern replacement:** Replace one pattern at a time (e.g., all console.log → pino in one file, verify, then next).
5. **For size limit enforcement:** Split large files into focused modules. Split large functions into helper functions.
6. **Preserve all public APIs** — if external code calls a function/route, the path must not change (or all callers must be updated).

### Step 5: Verify Size Limits

After implementation, verify hard limits:
- `wc -l <file>` for every modified/created file — must be ≤800 lines
- Check function lengths — must be ≤80 lines each
- If any violation remains, split further before proceeding.

### Step 6: Run All Verification Commands

Run ALL of these (per AGENTS.md):
```bash
npm run test:convex
python -m pytest python/tests -q
npm --prefix server run build
npm --prefix frontend run build
npm --prefix frontend run lint
```

If any command fails:
- Fix the issue immediately
- If you cannot fix it, document it as a discoveredIssue and return to orchestrator

### Step 7: Manual Verification

For each change, verify manually:
1. **Import paths**: `rg "from.*<old_path>" .` returns zero matches (all updated)
2. **No regressions**: Spot-check that related functionality still makes sense
3. **Integration seams**: Verify the seams identified in Step 2 are intact
4. **Size limits**: Every file ≤800, every function ≤80

### Step 8: Commit

Commit with a clear message describing what was refactored and why.

## Example Handoff

```json
{
  "salientSummary": "Split server/api/profiles.ts (537 lines) into profiles/routes.ts (120 lines), profiles/service.ts (180 lines), and profiles/data.ts (150 lines). Updated 8 import paths across server/. All 58 Convex tests pass, server build succeeds, frontend build+lint pass.",
  "whatWasImplemented": "Restructured server profile handling from monolithic api/profiles.ts into DDD domain folder server/profiles/ with separate route, service, and data-access modules. Replaced 6 inline try/catch blocks with asyncHandler wrapper delegating to global error handler. Replaced all console.log calls with pino structured logger.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npm run test:convex", "exitCode": 0, "observation": "58 tests passed" },
      { "command": "python -m pytest python/tests -q", "exitCode": 0, "observation": "221 passed, 1 failed (pre-existing)" },
      { "command": "npm --prefix server run build", "exitCode": 0, "observation": "Clean TypeScript compilation" },
      { "command": "npm --prefix frontend run build", "exitCode": 0, "observation": "Client + SSR build succeeded" },
      { "command": "npm --prefix frontend run lint", "exitCode": 0, "observation": "Zero errors" },
      { "command": "wc -l server/profiles/*.ts", "exitCode": 0, "observation": "routes.ts: 120, service.ts: 180, data.ts: 150 — all under 800" }
    ],
    "interactiveChecks": [
      { "action": "rg 'from.*api/profiles' server/", "observed": "Zero matches — all imports updated to profiles/" },
      { "action": "rg 'console\\.(log|error|warn)' server/profiles/", "observed": "Zero matches — all use pino logger" },
      { "action": "Checked function lengths in profiles/service.ts", "observed": "Longest function: 45 lines (reconcileRuntimeStatuses)" }
    ]
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on code that was supposed to be created by a previous feature but doesn't exist
- Integration seam broken and you can't determine how to fix without broader context
- A test failure you can't resolve (not the pre-existing one)
- File/function splitting requires design decisions about domain boundaries that aren't clear
- You discover a circular dependency that would require architectural changes
- Build fails due to external dependency issues (Convex cloud, npm registry)
