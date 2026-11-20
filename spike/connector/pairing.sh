#!/usr/bin/env bash
# 6.3.0 Step 1 spikes S2 (pairing from environment variables) and S3 (updates in a container).
# Needs: the image spike-connector (Dockerfile.connector), pnpm install done, sqlite3, the web build.
# Every measured line starts with RESULT.
set -u
cd "$(dirname "$0")/../.."
T=${RUNNER_TEMP:-/tmp}
IMG=spike-connector
H=http://127.0.0.1:4310
ctl() { node spike/connector/hubctl.mjs "$H" "$@"; }
r() { echo "RESULT $*"; }
GW=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')
HUB_IN="http://$GW:4310"
health() { docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null; }
devices() { ctl devices; }
online() { # name, seconds
  for _ in $(seq "$2"); do devices | grep -q "\"name\":\"$1\",\"online\":true" && return 0; sleep 1; done
  return 1
}
hub_pid=
start_hub() { # port datadir
  (cd apps/server && HOST=0.0.0.0 PORT=$1 APP_DATA_DIR=$2 nohup pnpm exec tsx src/main.ts > "$T/hub-$1.log" 2>&1 &)
  for _ in $(seq 60); do curl -sf "http://127.0.0.1:$1/api/health" > /dev/null && return 0; sleep 1; done
  echo "hub on $1 didn't start"; cat "$T/hub-$1.log"; exit 1
}
stop_hub() { pkill -f "PORT=$1" 2> /dev/null; fuser -k "$1/tcp" 2> /dev/null; sleep 2; }

mkdir -p "$T/hub"
start_hub 4310 "$T/hub"
ctl setup
r "hub $(ctl health) on $H, seen from containers as $HUB_IN"

echo "== 1. first start pairs"
code=$(ctl code)
t0=$(date +%s%N)
docker run -d --name c1 -v c1data:/data \
  -e CONNECTOR_HUB_URL="$HUB_IN" -e CONNECTOR_PAIRING_CODE="$code" -e CONNECTOR_NAME=spike-nas "$IMG" > /dev/null
if online spike-nas 60; then r "1 paired and online in $(( ($(date +%s%N) - t0) / 1000000 )) ms"; else r "1 NOT online"; fi
sleep 12
r "1 container health: $(health c1)"
docker logs c1 2>&1 | sed 's/^/  c1| /'
dev=$(devices | node -pe 'JSON.parse(require("fs").readFileSync(0)).find(d=>d.name==="spike-nas").id')

echo "== 2. docker restart"
docker restart c1 > /dev/null
online spike-nas 60 && r "2 online again after restart" || r "2 NOT online after restart"
docker logs c1 2>&1 | grep spike: | sed 's/^/  c1| /'
r "2 devices on the hub: $(devices | node -pe 'JSON.parse(require("fs").readFileSync(0)).length')"

echo "== 3. container recreated on the same volume (an image update)"
docker rm -f c1 > /dev/null
docker run -d --name c1 -v c1data:/data \
  -e CONNECTOR_HUB_URL="$HUB_IN" -e CONNECTOR_PAIRING_CODE="$code" -e CONNECTOR_NAME=spike-nas "$IMG" > /dev/null
online spike-nas 60 && r "3 online after recreate" || r "3 NOT online after recreate"
docker logs c1 2>&1 | grep spike: | sed 's/^/  c1| /'
r "3 same device id: $(devices | grep -c "\"id\":\"$dev\"") ; devices: $(devices | node -pe 'JSON.parse(require("fs").readFileSync(0)).length')"

echo "== S3. the hub is newer (6.3.99), the connector is a Docker one"
stop_hub 4310
cp package.json "$T/package.json.orig"
node -e 'const f="package.json",p=JSON.parse(require("fs").readFileSync(f));p.version="6.3.99";require("fs").writeFileSync(f,JSON.stringify(p,null,2))'
start_hub 4310 "$T/hub"
sleep 20
r "S3 hub $(ctl health); device: $(devices | grep -o "{[^}]*spike-nas[^}]*}")"
docker logs --since 40s c1 2>&1 | sed 's/^/  c1| /'
r "S3 download attempts in the connector log: $(docker logs c1 2>&1 | grep -c 'updating to')"
r "S3 connector local page mentions an update: $(docker exec c1 node -e "fetch('http://127.0.0.1:4301/local').then(r=>r.text()).then(t=>console.log(/updat|outdated|newer/i.test(t)))")"
stop_hub 4310
cp "$T/package.json.orig" package.json
start_hub 4310 "$T/hub"
online spike-nas 60 || true

echo "== 4. wrong code"
docker run -d --name c4 -v c4data:/data \
  -e CONNECTOR_HUB_URL="$HUB_IN" -e CONNECTOR_PAIRING_CODE=WRONG-CODE -e CONNECTOR_NAME=spike-wrong "$IMG" > /dev/null
sleep 15
r "4 running: $(docker inspect -f '{{.State.Running}}' c4), health: $(health c4)"
docker logs c4 2>&1 | grep spike: | sed 's/^/  c4| /'

echo "== 5. expired code"
code5=$(ctl code)
sqlite3 "$T/hub/app.sqlite" "UPDATE pairing_codes SET expires_at = '2000-01-01T00:00:00.000Z';"
docker run -d --name c5 -v c5data:/data \
  -e CONNECTOR_HUB_URL="$HUB_IN" -e CONNECTOR_PAIRING_CODE="$code5" -e CONNECTOR_NAME=spike-expired "$IMG" > /dev/null
sleep 15
docker logs c5 2>&1 | grep spike: | sed 's/^/  c5| /'
r "5 codes left in the hub after the expired try: $(sqlite3 "$T/hub/app.sqlite" 'SELECT count(*) FROM pairing_codes;')"

echo "== 6. revoked, restarted with the variables still set"
ctl revoke "$dev" > /dev/null
sleep 5
docker logs --since 10s c1 2>&1 | sed 's/^/  c1| /'
docker restart c1 > /dev/null
sleep 15
docker logs --since 15s c1 2>&1 | grep spike: | sed 's/^/  c1| /'
r "6 after revoke + restart: $(docker logs --since 15s c1 2>&1 | grep -o 'spike: [a-z].*' | tail -1)"

echo "== 7. exit on a refused code, restart: unless-stopped, fixed IP"
docker network create --subnet 172.30.0.0/24 spikenet > /dev/null
docker run -d --name c7 --network spikenet --ip 172.30.0.10 --restart unless-stopped -v c7data:/data \
  -e CONNECTOR_HUB_URL=http://172.30.0.1:4310 -e CONNECTOR_PAIRING_CODE=WRONG-CODE -e CONNECTOR_SPIKE_EXIT=1 "$IMG" > /dev/null
sleep 120
r "7 restarts in 120 s: $(docker inspect -f '{{.RestartCount}}' c7)"
docker logs c7 2>&1 | grep -o 'spike: pairing refused: [a-zA-Z]*' | sort | uniq -c | sed 's/^/  c7| /'
docker rm -f c7 > /dev/null
good=$(ctl code)
pair_status=$(docker run --rm --network spikenet --ip 172.30.0.10 --entrypoint node "$IMG" -e \
  "fetch('http://172.30.0.1:4310/api/hub/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:'$good',name:'after-loop',os:'x',connectorVersion:'6.2.0'})}).then(r=>console.log(r.status))")
r "7 a valid code from the same IP after the loop: HTTP $pair_status"
login_status=$(docker run --rm --network spikenet --ip 172.30.0.10 --entrypoint node "$IMG" -e \
  "fetch('http://172.30.0.1:4310/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'pair-test-password'})}).then(r=>console.log(r.status))")
r "7 sign-in from the same IP after the loop: HTTP $login_status"

echo "== 8. host networking beside a hub on 4300"
mkdir -p "$T/hub4300"
start_hub 4300 "$T/hub4300"
docker run --name c8 --network host -v c8data:/data "$IMG" > "$T/c8.log" 2>&1
r "8 exit code $? : $(tail -1 "$T/c8.log")"
stop_hub 4300

echo "== hub log (pair lines)"
grep -i 'pair' "$T/hub-4310.log" | tail -20
