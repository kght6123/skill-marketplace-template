#!/usr/bin/env bash
# VOICEVOXエンジンをコンテナで起動・停止する（ナレーション用）。
# 使い方: voicevox.sh start|stop|status
# Apple container（macOS 26+, Apple silicon）があれば使い、無ければ docker を使う。
set -euo pipefail
NAME=voicevox
IMAGE="${VOICEVOX_IMAGE:-docker.io/voicevox/voicevox_engine:cpu-latest}"
URL="http://localhost:50021"
if command -v container >/dev/null 2>&1; then RT=container; elif command -v docker >/dev/null 2>&1; then RT=docker
else echo "container も docker も見つからない。ナレーション無しで進める。" >&2; exit 1; fi

up() { curl -sf -m 2 "${URL}/version" >/dev/null; }
case "${1:-status}" in
  start)
    if up; then echo "VOICEVOX は起動済み（${URL}）"; exit 0; fi
    if [ "$RT" = container ]; then
      container system status >/dev/null 2>&1 || container system start
      container rm "$NAME" >/dev/null 2>&1 || true
    else docker rm -f "$NAME" >/dev/null 2>&1 || true; fi
    $RT run -d --name "$NAME" -p 50021:50021 "$IMAGE" >/dev/null
    for _ in $(seq 1 60); do up && { echo "VOICEVOX 起動（${RT}, ${URL}）"; exit 0; }; sleep 2; done
    echo "VOICEVOX が応答しない" >&2; exit 1 ;;
  stop) $RT stop "$NAME" >/dev/null 2>&1 || true; $RT rm "$NAME" >/dev/null 2>&1 || true; echo "停止した" ;;
  status) up && curl -s "${URL}/version" && echo || { echo "停止中"; exit 1; } ;;
  *) echo "使い方: $0 start|stop|status" >&2; exit 2 ;;
esac
