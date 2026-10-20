---
name: gh-readable-report
description: Claude Codeが作成・更新するGitHubのIssueやPull Requestを、人間が短時間で理解できる形にするスキル。Karpathy氏の「LLM出力を理解しやすくする4手段」に沿い、本文を "80% of the way to ASD-STE100" の日本語で書き、伝えたいことに合わせて選んだMermaid図や画像を必要なだけ入れ、Manimで作った3Blue1Brown風の解説動画（字幕＋任意でローカルTTSナレーション）とUIのスクリーンショット/GIFを gh の --attach で添付する。ユーザーが「Issueを作って」「PRを作って」「PR本文を書いて」「Issueを起票して」「gh pr create」「gh issue create」「PRの説明を分かりやすく」「Issue/PRに図や動画を付けて」などと言ったら必ず使う。Orchestrator等のエージェントがIssue/PRを作るとき、既存Issue/PRの本文を書き直すときにも積極的に使う。
---

# gh-readable-report

AIが書いたIssue/PRは長くなりがちで、読む側の「理解」がボトルネックになる。
Karpathy氏の4手段（文章→図/画像→Webページ→動画）を、GitHubのprivateリポジトリ（Teamプラン）で
実用的な形にして毎回適用する。どれも「大きくて、カスタムで、使い捨て」でよい。
以前なら作る手間に見合わなかった図や動画も、今は安く作れるので、迷ったら作る。

| 手段 | このスキルでの形 | 置き場所 |
|---|---|---|
| 文章 | "80% of the way to ASD-STE100" の日本語 | 本文 |
| 図 | Mermaid（伝えたいことに合わせて種類を選ぶ、数は無制限） | 本文（GitHubが描画） |
| 画像 | Mermaidで表しにくいものはSVG/PNG | `--attach` |
| Webページ・画面 | 変更前後のスクショ＋操作の画面録画（mp4） | `--attach` |
| 動画 | Manimの3Blue1Brown風mp4（字幕＋任意でナレーション） | `--attach` |

HTMLをGitHub Pagesで公開しない。Teamプランではprivateリポジトリでも
Pagesサイトが誰でも見られるURLになり、社内情報が漏れるため。

## 前提チェック（最初に1回）

```bash
gh --version            # 2.99.0 以上（--attach対応）
gh repo view --json viewerPermission -q .viewerPermission  # WRITE/MAINTAIN/ADMIN
python -c "import manim" && which ffmpeg mmdc
scripts/voicevox.sh status       # VOICEVOXエンジン（ナレーションを付ける場合のみ。start で Apple container / docker 上に起動）
```

足りないものがあれば、ユーザーに伝えて、できる範囲で進める。添付は後から `gh issue/pr edit --attach` で足せる。
導入：`brew install cairo pango ffmpeg && pip install manim`、`npm i -g @mermaid-js/mermaid-cli`。

## 手順

1. **事実を集める**：差分（`git diff`）、関連コード、Issueの経緯から、分かる事実を1行1件で書き出す（作業メモ。本文には載せない）。推測は事実と混ぜない。
2. **伝えたいことを決める**：Issue/PRの種類ごとに「読者が理解すべきこと」を書き出す。これが図の種類と数を決める。`references/mermaid.md` の対応表を見る。
3. **本文を書く**：事実メモを "80% of the way to ASD-STE100" の日本語で書き直す（`references/ste-japanese.md`）。前後で事実の件数を見比べ、消えた事実は戻す。
4. **図を作る**：手順2で決めた「伝えたいこと」ごとに、合う種類の図を1枚ずつ作る。枚数の上限は設けない。各図は1メッセージ・8要素程度に保ち、超えるなら分割する。`mmdc` で描画を検証する。Mermaidで表しにくいもの（画面配置、数値の推移、空間的な構成）は画像にする。
5. **動画を作る**：`references/manim-3b1b.md` に従い、台本とManimスクリプトを書き `scripts/render_manim.sh` でmp4にする。音声はオプション。ナレーションを付けるときは `--voice narration.json` を渡す（既定はずんだもん。付けなければ字幕のみ）。100MB未満にする。
6. **画面の変更があれば、スクショと画面録画を必ず添付する**：差分にUI（テンプレート、CSS、フロントエンドのコンポーネント、生成HTMLなど）が含まれるか、Issueが画面の不具合や要望なら必須。`references/screen-capture.md` に従う。
   - スクショ：変更した画面ごとに **変更前（ベースブランチ）と変更後** を撮る。
   - 画面録画：操作の流れ（クリック、入力、遷移、アニメーション）が変わるなら、操作をmp4で録画する。
   - Issueでは、再現中の画面（バグ）や現状の画面（要望）を撮る。
7. **作成**：本文確定後に一度だけアップロードする（失敗時の重複添付を避けるため）。

```bash
gh pr create --title "<件名>" --body-file body.md \
  --attach ./out/explain.mp4 --attach "./out/screen.png#変更後の一覧画面"
# Issueなら gh issue create、既存なら gh pr edit <番号> / gh issue edit <番号>
```

`#説明`（alt text）は画像だけに付ける。動画（mp4）に付けると `cannot set alt text on video` で失敗する。動画の説明は本文に書く。

`--attach` はURLを本文末尾に追記する。一部の添付だけ失敗しても、Issue/PR自体は作られて終了コードが0以外になることがある。URLが出力されたら作成済みとして扱い、`edit --attach` で不足分だけ足す。作り直さない。

## 本文テンプレート（PR）

```markdown
## 要約
（3文以内。何を・なぜ・結果どうなるか）

## 図
（手順2の「伝えたいこと」ごとに小見出し＋図。例：### 変更前後の流れ / ### API呼び出しの順序）

## 変更点
- （1項目1事柄）

## 確認方法
1. （1手順1動作）

## 影響と注意
- （無ければ「なし」）

## 画面（変更前 / 変更後）
（スクショ・画面録画。画像は --attach の `#説明` で何の画面か書く。動画は `#説明` を付けられないので、この節に「変更後：登録操作の録画」のように文で書く）

## 解説動画
（--attach で末尾に追加される）
```

Issueでは「変更点」を「現状」「期待する状態」に、「確認方法」を「完了条件」に置き換える。バグIssueには「再現手順」を加える。

## 動画を省く場面

typo修正、依存の更新、文言だけの変更など、動きや流れが無い変更では動画を省いてよい。
それ以外で迷ったら作る。図も同じで、理解の助けになりそうなら枚数を気にせず作る。
