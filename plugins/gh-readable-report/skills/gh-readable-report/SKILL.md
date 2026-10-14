---
name: gh-readable-report
description: Claude Codeが作成・更新するGitHubのIssueやPull Requestを、人間が短時間で理解できる形にするスキル。本文をASD-STE100風（制限技術英語の原則を日本語に適用、8割の厳しさ）の文章とMermaid図で書き、Manimで作った3Blue1Brown風の解説動画（mp4）とUIのスクリーンショット/GIFを gh の --attach で添付する。ユーザーが「Issueを作って」「PRを作って」「PR本文を書いて」「Issueを起票して」「gh pr create」「gh issue create」「PRの説明を分かりやすく」「Issue/PRに動画や図を付けて」などと言ったら必ず使う。Orchestrator等のエージェントがIssue/PRを作るとき、既存Issue/PRの本文を書き直すときにも積極的に使う。
---

# gh-readable-report

AIが書いたIssue/PRは長くなりがちで、読む側の理解がボトルネックになる。
このスキルは、Karpathy氏の4手段（文章→図→Webページ→動画）のうち、
GitHubのprivateリポジトリ（Teamプラン）で実用的な形に絞って毎回適用する。

| 手段 | このスキルでの形 | 置き場所 |
|---|---|---|
| 文章 | STE風の日本語 | 本文 |
| 図 | Mermaid | 本文（GitHubが描画） |
| Webページ | スクショ / GIF | `--attach` |
| 動画 | Manimで作るmp4（60秒前後） | `--attach` |

HTMLをGitHub Pagesで公開しない。Teamプランではprivateリポジトリでも
Pagesサイトが誰でも見られるURLになり、社内情報が漏れるため。

## 前提チェック（最初に1回）

```bash
gh --version            # 2.99.0 以上（--attach対応）
gh repo view --json viewerPermission -q .viewerPermission  # WRITE/MAINTAIN/ADMIN
python -c "import manim" && which ffmpeg
```

足りなければユーザーに伝え、文章＋図だけで進める（添付は後から `gh issue/pr edit --attach` で足せる）。
manimが無い場合の導入は `pip install manim`（cairo, pango, ffmpeg が必要。macOSは `brew install cairo pango ffmpeg`）。

## 手順

1. **事実を集める**：差分（`git diff`）、関連コード、Issueの経緯から、分かる事実を1行1件で書き出す（作業メモ。本文には載せない）。推測は事実と混ぜない。
2. **本文を書く**：`references/ste-japanese.md` のルールで書き直す。事実を落とさないことを優先する。書き直し前後で事実の件数を見比べ、消えた事実があれば戻す。
3. **図を書く**：変更の流れ・状態遷移・構成を Mermaid で1枚。要素は8つ以内。8つを超えるなら図を分けるか抽象度を上げる。
4. **動画を作る**：`references/manim-3b1b.md` に従い、ナレーション台本（字幕として画面に出す）と Manim スクリプトを書き、`scripts/render_manim.sh` で mp4 にする。100MB未満にする。
5. **画面の変更があればスクショ/GIF**：UIや生成HTMLがあるときだけ `scripts/capture.py` で撮る。無ければ省略。
6. **作成**：本文確定後に一度だけアップロードする（失敗時の重複添付を避けるため）。

```bash
gh pr create --title "<件名>" --body-file body.md \
  --attach ./out/explain.mp4 --attach "./out/screen.png#変更後の一覧画面"
# Issueなら gh issue create、既存なら gh pr edit <番号> / gh issue edit <番号>
```

`--attach` はURLを本文末尾に追記する。本文の途中に置きたいときは、本文に置きたい位置を見出しで用意しておく。
一部の添付だけ失敗しても、Issue/PR自体は作られて終了コードが0以外になることがある。URLが出力されたら作成済みとして扱い、`edit --attach` で不足分だけ足す。作り直さない。

## 本文テンプレート

```markdown
## 要約
（3文以内。何を・なぜ・結果どうなるか）

## 図
​```mermaid
flowchart LR
  ...
​```

## 変更点
- （1項目1事柄）

## 確認方法
1. （手順。1手順1動作）

## 影響と注意
- （無ければ「なし」）

## 解説動画
（--attach で末尾に追加される）
```

Issueでは「変更点」を「現状」「期待する状態」に、「確認方法」を「完了条件」に置き換える。

## 小さい変更の扱い

typo修正や依存更新など、図や動画が理解を助けない変更では、STE風の文章だけにする。
動画は作るのに数分かかるので、価値がない場面で作らない。判断に迷ったらユーザーに聞く。
