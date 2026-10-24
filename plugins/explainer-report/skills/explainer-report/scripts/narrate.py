#!/usr/bin/env python3
"""VOICEVOXエンジン(localhost:50021)で台本を読み上げ、動画に合成する。
  python narrate.py durations narration.json          # 各文の秒数を表示
  python narrate.py mux narration.json in.mp4 out.mp4 [--speaker 3]
narration.json: [{"text": "...", "at": 1.5}, ...]
  "at"（秒）があればその時刻から読み上げる（字幕の表示時刻に合わせる）。
  無ければ前の文の直後（0.4秒あけて）に続ける。
既定の話者は 3（ずんだもん ノーマル）。標準ライブラリと ffmpeg だけで動く。
"""
import json, subprocess, tempfile, urllib.request, urllib.parse, wave, pathlib, argparse
API = "http://localhost:50021"

def tts(text, spk, path):
    q = urllib.request.urlopen(urllib.request.Request(
        f"{API}/audio_query?speaker={spk}&text={urllib.parse.quote(text)}", method="POST")).read()
    req = urllib.request.Request(f"{API}/synthesis?speaker={spk}", data=q,
                                 headers={"Content-Type": "application/json"}, method="POST")
    pathlib.Path(path).write_bytes(urllib.request.urlopen(req).read())
    with wave.open(path) as w: return w.getnframes() / w.getframerate()

ap = argparse.ArgumentParser(); ap.add_argument("cmd", choices=["durations", "mux"]); ap.add_argument("script")
ap.add_argument("inp", nargs="?"); ap.add_argument("out", nargs="?"); ap.add_argument("--speaker", type=int, default=3)
a = ap.parse_args()
items = json.load(open(a.script))
tmp = pathlib.Path(tempfile.mkdtemp()); clips = []; t = 0.0
for i, it in enumerate(items):
    f = str(tmp / f"{i:02}.wav"); d = tts(it["text"], a.speaker, f)
    start = float(it.get("at", t)); clips.append((f, start)); t = start + d + 0.4
    print(f"{i+1}: at {start:5.1f}s  len {d:4.1f}s  {it['text']}")
if a.cmd == "mux":
    ins = sum([["-i", f] for f, _ in clips], [])
    fl = "".join(f"[{i+1}:a]adelay={int(s*1000)}:all=1[a{i}];" for i, (_, s) in enumerate(clips))
    fl += "".join(f"[a{i}]" for i in range(len(clips))) + f"amix=inputs={len(clips)}:normalize=0[v]"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", a.inp, *ins, "-filter_complex", fl,
                    "-map", "0:v", "-map", "[v]", "-c:v", "copy", "-c:a", "aac", "-b:a", "96k",
                    "-movflags", "+faststart", a.out], check=True)
    print("->", a.out, "（本文に「VOICEVOX:ずんだもん」などのクレジットを書く）")
