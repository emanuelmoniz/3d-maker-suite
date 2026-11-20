#!/usr/bin/env bash
# 6.3.0 Step 1 spike S5: a printer on the LAN, seen from a connector container in each network mode.
# The "LAN" is a bridge lan0 (10.99.0.1) on the runner; the printer is a network namespace (10.99.0.2)
# behind a veth, so its broadcasts and multicast reach the host the way a real printer's reach a NAS.
set -u
cd "$(dirname "$0")/../.."
T=${RUNNER_TEMP:-/tmp}
S=$PWD/spike/connector
r() { echo "RESULT $*"; }

sudo apt-get install -y -qq mosquitto > /dev/null
sudo systemctl stop mosquitto || true

sudo ip link add lan0 type bridge
sudo ip addr add 10.99.0.1/24 dev lan0
sudo ip link set lan0 up
sudo ip netns add printer
sudo ip link add vp type veth peer name vp-br
sudo ip link set vp-br master lan0 up
sudo ip link set vp netns printer
sudo ip netns exec printer ip addr add 10.99.0.2/24 dev vp
sudo ip netns exec printer ip link set vp up
sudo ip netns exec printer ip link set lo up
sudo ip netns exec printer ip route add default via 10.99.0.1

mkdir -p "$T/mq"
openssl req -x509 -newkey rsa:2048 -nodes -subj "/CN=00M00A000000001" -days 1 \
  -keyout "$T/mq/key.pem" -out "$T/mq/cert.pem" 2> /dev/null
mosquitto_passwd -b -c "$T/mq/pw" bblp 12345678
chmod 644 "$T/mq"/*
cat > "$T/mq/mosquitto.conf" << EOF
user root
listener 8883 10.99.0.2
certfile $T/mq/cert.pem
keyfile $T/mq/key.pem
password_file $T/mq/pw
allow_anonymous false
EOF
sudo ip netns exec printer mosquitto -c "$T/mq/mosquitto.conf" -d
sudo ip netns exec printer "$(command -v node)" "$S/fake-printer.mjs" \
  "$PWD/packages/adapters/bambu/fixtures/lan/ssdp-notify.txt" > "$T/printer.log" 2>&1 &
sleep 3
cat "$T/printer.log"
timeout 5 sudo tcpdump -ni lan0 -c 6 udp 2> /dev/null | sed 's/^/  lan0| /'

listen() { # mode, docker args...
  local mode=$1
  shift
  docker run --rm -v "$S:/spike:ro" "$@" spike-connector node /spike/listen-printer.mjs 10.99.0.2 "$mode"
}
echo "== bridge"
listen bridge
echo "== bridge with -p 2021:2021/udp -p 1990:1990/udp"
listen bridge-published -p 2021:2021/udp -p 1990:1990/udp
echo "== host"
listen host --network host
echo "== macvlan on the LAN"
sudo ip link add vm type veth peer name vm-br
sudo ip link set vm-br master lan0 up
sudo ip link set vm up
docker network create -d macvlan --subnet 10.99.0.0/24 --gateway 10.99.0.1 -o parent=vm lanvlan > /dev/null
listen macvlan --network lanvlan --ip 10.99.0.50
r "docker $(docker version -f '{{.Server.Version}}'), kernel $(uname -r)"
