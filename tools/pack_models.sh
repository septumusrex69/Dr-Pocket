#!/usr/bin/env bash
# Compress the per-system model files for the web (meshopt compression, named parts kept).
# Usage: tools/pack_models.sh <folder from build_models.py>
set -euo pipefail
IN="$1"; OUT="$(dirname "$0")/../public/models"
mkdir -p "$OUT"
for f in "$IN"/*.glb; do
  npx gltfpack -i "$f" -o "$OUT/$(basename "$f")" -cc -kn -km -noq 2>/dev/null || npx gltfpack -i "$f" -o "$OUT/$(basename "$f")" -cc -kn -km
done
cp "$IN/index.json" "$OUT/index.json"
du -ch "$OUT"/*.glb | tail -1
