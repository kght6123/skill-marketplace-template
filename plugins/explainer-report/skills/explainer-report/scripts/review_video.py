#!/usr/bin/env python3
"""解説動画を見て直すための材料を作り、数で測れる問題を出す。
  python review_video.py out/explain.mp4                 # 一覧画像と検査
  python review_video.py out/explain.mp4 --stills 3,9,15  # 指定した時刻の静止画を横に並べた1枚（絵の確認用）
出すもの（mp4 と同じ場所の <名前>.review/ に置く）
  sheet.png   1秒1コマの一覧（全体の流れ、似た場面の続き、字幕の位置を見る）
  phone.png   1秒1コマを幅360pxに縮めた一覧（スマホの大きさで読めるかを見る）
  stills.png  --stills の時刻の静止画（代表の2〜4コマを確かめるとき）
検査（標準出力。問題が無ければ PASS）
  止まっている区間  画面が --dead 秒（既定 4）以上変わらない区間。字幕だけ変わる区間は止まっている扱いになる
  文字のはみ出し    VoiceScene が書いた <名前>.layout.json の警告
  字幕の速さ        <名前>.narration.json があれば、1秒あたりの字数が多すぎる文（既定 9 字/秒を超える）
"""
import argparse, json, math, pathlib, re, subprocess, sys

def ff(*args):
    return subprocess.run(["ffmpeg", "-y", "-hide_banner", *args], capture_output=True, text=True)

def duration(mp4):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4],
                       capture_output=True, text=True, check=True)
    return float(r.stdout)

def sheet(mp4, out, width, cols=6):
    n = math.ceil(duration(mp4)); rows = math.ceil(n / cols)
    stamp = f"drawtext=text='%{{pts\\:hms}}':x=4:y=4:fontsize={max(10, width // 22)}:fontcolor=yellow:box=1:boxcolor=black@0.6,"
    for s in (stamp, ""):  # drawtext が無い ffmpeg では時刻を入れずに作る
        vf = f"fps=1,scale={width}:-2,{s}tile={cols}x{rows}:padding=4:color=gray"
        if ff("-loglevel", "error", "-i", mp4, "-vf", vf, "-frames:v", "1", out).returncode == 0: return

def stills(mp4, times, out):
    ins = sum([["-ss", str(t), "-i", mp4] for t in times], [])
    fc = "".join(f"[{i}:v]scale=640:-2[s{i}];" for i in range(len(times))) + "".join(f"[s{i}]" for i in range(len(times))) + f"hstack=inputs={len(times)}"
    if len(times) == 1: fc = "[0:v]scale=640:-2"
    ff("-loglevel", "error", *ins, "-filter_complex", fc, "-frames:v", "1", out)

def dead(mp4, sec):
    r = ff("-i", mp4, "-vf", f"freezedetect=n=-60dB:d={sec}", "-map", "0:v", "-f", "null", "-")
    starts = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"freeze_end: ([\d.]+)", r.stderr)] + [duration(mp4)]
    return [(s, e) for s, e in zip(starts, ends)]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("mp4"); ap.add_argument("--stills")
    ap.add_argument("--dead", type=float, default=4.0); ap.add_argument("--cps", type=float, default=9.0)
    a = ap.parse_args()
    mp4 = pathlib.Path(a.mp4); base = mp4.with_suffix(""); out = pathlib.Path(f"{base}.review"); out.mkdir(exist_ok=True)
    sheet(str(mp4), str(out / "sheet.png"), 320); sheet(str(mp4), str(out / "phone.png"), 360, cols=4)
    if a.stills: stills(str(mp4), [float(t) for t in a.stills.split(",")], str(out / "stills.png"))
    issues = []
    for s, e in dead(str(mp4), a.dead):
        issues.append(f"止まっている区間: {s:.1f}〜{e:.1f}秒（{e - s:.1f}秒）。何か1つ動かすか、場面を短くする")
    lay = pathlib.Path(f"{base}.layout.json")
    if lay.exists():
        for x in json.loads(lay.read_text()):
            issues.append(f"文字: {x['at']:.1f}秒 {x['kind']}: {x['text']}" + (f" / {x['with']}" if "with" in x else ""))
    narr = pathlib.Path(f"{base}.narration.json")
    if narr.exists():
        items = json.loads(narr.read_text())
        for i, it in enumerate(items):
            end = items[i + 1]["at"] if i + 1 < len(items) else duration(str(mp4))
            cap = it.get("caption", it["text"]); cps = len(cap) / max(end - it["at"], 0.1)
            if cps > a.cps: issues.append(f"字幕が速い: {it['at']:.1f}秒「{cap[:20]}」{cps:.1f}字/秒。文を分けるか、間を空ける")
    print(f"一覧: {out / 'sheet.png'} / スマホ幅: {out / 'phone.png'}" + (f" / 静止画: {out / 'stills.png'}" if a.stills else ""))
    print("\n".join(issues) if issues else "PASS: 止まっている区間・文字のはみ出し・速すぎる字幕は無い")
    sys.exit(1 if issues else 0)

if __name__ == "__main__":
    main()
