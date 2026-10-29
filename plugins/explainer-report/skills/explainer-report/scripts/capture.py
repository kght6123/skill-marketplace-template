#!/usr/bin/env python3
"""画面のスクショ(PNG)、操作の画面録画(MP4)、軽いGIFを作る。
  python capture.py <URL|HTML> out.png [--width 1280 --height 800]
  python capture.py <URL|HTML> out.mp4 --video [--steps steps.json] [--voice]
  python capture.py <URL|HTML> out.gif --gif   [--steps steps.json]
steps.json: [{"click": sel}, {"fill": [sel, text]}, {"press": key}, {"goto": url}, {"wait": ms}, {"scroll": px}]
--steps 無しで録画するとページを少しずつスクロールする。
各ステップに "say"（と任意で "caption"）を書くと、MP4 にその操作の時刻で字幕を焼き込む。
  --voice を付けると、字幕と同じ時刻にずんだもん（VOICEVOX）の読み上げも合成する。
  読み上げが終わるまで次の操作を待つので、"wait" は短くてよい。
  台本は out.narration.json、字幕は out.srt にも書き出す（YouTube の字幕に使える）。
必要: pip install playwright && playwright install chromium、ffmpeg
"""
import argparse, json, os, pathlib, subprocess, tempfile, time
from playwright.sync_api import sync_playwright
import narrate

p = argparse.ArgumentParser()
p.add_argument("target"); p.add_argument("out")
p.add_argument("--video", action="store_true"); p.add_argument("--gif", action="store_true")
p.add_argument("--steps"); p.add_argument("--width", type=int, default=1280); p.add_argument("--height", type=int, default=800)
p.add_argument("--voice", action="store_true")
a = p.parse_args()
url = a.target if "://" in a.target else pathlib.Path(a.target).resolve().as_uri()
out = pathlib.Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
vp = {"width": a.width, "height": a.height}
steps = json.load(open(a.steps)) if a.steps else []
spk = int(os.environ.get("VOICEVOX_SPEAKER", 3))
says = a.video and any("say" in s for s in steps)
voice = says and a.voice and os.environ.get("VOICE", "on") != "off"
if voice:
    here = pathlib.Path(__file__).parent
    voice = subprocess.run([str(here / "voicevox.sh"), "start"]).returncode == 0
    if not voice: print("VOICEVOX を起動できないため、字幕のみで出力する。")
script = []  # 録画中に読み上げた文と時刻（narration.json の形）
# 読み上げの長さは録画の前に測る（録画中に音声を作ると、その間の画面が止まって見えるため）
talks = [l for _, _, l in narrate.timeline([{"text": s["say"]} for s in steps if "say" in s], spk, voice, quiet=True)] if says else []

def run_steps(pg, t0):
    if not steps:
        for _ in range(24): pg.mouse.wheel(0, 200); pg.wait_for_timeout(250)
        return
    for s in steps:
        talk = 0
        if says and "say" in s:
            script.append({"text": s["say"], "at": round(time.monotonic() - t0, 2),
                           **({"caption": s["caption"]} if "caption" in s else {})})
            talk = int((talks[len(script) - 1] + narrate.GAP) * 1000)
        t = time.monotonic()
        if "click" in s: pg.click(s["click"])
        elif "fill" in s: pg.fill(*s["fill"])
        elif "press" in s: pg.keyboard.press(s["press"])
        elif "goto" in s: pg.goto(s["goto"])
        elif "scroll" in s: pg.mouse.wheel(0, s["scroll"])
        spent = int((time.monotonic() - t) * 1000)  # 読み上げ中に操作した分は待ち時間から引く
        pg.wait_for_timeout(max(s.get("wait", 600), talk - spent))

with sync_playwright() as pw:
    b = pw.chromium.launch()
    if not (a.video or a.gif):
        pg = b.new_page(viewport=vp); pg.goto(url); pg.wait_for_load_state("networkidle")
        pg.screenshot(path=str(out), full_page=True)
    else:
        tmp = tempfile.mkdtemp()
        ctx = b.new_context(viewport=vp, record_video_dir=tmp, record_video_size=vp)
        pg = ctx.new_page(); t0 = time.monotonic()  # 録画はページを開いた時点から始まる
        pg.goto(url); pg.wait_for_load_state("networkidle"); pg.wait_for_timeout(500)
        run_steps(pg, t0); pg.wait_for_timeout(800)
        raw = pg.video.path(); ctx.close()
        if a.gif:
            vf = "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse"
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-vf", vf, str(out)]
        else:  # GitHubで再生できる H.264 mp4
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-c:v", "libx264", "-pix_fmt", "yuv420p",
                   "-crf", "26", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-movflags", "+faststart", "-an", str(out)]
        subprocess.run(cmd, check=True)
    b.close()
if script:
    narr = out.with_suffix(".narration.json")
    narr.write_text(json.dumps(script, ensure_ascii=False, indent=2), encoding="utf-8")
    plain = str(out.with_suffix(".plain.mp4")); os.replace(out, plain)
    narrate.mux(script, narrate.timeline(script, spk, voice), plain, str(out), subs=True)
    os.remove(plain)
size = out.stat().st_size
limit = 10_000_000 if out.suffix in (".png", ".gif", ".jpg") else 100_000_000
print(f"{out} ({size//1024} KB)" + ("  ※上限超過: 操作を短くするか分割してください" if size > limit else ""))
