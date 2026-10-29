#!/usr/bin/env python3
"""VOICEVOXエンジン(localhost:50021)で台本を読み上げ、字幕と一緒に動画へ合成する。
  python narrate.py durations narration.json          # 各文の秒数を表示
  python narrate.py srt narration.json out.srt        # 字幕ファイル（YouTube の字幕にも使う）
  python narrate.py chapters narration.json           # YouTube 概要欄のチャプター行
  python narrate.py mux narration.json in.mp4 out.mp4 [--speaker 3] [--subs] [--no-voice] [--srt out.srt]
narration.json: [{"text": "...", "at": 1.5, "caption": "...", "chapter": "..."}, ...]
  "at"（秒）があればその時刻から読み上げる（字幕・操作の時刻に合わせる）。
  無ければ前の文の直後（0.4秒あけて）に続ける。
  "caption" があれば字幕はそれを使う（読み上げは "text"）。無ければ "text" を字幕にする。
  "chapter" はその文の時刻（"chapter_at" があればその秒）から始まるチャプター名（chapters で使う）。
mux は字幕ファイル（既定は out と同名の .srt）も書き出す。
  --subs   字幕を動画に焼き込む（画面録画向け。Manim の動画は字幕が既に入っているので付けない）。
  --no-voice  音声を付けない（字幕だけ）。VOICEVOX が動いていないときも同じ扱いになる。
既定の話者は 3（ずんだもん ノーマル）。標準ライブラリと ffmpeg だけで動く。
"""
import json, os, subprocess, sys, tempfile, urllib.request, urllib.parse, wave, pathlib, argparse
API = os.environ.get("VOICEVOX_URL", "http://localhost:50021")
GAP = 0.4
FONT = os.environ.get("SUB_FONT", "Hiragino Sans" if sys.platform == "darwin" else "Noto Sans CJK JP")

def available():
    try: urllib.request.urlopen(f"{API}/version", timeout=2); return True
    except OSError: return False

def tts(text, spk, path):
    q = urllib.request.urlopen(urllib.request.Request(
        f"{API}/audio_query?speaker={spk}&text={urllib.parse.quote(text)}", method="POST")).read()
    req = urllib.request.Request(f"{API}/synthesis?speaker={spk}", data=q,
                                 headers={"Content-Type": "application/json"}, method="POST")
    pathlib.Path(path).write_bytes(urllib.request.urlopen(req).read())
    with wave.open(path) as w: return w.getnframes() / w.getframerate()

def estimate(text):  # VOICEVOX が無いときの読み上げ秒数の見積もり
    return max(1.0, len(text) * 0.13)

def timeline(items, spk=3, voice=True, quiet=False):
    """各文の (wavパス or None, 開始秒, 長さ秒) を返す。"""
    tmp = pathlib.Path(tempfile.mkdtemp()); tl = []; t = 0.0
    for i, it in enumerate(items):
        f = str(tmp / f"{i:02}.wav") if voice else None
        d = tts(it["text"], spk, f) if voice else estimate(it["text"])
        start = float(it.get("at", t)); tl.append((f, start, d)); t = start + d + GAP
        if not quiet: print(f"{i+1}: at {start:5.1f}s  len {d:4.1f}s  {it['text']}")
    return tl

def ts(sec, sep=","):
    ms = int(round(sec * 1000)); h, ms = divmod(ms, 3600_000); m, ms = divmod(ms, 60_000); s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02}{sep}{ms:03}"

def write_srt(items, tl, path):
    out = []
    for i, (it, (_, start, d)) in enumerate(zip(items, tl)):
        end = start + max(d, 1.2)
        if i + 1 < len(tl): end = min(end, tl[i + 1][1] - 0.05)
        out.append(f"{i+1}\n{ts(start)} --> {ts(end)}\n{it.get('caption', it['text'])}\n")
    pathlib.Path(path).write_text("\n".join(out), encoding="utf-8")

def chapters(items, tl):
    lines = []
    for it, (_, start, _) in zip(items, tl):
        if "chapter" in it:
            m, s = divmod(int(it.get("chapter_at", start)), 60)
            lines.append(f"{m}:{s:02} {it['chapter']}")
    if lines and not lines[0].startswith("0:00 "): lines[0] = "0:00 " + lines[0].split(" ", 1)[1]
    return lines

def mux(items, tl, inp, out, subs=False, srt=None):
    srt = srt or str(pathlib.Path(out).with_suffix(".srt"))
    write_srt(items, tl, srt)
    clips = [(f, s) for f, s, _ in tl if f]
    ins = sum([["-i", f] for f, _ in clips], [])
    fl, maps = [], ["-map", "0:v"]
    if subs:
        style = f"FontName={FONT},FontSize=20,Outline=2,Shadow=0,MarginV=28"
        fl.append(f"[0:v]subtitles=filename='{srt}':force_style='{style}'[vo]"); maps = ["-map", "[vo]"]
    if clips:
        fl += [f"[{i+1}:a]adelay={int(s*1000)}:all=1[a{i}]" for i, (_, s) in enumerate(clips)]
        fl.append("".join(f"[a{i}]" for i in range(len(clips))) + f"amix=inputs={len(clips)}:normalize=0[ao]")
        maps += ["-map", "[ao]", "-c:a", "aac", "-b:a", "96k"]
    vcodec = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23"] if subs else ["-c:v", "copy"]
    fc = ["-filter_complex", ";".join(fl)] if fl else []
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", inp, *ins, *fc, *maps, *vcodec,
                    "-movflags", "+faststart", out], check=True)
    print("->", out, "/", srt + ("（本文に「VOICEVOX:ずんだもん」などのクレジットを書く）" if clips else ""))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("cmd", choices=["durations", "srt", "chapters", "mux"])
    ap.add_argument("script"); ap.add_argument("inp", nargs="?"); ap.add_argument("out", nargs="?")
    ap.add_argument("--speaker", type=int, default=3); ap.add_argument("--subs", action="store_true")
    ap.add_argument("--no-voice", action="store_true"); ap.add_argument("--srt")
    a = ap.parse_args()
    items = json.load(open(a.script))
    voice = not a.no_voice and available()
    if not a.no_voice and not voice: print("VOICEVOX に接続できないため、長さは文字数から見積もる（音声なし）。", file=sys.stderr)
    tl = timeline(items, a.speaker, voice, quiet=a.cmd == "chapters")
    if a.cmd == "srt": write_srt(items, tl, a.inp or "out.srt"); print("->", a.inp or "out.srt")
    elif a.cmd == "chapters": print("\n".join(chapters(items, tl)))
    elif a.cmd == "mux": mux(items, tl, a.inp, a.out, a.subs, a.srt)

if __name__ == "__main__":
    main()
