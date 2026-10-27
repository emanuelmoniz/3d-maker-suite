#!/bin/bash
# Spike 4 on macOS/Linux: the stand-in connector bundled like packaging/build.mjs (hoisted prod deps,
# links out, same trims) plus Node 22, then the .dmg or tar.gz. Prints the sizes. ARCH = x64 | arm64.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
os=$([ "$(uname)" = Darwin ] && echo darwin || echo linux)
w=$(mktemp -d); app=$w/stage/versions/4.2.0; mkdir -p "$app"
git -C "$root" archive --format=tar HEAD | tar -x -C "$app"
cp -R "$root/spike/hub/connector" "$app/apps/connector"
cross=$([ "$ARCH" = "$(node -p process.arch)" ] || echo "--cpu=$ARCH")
(cd "$app" && pnpm install --prod --filter "@3d-maker-suite/connector..." --no-frozen-lockfile --config.node-linker=hoisted $cross > /dev/null)
find "$app" -type l -delete
(cd "$app" && for n in *; do case $n in package.json|LICENSE|apps|packages|node_modules) ;; *) rm -rf "$n";; esac; done
  for n in apps/*; do [ "$n" = apps/connector ] || rm -rf "$n"; done
  for n in packages/*; do case $n in packages/core|packages/3mf) ;; *) rm -rf "$n";; esac; done
  rm -rf packages/3mf/fixtures; find . -name '*.test.ts' -delete
  find node_modules \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.md' \) ! -iname 'licen*' -delete)
v=$(curl -s https://nodejs.org/dist/index.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(r=>r.version.startsWith("v22.")).version))')
curl -sL "https://nodejs.org/dist/$v/node-$v-$os-$ARCH.tar.gz" | tar -xz -C "$w"
mkdir -p "$w/stage/node/bin"; cp "$w/node-$v-$os-$ARCH/bin/node" "$w/stage/node/bin/"
cp "$root/packaging/launcher.mjs" "$w/stage/"
echo "node $v $os-$ARCH"
du -sh "$app/node_modules" "$app" "$w/stage/node" "$w/stage"
(cd "$app" && zip -qry "$w/app.zip" .); ls -l "$w/app.zip"
if [ $os = darwin ]; then
  mkdir -p "$w/dmg/C.app/Contents/Resources"; cp -R "$w/stage/." "$w/dmg/C.app/Contents/Resources/"
  hdiutil create -quiet -volname C -srcfolder "$w/dmg" -format ULMO "$w/connector.dmg"; ls -l "$w/connector.dmg"
else
  tar -czf "$w/connector.tar.gz" -C "$w" stage; ls -l "$w/connector.tar.gz"
fi
