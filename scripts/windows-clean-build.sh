#!/usr/bin/env bash
#
# windows-clean-build.sh — build the EE FORGE installer on WINDOWS, from WSL, out of a CLEAN copy of the Forge sources.
#
#   bash scripts/windows-clean-build.sh            # the version in packages/forge-desktop/package.json
#   VERSION=0.6.1 bash scripts/windows-clean-build.sh   # another version (used to test updating)
#   BUILD_DIR=… RELEASE_OUT=… bash scripts/windows-clean-build.sh   # elsewhere, without touching release/ (reproducibility check)
#
# 1. copies ONLY what the Forge subset needs (forge-contracts, forge-core, forge-app, web-forge, forge-desktop,
#    the licence-checked assets, the lockfile and root manifests) into %LOCALAPPDATA%\Temp\ee-forge-build\src —
#    no node_modules, no dist, no .git, none of the EXODUS packages (bridge, cockpit, viewer …): if the product
#    needed them, this build would fail;
# 2. runs packages\forge-desktop\scripts\build-windows.ps1 there with Windows' own Node (pnpm install --frozen-lockfile,
#    build, electron-builder, content verification);
# 3. copies release\ back to packages/forge-desktop/release/ here, and prints path, version and SHA-256.
#
# Nothing outside that scratch folder (and the npm/electron caches) is written; nothing is uploaded or signed.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCALAPPDATA_WIN="$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')"
BASE_WSL="${BUILD_DIR:-$(wslpath -u "$LOCALAPPDATA_WIN")/Temp/ee-forge-build}"
SRC_WSL="$BASE_WSL/src"
SRC_WIN="$(wslpath -w "$SRC_WSL")"

rm -rf "$BASE_WSL"
mkdir -p "$SRC_WSL/packages"
cd "$REPO"
cp package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json "$SRC_WSL/"
for pkg in forge-contracts forge-core forge-app web-forge forge-desktop; do
  rsync -a --exclude node_modules --exclude dist --exclude release --exclude '*.tsbuildinfo' "packages/$pkg/" "$SRC_WSL/packages/$pkg/"
done
rsync -a assets/ "$SRC_WSL/assets/"
mkdir -p "$SRC_WSL/docs/licenses" && cp docs/licenses/asset-inventory.json "$SRC_WSL/docs/licenses/" 2>/dev/null || true

echo "building in $SRC_WIN"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$SRC_WIN\\packages\\forge-desktop\\scripts\\build-windows.ps1" -Root "$SRC_WIN" -Version "${VERSION:-}"

OUT="${RELEASE_OUT:-$REPO/packages/forge-desktop/release}"
mkdir -p "$OUT"
cp "$SRC_WSL/packages/forge-desktop/release/"EE-FORGE-Setup-*.exe "$OUT/"
V="$(node -p "require('$SRC_WSL/packages/forge-desktop/release/build-info.json').version")"
cp "$SRC_WSL/packages/forge-desktop/release/build-info.json" "$OUT/build-info-$V.json"
cat "$SRC_WSL/packages/forge-desktop/release/SHA256SUMS.txt" >> "$OUT/SHA256SUMS.txt"
sort -u -o "$OUT/SHA256SUMS.txt" "$OUT/SHA256SUMS.txt"
echo
cat "$OUT/build-info-$V.json"
