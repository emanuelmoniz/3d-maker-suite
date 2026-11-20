#!/bin/sh
# 6.3.0 Step 1 spike (S4): PUID/PGID. As root: give /data to that user (only what differs), then drop
# to it with setpriv. Without the variables: stays root, as today.
set -e
if [ -n "$PUID" ] || [ -n "$PGID" ]; then
  uid=${PUID:-0}
  gid=${PGID:-0}
  mkdir -p /data
  t0=$(date +%s%N)
  n=$(find /data \( ! -user "$uid" -o ! -group "$gid" \) -print -exec chown -h "$uid:$gid" {} + | wc -l)
  echo "spike: chown of /data: $n entries changed in $(( ($(date +%s%N) - t0) / 1000000 )) ms"
  export HOME=/data
  exec setpriv --reuid="$uid" --regid="$gid" --clear-groups -- "$@"
fi
exec "$@"
