#!/usr/bin/env python3
"""解説動画・画面録画を YouTube Data API v3 でアップロードする。
  python youtube_upload.py youtube.json --dry-run   # メタデータの検査だけ（認証しない）
  python youtube_upload.py youtube.json             # アップロード
youtube.json は1本なら object、複数なら list。パスは youtube.json からの相対で書ける。
  {"file": "out/explain.mp4", "title": "...", "description": "...", "tags": ["..."],
   "categoryId": "28", "privacyStatus": "unlisted", "defaultLanguage": "ja",
   "captions": "out/explain.srt", "thumbnail": 12.5, "playlistId": "PL...", "madeForKids": false}
  thumbnail は画像のパスか、動画から切り出す秒数。captions / thumbnail / playlistId は任意。
結果は youtube.result.json に累積保存し、再実行時はアップロード済みの動画を飛ばす。
認証情報は ~/.config/explainer-report/youtube/ に置く（YOUTUBE_CONFIG_DIR で変更できる）。
  client_secret.json … Google Cloud Console で作った「デスクトップアプリ」の OAuth クライアント
  token.json         … 初回のブラウザ認証後に自動で保存される
必要: pip install google-api-python-client google-auth-oauthlib google-auth-httplib2、ffmpeg（thumbnail を秒数で書くとき）
"""
import argparse, json, os, pathlib, subprocess, sys, tempfile, time

CONF = pathlib.Path(os.environ.get("YOUTUBE_CONFIG_DIR", "~/.config/explainer-report/youtube")).expanduser()
SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl"]
PRIVACY = ("private", "unlisted", "public")

def check(v, base):
    """YouTube が受け付けない値を、アップロード前に見つける。"""
    errs = []
    f = base / v.get("file", "")
    if not v.get("file") or not f.is_file(): errs.append(f"file が無い: {f}")
    t = v.get("title", "")
    if not 1 <= len(t) <= 100: errs.append(f"title は1〜100文字（今 {len(t)} 文字）")
    d = v.get("description", "")
    if len(d.encode()) > 5000: errs.append(f"description は5000バイト以内（今 {len(d.encode())} バイト）")
    tags = v.get("tags", [])
    tlen = sum(len(x) + (2 if " " in x else 0) for x in tags) + max(len(tags) - 1, 0)
    if tlen > 500: errs.append(f"tags は合計500文字以内（今 {tlen} 文字）")
    for k, s in [("title", t), ("description", d), *[("tags", x) for x in tags]]:
        if "<" in s or ">" in s: errs.append(f"{k} に < か > がある（YouTube が拒否する）")
    if v.get("privacyStatus", "unlisted") not in PRIVACY: errs.append(f"privacyStatus は {PRIVACY} のどれか")
    for k in ("captions", "thumbnail"):
        x = v.get(k)
        if isinstance(x, str) and not (base / x).is_file(): errs.append(f"{k} が無い: {base / x}")
    return errs

def body(v):
    lang = v.get("defaultLanguage", "ja")
    return {
        "snippet": {"title": v["title"], "description": v.get("description", ""), "tags": v.get("tags", []),
                    "categoryId": str(v.get("categoryId", "28")),  # 28 = Science & Technology
                    "defaultLanguage": lang, "defaultAudioLanguage": v.get("defaultAudioLanguage", lang)},
        "status": {"privacyStatus": v.get("privacyStatus", "unlisted"),
                   "selfDeclaredMadeForKids": bool(v.get("madeForKids", False)),
                   **({"containsSyntheticMedia": v["containsSyntheticMedia"]} if "containsSyntheticMedia" in v else {})},
    }

def credentials():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    secret, token = CONF / "client_secret.json", CONF / "token.json"
    creds = Credentials.from_authorized_user_file(str(token), SCOPES) if token.exists() else None
    if creds and creds.expired and creds.refresh_token and creds.has_scopes(SCOPES):
        creds.refresh(Request())
    if not creds or not creds.valid or not creds.has_scopes(SCOPES):
        if not secret.exists(): sys.exit(f"client_secret.json が無い: {secret}（references/youtube.md の準備を参照）")
        creds = InstalledAppFlow.from_client_secrets_file(str(secret), SCOPES).run_local_server(port=0)
        CONF.mkdir(parents=True, exist_ok=True); token.write_text(creds.to_json()); token.chmod(0o600)
    return creds

def upload(yt, path, meta):
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload
    media = MediaFileUpload(str(path), chunksize=8 * 1024 * 1024, resumable=True, mimetype="video/mp4")
    req = yt.videos().insert(part="snippet,status", body=body(meta), media_body=media)
    res, retry = None, 0
    while res is None:
        try:
            st, res = req.next_chunk()
            if st: print(f"  {int(st.progress() * 100)}%", end="\r", flush=True)
        except HttpError as e:  # 5xx は待って続きから送り直す
            if e.resp.status < 500 or retry >= 5: raise
            retry += 1; time.sleep(2 ** retry)
    return res["id"]

def extras(yt, vid, meta, base, path):
    """字幕・サムネイル・再生リストを付ける。失敗しても動画は残すので、警告だけ返す。"""
    from googleapiclient.http import MediaFileUpload
    warn = []
    if meta.get("captions"):
        try:
            yt.captions().insert(part="snippet", body={"snippet": {
                "videoId": vid, "language": meta.get("defaultLanguage", "ja"), "name": "日本語", "isDraft": False}},
                media_body=MediaFileUpload(str(base / meta["captions"]), mimetype="application/octet-stream")).execute()
        except Exception as e: warn.append(f"captions: {e}")
    thumb = meta.get("thumbnail")
    if thumb is not None:
        try:
            if isinstance(thumb, (int, float)):  # 秒数なら、その時刻のフレームを切り出す
                img = pathlib.Path(tempfile.mkdtemp()) / "thumb.jpg"
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(thumb), "-i", str(path),
                                "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "3", str(img)], check=True)
            else: img = base / thumb
            yt.thumbnails().set(videoId=vid, media_body=MediaFileUpload(str(img))).execute()
        except Exception as e: warn.append(f"thumbnail: {e}（チャンネルの電話番号確認が済んでいないと失敗する）")
    if meta.get("playlistId"):
        try:
            yt.playlistItems().insert(part="snippet", body={"snippet": {
                "playlistId": meta["playlistId"], "resourceId": {"kind": "youtube#video", "videoId": vid}}}).execute()
        except Exception as e: warn.append(f"playlist: {e}")
    return warn

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("meta"); ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    mp = pathlib.Path(a.meta).resolve(); base = mp.parent
    items = json.loads(mp.read_text())
    items = items if isinstance(items, list) else [items]
    bad = [(m.get("file"), e) for m in items for e in check(m, base)]
    for f, e in bad: print(f"NG {f}: {e}")
    if bad: sys.exit(1)
    if a.dry_run:
        for m in items: print(json.dumps({"file": m["file"], **body(m)}, ensure_ascii=False, indent=2))
        print("OK: メタデータに問題なし（--dry-run のためアップロードしていない）"); return

    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    yt = build("youtube", "v3", credentials=credentials())
    rp = mp.with_suffix(".result.json")
    results = json.loads(rp.read_text()) if rp.exists() else {}
    save = lambda: rp.write_text(json.dumps(results, ensure_ascii=False, indent=2))
    for i, m in enumerate(items, 1):
        key = m["file"]; path = base / key
        if results.get(key, {}).get("id"):
            print(f"[{i}/{len(items)}] skip（アップロード済み）: {key} -> {results[key]['url']}"); continue
        print(f"[{i}/{len(items)}] uploading: {key}")
        try: vid = upload(yt, path, m)
        except HttpError as e:
            results[key] = {"error": str(e)}; save(); print(f"  ERROR: {e}")
            if e.resp.status == 403 and "quota" in str(e).lower():
                sys.exit("1日のクォータを使い切った。翌日（太平洋時間の0時以降）に再実行すると続きから上げる。")
            continue
        url = f"https://youtu.be/{vid}"
        results[key] = {"id": vid, "url": url, "title": m["title"], "privacyStatus": body(m)["status"]["privacyStatus"]}
        save()  # 動画の ID は付属物より先に保存する（再実行で二重に上げないため）
        warn = extras(yt, vid, m, base, path)
        if warn: results[key]["warnings"] = warn; save()
        print(f"  OK: {url}" + "".join(f"\n  WARN {w}" for w in warn))
    print(f"結果: {rp}")

if __name__ == "__main__":
    main()
