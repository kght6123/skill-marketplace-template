#!/usr/bin/env python3
"""HTML/CSS の成果物を Tailwind QR Playground で開ける QR 画像と URL にする。
  python qr_sample.py page.html out/qr_page.png [--css extra.css ...] [--title "名前"]
page.html は断片でも完全な文書でもよい。完全な文書なら次のように整える。
  <body> の中身を HTML にする（body の class / style は外側の div に移す）。
  <style> の中身と、ローカルの <link rel="stylesheet"> のファイルを CSS にまとめる。
  Tailwind を読み込む <script>（CDN / @tailwindcss/browser）は外す（プレイグラウンドに入っている）。
JS で動く成果物（それ以外の <script>、onclick などのイベント属性）は対象外で、終了コード 2 で止まる。
画像・外部 CSS・リンク先はプレイグラウンドで表示されないので、警告を出す。
標準出力に JSON を出す：{"png", "url", "urls", "qrCount", "warnings"}
  url は1枚目の QR の URL。qrCount が 1 なら、この URL を開くだけでコード全体が復元される。
QR の作成には https://github.com/kght6123/tailwind-qr-playground の CLI を npx で使う（Node.js 22.12 以上と Git）。
  QR_CLI=../tailwind-qr-playground/cli/index.mjs のようにローカルの CLI も指定できる。
"""
import argparse, json, os, pathlib, re, subprocess, sys, tempfile

PKG = os.environ.get("QR_PKG", "github:kght6123/tailwind-qr-playground#f187c5983656054632fa059042fca8b025d87b20")
TW = re.compile(r"tailwindcss|@tailwindcss/browser", re.I)

def split(src, base):
    """完全な文書を、プレイグラウンドに渡す HTML 断片と CSS に分ける。"""
    css, warn = [], []
    for m in re.finditer(r"<script\b([^>]*)>(.*?)</script>", src, re.S | re.I):
        if not TW.search(m.group(1)) and "application/ld+json" not in m.group(1):
            print("JS を含むので対象外（<script> がある）。QR は作らない。", file=sys.stderr); sys.exit(2)
    if re.search(r"<[^>]+\son[a-z]+\s*=", src, re.I):
        print("JS を含むので対象外（イベント属性がある）。QR は作らない。", file=sys.stderr); sys.exit(2)
    for m in re.finditer(r"<link\b[^>]*>", src, re.I):
        tag = m.group(0); href = re.search(r"href\s*=\s*[\"']?([^\"'\s>]+)", tag, re.I)
        if not re.search(r"stylesheet", tag, re.I) or not href: continue
        h = href.group(1)
        if "://" in h or h.startswith("//"):
            if not TW.search(h): warn.append(f"外部 CSS は取り込まない: {h}")
        elif (base / h).is_file(): css.append((base / h).read_text(encoding="utf-8"))
        else: warn.append(f"CSS が見つからない: {h}")
    css += re.findall(r"<style\b[^>]*>(.*?)</style>", src, re.S | re.I)
    body = re.search(r"<body\b([^>]*)>(.*?)</body>", src, re.S | re.I)
    if body:
        attrs = " ".join(re.findall(r"\b(?:class|style)\s*=\s*(?:\"[^\"]*\"|'[^']*')", body.group(1)))
        html = body.group(2).strip()
        if attrs: html = f"<div {attrs}>\n{html}\n</div>"
    else:
        html = re.sub(r"<!doctype[^>]*>|</?html\b[^>]*>|<head\b.*?</head>", "", src, flags=re.S | re.I)
    html = re.sub(r"<(script|style)\b.*?</\1>|<link\b[^>]*>", "", html, flags=re.S | re.I).strip()
    if re.search(r"<(img|video|audio|iframe|picture)\b|url\(", html + "".join(css), re.I):
        warn.append("画像・動画・埋め込みはプレイグラウンドで表示されない")
    if re.search(r"<a\b[^>]*href", html, re.I): warn.append("リンクはプレイグラウンドでは遷移しない")
    return html, "\n".join(c.strip() for c in css), warn

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("html"); ap.add_argument("out")
    ap.add_argument("--css", action="append", default=[]); ap.add_argument("--title")
    a = ap.parse_args()
    src = pathlib.Path(a.html)
    html, css, warn = split(src.read_text(encoding="utf-8"), src.parent)
    css = "\n".join([css, *[pathlib.Path(c).read_text(encoding="utf-8") for c in a.css]]).strip()
    tmp = pathlib.Path(tempfile.mkdtemp())
    (tmp / "sample.html").write_text(html, encoding="utf-8")
    args = ["--html", str(tmp / "sample.html"), "--title", a.title or src.stem,
            "--out", str(pathlib.Path(a.out).resolve()), "--force", "--json"]
    if css: (tmp / "sample.css").write_text(css, encoding="utf-8"); args[2:2] = ["--css", str(tmp / "sample.css")]
    cli = os.environ.get("QR_CLI")
    cmd = ["node", cli, *args] if cli else ["npx", "--yes", PKG, *args]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0: sys.exit(f"QR を作れなかった: {r.stderr.strip()}")
    res = json.loads(r.stdout)["results"][0]
    if res["qrCount"] > 1: warn.append(f"QR が {res['qrCount']} 枚に分かれた。URL だけでは開けないので、QR 画像を読み込んでもらう")
    print(json.dumps({"png": res["output"], "url": res["urls"][0], "urls": res["urls"],
                      "qrCount": res["qrCount"], "warnings": warn}, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
