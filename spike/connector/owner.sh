#!/usr/bin/env bash
# 6.3.0 Step 1 spike S4: PUID/PGID for the connector image and the app image.
# Needs: images spike-connector, spike-app (repo Dockerfile, default target) and spike-slicer (target slicer).
set -u
cd "$(dirname "$0")/../.."
T=${RUNNER_TEMP:-/tmp}
r() { echo "RESULT $*"; }
U=$(id -u) G=$(id -g)
health() { for _ in $(seq "$2"); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null)" = healthy ] && return 0; sleep 1; done; return 1; }

r "setpriv in node:22-trixie-slim: $(docker run --rm node:22-trixie-slim sh -c 'command -v setpriv && setpriv --version' | tr '\n' ' ')"
r "runner user $U:$G"

echo "== connector: a /data first used as root, 10k files"
docker run -d --name own1 -v owndata:/data spike-connector > /dev/null
health own1 60 && r "as root: healthy" || r "as root: NOT healthy"
docker rm -f own1 > /dev/null
docker run --rm -v owndata:/data --entrypoint sh spike-connector -c \
  'mkdir -p /data/sync && cd /data/sync && seq 10000 | xargs touch && ls -ln /data | head -5'
docker run -d --name own2 -v owndata:/data -e PUID="$U" -e PGID="$G" spike-connector > /dev/null
health own2 90 && r "PUID: healthy on the old root /data" || r "PUID: NOT healthy"
docker logs own2 2>&1 | head -5 | sed 's/^/  own2| /'
r "PUID first start: $(docker logs own2 2>&1 | grep -o 'spike: chown.*')"
r "PUID process: $(docker exec own2 sh -c 'ps -o user=,uid=,gid=,args= -p 1 2>/dev/null || cat /proc/1/status | grep -E "^(Uid|Gid|Groups)"' | tr '\n' ' ')"
docker restart own2 > /dev/null
health own2 60 || true
r "PUID second start: $(docker logs own2 2>&1 | grep -o 'spike: chown.*' | tail -1)"
r "files in /data not owned by $U: $(docker exec own2 sh -c "find /data ! -user $U | wc -l")"
docker rm -f own2 > /dev/null

echo "== connector: a file written into a bind mount"
mkdir -p "$T/proj"
chmod 777 "$T/proj"
write='require("fs").writeFileSync(process.argv[1],"x")'
docker run --rm -v "$T/proj:/projects" -e PUID="$U" -e PGID="$G" spike-connector node -e "$write" /projects/with-puid.txt
docker run --rm -v "$T/proj:/projects" spike-connector node -e "$write" /projects/without-puid.txt
r "bind mount owners on the host: $(stat -c '%n %U:%G' "$T"/proj/* | tr '\n' ' ')"

echo "== app image with the same entrypoint"
cat > "$T/Dockerfile.app-entry" << 'EOF'
FROM spike-app
COPY spike/connector/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["pnpm", "--filter", "@3d-maker-suite/server", "start"]
EOF
docker build -q -t spike-app-entry -f "$T/Dockerfile.app-entry" . > /dev/null
t0=$(date +%s)
docker run -d --name app1 -e PUID="$U" -e PGID="$G" -v appdata:/data spike-app-entry > /dev/null
health app1 180 && r "app PUID: healthy in $(( $(date +%s) - t0 )) s" || r "app PUID: NOT healthy after 180 s"
docker logs app1 2>&1 | head -15 | sed 's/^/  app1| /'
r "app PUID /data: $(docker exec app1 sh -c 'ls -lna /data' | tr '\n' ';')"
docker rm -f app1 > /dev/null
echo "-- the same with the network cut (does pnpm/corepack fetch anything as that user?)"
docker network create --internal nonet > /dev/null
docker run -d --name app2 --network nonet -e PUID="$U" -e PGID="$G" -v appdata2:/data spike-app-entry > /dev/null
sleep 60
r "app PUID offline: running=$(docker inspect -f '{{.State.Running}}' app2) health=$(docker inspect -f '{{.State.Health.Status}}' app2)"
docker logs app2 2>&1 | head -15 | sed 's/^/  app2| /'
docker rm -f app2 > /dev/null
echo "-- node directly instead of pnpm, offline"
docker run -d --name app3 --network nonet -e PUID="$U" -e PGID="$G" -v appdata3:/data -w /app/apps/server \
  spike-app-entry ./node_modules/.bin/tsx src/main.ts > /dev/null
sleep 45
r "app PUID offline, node directly: health=$(docker inspect -f '{{.State.Health.Status}}' app3)"
docker logs app3 2>&1 | head -8 | sed 's/^/  app3| /'
docker rm -f app3 > /dev/null

echo "== -slicer image: OrcaSlicer extracted into /data/slicers and run as that user"
cat > "$T/Dockerfile.slicer-entry" << 'EOF'
FROM spike-slicer
COPY spike/connector/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
EOF
docker build -q -t spike-slicer-entry -f "$T/Dockerfile.slicer-entry" . > /dev/null
docker run --rm -e PUID="$U" -e PGID="$G" -v slicerdata:/data -w /data spike-slicer-entry sh -c '
  id
  url=$(node -e "fetch(\"https://api.github.com/repos/OrcaSlicer/OrcaSlicer/releases/latest\").then(r=>r.json()).then(j=>console.log(j.assets.find(a=>/Linux.*AppImage$/i.test(a.name)&&!/ubuntu2[02]/i.test(a.name))?.browser_download_url??j.assets.find(a=>/AppImage$/.test(a.name)).browser_download_url))")
  echo "download $url"
  mkdir -p /data/slicers/orca && cd /data/slicers/orca
  node -e "fetch(process.argv[1]).then(r=>r.arrayBuffer()).then(b=>require(\"fs\").writeFileSync(\"orca.AppImage\",Buffer.from(b)))" "$url"
  chmod 755 orca.AppImage && ./orca.AppImage --appimage-extract > /dev/null && echo extracted
  ls -ln /data/slicers/orca | head -3
  timeout 60 ./squashfs-root/AppRun --help > /tmp/help.txt 2>&1; echo "exit $?"; head -5 /tmp/help.txt
' 2>&1 | sed 's/^/  slicer| /'
