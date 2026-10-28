#!/bin/sh
# Installs 3D Maker Suite or its connector for this user (ADR-0011): copies it to the install dir and
# adds an app menu entry. Run it from the extracted folder: ./install.sh. Running a newer one updates
# the install. Which product it is comes from product.json (packaging/build.mjs).
set -eu
src=$(cd "$(dirname "$0")" && pwd)
product() { "$src/node/bin/node" -p "require(process.argv[1]).$1" "$src/product.json"; }
id=$(product id)
name=$(product name)
share=${XDG_DATA_HOME:-$HOME/.local/share}
dir=$share/$id/install
mkdir -p "$dir/versions" "$share/applications"
rm -rf "$dir/node"
cp -R "$src/node" "$src/launcher.mjs" "$src/loader.html" "$src/product.json" "$dir/"
cp -R "$src/versions/." "$dir/versions/"
cat > "$share/applications/$id.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$name
Exec="$dir/node/bin/node" "$dir/launcher.mjs"
Terminal=false
Categories=Utility;
EOF
echo "Installed to $dir"
echo "Start it from the app menu, or run: \"$dir/node/bin/node\" \"$dir/launcher.mjs\""
