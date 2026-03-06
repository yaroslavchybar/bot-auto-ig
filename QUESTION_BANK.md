# PRD Question Bank (required)

Answer every section that applies. If something is unknown, label it **ASSUMPTION** and specify a default.

## Format rule (required)

For each decision question you ask the owner, provide options using this format
so they can answer quickly like `1a, 2c, 3a (+ note...)`:

1. The question (what decision we are making)
   a) Option A (Recommended) — why recommended
   b) Option B — tradeoff
   c) Option C — tradeoff
   d) Other — owner free-form

## A) Problem and stakes (required)

- What does the user/system observe today (1 sentence)?
- Why is that a problem (impact/risk, 1 sentence)?
- What is the goal (WHY + expected behavior)?
- What happens if we do nothing for 30 days?
- What is explicitly out of scope?

## B) Success definition (required)

- What are the pass/fail acceptance criteria (bullet list)?
  - Include at least one negative test (“should not …”).
- What is the required proof plan (commands + expected outputs)?
- What artifacts are produced (files/paths, issue comment contents, dashboards)?

## C) Scope boundaries (required)

- What must NOT change (explicit “do-not-change” list)?
  - Examples: production configuration, historical results, billing math, schema constraints.
- What is allowed to change?

## D) Data model and cohorts (required if data/backfills/analytics)

- What is the cohort definition?
  - Exact filter rules (fields + values).
- What does “ALL records” mean?
  - Tables/views, filtering rules, and time bounds.
- What are the required fields/columns?
  - Explicit list (no “examples”).
- Time handling:
  - UTC vs local, date vs datetime semantics, trading-day semantics.

## E) Failure modes and safety (required)

- What can go wrong?
  - rate limits, partial runs, retries, idempotence, schema mismatch, missing fields
- What is the safe dry-run plan?
  - sample size, what gets logged, how we verify no unintended writes
- What is the rollback plan?
  - how to revert safely and/or how to re-run idempotently

## F) Operational closure (required if scripts/backfills/audits)

- What must be executed end-to-end to claim solved?
- What evidence must be posted before closing?
  - totals, coverage %, mismatch totals, and 3 concrete IDs/examples

## G) Decomposition (required)

- List the child TASK issues we will create (titles + what each proves).
- Identify the mandatory final TASK: `Execution: run end-to-end + post evidence`.