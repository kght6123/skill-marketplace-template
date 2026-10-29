# 出力先：gh（GitHub の Issue/PR）

GitHub の Issue/PR を作る・書き直すときの「出す」手順。gh CLI の `--attach` で画像・動画を添付する。

## 前提チェック
```bash
gh --version            # 2.99.0 以上（--attach対応）
gh repo view --json viewerPermission -q .viewerPermission  # WRITE/MAINTAIN/ADMIN
```
添付は後から `gh issue/pr edit --attach` で足せる。

## 置き場所
| もの | 置き場所 |
|---|---|
| 文章・Mermaid図 | 本文（GitHubがMermaidを描画する） |
| 画像・スクショ・画面録画・解説動画・QR 画像 | `--attach` |
| プレイグラウンドの URL | 本文のリンク（`references/qr-playground.md`） |

HTMLをGitHub Pagesで公開しない。Teamプランではprivateリポジトリでも
Pagesサイトが誰でも見られるURLになり、社内情報が漏れるため。

## 作成
本文確定後に一度だけアップロードする（失敗時の重複添付を避けるため）。

```bash
gh pr create --title "<件名>" --body-file body.md \
  --attach ./out/explain.mp4 --attach "./out/after_items.png#変更後：商品一覧"
# Issueなら gh issue create、既存なら gh pr edit <番号> / gh issue edit <番号>
```

- `#説明`（alt text）は画像だけに付ける。動画（mp4）に付けると `cannot set alt text on video` で失敗する。動画の説明は本文に書く。
- `--attach` はURLを本文末尾に追記する。本文の途中（「画面」「解説動画」の節）に置きたいときは、添付後に出力されたURLを本文の該当の節へ移し、`gh pr edit --body-file` で更新する。
- 一部の添付だけ失敗しても、Issue/PR自体は作られて終了コードが0以外になることがある。URLが出力されたら作成済みとして扱い、`edit --attach` で不足分だけ足す。作り直さない。
- 上限：画像10MB、動画100MB（有料プラン）。超える動画は、ユーザーに確認して YouTube に上げ（`references/youtube.md`）、本文に URL を書く。
- YouTube に上げた動画は `--attach` しない。URL を「解説動画」「画面」の節に書く（GitHub は YouTube の URL を埋め込み再生しないので、`[解説動画（YouTube）](https://youtu.be/…)` とリンクにする）。
