#!/bin/sh
# Installs 3D Maker Suite or its connector for this user (ADR-0011): copies it to the install dir and
# adds an app menu entry. Run it from the extracted folder: ./install.sh. Running a newer one updates
# the install. Which product it is comes from product.json (packaging/build.mjs).
#
# ./install.sh --headless [--hub-url URL --pairing-code CODE [--name NAME]]   (the connector only)
#   For a Raspberry Pi or a Linux server with no screen (ADR-0024): instead of the app menu entry it
#   writes a systemd user service that starts the connector at boot and brings it back after a crash.
#   The hub address, code and name can also come from CONNECTOR_HUB_URL, CONNECTOR_PAIRING_CODE and
#   CONNECTOR_NAME. They go in the service's Environment=; the first start pairs, and the pairing
#   stays in the data folder, so the code is ignored from then on. Without them, an existing
#   service keeps the ones it has.
set -eu
src=$(cd "$(dirname "$0")" && pwd)
usage() {
  echo "Usage: ./install.sh [--headless [--hub-url URL] [--pairing-code CODE] [--name NAME]]" >&2
  exit 2
}
headless=
hub=${CONNECTOR_HUB_URL:-}
code=${CONNECTOR_PAIRING_CODE:-}
cname=${CONNECTOR_NAME:-}
while [ $# -gt 0 ]; do
  case $1 in
    --headless) headless=1 ;;
    --hub-url | --pairing-code | --name)
      [ $# -ge 2 ] || usage
      case $1 in
        --hub-url) hub=$2 ;;
        --pairing-code) code=$2 ;;
        --name) cname=$2 ;;
      esac
      shift
      ;;
    *) usage ;;
  esac
  shift
done
product() { "$src/node/bin/node" -p "require(process.argv[1]).$1" "$src/product.json"; }
id=$(product id)
name=$(product name)
if [ -n "$headless" ] && [ "$id" != 3d-maker-suite-connector ]; then
  echo "--headless is for the connector. $name starts from its app menu entry, or run it with Docker." >&2
  exit 2
fi
share=${XDG_DATA_HOME:-$HOME/.local/share}
dir=$share/$id/install
mkdir -p "$dir/versions" "$share/applications"
rm -rf "$dir/node"
cp -R "$src/node" "$src/launcher.mjs" "$src/loader.html" "$src/product.json" "$src/icon.png" "$dir/"
cp -R "$src/versions/." "$dir/versions/"
echo "Installed to $dir"

if [ -z "$headless" ]; then
  cat > "$share/applications/$id.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$name
Exec="$dir/node/bin/node" "$dir/launcher.mjs"
Icon=$dir/icon.png
Terminal=false
Categories=Utility;
EOF
  echo "Start it from the app menu, or run: \"$dir/node/bin/node\" \"$dir/launcher.mjs\""
  exit 0
fi

# Headless: a systemd user service.
unit=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$id.service
mkdir -p "$(dirname "$unit")"
# One Environment= line, quoted for systemd: \ and " escaped, % doubled.
env_line() {
  printf 'Environment="%s=%s"\n' "$1" "$(printf '%s' "$2" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/%/%%/g')"
}
env_lines=
if [ -n "$hub$code$cname" ]; then
  [ -n "$hub" ] && env_lines="$(env_line CONNECTOR_HUB_URL "$hub")
"
  [ -n "$code" ] && env_lines="$env_lines$(env_line CONNECTOR_PAIRING_CODE "$code")
"
  [ -n "$cname" ] && env_lines="$env_lines$(env_line CONNECTOR_NAME "$cname")
"
elif [ -f "$unit" ]; then
  env_lines=$(grep '^Environment=' "$unit" || true)
fi
# Written for this user only: it may hold a pairing code until the first start has used it.
old_umask=$(umask)
umask 077
cat > "$unit" <<EOF
[Unit]
Description=$name
After=network-online.target
Wants=network-online.target

[Service]
ExecStart="$dir/node/bin/node" "$dir/launcher.mjs" --background --headless
# The launcher exits 0 for a stop the connector asked for (Stop connector, systemctl stop) and
# non-zero when its program crashed or was killed, which is the one to restart.
Restart=on-failure
RestartSec=5
${env_lines}
[Install]
WantedBy=default.target
EOF
umask "$old_umask"

# Without linger the service stops when the user's last session ends, and doesn't start at boot.
me=$(id -un)
if ! loginctl enable-linger "$me" 2> /dev/null; then
  echo "To start it at boot with nobody signed in, run this once as an administrator:"
  echo "  sudo loginctl enable-linger $me"
fi
if ! systemctl --user daemon-reload 2> /dev/null; then
  echo "systemd's user manager isn't running for this session, so the service can't be started." >&2
  echo "Sign in again (not with su), or run: sudo loginctl enable-linger $me, then run this again." >&2
  exit 1
fi
systemctl --user enable "$id.service" 2> /dev/null
systemctl --user restart "$id.service"
echo "Service installed and started: $unit"
echo "Status:  systemctl --user status $id"
echo "Log:     journalctl --user -u $id   (and $dir/logs/server.log)"
