#!/bin/sh
# The start script of the app image and the connector image (ADR-0024). It runs as root, and only
# when PUID or PGID is set does it do more than start the program:
#   1. it gives /data (APP_DATA_DIR) to that user, changing only the entries whose owner or group
#      differ (a start after the first changes none), and never the folders mounted from the host;
#   2. it drops to that user with setpriv (util-linux, in the base image) and starts the program.
# Without PUID and PGID the program stays root, so an install from before they existed keeps working.
# Started as another user (`user:` in compose), it starts the program as it is.
set -eu

if [ "$(id -u)" != 0 ] || { [ -z "${PUID:-}" ] && [ -z "${PGID:-}" ]; }; then
  exec "$@"
fi

uid="${PUID:-${PGID}}"
gid="${PGID:-${PUID}}"
case "$uid$gid" in
  *[!0-9]* | "")
    echo "PUID and PGID must be numbers (find yours with: id)" >&2
    exit 1
    ;;
esac

data="${APP_DATA_DIR:-/data}"
mkdir -p "$data"
# -xdev: a share mounted inside /data stays as it is. Symbolic links are changed, not followed.
find "$data" -xdev \( ! -user "$uid" -o ! -group "$gid" \) -exec chown -h "$uid:$gid" {} +

# A program that keeps something in its home folder gets one it can write to.
export HOME="$data"
exec setpriv --reuid="$uid" --regid="$gid" --clear-groups "$@"
