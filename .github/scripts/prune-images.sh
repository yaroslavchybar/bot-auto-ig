#!/bin/sh
set -eu

repository=ghcr.io/yaroslavchybar/bot-auto-ig
# Docker lists newest images first. Read stable fields, not space-separated dates.
images=$(docker image ls "$repository" --no-trunc --format '{{.ID}} {{.Tag}}')
[ -n "$images" ] || exit 0

# Keep two distinct release images per service, even when many tags share one image.
keep=$(printf '%s\n' "$images" | awk '
  $2 ~ /^(server|frontend|spoofer)-[a-f0-9]+$/ {
    split($2, parts, "-")
    if (length(parts[2]) == 40 && !seen[parts[1], $1]++ && count[parts[1]]++ < 2) print $1
  }')
[ -n "$keep" ] || { echo 'Image cleanup skipped: no release images found'; exit 0; }

# Stopped containers also retain image references; preserve every container's image.
containers=$(docker container ls --all --quiet)
for container in $containers; do
  keep="$keep
$(docker container inspect "$container" --format '{{.Image}}')"
done

printf '%s\n' "$images" | while read -r id tag; do
  if printf '%s\n' "$keep" | grep -Fxq "$id"; then continue; fi
  # Untag named project images individually. Never force-remove shared image IDs.
  if printf '%s\n' "$tag" | grep -Eq '^(server|frontend|spoofer)-([a-f0-9]{40}|inputs-[a-f0-9]{64})$'; then
    docker image rm "$repository:$tag"
  fi
done
