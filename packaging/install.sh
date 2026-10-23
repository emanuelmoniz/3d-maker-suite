#!/bin/sh
# Installs 3D Maker Suite for this user (ADR-0011): copies it to the install dir and adds an app
# menu entry. Run it from the extracted folder: ./install.sh. Running a newer one updates the install.
set -eu
src=$(cd "$(dirname "$0")" && pwd)
share=${XDG_DATA_HOME:-$HOME/.local/share}
dir=$share/3d-maker-suite/install
mkdir -p "$dir/versions" "$share/applications"
rm -rf "$dir/node"
cp -R "$src/node" "$src/launcher.mjs" "$src/loader.html" "$dir/"
cp -R "$src/versions/." "$dir/versions/"
cat > "$share/applications/3d-maker-suite.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=3D Maker Suite
Exec="$dir/node/bin/node" "$dir/launcher.mjs"
Terminal=false
Categories=Utility;
EOF
echo "Installed to $dir"
echo "Start it from the app menu, or run: \"$dir/node/bin/node\" \"$dir/launcher.mjs\""
