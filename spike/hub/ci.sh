#!/bin/bash
# Spikes 1, 2, 2b on a CI runner (macOS or Linux), with the slicers already installed by the workflow:
#   BAMBU / ORCA = path of the program, OUT = log folder. Every step logs; nothing fails the job.
set -u
# Without it the AppImages stop at a first-start "use system SSL certificate?" dialog (Http.cpp).
[ "$(uname)" = Linux ] && export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
here=$(cd "$(dirname "$0")" && pwd)
fx=$here/../../packages/3mf/fixtures/single_color.3mf
mkdir -p "$OUT"
shot() { if [ "$(uname)" = Darwin ]; then screencapture -x "$OUT/$1.png"; else import -window root "$OUT/$1.png"; fi 2>/dev/null || true; }
# Closes the slicer's window the way a user does (no kill): AppleScript quit on macOS, the window
# manager's close (WM_DELETE_WINDOW) on Linux.
close() {
  if [ "$(uname)" = Darwin ]; then osascript -e "quit app \"$1\"" 2>&1
  else wmctrl -l; wmctrl -c "$2" 2>&1; fi
}

# Kills what is left of the slicer, never launch.mjs (its arguments hold the slicer path too).
killslicer() { ps -eo pid=,args= | grep -F "$proc" | grep -v -e launch.mjs -e grep | awk '{print $1}' | xargs kill 2>/dev/null; }

for s in bambu orca; do
  exe=$([ $s = bambu ] && echo "$BAMBU" || echo "$ORCA")
  app=$([ $s = bambu ] && echo BambuStudio || echo OrcaSlicer)
  win=$app
  extra=$([ $s = orca ] && echo --allow-newer-file)
  # Command-line fragment of the running slicer (launch.mjs and pkill -f).
  proc=$([ "$(uname)" = Darwin ] && echo "$app.app/Contents/MacOS" || echo "$s/squashfs-root")

  echo "### spike 1: $s CLI export over the file"
  d=$OUT/s1-$s; mkdir -p "$d/w" "$d/cwd"; cp "$fx" "$d/w/model.3mf"
  node "$here/watch.mjs" "$d/w" 30 > "$OUT/s1-$s-watch.log" 2>&1 & w=$!
  sleep 2
  (cd "$d/cwd" && if command -v strace >/dev/null; then
    strace -f -qq -e trace=openat,rename,renameat,renameat2,unlink,unlinkat -o "$OUT/s1-$s-strace.log" "$exe" $extra --outputdir "$d/w" --export-3mf model.3mf "$d/w/model.3mf"
  else "$exe" $extra --outputdir "$d/w" --export-3mf model.3mf "$d/w/model.3mf"; fi) > "$OUT/s1-$s-cli.log" 2>&1
  echo "exit $?"; wait $w; cat "$OUT/s1-$s-watch.log"
  [ -f "$OUT/s1-$s-strace.log" ] && grep -E 'model\.3mf' "$OUT/s1-$s-strace.log" | grep -v ENOENT | head -20

  echo "### spike 2: $s direct launch, close once 2b and the second launch are done"
  cp "$fx" "$OUT/a-$s.3mf"; cp "$fx" "$OUT/b-$s.3mf"
  node "$here/launch.mjs" 400 "$proc" "$exe" "$OUT/a-$s.3mf" > "$OUT/s2-$s-direct.log" 2>&1 & l=$!
  sleep 30; shot "s2-$s-open"

  echo "### spike 2b: $s CLI slice while the GUI runs"
  mkdir -p "$OUT/s2b-$s"
  (cd "$OUT/s2b-$s" && timeout 300 "$exe" $extra --slice 1 --outputdir "$OUT/s2b-$s" --export-3mf out.3mf "$fx" > cli.log 2>&1; echo "exit $?")
  ls -la "$OUT/s2b-$s"; cat "$OUT/s2b-$s/result.json" 2>/dev/null

  echo "### spike 2: $s second launch while the first runs"
  node "$here/launch.mjs" 20 "$proc" "$exe" "$OUT/b-$s.3mf" > "$OUT/s2-$s-second.log" 2>&1
  cat "$OUT/s2-$s-second.log"; shot "s2-$s-second"

  # Close both windows if the second launch made a second instance; kill whatever is left after 60 s.
  sleep 2; close "$app" "$win"; sleep 5; close "$app" "$win"; (sleep 60; killslicer) &
  wait $l; cat "$OUT/s2-$s-direct.log"
  killslicer; sleep 3

  if [ "$(uname)" = Darwin ]; then
    echo "### spike 2: $s open -a (LaunchServices), then open -W"
    node "$here/launch.mjs" 40 "$proc" open -a "/Applications/$app.app" "$OUT/a-$s.3mf" > "$OUT/s2-$s-open.log" 2>&1 & l=$!
    sleep 25; close "$app"; wait $l; cat "$OUT/s2-$s-open.log"; killslicer; sleep 3
    node "$here/launch.mjs" 40 "$proc" open -W -a "/Applications/$app.app" "$OUT/a-$s.3mf" > "$OUT/s2-$s-openW.log" 2>&1 & l=$!
    sleep 25; close "$app"; wait $l; cat "$OUT/s2-$s-openW.log"; killslicer; sleep 3
  fi
done
exit 0
