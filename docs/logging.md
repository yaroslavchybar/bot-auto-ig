# Production logs

The API, automation/manual workers, and image service emit redacted JSON.
Vector 0.58.0 collects `ig-bot-server` and `ig-bot-spoofer` Docker stdout/stderr,
parses canonical events, and batches them into Axiom's `ig-bot-prod` dataset
in US East. Retention uses the organization default (30 days at setup).
Dev logs stay local. Browser errors continue through Sentry.

The pipeline preserves business fields, nested context, errors, and correlation
IDs. `_time` comes from the original millisecond `ts`, not the delivery time.
Docker metadata is under `container`. Partial Docker lines are reassembled.
Plain subprocess output, IPC messages, and malformed/noncanonical JSON are
discarded. No sampling is configured. Do not send raw payloads or private data.

Vector retries failed delivery with a persistent 512 MiB disk buffer. Docker's
source is best effort: downtime/restarts or exhausted Docker log retention can
lose unread events. Sink retries can create duplicates; use `id` to deduplicate
when counting exact operations. Vector's own diagnostics remain in its Docker
logs and are excluded from ingestion to avoid feedback loops.

## Application events

Use the shared `logOperation` helper for each request or background job. Add
business counts and decisions with `addLogContext`; log steps inside the scope
only when they help explain the result. The helper emits one completion event
in `finally`, including duration, outcome, deployment details, and correlation.
It keeps the latest 20 notes and total counts per step, so add important totals
directly to the completion context instead of relying on the note history.

Failed profile scopes add a redacted `automation.profile_failed` note to their
parent session, including the child operation ID. A handled profile failure
therefore remains an error in the session and native process completion logs,
even when the worker exits with code 0. Process `context.workerStatus` records
the scheduling status separately: a pending retry stays pending. Stderr warnings
alone do not fail a process, and explicit cancellation keeps its cancelled outcome.

Request IDs must contain 8–128 ASCII letters, digits, underscores, or hyphens.
Invalid IDs are replaced; nested operations retain a valid parent ID. Propagate
`currentRequestId()` to service and worker boundaries rather than starting a
new correlation at each hop. Register credentials with `redactLogValues` before
calling libraries that may include their arguments in errors. Redaction is a
last safeguard: prefer counts and IDs over response bodies or account content.

Rust startup, HTTP, browser-process, account-login, and scraper completions use
the common log writer too. It redacts credential fields and configured secrets,
limits detail strings to 4,000 characters, arrays to 30 items, object fields to
100, and nesting to six levels. Bun child events use the existing relay path,
which preserves their original identity and deployment context. Account login
attempts and their cleanup requests share the login completion's request ID. Scraper completion
events include a failed final save without hiding the original task result.

## Dataset schema

Configure `context` as an Axiom **map field** in `ig-bot-prod`. This is a
dataset setting, not a JSON encoding change: the collector continues to send
the same nested objects. It was enabled on October 22, 2026. Custom attributes,
notes, decision details, and event names in `context.stepCounts` now share one
field instead of creating a field for every key.

Keep the stable envelope (`event`, `level`, `outcome`, IDs, `durationMs`), error
fields, environment, and container metadata as ordinary fields. Add variable
business details inside `context`, never as new top-level fields. Filter on
time and ordinary fields first; map lookups cost more query work and their
keys are not listed in schema autocomplete.

For a replacement dataset, create the `context` map before collecting logs:
**Datasets → select dataset → fields list More → Create map field → context**.
Use an administrator's session for this one-time setting. The production
collector must retain its existing ingest-only token.

The change does not rewrite older events or immediately free their fields.
Preserve them for historical queries. Once the old events leave retention,
use **Settings → Datasets and views → Vacuum fields** to remove the unused
field definitions. Vacuuming does not delete events. Do not delete old fields
or trim the dataset just to reduce the count: that removes historical data.

## Deploy

`AXIOM_INGEST_TOKEN` is a GitHub Actions secret with **only ingest** access to
`ig-bot-prod`. Never use a personal access token in the collector. CI writes it
to `~/ig-bot/secrets/axiom-token` with restrictive permissions. Docker mounts it
as a secret, and Vector uses its directory secret backend. The token is never
put in the server/frontend environment or committed to the repository.
Vector runs as root with only `DAC_OVERRIDE` retained so it can read the
host-user-owned mode-600 token. Validation uses the same user and restrictions,
with a temporary writable volume instead of the active collector's buffer.

The existing main-branch workflow validates Vector config, transforms, and live
Axiom connectivity before starting the production collector. Its named volume
`ig-bot-vector-data` survives replacement of the application directory. Deploy
only through that workflow; do not deploy manually or delete the buffer volume.
The collector needs Docker socket access to discover/follow the application containers;
the read-only socket mount does not restrict Docker API permissions.

The buffer volume is external to Compose. CI idempotently creates
`ig-bot-vector-data` before `compose up`; existing buffer data is reused.
See [Docker external volumes](https://docs.docker.com/reference/compose-file/volumes/#external).

## Convex

Convex runs outside Docker. Its native Axiom log stream requires Convex Pro,
which was unavailable for the production deployment during setup. Convex HTTP
completion events currently stay in Convex logs; API events still record calls
to the bridge. Axiom is not yet a complete export of Convex logs.

When Pro is available, create a separate `ig-bot-convex-prod` dataset (the
native stream has a different schema), create a second ingest-only token, then
configure production **Settings → Integrations → Axiom**. Include
`environment=production` and `service=convex` attributes. Keep the native
function execution events: they cover browser queries/mutations as well as HTTP
actions. Do not add log forwarding code to every mutation.

## Query

```apl
['ig-bot-prod']
| where level == "error"
| project _time, event, requestId, profileId, error, context
| order by _time desc
```

```apl
['ig-bot-prod']
| where requestId == "REQUEST_ID"
| order by _time asc
```

Map keys use index notation, especially event names containing dots:

```apl
['ig-bot-prod']
| where _time > ago(1h) and event == "http.request"
| extend statusCode = tolong(coalesce(['context']['statusCode'], ['context.statusCode']))
| summarize requests=count() by statusCode
```

The `coalesce` includes ordinary fields from before the map was enabled.
For recent events, access step counts as
`['context']['stepCounts']['automation.routine.notifications']` and notes as
`['context']['notes']`. Older step-count fields contain escaped literal dots;
use Axiom's schema field picker when querying that older structure.

```apl
['ig-bot-prod']
| summarize operations=dcount(id), errors=countif(outcome == "error"),
    p95_ms=percentile(durationMs, 95) by event, bin(_time, 5m)
```

## Validate

With Docker running, use a dummy token directory for checks that don't ingest:

```sh
mkdir -p /tmp/ig-bot-vector-secrets
printf '%s' ci-ingest-token > /tmp/ig-bot-vector-secrets/axiom_token
chmod 600 /tmp/ig-bot-vector-secrets/axiom_token
docker run --rm --user 0:0 --read-only --cap-drop ALL --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges:true -v /var/lib/vector \
  -v "$PWD/deploy:/etc/vector:ro" \
  -v /tmp/ig-bot-vector-secrets:/run/secrets:ro \
  timberio/vector:0.58.0-debian validate --no-environment --skip-healthchecks /etc/vector/vector.toml
docker run --rm --user 0:0 --read-only --cap-drop ALL --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges:true -v /var/lib/vector \
  -v "$PWD/deploy:/etc/vector:ro" \
  -v /tmp/ig-bot-vector-secrets:/run/secrets:ro \
  timberio/vector:0.58.0-debian test /etc/vector/vector.toml
```

After deployment, inspect `docker logs ig-bot-vector` for collector errors and
query Axiom for recent `http.request`, worker, and image-service events. Match
their `environment.commitHash` to the deployed revision. A setup test event
proves dataset/token access; it does not prove the production collector is live.

References: [Axiom Vector guide](https://axiom.co/docs/send-data/vector),
[Axiom map fields](https://axiom.co/docs/apl/data-types/map-fields),
[Axiom field limits](https://axiom.co/docs/reference/limits),
[Axiom dataset maintenance](https://axiom.co/docs/reference/datasets),
[Vector Axiom sink](https://vector.dev/docs/reference/configuration/sinks/axiom/),
[Vector secrets](https://vector.dev/docs/reference/configuration/secrets/),
[Convex log streams](https://docs.convex.dev/production/integrations/log-streams).
