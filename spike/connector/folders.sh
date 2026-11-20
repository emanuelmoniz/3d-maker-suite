#!/usr/bin/env bash
# 6.3.0 Step 1 spike S6: which mounted folders send change events into a connector container, and how
# soon a listing (what a rescan reads) sees a change that sent none.
set -u
cd "$(dirname "$0")/../.."
T=${RUNNER_TEMP:-/tmp}
S=$PWD/spike/connector
U=$(id -u) G=$(id -g)
r() { echo "RESULT $*"; }

sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq samba cifs-utils nfs-kernel-server > /dev/null
sudo mkdir -p /srv/smb /srv/nfs /mnt/cifsA /mnt/cifsB /mnt/nfsA /mnt/nfsB
sudo chown "$U:$G" /srv/smb /srv/nfs
sudo tee -a /etc/samba/smb.conf > /dev/null << EOF
[share]
path = /srv/smb
read only = no
EOF
(echo spikepw; echo spikepw) | sudo smbpasswd -s -a "$(id -un)"
sudo systemctl restart smbd
echo "/srv/nfs 127.0.0.1(rw,sync,no_subtree_check,no_root_squash,insecure)" | sudo tee /etc/exports > /dev/null
sudo exportfs -ra
sudo systemctl restart nfs-kernel-server
cifs="username=$(id -un),password=spikepw,uid=$U,gid=$G,vers=3.1.1"
sudo mount -t cifs //127.0.0.1/share /mnt/cifsA -o "$cifs"
sudo mount -t cifs //127.0.0.1/share /mnt/cifsB -o "$cifs"
sudo mount -t nfs 127.0.0.1:/srv/nfs /mnt/nfsA
sudo mount -t nfs 127.0.0.1:/srv/nfs /mnt/nfsB
mount | grep -E 'cifs|nfs' | grep /mnt | sed 's/^/  mount| /'
mkdir -p "$T/bind"
docker volume create vol > /dev/null

watcher() { # name, mount args...
  local n=$1
  shift
  docker run -d --name "w-$n" -u "$U:$G" -v "$S:/spike:ro" "$@" --entrypoint node spike-connector /spike/watch.mjs /root-under-test > /dev/null
  sleep 2
}
# writer label, then the command that writes the file named by $f
check() { # watcher, label, write command (gets $f)
  local w=$1 label=$2 cmd=$3 f="w-$1-$2-$RANDOM.txt"
  local t0
  t0=$(date +%s%3N)
  f=$f bash -c "$cmd"
  sleep 4
  local ev
  ev=$(docker logs "w-$w" 2>&1 | grep "EVENT.* $f" | head -1 | awk '{print $2}')
  if [ -n "$ev" ]; then
    r "$w / $label: event after $((ev - t0)) ms"
  else
    # No event: how soon does a listing from the container show it?
    local seen=""
    for i in $(seq 0 90); do
      docker exec "w-$w" ls /root-under-test | grep -q "$f" && seen=$i && break
      sleep 1
    done
    r "$w / $label: NO event; a listing sees it after ${seen:-more than 90} s (+4 s)"
  fi
}

echo "== bind mount"
watcher bind -v "$T/bind:/root-under-test"
check bind host 'echo x > '"$T"'/bind/$f'
check bind inside 'docker exec w-bind sh -c "echo x > /root-under-test/$f"'
check bind subfolder 'mkdir -p '"$T"'/bind/sub/deep && echo x > '"$T"'/bind/sub/deep/$f'

echo "== named volume"
watcher vol -v vol:/root-under-test
check vol inside 'docker exec w-vol sh -c "echo x > /root-under-test/$f"'
check vol other-container 'docker run --rm -v vol:/v --entrypoint sh spike-connector -c "echo x > /v/$f"'

echo "== CIFS (samba on the runner, mounted twice)"
watcher cifs -v /mnt/cifsA:/root-under-test
check cifs server-side 'echo x > /srv/smb/$f'
check cifs other-client 'echo x > /mnt/cifsB/$f'
check cifs same-mount-on-host 'echo x > /mnt/cifsA/$f'
check cifs inside 'docker exec w-cifs sh -c "echo x > /root-under-test/$f"'

echo "== NFS (nfs-kernel-server on the runner, mounted twice)"
watcher nfs -v /mnt/nfsA:/root-under-test
check nfs server-side 'echo x > /srv/nfs/$f'
check nfs other-client 'echo x > /mnt/nfsB/$f'
check nfs same-mount-on-host 'echo x > /mnt/nfsA/$f'
check nfs inside 'docker exec w-nfs sh -c "echo x > /root-under-test/$f"'

echo "== a share that drops and comes back (watcher in a host process, as on a Pi)"
node "$S/watch.mjs" /mnt/cifsA > "$T/remount.log" 2>&1 &
wp=$!
sleep 2
echo x > /mnt/cifsA/before-drop.txt
sleep 3
sudo umount -l /mnt/cifsA
sleep 3
sudo mount -t cifs //127.0.0.1/share /mnt/cifsA -o "$cifs"
echo x > /mnt/cifsA/after-remount.txt
sleep 4
kill $wp
sed 's/^/  remount| /' "$T/remount.log"
r "remount: before-drop event $(grep -c before-drop "$T/remount.log"), after-remount event $(grep -c after-remount "$T/remount.log"), watcher errors $(grep -c WATCH-ERROR "$T/remount.log")"

echo "== the watcher container after its share dropped (bind of a lazily unmounted share)"
sudo umount -l /mnt/nfsA
sleep 2
r "nfs container after the host unmounted: $(docker exec w-nfs ls /root-under-test 2>&1 | wc -l) entries listed, running=$(docker inspect -f '{{.State.Running}}' w-nfs)"
docker logs w-nfs 2>&1 | grep -E 'WATCH-(ERROR|CLOSE)' | sed 's/^/  w-nfs| /'
