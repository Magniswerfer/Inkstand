#!/bin/sh
# Rebuilds build/icon.png and build/icon.icns from build/icon.svg (off-screen, no windows).
set -e
cd "$(dirname "$0")/.."
npx electron scripts/render.cjs scripts/icon.html build/icon@2x.png 1024 1024 2
sips -z 1024 1024 build/icon@2x.png --out build/icon.png >/dev/null
rm -rf build/icon.iconset && mkdir build/icon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s build/icon@2x.png --out build/icon.iconset/icon_${s}x${s}.png >/dev/null
  sips -z $((s * 2)) $((s * 2)) build/icon@2x.png --out build/icon.iconset/icon_${s}x${s}@2x.png >/dev/null
done
iconutil -c icns build/icon.iconset -o build/icon.icns
rm -rf build/icon.iconset build/icon@2x.png
cp build/icon.svg docs/logo.svg
echo "Icon written to build/icon.png and build/icon.icns"
