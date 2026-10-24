#!/usr/bin/env python3
"""画面のスクショ(PNG)、操作の画面録画(MP4)、軽いGIFを作る。
  python capture.py <URL|HTML> out.png [--width 1280 --height 800]
  python capture.py <URL|HTML> out.mp4 --video [--steps steps.json]
  python capture.py <URL|HTML> out.gif --gif   [--steps steps.json]
steps.json: [{"click": sel}, {"fill": [sel, text]}, {"press": key}, {"goto": url}, {"wait": ms}, {"scroll": px}]
--steps 無しで録画するとページを少しずつスクロールする。
必要: pip install playwright && playwright install chromium、ffmpeg
"""
import argparse, json, pathlib, subprocess, tempfile
from playwright.sync_api import sync_playwright

p = argparse.ArgumentParser()
p.add_argument("target"); p.add_argument("out")
p.add_argument("--video", action="store_true"); p.add_argument("--gif", action="store_true")
p.add_argument("--steps"); p.add_argument("--width", type=int, default=1280); p.add_argument("--height", type=int, default=800)
a = p.parse_args()
url = a.target if "://" in a.target else pathlib.Path(a.target).resolve().as_uri()
out = pathlib.Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
vp = {"width": a.width, "height": a.height}

def run_steps(pg):
    if not a.steps:
        for _ in range(24): pg.mouse.wheel(0, 200); pg.wait_for_timeout(250)
        return
    for s in json.load(open(a.steps)):
        if "click" in s: pg.click(s["click"])
        elif "fill" in s: pg.fill(*s["fill"])
        elif "press" in s: pg.keyboard.press(s["press"])
        elif "goto" in s: pg.goto(s["goto"])
        elif "scroll" in s: pg.mouse.wheel(0, s["scroll"])
        pg.wait_for_timeout(s.get("wait", 600))

with sync_playwright() as pw:
    b = pw.chromium.launch()
    if not (a.video or a.gif):
        pg = b.new_page(viewport=vp); pg.goto(url); pg.wait_for_load_state("networkidle")
        pg.screenshot(path=str(out), full_page=True)
    else:
        tmp = tempfile.mkdtemp()
        ctx = b.new_context(viewport=vp, record_video_dir=tmp, record_video_size=vp)
        pg = ctx.new_page(); pg.goto(url); pg.wait_for_load_state("networkidle"); pg.wait_for_timeout(500)
        run_steps(pg); pg.wait_for_timeout(800)
        raw = pg.video.path(); ctx.close()
        if a.gif:
            vf = "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse"
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-vf", vf, str(out)]
        else:  # GitHubで再生できる H.264 mp4
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-c:v", "libx264", "-pix_fmt", "yuv420p",
                   "-crf", "26", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-movflags", "+faststart", "-an", str(out)]
        subprocess.run(cmd, check=True)
    b.close()
size = out.stat().st_size
limit = 10_000_000 if out.suffix in (".png", ".gif", ".jpg") else 100_000_000
print(f"{out} ({size//1024} KB)" + ("  ※上限超過: 操作を短くするか分割してください" if size > limit else ""))
