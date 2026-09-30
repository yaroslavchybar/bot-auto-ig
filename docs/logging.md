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
[Vector Axiom sink](https://vector.dev/docs/reference/configuration/sinks/axiom/),
[Vector secrets](https://vector.dev/docs/reference/configuration/secrets/),
[Convex log streams](https://docs.convex.dev/production/integrations/log-streams).
