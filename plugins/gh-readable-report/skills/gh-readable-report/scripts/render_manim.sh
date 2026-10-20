#!/usr/bin/env bash
# 使い方: render_manim.sh <script.py> <SceneClass> [出力先=out/explain.mp4] [--voice narration.json]
# 720p30でレンダリングし、100MBを超えたら再圧縮する（--attachの有料プラン上限）。
# --voice を付けると VOICEVOX（既定：ずんだもん）のナレーションを合成する。付けなければ無音（字幕のみ）。
# 環境変数 VOICE=off で --voice を無効にできる。話者は VOICEVOX_SPEAKER（既定 3 = ずんだもん ノーマル）。
set -euo pipefail
NARR=""; ARGS=()
while [ $# -gt 0 ]; do case "$1" in --voice) NARR="$2"; shift 2;; *) ARGS+=("$1"); shift;; esac; done
SRC="${ARGS[0]}"; SCENE="${ARGS[1]}"; OUT="${ARGS[2]:-out/explain.mp4}"
[ "${VOICE:-on}" = off ] && NARR=""
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$(dirname "$OUT")"
manim -qm --format mp4 -o explain_raw "$SRC" "$SCENE"
RAW=$(find media/videos -name 'explain_raw.mp4' -newer "$SRC" | head -1)
# GitHubのブラウザ再生互換のため H.264 + yuv420p + faststart に揃える
ffmpeg -y -loglevel error -i "$RAW" -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart -an "$OUT"
SIZE=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")
if [ "$SIZE" -gt 95000000 ]; then
  ffmpeg -y -loglevel error -i "$RAW" -c:v libx264 -pix_fmt yuv420p -crf 32 -vf scale=-2:540 -movflags +faststart -an "$OUT"
fi
if [ -n "$NARR" ]; then
  if "$HERE/voicevox.sh" start; then
    python3 "$HERE/narrate.py" mux "$NARR" "$OUT" "$OUT.voice.mp4" --speaker "${VOICEVOX_SPEAKER:-3}" && mv "$OUT.voice.mp4" "$OUT"
  else
    echo "VOICEVOX を起動できないため、字幕のみで出力する。" >&2
  fi
fi
echo "$OUT ($(( $(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT") / 1024 )) KB)"
