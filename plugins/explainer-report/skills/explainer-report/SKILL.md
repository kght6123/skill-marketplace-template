---
name: explainer-report
description: AIが作った成果（コード変更、調査結果、設計案、障害報告など）を、人間が短時間で理解できる解説レポートにするスキル。Karpathy氏の「LLM出力を理解しやすくする4手段」に沿い、本文を "80% of the way to ASD-STE100" の日本語で書き、伝えたいことに合わせて選んだMermaid図や画像を必要なだけ入れ、Manimで作った3Blue1Brown風の解説動画（字幕＋任意でずんだもんのナレーション）と画面のスクリーンショット/録画（字幕＋任意でずんだもんのナレーション）を付ける。成果物がHTML/CSSなら、Tailwind QR Playgroundで開けるQRコード画像とURLのリンクも付ける。出力先は GitHub の Issue/PR（gh）と Markdown ファイル。動画は任意で YouTube Data API でアップロードし、タイトル・概要・タグ・チャプター・字幕・サムネイルをAIが作る。ユーザーが「Issueを作って」「PRを作って」「PR本文を書いて」「Issueを起票して」「gh pr create」「gh issue create」「PRの説明を分かりやすく」「解説して」「レポートにまとめて」「説明資料を作って」「図や動画で説明して」「解説動画を作って」「画面録画に字幕を付けて」「動画をYouTubeに上げて」などと言ったら必ず使う。Orchestrator等のエージェントがIssue/PRや報告書を作るとき、既存の本文を書き直すときにも積極的に使う。
---

# explainer-report

AIが書いた説明は長くなりがちで、読む側の「理解」がボトルネックになる。
Karpathy氏の4手段（文章→図/画像→Webページ→動画）を、毎回実用的な形で適用する。
どれも「大きくて、カスタムで、使い捨て」でよい。
以前なら作る手間に見合わなかった図や動画も、今は安く作れるので、迷ったら作る。

| 手段 | このスキルでの形 | 参照 |
|---|---|---|
| 文章 | "80% of the way to ASD-STE100" の日本語 | `references/ste-japanese.md` |
| 図 | Mermaid（伝えたいことに合わせて種類を選ぶ、数は無制限） | `references/mermaid.md` |
| 画像 | Mermaidで表しにくいものはSVG/PNG | `references/mermaid.md` |
| Webページ・画面 | 変更前後のスクショ＋操作の画面録画（mp4。字幕＋任意でナレーション） | `references/screen-capture.md` |
| 試せるページ | HTML/CSS の成果物だけ：プレイグラウンドで開ける QR 画像と URL | `references/qr-playground.md` |
| 動画 | Manimの3Blue1Brown風mp4（字幕＋任意でナレーション） | `references/manim-3b1b.md` |

作り方は出力先によらず同じ。最後の「出す」手順だけが出力先で変わる。

## 出力先

| 出力先 | 使う場面 | 参照 |
|---|---|---|
| gh | GitHub の Issue/PR を作る・書き直す | `references/targets/gh.md` |
| markdown | ローカルの `.md` レポート（調査結果、設計案、障害報告、gh を使わない環境） | `references/targets/markdown.md` |

ユーザーが出力先を言わなければ、Issue/PR の話なら gh、それ以外は markdown にする。

どちらの出力先でも、ユーザーが望めば動画を YouTube に上げて URL を貼れる（`references/youtube.md`）。

## 前提チェック（最初に1回）

```bash
python -c "import manim" && which ffmpeg mmdc
scripts/voicevox.sh status   # ナレーションを付ける場合のみ。start で Apple container / docker 上に起動
python -c "import googleapiclient, google_auth_oauthlib"  # YouTube に上げる場合のみ
node --version               # HTML/CSS の成果物に QR を付ける場合のみ（22.12 以上）
```

出力先ごとの確認は `references/targets/` の各ファイルに書いてある。
足りないものがあれば、ユーザーに伝えて、できる範囲で進める。
導入：`brew install cairo pango ffmpeg && pip install manim`、`npm i -g @mermaid-js/mermaid-cli`。

## 手順

1. **事実を集める**：差分（`git diff`）、関連コード、Issueの経緯、調査のメモから、分かる事実を1行1件で書き出す（作業メモ。本文には載せない）。推測は事実と混ぜない。
2. **伝えたいことを決める**：レポートの種類ごとに「読者が理解すべきこと」を書き出す。これが図の種類と数を決める。`references/mermaid.md` の対応表を見る。
3. **本文を書く**：事実メモを "80% of the way to ASD-STE100" の日本語で書き直す（`references/ste-japanese.md`）。前後で事実の件数を見比べ、消えた事実は戻す。構成は下の「本文テンプレート」を使う。
4. **図を作る**：手順2で決めた「伝えたいこと」ごとに、合う種類の図を1枚ずつ作る。枚数の上限は設けない。各図は1メッセージ・8要素程度に保ち、超えるなら分割する。`mmdc` で描画を検証する。Mermaidで表しにくいもの（画面配置、数値の推移、空間的な構成）は画像にする。
5. **動画を作る**：`references/manim-3b1b.md` に従い、台本とManimスクリプトを書き `scripts/render_manim.sh` でmp4にする。音声はオプション。ナレーションを付けるときは `--voice narration.json` を渡す（既定はずんだもん。付けなければ字幕のみ）。100MB未満にする。
6. **画面の変更があれば、スクショと画面録画を必ず付ける**：差分にUI（テンプレート、CSS、フロントエンドのコンポーネント、生成HTMLなど）が含まれるか、報告の対象が画面の不具合や要望なら必須。`references/screen-capture.md` に従う。
   - スクショ：変更した画面ごとに **変更前と変更後** を撮る。
   - 画面録画：操作の流れ（クリック、入力、遷移、アニメーション）が変わるなら、操作をmp4で録画する。操作の意味を補うなら、ステップに `say` を書いて字幕を付ける（`--voice` でずんだもんの読み上げも付く）。
   - 不具合の報告では、再現中の画面を撮る。要望では、現状の画面を撮る。
   - 成果物が HTML/CSS だけ（JS 無し）なら、`references/qr-playground.md` に従い、QR 画像とプレイグラウンドの URL も付ける。
7. **YouTube に上げる（任意）**：ユーザーが望んだときだけ。`references/youtube.md` に従い、タイトル・概要などのメタデータを AI が作り、`--dry-run` で検査し、公開範囲と内容をユーザーに確認してから上げる。
8. **出す**：出力先のファイル（`references/targets/gh.md` か `references/targets/markdown.md`）に従う。

## 本文テンプレート

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
（スクショ・画面録画。各画像に何の画面かを書く。動画は「変更後：登録操作の録画」のように文で書く。YouTube に上げたら URL も書く。HTML/CSS の成果物なら QR 画像とプレイグラウンドのリンクも置く）

## 解説動画
（動画か YouTube の URL と、ナレーションを付けたらクレジット「音声：VOICEVOX:ずんだもん」）
```

レポートの種類に合わせて節を置き換える。

| 種類 | 置き換え |
|---|---|
| 変更の説明（PR） | そのまま |
| 課題・要望（Issue） | 「変更点」→「現状」「期待する状態」、「確認方法」→「完了条件」 |
| 不具合の報告 | 上に加えて「再現手順」を足す |
| 調査結果 | 「変更点」→「分かったこと」、「確認方法」→「根拠（出典・コマンド・ログ）」 |
| 設計案 | 「変更点」→「案と比較」、「確認方法」→「決めてほしいこと」 |

## 動画を省く場面

typo修正、依存の更新、文言だけの変更など、動きや流れが無い内容では動画を省いてよい。
それ以外で迷ったら作る。図も同じで、理解の助けになりそうなら枚数を気にせず作る。
