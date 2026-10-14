#!/usr/bin/env python3
"""VOICEVOXエンジン(localhost:50021)で台本を読み上げ、動画に合成する。
  python narrate.py durations narration.json          # 各文の秒数を表示
  python narrate.py mux narration.json in.mp4 out.mp4 [--speaker 3]
narration.json: [{"text": "..."}, ...]  文の間に0.4秒の無音を入れて連結する。
"""
import json, sys, subprocess, tempfile, urllib.request, urllib.parse, wave, pathlib, argparse
API = "http://localhost:50021"

def tts(text, spk, path):
    q = urllib.request.urlopen(urllib.request.Request(
        f"{API}/audio_query?speaker={spk}&text={urllib.parse.quote(text)}", method="POST")).read()
    req = urllib.request.Request(f"{API}/synthesis?speaker={spk}", data=q,
                                 headers={"Content-Type": "application/json"}, method="POST")
    pathlib.Path(path).write_bytes(urllib.request.urlopen(req).read())
    with wave.open(path) as w: return w.getnframes() / w.getframerate()

ap = argparse.ArgumentParser(); ap.add_argument("cmd"); ap.add_argument("script")
ap.add_argument("inp", nargs="?"); ap.add_argument("out", nargs="?"); ap.add_argument("--speaker", type=int, default=3)
a = ap.parse_args()
lines = [x["text"] for x in json.load(open(a.script))]
tmp = pathlib.Path(tempfile.mkdtemp()); files = []
for i, t in enumerate(lines):
    f = str(tmp / f"{i:02}.wav"); d = tts(t, a.speaker, f); files.append(f)
    print(f"{i+1}: {d+0.4:.1f}s  {t}")
if a.cmd == "mux":
    lst = tmp / "list.txt"
    subprocess.run(["ffmpeg","-y","-loglevel","error","-f","lavfi","-i","anullsrc=r=24000:cl=mono","-t","0.4",str(tmp/"gap.wav")],check=True)
    lst.write_text("".join(f"file '{f}'\nfile '{tmp/'gap.wav'}'\n" for f in files))
    subprocess.run(["ffmpeg","-y","-loglevel","error","-f","concat","-safe","0","-i",str(lst),str(tmp/"voice.wav")],check=True)
    subprocess.run(["ffmpeg","-y","-loglevel","error","-i",a.inp,"-i",str(tmp/"voice.wav"),"-c:v","copy","-c:a","aac",
                    "-b:a","96k","-shortest","-movflags","+faststart",a.out],check=True)
    print("->", a.out, "（VOICEVOX:各キャラの利用規約に従いクレジットを本文に記載）")
