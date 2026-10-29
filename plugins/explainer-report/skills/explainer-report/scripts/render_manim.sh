#!/usr/bin/env bash
# 使い方: render_manim.sh <script.py> <SceneClass> [出力先=out/explain.mp4] [--voice [narration.json]]
# 720p30でレンダリングし、100MBを超えたら再圧縮する（gh --attach の有料プラン上限に合わせる）。
# --voice を付けると VOICEVOX（既定：ずんだもん）のナレーションを合成し、YouTube 用の字幕 <出力先>.srt も書き出す。
#   VoiceScene（scripts/voice_scene.py）を使うなら台本は自動で作られるので、--voice だけでよい。
#   Scene を直接使うなら --voice narration.json で手で書いた台本を渡す。
# 付けなければ無音（字幕のみ）。VoiceScene なら、このときも <出力先>.srt を書き出す。
# 環境変数 VOICE=off で --voice を無効にできる。話者は VOICEVOX_SPEAKER（既定 3 = ずんだもん ノーマル）。
# 環境変数 QUALITY=l で 480p15 の下書きになる（ロング版の確認用。既定 m = 720p30）。
set -euo pipefail
VOICE_ON=""; NARR=""; ARGS=()
while [ $# -gt 0 ]; do case "$1" in
  --voice) VOICE_ON=1; if [ $# -gt 1 ] && [[ "$2" == *.json ]]; then NARR="$2"; shift; fi; shift;;
  *) ARGS+=("$1"); shift;;
esac; done
SRC="${ARGS[0]}"; SCENE="${ARGS[1]}"; OUT="${ARGS[2]:-out/explain.mp4}"
[ "${VOICE:-on}" = off ] && VOICE_ON=""
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$(dirname "$OUT")"
if [ -n "$VOICE_ON" ] && ! "$HERE/voicevox.sh" start; then
  echo "VOICEVOX を起動できないため、字幕のみで出力する。" >&2; VOICE_ON=""
fi
# VoiceScene が読む設定。台本は描画のたびに書き直される
AUTO="${OUT%.mp4}.narration.json"; rm -f "$AUTO"
export PYTHONPATH="$HERE${PYTHONPATH:+:$PYTHONPATH}" NARRATION_OUT="$(cd "$(dirname "$AUTO")" && pwd)/$(basename "$AUTO")"
export EXPLAINER_VOICE="${VOICE_ON:+1}"
manim "-q${QUALITY:-m}" --format mp4 -o explain_raw "$SRC" "$SCENE"
RAW=$(find media/videos -name 'explain_raw.mp4' -newer "$SRC" | head -1)
# GitHubのブラウザ再生互換のため H.264 + yuv420p + faststart に揃える
ffmpeg -y -loglevel error -i "$RAW" -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart -an "$OUT"
SIZE=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")
if [ "$SIZE" -gt 95000000 ]; then
  ffmpeg -y -loglevel error -i "$RAW" -c:v libx264 -pix_fmt yuv420p -crf 32 -vf scale=-2:540 -movflags +faststart -an "$OUT"
fi
[ -z "$NARR" ] && [ -f "$AUTO" ] && NARR="$AUTO"
if [ -n "$VOICE_ON" ] && [ -n "$NARR" ]; then
  python3 "$HERE/narrate.py" mux "$NARR" "$OUT" "$OUT.voice.mp4" --speaker "${VOICEVOX_SPEAKER:-3}" --srt "${OUT%.mp4}.srt" \
    && mv "$OUT.voice.mp4" "$OUT"
elif [ -n "$NARR" ]; then
  python3 "$HERE/narrate.py" srt "$NARR" "${OUT%.mp4}.srt" --no-voice >/dev/null
elif [ -n "$VOICE_ON" ]; then
  echo "台本が無いため音声を付けない（VoiceScene を使うか、--voice narration.json を渡す）。" >&2
fi
echo "$OUT ($(( $(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT") / 1024 )) KB)"
