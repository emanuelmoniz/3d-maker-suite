#!/usr/bin/env bash
# 6.3.0 Step 1 spike S6 (second run): which mounted folders send change events into a connector
# container, how soon a listing (what a rescan reads) sees a change that sent none, and what a
# container sees when a share drops, comes back or is mounted after the container started.
# Only one client mount per share: two mounts on one kernel share a superblock, and a write through
# the second one then raises events on the first, which a write from another PC never does.
set -u
cd "$(dirname "$0")/../.."
T=${RUNNER_TEMP:-/tmp}
S=$PWD/spike/connector
U=$(id -u) G=$(id -g)
r() { echo "RESULT $*"; }

sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq samba cifs-utils nfs-kernel-server > /dev/null
sudo mkdir -p /srv/smb /srv/nfs /mnt/cifs /mnt/nfs /mnt/late
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
mount_cifs() { sudo mount -t cifs //127.0.0.1/share "$1" -o "$cifs"; }
mount_nfs() { sudo mount -t nfs 127.0.0.1:/srv/nfs "$1"; }
mount_cifs /mnt/cifs
mount_nfs /mnt/nfs
mkdir -p "$T/bind"
docker volume create vol > /dev/null
docker run --rm -v vol:/v --entrypoint chown spike-connector "$U:$G" /v

watcher() { # name, mount args...
  local n=$1
  shift
  docker run -d --name "w-$n" -u "$U:$G" -v "$S:/spike:ro" "$@" --entrypoint node spike-connector /spike/watch.mjs /root-under-test > /dev/null
  sleep 2
}
check() { # watcher, label, write command (gets $f)
  local w=$1 label=$2 cmd=$3 f="w-$1-$2-$RANDOM.txt"
  local t0
  t0=$(date +%s%3N)
  f=$f bash -c "$cmd" || r "$w / $label: the write itself FAILED"
  sleep 4
  local ev
  ev=$(docker logs "w-$w" 2>&1 | grep "EVENT.* .*$f" | head -1 | awk '{print $2}')
  if [ -n "$ev" ]; then
    r "$w / $label: event after $((ev - t0)) ms"
  else
    local seen=""
    for i in $(seq 0 90); do
      docker exec "w-$w" find /root-under-test -name "$f" | grep -q . && seen=$i && break
      sleep 1
    done
    r "$w / $label: NO event; a listing sees it after ${seen:-more than 90} s (+4 s)"
  fi
}

echo "== bind mount of a local folder (the NAS's own disk: SMB clients write through the NAS's samba)"
watcher bind -v "$T/bind:/root-under-test"
check bind host-process 'echo x > '"$T"'/bind/$f'
check bind inside 'docker exec w-bind sh -c "echo x > /root-under-test/$f"'
check bind new-subfolders 'mkdir -p '"$T"'/bind/sub/deep && echo x > '"$T"'/bind/sub/deep/$f'
docker logs w-bind 2>&1 | grep -E 'EVENT.* sub' | head -4 | sed 's/^/  w-bind| /'
check bind existing-subfolder 'echo x > '"$T"'/bind/sub/deep/$f'
for i in 1 2 3; do
  mkdir -p "$T/bind/burst$i"
  for n in $(seq 50); do echo x > "$T/bind/burst$i/f$n.txt"; done
  sleep 3
  r "bind / 50 files right after mkdir burst$i: events for $(docker logs w-bind 2>&1 | grep -oE "burst$i/f[0-9]+\.txt" | sort -u | wc -l) of them, folder event $(docker logs w-bind 2>&1 | grep -cE " burst$i$")"
done

echo "== named volume"
watcher vol -v vol:/root-under-test
check vol inside 'docker exec w-vol sh -c "echo x > /root-under-test/$f"'
check vol other-container 'docker run --rm -u '"$U:$G"' -v vol:/v --entrypoint sh spike-connector -c "echo x > /v/$f"'

echo "== CIFS: a remote share mounted on the connector's host"
watcher cifs -v /mnt/cifs:/root-under-test
check cifs not-through-this-mount 'echo x > /srv/smb/$f'
check cifs this-mount-on-host 'echo x > /mnt/cifs/$f'
check cifs inside 'docker exec w-cifs sh -c "echo x > /root-under-test/$f"'

echo "== NFS: a remote export mounted on the connector's host"
watcher nfs -v /mnt/nfs:/root-under-test
check nfs not-through-this-mount 'echo x > /srv/nfs/$f'
check nfs this-mount-on-host 'echo x > /mnt/nfs/$f'
check nfs inside 'docker exec w-nfs sh -c "echo x > /root-under-test/$f"'
docker rm -f w-cifs w-nfs > /dev/null

for fs in cifs nfs; do
  echo "== $fs drops and comes back (watcher in a host process, as on a Pi)"
  node "$S/watch.mjs" "/mnt/$fs" > "$T/remount-$fs.log" 2>&1 &
  wp=$!
  sleep 2
  echo x > "/mnt/$fs/before-drop.txt"
  sleep 3
  sudo umount -l "/mnt/$fs"
  sleep 3
  echo "  listing while down: $(ls "/mnt/$fs" | wc -l) entries"
  "mount_$fs" "/mnt/$fs"
  echo x > "/mnt/$fs/after-remount.txt"
  sleep 4
  kill $wp
  sed 's/^/  remount| /' "$T/remount-$fs.log"
  r "$fs remount: before-drop event $(grep -c before-drop "$T/remount-$fs.log"), after-remount event $(grep -c after-remount "$T/remount-$fs.log"), watcher errors $(grep -c WATCH-ERROR "$T/remount-$fs.log")"
done

echo "== a share mounted on the host after the container started (NAS boot order)"
docker run -d --name late-private -v /mnt/late:/root-under-test --entrypoint sleep spike-connector 600 > /dev/null
docker run -d --name late-rslave --mount type=bind,src=/mnt/late,dst=/root-under-test,bind-propagation=rslave \
  --entrypoint sleep spike-connector 600 > /dev/null
mount_cifs /mnt/late
sleep 2
r "late mount, host: $(ls /mnt/late | wc -l) entries"
r "late mount, default (rprivate) container: $(docker exec late-private ls /root-under-test | wc -l) entries"
r "late mount, rslave container: $(docker exec late-rslave ls /root-under-test | wc -l) entries"
sudo umount /mnt/late
sleep 2
r "after the host unmounts: rprivate $(docker exec late-private ls /root-under-test | wc -l), rslave $(docker exec late-rslave ls /root-under-test | wc -l) entries"
docker run -d --name early-private -v /mnt/cifs:/root-under-test --entrypoint sleep spike-connector 600 > /dev/null
sudo umount -l /mnt/cifs
sleep 2
r "share mounted before start, host unmounts: the rprivate container still lists $(docker exec early-private ls /root-under-test | wc -l) entries"
