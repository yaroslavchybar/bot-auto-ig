# Templates (required)

## EPIC body template (PRD → EPIC, same issue)

Use this structure:

1) Goal (WHY + expected behavior)
2) Non-goals / out of scope
3) Background / current state (symptoms + links)
4) Requirements (functional + non-functional)
5) Data impact (tables/fields + backfill decision + record selection criteria + idempotency)
6) Approach (reuse candidates + failure modes)
7) Execution / Runbook (required if any real-world action)
8) Acceptance criteria (pass/fail checkboxes)
9) QA plan (commands + required evidence)
10) Rollout / Rollback
11) Risks / unknowns
12) Definition of Done (STRICT; includes “executed + validated” when relevant)
13) Task breakdown (links as checklist; include explicit RUN task if needed)

## TASK body template (child of EPIC)

First line MUST be:
`Epic: #<EPIC_NUMBER>`

Then:

Goal
- …

Acceptance
- [ ] …

Test plan
- [ ] `...`
- Expected: ...

Execution steps (if applicable)
- [ ] Dry-run …
- [ ] Full run (ALL records) …

Evidence to post before closing
- totals: …
- coverage %: …
- mismatch_total: …
- examples (3 IDs): …