#!/usr/bin/env bash
# Checks the app image and the connector image on this machine's architecture (ADR-0024): PUID and PGID,
# the program started with node, a connector pairing from its variables and keeping the pairing, and an
# install of a slicer refused on Linux ARM. Linux with Docker and Node; run by .github/workflows/images.yml
# on both architectures, and by release.yml's test build on the images it pushed.
#   scripts/image-test.sh <app image> <connector image>
set -euo pipefail

app=${1:?usage: image-test.sh <app image> <connector image>}
conn=${2:?usage: image-test.sh <app image> <connector image>}
here=$(cd "$(dirname "$0")" && pwd)
hub=http://127.0.0.1:4310
work=$(mktemp -d)
uid=1234

cleanup() {
  docker rm -f -v hub owner conn >/dev/null 2>&1 || true
  docker volume rm -f hub-data owner-data conn-data >/dev/null 2>&1 || true
  sudo rm -rf "$work"
}
# A failed run shows what the containers said before they go.
on_exit() {
  if [ $? -ne 0 ]; then
    for c in hub owner conn; do
      echo "--- $c" >&2
      docker logs "$c" 2>&1 | tail -40 >&2 || true
    done
  fi
  cleanup
}
trap on_exit EXIT
step() { echo "== $*"; }
fail() { echo "FAILED: $*" >&2; exit 1; }
# The image's own HEALTHCHECK says it is up (checked every 5 s here instead of every 30).
healthy() {
  for _ in $(seq 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$1")" = healthy ] && return 0
    sleep 2
  done
  fail "$1 never became healthy"
}
# The user the container's program (PID 1 after the start script's exec) runs as: "0" or "1234".
runs_as() { docker exec "$1" sh -c "awk '/^Uid:/ {print \$2}' /proc/1/status"; }
command_of() { docker exec "$1" sh -c "tr '\0' ' ' < /proc/1/cmdline"; }
not_owned() { docker exec "$1" sh -c "find '$2' ! -user $uid | wc -l"; }
arch=$(docker image inspect -f '{{.Architecture}}' "$app")
[ "$(docker image inspect -f '{{.Architecture}}' "$conn")" = "$arch" ] || fail "the two images are for different architectures"
node_arch=x64
[ "$arch" = arm64 ] && node_arch=arm64
step "images for $arch"

# 1. The app image as a hub, with no PUID: it stays root, as before the variables existed.
step "app image: no PUID stays root, started with node"
docker run -d --name hub --network host --health-interval 5s -e PORT=4310 -e HOST=127.0.0.1 \
  -v hub-data:/data "$app" >/dev/null
healthy hub
[ "$(runs_as hub)" = 0 ] || fail "the app runs as $(runs_as hub) without PUID, not root"
command_of hub | grep -q "src/main.ts" || fail "unexpected start command: $(command_of hub)"
command_of hub | grep -q pnpm && fail "started through pnpm: $(command_of hub)"

# 2. The slicer rule: not on Linux ARM.
step "slicer install on $arch"
node "$here/image-test.mjs" slicer --arch "$node_arch" --hub "$hub"

# 3. The connector, as the PUID user, paired from its variables.
step "connector image: pairs from its variables as PUID $uid"
code=$(node "$here/image-test.mjs" code --hub "$hub")
run_connector() {
  docker run -d --name conn --network host --health-interval 5s \
    -e CONNECTOR_HUB_URL="$hub" -e CONNECTOR_PAIRING_CODE="$1" -e CONNECTOR_NAME=ci-docker \
    -e PUID=$uid -e PGID=$uid -v conn-data:/data "$conn" >/dev/null
}
run_connector "$code"
id=$(node "$here/image-test.mjs" online --hub "$hub")
healthy conn
[ "$(runs_as conn)" = "$uid" ] || fail "the connector runs as $(runs_as conn), not $uid"
[ "$(not_owned conn /data)" = 0 ] || fail "/data has entries not owned by $uid"
step "connector image: a restart and a new container keep the pairing"
docker restart conn >/dev/null
healthy conn
node "$here/image-test.mjs" online --hub "$hub" --id "$id" >/dev/null
docker rm -f conn >/dev/null
run_connector "$code" # the used code, still set: ignored
healthy conn
node "$here/image-test.mjs" online --hub "$hub" --id "$id" >/dev/null
docker rm -f -v conn >/dev/null
docker rm -f -v hub >/dev/null

# 4. PUID and PGID on the app image: /data and the files the app makes in a mounted folder.
step "app image: PUID $uid owns /data and what the app writes in a mounted folder"
mkdir -p "$work/projects"
sudo chown "$uid:$uid" "$work/projects"
docker run -d --name owner --network host --health-interval 5s -e PORT=4310 -e HOST=127.0.0.1 \
  -e PUID=$uid -e PGID=$uid -v owner-data:/data -v "$work/projects:/projects/files" "$app" >/dev/null
healthy owner
[ "$(runs_as owner)" = "$uid" ] || fail "the app runs as $(runs_as owner), not $uid"
made=$(node "$here/image-test.mjs" owner --hub "$hub" --root /projects/files)
folder=$(node -p "JSON.parse(process.argv[1]).folder" "$made")
file=$(node -p "JSON.parse(process.argv[1]).file" "$made")
for path in "$folder" "$file"; do
  [ "$(stat -c '%u:%g' "$work/projects/$path")" = "$uid:$uid" ] || fail "$path is owned by $(stat -c '%u:%g' "$work/projects/$path")"
done
[ "$(not_owned owner /data)" = 0 ] || fail "/data has entries not owned by $uid"
# The next start changes nothing and the app is still up.
docker restart owner >/dev/null
healthy owner
[ "$(not_owned owner /data)" = 0 ] || fail "/data has entries not owned by $uid after a restart"
echo "Images work on $arch."
