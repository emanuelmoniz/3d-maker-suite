#!/usr/bin/env bash
# 6.3.0 Step 1 spike S4 (slicer part, second run) and the ARM slicing question: OrcaSlicer's AppImage
# for this machine's arch, extracted into /data/slicers and run as the PUID user in the -slicer image,
# then a real CLI slice of a fixture with the app's own flags (packages/slicer-presets/src/slice.ts).
# Needs the image spike-slicer (Dockerfile target slicer) built on this runner.
set -u
cd "$(dirname "$0")/../.."
T=${RUNNER_TEMP:-/tmp}
U=$(id -u) G=$(id -g)
m=$(uname -m)
cat > "$T/Dockerfile.slicer-entry" << 'EOF'
FROM spike-slicer
COPY spike/connector/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
EOF
docker build -q -t spike-slicer-entry -f "$T/Dockerfile.slicer-entry" . > /dev/null
[ "$m" = aarch64 ] && pick='/Ubuntu2404_aarch64_V[0-9.]+\.AppImage$/' || pick='/Ubuntu2404_V[0-9.]+\.AppImage$/'
docker run --rm -e PUID="$U" -e PGID="$G" -e PICK="$pick" -v slicerdata:/data \
  -v "$PWD/packages/3mf/fixtures:/fixtures:ro" -v "$PWD/spike/connector:/spike:ro" -w /data spike-slicer-entry sh -c '
  echo "as $(id -u):$(id -g) on $(uname -m), glibc $(ldd --version | head -1 | grep -oE "[0-9.]+$")"
  url=$(node -e "fetch(\"https://api.github.com/repos/OrcaSlicer/OrcaSlicer/releases/latest\").then(r=>r.json()).then(j=>console.log(j.assets.find(a=>eval(process.env.PICK).test(a.name)).browser_download_url))")
  echo "download $url"
  mkdir -p /data/slicers/orca && cd /data/slicers/orca
  node -e "fetch(process.argv[1]).then(r=>r.arrayBuffer()).then(b=>require(\"fs\").writeFileSync(\"orca.AppImage\",Buffer.from(b)))" "$url"
  chmod 755 orca.AppImage
  ./orca.AppImage --appimage-extract > /dev/null && echo "RESULT extracted as $(stat -c %u:%g squashfs-root/AppRun)"
  timeout 60 ./squashfs-root/AppRun --help > /tmp/help.txt 2>&1
  echo "RESULT --help exit $?: $(head -1 /tmp/help.txt)"
  mkdir -p /data/out
  # The fixture is a Bambu Studio file; Orca refuses its raft_first_layer_expansion of -1 (first run).
  python3 /spike/fix3mf.py /fixtures/single_color.3mf /data/model.3mf
  s=$(date +%s)
  timeout 300 ./squashfs-root/AppRun --slice 1 --outputdir /data/out --export-3mf out.3mf --allow-newer-file \
    --logfile /data/out/log.txt /data/model.3mf > /tmp/slice.txt 2>&1
  e=$?
  echo "RESULT slice exit $e in $(( $(date +%s) - s )) s, out.3mf $(stat -c %s /data/out/out.3mf 2>/dev/null || echo missing) bytes"
  cat /tmp/slice.txt | tail -15
  echo "-- log.txt"; grep -iE "error|fail|not |invalid" /data/out/log.txt | tail -15
  rm -rf /data/out2 && mkdir -p /data/out2
  s=$(date +%s)
  timeout 300 ./squashfs-root/AppRun --slice 1 --outputdir /data/out2 --export-3mf out.3mf --allow-newer-file \
    --logfile /data/out2/log.txt /fixtures/unsliced.3mf > /tmp/slice2.txt 2>&1
  e=$?
  echo "RESULT slice unsliced.3mf exit $e in $(( $(date +%s) - s )) s, out.3mf $(stat -c %s /data/out2/out.3mf 2>/dev/null || echo missing) bytes"
  tail -8 /tmp/slice2.txt
  echo "-- log.txt"; grep -iE "error|fail|not |invalid" /data/out2/log.txt | tail -10
' 2>&1 | sed "s/^RESULT /RESULT slicer $m: /"
