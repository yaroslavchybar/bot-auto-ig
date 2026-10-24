# Automation simplification

Automations execute routines directly, one profile at a time. Graph execution,
graph checkpoints, and the configurable worker pool are removed. Profile failures
still record their issue and allow other eligible profiles to run.

- `profiles.paused` is the persistent pause switch. Worker projections derive it.
- `profiles.modelId` holds the optional model assignment. Runtime pages use its index.
- `routine.outreach` holds the optional scraped list, profile selection, and message.
- Successful activity creates analytics history atomically, without opening Analytics.

Production and development settings and analytics history have been migrated. Application code
no longer contains migration jobs or legacy schema fields.
