#!/bin/sh
set -eu

# Stage validation leaves the running release untouched. Keep one rollback copy
# through activation and health checks; persistent data stays outside both dirs.
root=$(cd "${1:-$HOME/ig-bot}" && pwd -P)
active="$root/app"
staged="$root/app.new"
previous="$root/app.prev"
token="$root/secrets/axiom-token"
caddy="$(dirname "$root")/caddy/conf.d/ig-bot.caddy"
test -f "$staged/docker-compose.prod.yml"
test -f "$staged/.env"
test -s "$staged/.axiom-token"
if [ -e "$previous" ]; then
  echo 'Previous release still exists; recover the interrupted deployment first.' >&2
  exit 1
fi

compose() {
  release=$1
  shift
  # Staging must use the same project identity as ~/ig-bot/app.
  docker compose --project-name app --project-directory "$release" \
    --env-file "$release/.env" -f "$release/docker-compose.prod.yml" "$@"
}

compose "$staged" pull
docker run --rm \
  --user 0:0 --read-only --cap-drop ALL --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges:true \
  -v /var/lib/vector \
  -v "$staged/deploy:/etc/vector:ro" \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v "$staged/.axiom-token:/run/secrets/axiom_token:ro" \
  timberio/vector:0.58.0-debian validate /etc/vector/vector.toml
docker volume create ig-bot-vector-data > /dev/null
if [ -f "$token" ]; then cp "$token" "$staged/.previous-axiom-token"; fi
if [ -f "$caddy" ]; then cp "$caddy" "$staged/.previous-caddy"; fi

rollback() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$status" -ne 0 ] && [ -d "$previous" ]; then
    echo 'Deployment failed; restoring the previous release.' >&2
    if [ -d "$active" ]; then mv "$active" "$staged"; fi
    mv "$previous" "$active"
    if [ -f "$staged/.previous-axiom-token" ]; then
      cp "$staged/.previous-axiom-token" "$token"
    else
      rm -f "$token"
    fi
    if [ -f "$staged/.previous-caddy" ]; then
      cp "$staged/.previous-caddy" "$caddy"
    else
      rm -f "$caddy"
    fi
    if ! compose "$active" up -d --remove-orphans --pull never --force-recreate; then
      echo 'Rollback could not restart the previous containers; manual recovery required.' >&2
    fi
    if ! docker exec caddy caddy reload --config /etc/caddy/Caddyfile; then
      echo 'Rollback could not reload Caddy; manual recovery required.' >&2
    fi
  fi
  exit "$status"
}
trap rollback EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ -d "$active" ]; then mv "$active" "$previous"; fi
mv "$staged" "$active"
mkdir -p "$(dirname "$token")" "$(dirname "$caddy")"
cp "$active/.axiom-token" "$token"
chmod 600 "$token"
compose "$active" up -d --remove-orphans
cp "$active/deploy/ig-bot.caddy" "$caddy"
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
# Retry readiness through nginx as well as the server; container creation alone
# does not establish application health.
curl --fail --silent --show-error --retry 12 --retry-delay 2 --retry-all-errors \
  --retry-max-time 60 --max-time 5 http://127.0.0.1:3101/api/health > /dev/null

trap - EXIT HUP INT TERM
rm -f "$active/.previous-axiom-token" "$active/.previous-caddy" "$active/.axiom-token"
rm -rf "$previous"
if ! sh "$active/.github/scripts/prune-images.sh"; then
  echo 'Image cleanup failed; the healthy release remains active.' >&2
fi
