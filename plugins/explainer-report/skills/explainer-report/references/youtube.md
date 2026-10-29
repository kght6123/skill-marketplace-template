# YouTube にアップロードする（任意）

解説動画や画面録画を YouTube Data API v3 で上げ、URL を Issue/PR や Markdown レポートに貼る。
GitHub の添付上限（動画100MB）を超えるとき、ロング版の解説動画を章ごとに見せたいとき、長い動画を何本も見せたいとき、Markdown レポートを
動画ごと渡せないときに使う。ユーザーが「YouTube に上げて」と言ったときだけ行う。

タイトル・概要・タグ・チャプター・字幕・サムネイルは、人に聞かずに AI（このスキルを実行するエージェント）が作る。
人に確認するのは「公開範囲」と「上げてよいか」の2点だけにする。

## 準備（初回だけ。ユーザーに頼む）
| 必要なもの | 用意のしかた |
|---|---|
| YouTube Data API v3 | Google Cloud Console の「APIとサービス」→「ライブラリ」で有効にする |
| OAuth 同意画面 | User Type「外部」。「テストユーザー」にアップロード先チャンネルの Google アカウントを足す |
| OAuth クライアント | 「認証情報」→「OAuth クライアント ID」→ 種類は **デスクトップアプリ**。JSON をダウンロードする |
| `client_secret.json` | `~/.config/explainer-report/youtube/client_secret.json` に置く（`YOUTUBE_CONFIG_DIR` で変更可） |
| ライブラリ | `pip install google-api-python-client google-auth-oauthlib google-auth-httplib2` |

- 初回のアップロードでブラウザが開き、Google アカウントでの許可を求める。以後は同じフォルダの `token.json` を使う。
- 「Google の審査プロセスを完了していません」と出たら、そのアカウントがテストユーザーに入っていない。
- 認証情報はリポジトリに置かない。コミットしない。
- サムネイルの設定は、チャンネルの電話番号確認が済んでいないと失敗する（動画は上がる）。
- クォータは既定で1日10,000ユニット。`videos.insert` が1回1,600、`captions.insert` が400、`thumbnails.set` と `playlistItems.insert` が50（変わることがあるので、詰まったら Google のクォータ計算ツールで確かめる）。1日に上げられるのは4本前後。超えたらスクリプトが止まり、翌日の再実行で続きから上げる。

## 手順
1. **動画を仕上げる**：字幕付きの mp4 と字幕ファイル（`.srt`）をそろえる。
   - 解説動画：`render_manim.sh … --voice narration.json` で `explain.srt` も出る。音声なしなら `python3 scripts/narrate.py srt narration.json out/explain.srt`。
   - 画面録画：`capture.py … --steps steps.json` に `say` を書くと `flow.srt` も出る（`references/screen-capture.md`）。
2. **メタデータを作る**：下の「作り方」に従い、`youtube.json` を書く。複数の動画は list にする。
3. **検査する**：`python3 scripts/youtube_upload.py youtube.json --dry-run`。NG が出たら直す。
4. **確認を取る**：タイトル・公開範囲・概要の先頭2行をユーザーに見せ、上げてよいか聞く。上げると外に出るので、確認なしで上げない。
5. **上げる**：`python3 scripts/youtube_upload.py youtube.json`。結果（URL）は `youtube.result.json` に残る。再実行しても上げ済みの動画は飛ばす。
6. **貼る**：URL をレポートの「解説動画」「画面」の節に書く（出力先ごとの書き方は `references/targets/`）。

## youtube.json の作り方（AI が埋める）
```json
{
  "file": "out/explain.mp4",
  "title": "承認フローに「差し戻し」を足した｜myapp PR #123 の解説",
  "description": "承認待ちの申請を、承認者が差し戻せるようにした変更の解説です。\n差し戻すと申請者に通知が届き、編集してから出し直せます。\n\n■ 変わったこと\n・…\n\n■ チャプター\n0:00 今の流れ\n0:12 問題\n0:25 新しい流れ\n0:48 影響範囲\n\n音声：VOICEVOX:ずんだもん\n#myapp #承認フロー #解説",
  "tags": ["myapp", "承認フロー", "ワークフロー", "差し戻し", "Rails", "解説動画", "VOICEVOX", "ずんだもん"],
  "categoryId": "28",
  "privacyStatus": "unlisted",
  "defaultLanguage": "ja",
  "captions": "out/explain.srt",
  "thumbnail": 25.0,
  "madeForKids": false
}
```

| 項目 | 作り方 |
|---|---|
| `title` | 100文字以内。検索結果では前の40文字ほどしか出ないので、何が変わったか・何の話かを先頭に置く。対象（リポジトリ名や機能名）を入れる。煽り文句・絵文字の連続・`<` `>` は使わない |
| `description` | 先頭2行（折りたたみの前に出る）に要約を書く。続けて「変わったこと」を箇条書きで3〜5行、チャプター、クレジット、ハッシュタグ（3〜5個。先頭3個はタイトルの上に出る）の順に書く。レポート本文の「要約」「変更点」を元にし、STE 風の短い文で書く。5000バイト以内、`<` `>` は使わない |
| チャプター | `python3 scripts/narrate.py chapters narration.json` で出る行を貼る（台本の各場面の最初の文に `"chapter": "見出し"` を足しておく）。YouTube がチャプターと認めるのは「0:00 から始まる」「3つ以上」「各10秒以上」のときだけ。満たさなければ書かない |
| `tags` | 5〜15個。機能名・技術名・リポジトリ名・日本語と英語の言い換え。合計500文字以内 |
| `categoryId` | 既定 `28`（科学と技術）。学習・講座の内容なら `27`（教育） |
| `privacyStatus` | 既定 `unlisted`（限定公開：URL を知る人だけ見られる）。ユーザーが言ったときだけ `public` か `private` にする |
| `captions` | 手順1の `.srt`。焼き込み字幕があっても付ける（検索と自動翻訳に効く） |
| `thumbnail` | 秒数を書くと、その時刻のフレームを切り出して使う。図が全部そろって、要点の字幕が出ている時刻を選ぶ。画像のパスでもよい |
| `madeForKids` | `false` |
| `playlistId` | 任意。ユーザーが再生リストを指定したときだけ |
| `containsSyntheticMedia` | 任意。実在の人物・出来事に見える合成映像を含むときだけ `true`。ずんだもんの音声や Manim の図だけなら書かない |

## 載せない情報
限定公開でも URL が広まれば誰でも見られる。上げる前に、動画とメタデータに次が無いか確かめる。
- 社内・private リポジトリの URL や Issue 番号（private リポジトリの解説なら、リンクを書かず機能名だけにする）
- 個人情報、本番データ、トークン、社内のホスト名
- 画面録画に写った通知・ブックマークバー・他のタブ
