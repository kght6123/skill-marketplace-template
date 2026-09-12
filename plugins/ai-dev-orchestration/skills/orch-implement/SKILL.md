---
name: orch-implement
description: 承認済みの理解メモから実装して stacked PR を作るワーカー側のスキル。ユーザーが「このIssueを実装して」「orchのbuildで実装して」「PRを作って」「レビュー指摘に対応して」「次のPRを実装して」「セルフレビューのコメントを作って」などと言ったら使う。各リポジトリの worktree を作業ディレクトリにして動き、スケルトンのテスト名からテストを書き、AIレビューを通してPRを作る。state.json は書かず、結果をエンベロープで返す。マージはしない。
argument-hint: <org/repo#123> [--mode implement|continue|apply-triage]
---

# orch-implement

理解メモに🚀が付いた（status が `ready`）Issueだけを実装する。メモが無いものには着手しない。

**このスキルはワーカーとして動く。** `orch worker` が用意した worktree が作業ディレクトリになっていて、
そのリポジトリの `CLAUDE.md`・`.claude/settings.json`・フック・プロジェクトスキルが効いている。
リポジトリの流儀（テストコマンド・規約）は、ここにあるものに従う。

**state.json は書かない。** `ORCH_ROLE=worker` なので `orch state set` や `orch post` は拒否される。
やったことは最後にエンベロープで返し、state に反映するのはマネージャ。

スクリプトの場所と実行の鉄則は `orch-core/SKILL.md`、役割の境界は `orch-core/references/topology.md`。

## モード

`orch next --mode build` が返した `action` をそのまま使う。

| action | 条件 | やること |
|---|---|---|
| `implement` | ready、依存先がすべてdone、pr-reviewが上限未満 | worktree → テスト → 実装 → AIレビュー → PR作成 |
| `implement-continue` | implementing、または前のPRがマージ済み | 次のPRを実装 |
| `apply-triage` | 対応案に🚀済み | 修正して再プッシュ、新しい承認用コメント |

`maxStackedPrs`（既定10）に達しても作業が残るときは、停止して残作業を新しいIssueとして `sizing` に登録する。

## 手順

### 1. 対象と理解メモを読む

```bash
node "$ORCH" state get <key>
gh issue view <number> --repo <org/repo> --json title,body,comments
```

メモの **例の表** と **スケルトン** が仕様書。ここに無い機能を足さない。

### 2. worktree を切る

```bash
git worktree add ../<repo>-ai-<number> -b ai/<number>-<短い説明>
```

ブランチは必ず `ai/` 接頭辞。**`ai/` 以外のブランチに force push しない。**

### 3. テストから書く

スケルトンのテスト名をそのまま使う。名前を変えると、PR本文のテスト表とメモの例の対応が崩れて
`orch-memo-check` が落ちる。

### 4. 実装する

メモの「仮定」に沿って実装する。仮定と違う判断をしたら、PR本文の「メモにない判断」に書く。

### 5. AIレビューを通す

`orch review` は state を書くのでワーカーからは使えない。設定された step を自分で実行し、
結果をエンベロープの `review` に入れて返す。記録するのはマネージャ。
step の種類と共通の出力形式は `references/review-pipeline.md`。

`block` が出たら直す。2回直しても消えなければ `needs_human: true` で返して止める。
自分のコードを自分で見ると通ってしまうので、`memo-check` は `orch-memo-check` スキルで
別に実行する。

### 6. PR を作る

本文は `references/pr-template.md` の形。書いたら lint を通す。

```bash
node "$ORCH" lint pr /tmp/pr-body.md --title "feat(order-api): 期間指定でCSVを絞り込む [2/3] #123"
```

exit 2 なら作り直し。通ったら作成する。2本目以降は前のPRのブランチを base にする（stacked）。

```bash
gh pr create --repo <org/repo> --base ai/<前のPRのブランチ> --head ai/<このPR> \
  --title "..." --body-file /tmp/pr-body.md
node "$ORCH" state set <key> --set '{"prs":[{"number":46,"order":2,"headSha":"...","merged":false}]}'
```

### 7. セルフレビューの承認用コメントを投稿する

```markdown
<!-- ai-approve v1 sha=abc1234 -->
**レビュー対象**: `abc1234`（スタック 2/3、前: #45）
メモとのずれ: なし ／ 未解決の指摘: なし

---
<sub>🚀 レビュー依頼へ ／ 👎 修正依頼（行コメントに理由）／ 👀 後回し</sub>
```

ワーカーは投稿できないので、本文をファイルに書いてエンベロープの `comments` に載せる。
投稿はマネージャが `orch post --kind approve` で行う。

🚀の意味は「セルフレビューOK、他のエンジニアにレビュー依頼」。マージ条件は他エンジニアのApprove。
**自分では🚀を押さない。**

### 8. 結果を返す

最後に必ずこれを標準出力へ出す。これが無いとマネージャは結果を反映できない。

```
<<<ORCH_RESULT>>>
{
  "key": "org/order-api#125",
  "action": "implement",
  "status": "pr-review",
  "prs": [{ "number": 50, "order": 1, "headSha": "aaa111", "branch": "ai/125" }],
  "review": [{ "reviewer": "memo-check", "findings": [] }],
  "comments": [{ "kind": "approve", "pr": 50, "bodyFile": "/abs/path/approve.md" }],
  "needs_human": false,
  "notes": "テストを3件追加。エラーは400で返した"
}
<<<END>>>
```

### 9. 指摘対応（apply-triage）

`orch-review-triage` が出した対応案に🚀が付いたものだけを実装する。

- 修正してプッシュすると承認は無効になる。新しい承認用コメントを投稿し、旧を折りたたむ
- セルフレビューの対象は、前回承認したSHA（`approvedSha`）からの差分だけ
- 対応が終わったらエンベロープの `prs` に `"triageApplied": true` を入れて返す

## 競合

```bash
node "$ORCH" conflict --files "$(git diff --name-only --diff-filter=U | paste -sd,)"
```

`human` に入ったファイルがあれば `needs_human` が返る。そこで止めて人間に渡す。
`auto` は解決してよいが、解決前後の range-diff をPRにコメントし、事後確認に載せる。
main をブランチにマージする形で対応し、force push はしない。

## 注意事項

- メモに無い機能を足さない。必要だと思ったらPR本文の「見てほしい所」に書いて人間に判断させる
- `gh pr merge` を叩かない。マージは `orch merge-train` だけ
- テストが落ちたまま PR を作らない
- スタック途中で needs-human になったら、それより後ろのPRは待機させる
- 他のリポジトリのファイルを触らない。作業ディレクトリの外に出ない
- エンベロープを出さずに終わらない。途中で止まる場合も `needs_human: true` で返す
