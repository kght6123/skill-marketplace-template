#!/usr/bin/env python3
"""HTML/URLのスクリーンショット(PNG)か、スクロール録画のGIFを作る。
使い方:
  python capture.py <URLまたはHTMLファイル> out/screen.png
  python capture.py <URLまたはHTMLファイル> out/screen.gif --gif [--seconds 6]
必要: pip install playwright && playwright install chromium（GIFはffmpegも）
GIFは10MB上限のため、幅800px・10fpsに抑える。
"""
import argparse, pathlib, subprocess, tempfile
from playwright.sync_api import sync_playwright

p = argparse.ArgumentParser()
p.add_argument("target"); p.add_argument("out")
p.add_argument("--gif", action="store_true"); p.add_argument("--seconds", type=float, default=6)
p.add_argument("--width", type=int, default=1280); p.add_argument("--height", type=int, default=800)
a = p.parse_args()
url = a.target if "://" in a.target else pathlib.Path(a.target).resolve().as_uri()
out = pathlib.Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)

with sync_playwright() as pw:
    b = pw.chromium.launch()
    if not a.gif:
        pg = b.new_page(viewport={"width": a.width, "height": a.height})
        pg.goto(url); pg.wait_for_load_state("networkidle")
        pg.screenshot(path=str(out), full_page=True)
    else:
        tmp = tempfile.mkdtemp()
        ctx = b.new_context(viewport={"width": a.width, "height": a.height},
                            record_video_dir=tmp, record_video_size={"width": a.width, "height": a.height})
        pg = ctx.new_page(); pg.goto(url); pg.wait_for_load_state("networkidle")
        steps = int(a.seconds * 4)
        for _ in range(steps):
            pg.mouse.wheel(0, 200); pg.wait_for_timeout(250)
        vid = pg.video.path(); ctx.close()
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", vid, "-vf",
                        "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
                        str(out)], check=True)
    b.close()
size = out.stat().st_size
print(f"{out} ({size//1024} KB)" + ("  ※10MB超: --seconds を減らしてください" if size > 10_000_000 else ""))
