---
name: orch-core
description: AI開発オーケストレーション（orch）の土台。state.json・orch.config.json・スタンプ運用・WIP上限・orch CLI の使い方を提供する。ユーザーが「orchをセットアップして」「AI開発オーケストレーションを導入したい」「state.jsonの状態を見せて」「行列の件数は？」「orchの設定を変えたい」「スタンプの判定ルールを知りたい」などと言ったら使う。他の orch-* スキル（orch-run / orch-issue-memo / orch-implement / orch-review-triage / orch-memo-check）はすべてこのスキルのスクリプトを経由して状態を読み書きする。
argument-hint: [init|status|config] [--repo org/repo]
---

# orch-core

複数プロジェクトを並行してAIに開発させるとき、人間のレビューがボトルネックになる。
この仕組みの目的は **人間の処理量を上限にして、AI側をそれに合わせる** こと。

| | 担当 | 起動 |
|---|---|---|
| スタンプ読み取り・状態遷移・WIP判定・並び順・マージ | `orch` スクリプト | AIがスキルから実行 |
| 理解メモ・分割案・実装・PR本文・図の生成 | AI | AI |
| 🚀の判断・コードレビュー・対応判断 | 人間 | 人間 |

セッションは2種類ある。**マネージャ**は `$ORCH_HOME` で起動し、GitHub と state.json だけを触る。
**ワーカー**は各リポジトリの worktree で起動し、実装する。そこで起動しないと、そのリポジトリの
`.claude/settings.json`（権限・フック）とプロジェクトスキルが効かない。

連携に使うのはプロセス起動・作業ディレクトリ・環境変数・標準出力・終了コードだけで、
Claude Code 固有の機能は使わない。ワーカーのCLIは差し替えられる（Codex CLI / Copilot CLI など）。

モデルは分けるとよい。**マネージャは良いモデル**（理解メモの質がこの仕組みの要）、
**ワーカーは安いモデル**（承認済みのメモどおりに実装するだけ）。
組み合わせはプロファイルで切り替える（`sonnet` / `opus` / `fable`。名前はマネージャのモデル）。
`node "$ORCH" profile --human` で今の設定とマネージャの起動コマンドが出る。
詳しくは `references/topology.md`。

---

## 0. 実行の鉄則（これを破ると仕組みが壊れる）

1. **スクリプトの判定を再計算しない**。status も並び順も WIP の可否もマージ可否も、`orch` の出力が正
2. **読むのは `--json` の出力だけ**。`--human` の整形出力は人間向けで、AIは参照しない
3. **exit code 1 か `"needs_human": true` が返ったら、そこで止めて人間に渡す**。exit code 2 は lint 違反で、これは作り直し
4. **state.json を直接編集しない**。書き込みは `orch state set` のみ
5. **AIがやらないこと**: スタンプを押さない／Issue本文を編集しない／自分が作ったもの以外のコメントを編集しない／`gh pr merge` を直接叩かない（マージは `orch merge-train` だけ）
6. **ワーカーは state を書かない**。`ORCH_ROLE=worker` のセッションでは `orch` が書き込み系を拒否する。結果はエンベロープで返す

---

## 1. スクリプトの場所

次の順に探して、最初に見つかったものを使う。

```bash
ORCH="${CLAUDE_PLUGIN_ROOT}/skills/orch-core/scripts/orch.mjs"
[ -f "$ORCH" ] || ORCH="$(dirname "$0")/../orch-core/scripts/orch.mjs"   # npx skills 配置
node "$ORCH" --help
```

どちらも無ければスクリプト無しの環境。その場合は lint を手動チェックリストで代用し（各スキルに記載）、
状態管理が要る処理（sync / next / post / merge-train）は実行せず人間に伝える。

## 2. 初期化

```bash
node "$ORCH" init          # $ORCH_HOME（既定 ~/.orch）に state.json と orch.config.json を作る
```

`orch.config.json` の `account`（自分のGitHubアカウント）と `repos` を埋めるまで、他のコマンドは動かない。
`repos` には各リポジトリのローカルのチェックアウト先（`path`）も書く。**AIはクローンしない。**
設定項目は `references/config.md` を読む。

## 3. コマンド

| コマンド | 使うとき |
|---|---|
| `orch sync` | 何かを始める前。GitHubの差分とスタンプを読んで状態を進める |
| `orch queue` | コメントを投稿する前。行列が満杯なら投稿しない |
| `orch next --mode memo\|build` | AIが次に処理する1件を決める |
| `orch next [--minutes N]` | 人間向けの「今やること」1件 |
| `orch state list\|get\|set` | 状態の読み書き |
| `orch post --kind memo\|split\|approve\|triage` | コメント投稿（commentIdの記録と状態遷移まで） |
| `orch lint memo\|pr <file>` | 生成物の上限検査。exit 2 なら作り直し |
| `orch review run\|record\|status` | AIレビューのpipeline |
| `orch merge-train` | マージ条件の判定とマージ |
| `orch profile` | 今のプロファイル（モデルの組み合わせ）とマネージャの起動コマンド |
| `orch worker --key K --action A --prompt f` | 各リポジトリの worktree でワーカーを起動する |
| `orch apply --file f` | ワーカーの結果エンベロープを state に反映する |
| `orch conflict --files a,b` | 競合を自動解決とhuman確認に分類 |

詳しい引数は `node "$ORCH"` を引数なしで実行すると出る。

## 4. 状態とスタンプ

- マネージャとワーカーの分担、リポジトリの場所、並行実行は `references/topology.md`
- status の一覧と遷移は `references/state.md`
- スタンプの有効条件（自分のアカウントか／🚀がコメント更新より後か／確認事項が全部チェック済みか）は `references/stamps.md`
- 仕様全体の見取り図は `references/spec.md`

state.json を失った場合は `orch sync --rebuild` でコメントの目印（`<!-- ai-memo` など）から再構築する。

## 5. 権限設定（文章だけでなく権限でも縛る）

`.claude/settings.json` に入れておく。

```json
{
  "permissions": {
    "allow": ["Bash(node:*orch.mjs*)"],
    "deny": [
      "Bash(gh api:*reactions*)",
      "Bash(gh pr merge:*)",
      "Bash(gh issue edit:*)"
    ]
  }
}
```

リアクション作成APIを拒否しておくと、AIが自分で🚀を押して自分の作ったものを承認する事故が起きない。

## 6. 導入の順番

**最初から全部自動化しない。** 長いメモが大量に生成されて読む量が増えると、元の問題に戻る。

1. `orch-issue-memo` を手で呼び、理解メモの長さと粒度が安定するまでここで止める
2. `orch init` → `orch sync` で状態の自動遷移を入れる
3. `orch next` の1画面を使い始める
4. `orch-implement` とPRテンプレート
5. `orch merge-train`

定期実行したくなったら、Claude Desktop のスケジュールタスクか launchd から `claude -p "/orch-tick"` を呼ぶ。
スケジューラは任意で、無くてもスキルを手で呼べば同じ動作になる。

## 注意事項

- PR作成者は自分のPRをApproveできないため、セルフレビューの承認はスタンプで代替している
- ブランチ保護で「承認レビュー必須」が有効な場合、スタンプではその条件を満たせない。組織のリポジトリでは設定を迂回せず、チームで合意してから変更する
- 「古い承認を取り消す」設定が有効だと、プッシュのたびに他エンジニアの承認が外れる
- 図・ダッシュボード等でリポジトリ外にリンクを貼る場合、`github.com` を `redirect.github.com` に置き換えるとバックリンク（他エンジニアから見えるノイズ）を作らない
