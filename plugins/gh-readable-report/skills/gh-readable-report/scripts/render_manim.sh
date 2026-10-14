#!/usr/bin/env bash
# 使い方: render_manim.sh <script.py> <SceneClass> [出力先=out/explain.mp4]
# 720p30でレンダリングし、100MBを超えたら再圧縮する（--attachの有料プラン上限）。
set -euo pipefail
SRC="$1"; SCENE="$2"; OUT="${3:-out/explain.mp4}"
mkdir -p "$(dirname "$OUT")"
manim -qm --format mp4 -o explain_raw "$SRC" "$SCENE"
RAW=$(find media/videos -name 'explain_raw.mp4' -newer "$SRC" | head -1)
# GitHubのブラウザ再生互換のため H.264 + yuv420p + faststart に揃える
ffmpeg -y -loglevel error -i "$RAW" -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart -an "$OUT"
SIZE=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")
if [ "$SIZE" -gt 95000000 ]; then
  ffmpeg -y -loglevel error -i "$RAW" -c:v libx264 -pix_fmt yuv420p -crf 32 -vf scale=-2:540 -movflags +faststart -an "$OUT"
fi
echo "$OUT ($(( $(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT") / 1024 )) KB)"
