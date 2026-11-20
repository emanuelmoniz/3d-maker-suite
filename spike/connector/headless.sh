#!/usr/bin/env bash
# 6.3.0 Step 1 spike S7 (+ S1 pairing on the runner's arch): the connector archive installed with
# install.sh, then run by systemd instead of the app menu. A hub must answer on 127.0.0.1:4310.
set -u
cd "$(dirname "$0")/../.."
S=$PWD/spike/connector
H=http://127.0.0.1:4310
r() { echo "RESULT $(uname -m) $*"; }
ctl() { node "$S/hubctl.mjs" "$H" "$@"; }
up() { for _ in $(seq "${1:-60}"); do curl -sf http://127.0.0.1:4301/api/health > /dev/null && return 0; sleep 1; done; return 1; }
down() { for _ in $(seq "${1:-30}"); do curl -sf http://127.0.0.1:4301/api/health > /dev/null || return 0; sleep 1; done; return 1; }
me=$(id -un)
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus

tar -xzf packaging/out/3d-maker-suite-connector-*.tar.gz -C "$RUNNER_TEMP"
"$RUNNER_TEMP/3d-maker-suite-connector/install.sh"
dir=$HOME/.local/share/3d-maker-suite-connector/install
r "installed in $dir: $(du -sh "$dir" | cut -f1)"

r "systemctl --user before linger: $(systemctl --user is-system-running 2>&1 | head -1)"
r "loginctl enable-linger without sudo: $(loginctl enable-linger "$me" 2>&1 && echo ok)"
sudo loginctl enable-linger "$me"
for _ in $(seq 20); do [ -S "$XDG_RUNTIME_DIR/bus" ] && break; sleep 0.5; done
r "systemctl --user after linger: $(systemctl --user is-system-running 2>&1 | head -1)"

unit() { # restart policy, extra Environment lines
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/3d-maker-suite-connector.service" << EOF
[Unit]
Description=3D Maker Suite Connector
After=network-online.target
Wants=network-online.target

[Service]
ExecStart="$dir/node/bin/node" "$dir/launcher.mjs" --background
Restart=$1
RestartSec=2
$2

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
}
unit on-failure ""
t0=$(date +%s%N)
systemctl --user enable --now 3d-maker-suite-connector
up && r "user service up in $(( ($(date +%s%N) - t0) / 1000000 )) ms" || { r "user service NOT up"; journalctl --user -u 3d-maker-suite-connector --no-pager | tail -20; }
r "autostart .desktop written as well: $(test -f "$HOME/.config/autostart/3d-maker-suite-connector.desktop" && echo yes || echo no)"

echo "== pair-test (status page pairing, rename, revoke) on $(uname -m)"
node scripts/pair-test.mjs --hub "$H" && r "pair-test passed" || r "pair-test FAILED"

echo "== pairing from the environment through the unit"
ctl setup > /dev/null
code=$(ctl code)
unit on-failure "Environment=CONNECTOR_HUB_URL=$H CONNECTOR_PAIRING_CODE=$code CONNECTOR_NAME=spike-headless"
systemctl --user restart 3d-maker-suite-connector
up
for _ in $(seq 30); do ctl devices | grep -q '"name":"spike-headless","online":true' && break; sleep 1; done
r "env pairing via systemd: $(ctl devices | grep -o '{[^}]*spike-headless[^}]*}' || echo 'not online')"

echo "== crashes with Restart=on-failure"
pkill -9 -f "^$dir/node/bin/node src/main.ts"
sleep 8
r "on-failure, connector (child) killed: $(up 5 && echo back || echo 'stays down'); unit $(systemctl --user is-active 3d-maker-suite-connector)"
systemctl --user restart 3d-maker-suite-connector
up
pkill -9 -f "$dir/launcher.mjs"
sleep 8
r "on-failure, launcher killed: $(up 10 && echo back || echo 'stays down'); unit $(systemctl --user is-active 3d-maker-suite-connector)"

echo "== crashes with Restart=always"
unit always "Environment=CONNECTOR_NAME=spike-headless"
systemctl --user restart 3d-maker-suite-connector
up
pkill -9 -f "^$dir/node/bin/node src/main.ts"
sleep 8
r "always, connector (child) killed: $(up 10 && echo back || echo 'stays down')"
systemctl --user stop 3d-maker-suite-connector
down && r "always, systemctl stop: stopped (no restart)" || r "always, systemctl stop: still answering"
systemctl --user start 3d-maker-suite-connector
up

echo "== without linger"
sudo loginctl disable-linger "$me"
sleep 8
r "after disable-linger: $(down 15 && echo 'connector stopped' || echo 'still running')"

echo "== the alternative: a system unit (needs sudo to install)"
sudo tee /etc/systemd/system/spike-connector.service > /dev/null << EOF
[Unit]
After=network-online.target
[Service]
User=$me
Environment=HOME=$HOME
ExecStart="$dir/node/bin/node" "$dir/launcher.mjs" --background
Restart=always
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl start spike-connector
up && r "system unit: up, still paired: $(ctl devices | grep -o '"name":"spike-headless","online":[a-z]*')" || r "system unit: NOT up"
sudo systemctl stop spike-connector
