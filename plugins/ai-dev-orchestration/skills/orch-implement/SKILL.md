---
name: orch-implement
description: 承認済みの理解メモから実装して stacked PR を作るワーカー側のスキル。ユーザーが「このIssueを実装して」「orchのbuildで実装して」「PRを作って」「レビュー指摘に対応して」「次のPRを実装して」「セルフレビューのコメントを作って」などと言ったら使う。マネージャが用意した worktree の中で動き、スケルトンのテスト名からテストを書き、AIレビューを通して PR の中身まで用意する。worktree作成・PR作成・コメント投稿・state.json はマネージャの担当で、ワーカーは結果をエンベロープで返すだけ。マージはしない。
argument-hint: <org/repo#123> [--mode implement|continue|apply-triage]
---

# orch-implement

理解メモに🚀が付いた（status が `ready`）Issueだけを実装する。メモが無いものには着手しない。

**このスキルはワーカーとして動く。** worktree もブランチもマネージャ（`orch worker`）が用意済みで、
それが最初から作業ディレクトリになっている。そのリポジトリの `CLAUDE.md`・`.claude/settings.json`・
フック・プロジェクトスキルが効いている。リポジトリの流儀（テストコマンド・規約）は、ここにあるものに従う。

**ワーカーは外に何も書かない。** やるのは「今いるディレクトリでコードを直してコミットする」ことだけ。
worktree を作らない・state.json を書かない・コメントを投稿しない・PRを作らない。
`ORCH_ROLE=worker` なので `orch state set` / `orch post` / `orch worker` は拒否される。
やったことと作ってほしいものは、最後にエンベロープ1個で返す。反映はすべてマネージャがやる。

| | ワーカー（このスキル） | マネージャ |
|---|---|---|
| worktree・ブランチ | 用意されたものを使う | 作る・片付ける |
| コード・テスト・コミット | やる | やらない |
| PR作成 | `pullRequest` で頼む | `gh pr create` する（lint後） |
| コメント投稿 | `comments` で頼む | `orch post` で投稿する |
| state.json | 触らない | `orch apply` で反映する |

渡される環境変数は `ORCH_ROLE` / `ORCH_KEY`（対象キー）/ `ORCH_ACTION`（モード）/ `ORCH_BRANCH`（作業ブランチ）/
`ORCH_OUTBOX`（本文の受け渡し用ディレクトリ）。

**本文のファイルは `$ORCH_OUTBOX` か worktree の中に置く。** それ以外の場所を `bodyFile` に書くと
マネージャが読まずに止まる（ワーカーが任意のファイルを投稿できると危ないため）。

スクリプトの場所と実行の鉄則は `orch-core/SKILL.md`、役割の境界は `orch-core/references/topology.md`。

## モード

`orch next --mode build` が返した `action` をそのまま使う。

| action | 条件 | やること |
|---|---|---|
| `implement` | ready、依存先がすべてdone、pr-reviewが上限未満 | テスト → 実装 → AIレビュー → PR本文を用意 |
| `implement-continue` | implementing、または前のPRがマージ済み | 次のPRを実装（base は前のブランチ） |
| `apply-triage` | 対応案に🚀済み | 修正して再プッシュ、新しい承認用コメントを用意 |

`maxStackedPrs`（既定10）に達しても作業が残るときは、停止して残作業を新しいIssueとして `sizing` に登録する。

## 手順

### 1. 対象と理解メモを読む

```bash
node "$ORCH" state get <key>
gh issue view <number> --repo <org/repo> --json title,body,comments
```

メモの **例の表** と **スケルトン** が仕様書。ここに無い機能を足さない。

### 2. 今いる場所を確かめる

worktree は作らない。作られたものの中にもういる。

```bash
pwd && git branch --show-current   # = $ORCH_BRANCH
```

ブランチが `$ORCH_BRANCH` と違っていたら、切り替えずに `needs_human: true` で返す。
ブランチ名を自分で決めない。スタックの何本目かはマネージャが state から決めている。
**このディレクトリの外に出ない。`git worktree add` も `git push --force` もしない。**

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

### 6. PR の中身を用意する（作るのはマネージャ）

コミットして push するところまでがワーカーの仕事。`gh pr create` は叩かない。

```bash
git push -u origin "$ORCH_BRANCH"
```

本文は `references/pr-template.md` の形でファイルに書き、手元で lint を通しておく。

```bash
node "$ORCH" lint pr "$ORCH_OUTBOX/pr-body.md" --title "feat(order-api): 期間指定でCSVを絞り込む [2/3] #123"
```

exit 2 なら作り直す。通ったらエンベロープの `pullRequest` に載せて返す。

```json
"pullRequest": {
  "title": "feat(order-api): 期間指定でCSVを絞り込む [2/3] #123",
  "head": "<$ORCH_BRANCH の値>",
  "bodyFile": "$ORCH_OUTBOX/pr-body.md",
  "draft": false
}
```

`head` は必ず `$ORCH_BRANCH`。違うブランチを書くとマネージャが拒否する。
`base` はマネージャが state から決めるので書かなくてよい（2本目以降は前のPRのブランチ）。
マネージャは作る前にもう一度 `lint pr` をかけ、落ちたら作らない。番号と `headSha` は
作った後にマネージャが記録するので、ワーカーが書く必要はない。

### 7. セルフレビューの承認用コメントを用意する

```markdown
<!-- ai-approve v1 sha=abc1234 -->
**レビュー対象**: `abc1234`（スタック 2/3、前: #45）
メモとのずれ: なし ／ 未解決の指摘: なし

---
<sub>🚀👍❤️ レビュー依頼へ ／ 👎 修正依頼（行コメントに理由）／ 😄 後回し</sub>
```

ワーカーは投稿できないので、本文を `$ORCH_OUTBOX` に書いてエンベロープの `comments` に載せる。
投稿はマネージャが `orch post --kind approve` で行う。

🚀の意味は「セルフレビューOK、他のエンジニアにレビュー依頼」。マージ条件は他エンジニアのApprove。
**自分では🚀を押さない。**

### 8. 結果を返す

最後に必ずこれを標準出力へ出す。これが無いとマネージャは結果を反映できない。

**返してよいのは観測した事実だけ。** `merged` `selfApproved` `approvalCommentId` `approvedSha`
`triageApproved` `triageApplied` はマネージャ管轄で、入れるとエンベロープごと拒否される。
`status` も action ごとの許可リスト内（実装なら `implementing` / `pr-review` / `needs-human`）だけ。

```
<<<ORCH_RESULT>>>
{
  "key": "org/order-api#125",
  "action": "implement",
  "status": "pr-review",
  "pullRequest": {
    "title": "feat(order-api): 期間指定でCSVを絞り込む [1/3] #125",
    "head": "<$ORCH_BRANCH の値>",
    "bodyFile": "<$ORCH_OUTBOX>/pr-body.md"
  },
  "review": [{ "reviewer": "memo-check", "findings": [] }],
  "comments": [{ "kind": "approve", "bodyFile": "<$ORCH_OUTBOX>/approve.md" }],
  "needs_human": false,
  "notes": "テストを3件追加。エラーは400で返した"
}
<<<END>>>
```

既にあるPRを更新しただけなら `pullRequest` は省き、`prs` に観測した番号と `headSha` を入れる。

```json
"prs": [{ "number": 50, "order": 1, "headSha": "bbb222", "branch": "orch/125" }]
```

### 9. 指摘対応（apply-triage）

`orch-review-triage` が出した対応案に🚀が付いたものだけを実装する。

- 修正してプッシュすると承認は無効になる。新しい承認用コメントを `comments` に載せる（旧の折りたたみはマネージャがやる）
- セルフレビューの対象は、前回承認したSHA（`approvedSha`）からの差分だけ
- 対応が終わったことは申告しない。`action: apply-triage` が成功した事実からマネージャが記録する

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
- 接頭辞は `orch.config.json` の `branchPrefix`（既定 `orch/`）で変えられる
- 他のリポジトリのファイルを触らない。作業ディレクトリの外に出ない
- エンベロープを出さずに終わらない。途中で止まる場合も `needs_human: true` で返す
