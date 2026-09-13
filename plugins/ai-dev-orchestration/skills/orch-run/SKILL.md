---
name: orch-run
description: AI開発オーケストレーションの1周（tick / build）をマネージャとして回す司令塔スキル。ユーザーが「AI開発を1周進めて」「orchのtickを回して」「buildを実行して」「今やることを教えて」「orchを回して」「次のタスクは？」などと言ったら使う。自分では実装せず、orch CLI で対象を決め、実装は各リポジトリの worktree でワーカーを起動して任せる。state.json に書くのはこのマネージャだけ。
argument-hint: [tick|build|next] [--minutes N] [--project org/repo]
---

# orch-run

**マネージャ側のスキル。** 分岐と実行だけを担当し、コードは書かない。

`$ORCH_HOME` で起動する。リポジトリのコードを触る作業（実装）は、そのリポジトリの worktree で
ワーカーを起動して任せる。マネージャがコードを触ると、各リポジトリの権限・フック・CLAUDE.md が
効かないまま作業することになる。詳しくは `orch-core/references/topology.md`。

スクリプトの場所と実行の鉄則は `orch-core/SKILL.md` を読む。以下 `$ORCH` はその手順で解決したパス。

## tick（理解メモのサイクル）

```bash
node "$ORCH" sync
node "$ORCH" queue
node "$ORCH" next --mode memo --claim
```

**`--claim` を付ける。** マネージャが2つ動いていても、同じ件を両方が処理しないための予約で、
選択と予約が1つのロックの中で行われる。付けないと下見（予約なし）になり、二重に処理しうる。
返ってきた `leaseId` は処理が終わったら返す。

```bash
node "$ORCH" lease release --key <key> --id <leaseId>
```

`items` が空なら何もせずに終わる。空でなければ、各 `item` の **`action` ごとに手順が違う**。
`item.action` で分岐し、下の表の列をそのまま実行する。**どの action も lint→post だと思い込まない。**

| action | 生成するもの | lint | post | 仕上げ |
|---|---|---|---|---|
| `sizing` | 見積もり（JSON、ファイル無し） | しない | **しない** | `state set --set '{"sizing":{"estimatedPrs":N,"examples":M}}'` |
| `memo` | 理解メモ本文 | `lint memo` | `post --kind memo` | post が status を進める |
| `memo-update` | 回答を反映した本文 | `lint memo` | `post --kind memo --update` | 同じコメントを上書き |
| `memo-redo` | 直した本文（新規） | `lint memo` | `post --kind memo` | 旧コメントは post が折りたたむ |
| `split` | 分割案 | **`lint split`** | `post --kind split` | → split-review |
| `split-redo` | 直した分割案（新規） | **`lint split`** | `post --kind split` | 旧は post が折りたたむ |
| `create-children` | Sub Issue（GitHub上） | しない | **しない** | `gh issue create --parent` → 子を `state set --status sizing` → 親に `--set '{"childrenCreated":true}'` |
| `post-pending` | 無し（前回の投稿が残っている） | しない | `post --pending --key <key>` | 通れば status が進む。PRは作り直さない |

`sizing` と `create-children` には投稿する本文が無い。ファイルが無いのに `lint` や `post` を呼ぶと
そこで落ちる。逆に本文を作る5つは、**lint を通さずに post しない**（exit 2 なら作り直し、最大2回、
通らなければ `state set --status needs-human` で止める）。

**分割案に `lint memo` を使わない。** マーカーも見出しも違う（`ai-split` / `## 分割案`）ので、
正しく書いた分割案でも必ず block になる。分割案は `lint split`。

生成そのものは `orch-issue-memo` に `key` と `action` を渡して任せる。マネージャは action の振り分けと
lint／post の実行だけを持つ。

`state set` で `sizing` を書いた後、大小の判定はしない。次の `orch next` が `split` か `memo` を返す。

最大件数は `limits.memoPerTick`（既定3）。`orch next` が返した件数を超えて処理しない。

## build（実装のサイクル）

```bash
node "$ORCH" sync
node "$ORCH" queue
node "$ORCH" next --mode build --claim
```

`items` の `action` ごとに、ワーカー用の指示を書いて起動する。build 側は3つとも
「ワーカーを起動 → 返ってきたエンベロープを `orch worker` が反映」で同じ形になる。

| action | ワーカーに頼むこと | エンベロープで返るもの |
|---|---|---|
| `implement` | 1本目の実装 | `pullRequest`（新規PR）＋ `approve` コメント |
| `implement-continue` | 続きのPR（base は前のブランチ） | 同上 |
| `apply-triage` | 🚀済みの対応案を反映して再プッシュ | `prs`（`headSha` 更新）＋ 新しい `approve` コメント |
| `post-pending` | （ワーカーを起動しない）`orch post --pending --key <key>` だけ | — |

ブランチはマネージャが state から決めて `ORCH_BRANCH` で渡す。1本目は `orch/125/1`、
2本目は `orch/125/2`（1本目から分岐）。ワーカーに決めさせない。

PR作成もコメント投稿もマネージャ側で `orch worker` がやる。ワーカーの出力を見て自分で
`gh pr create` や `orch post` を追加で叩かない（二重に作る）。

```bash
cat > /tmp/task-125.md <<'TASK'
orch-implement スキルの手順で org/order-api#125 を実装してください。
action: implement
理解メモ: <本文を貼る>
終わったら <<<ORCH_RESULT>>> … <<<END>>> で結果を返してください。
TASK

node "$ORCH" worker --key org/order-api#125 --action implement --prompt /tmp/task-125.md \
  --lease <next が返した leaseId>
```

`--lease` を渡しておくと、成功しても失敗しても予約が返る。渡し忘れると期限（既定はワーカーの
タイムアウトの2倍）まで、その Issue が誰にも選べないままになる。

`orch worker` が worktree を用意し、そこを作業ディレクトリにしてワーカーを起動し、
返ってきたエンベロープを検証して state に反映するところまでやる。

**並行させる場合**は `orch worker` を同時に複数起動する。上限は `limits.parallelWorkers`（既定12）。
同じIssueに2本来ても worktree は連番（`<repo>-125`, `<repo>-125-2`）で分かれるので衝突しない。

```bash
node "$ORCH" worker --key org/order-api#125 --action implement --prompt /tmp/a.md --lease $L1 &
node "$ORCH" worker --key org/admin-web#47 --action implement --prompt /tmp/b.md --lease $L2 &
wait
```

競合の防止は2層ある。混同しない。

| 層 | 守るもの | 仕組み |
|---|---|---|
| 予約（lease） | 同じ Issue / action を2本が処理しない・WIP を超えない | state の中で選択と同時に取る |
| worktree の枠 | 同じディレクトリに2本入らない | `<dir>.lock` を `O_EXCL` で取る |

worktree の枠だけでは二重実装は防げない（別々の枠に入って同じ Issue を2回実装できる）。

`needs_human` が返ったワーカーは、その件だけ止めて人間に渡す。他の件は続けてよい。

`orch sync` が `needsReviewer` を返したら、その件にレビュアーを割り当てる。
誰が空いているかを自分で考えない。依頼中件数・上限・スタックの引き継ぎはスクリプトが決める。

```bash
node "$ORCH" assign --key org/order-api#123 --pr 46
```

`waiting: true` が返ったら全員が上限。これは異常ではなく人間の行列を守っている状態なので、
上限を上げて回避しない。引き継ぎ先が上限のときも同じで、上限を超えてまで引き継がない。

実装が終わったら、続けてマージを試す。

```bash
node "$ORCH" merge-train
```

`reasons` が付いて `merged: false` のものは条件を満たしていないだけ。**理由を読んで納得しても、自分で
マージしない**。

## next（人間向けの1画面）

```bash
node "$ORCH" next --human                    # 今やること1件＋行列の件数
node "$ORCH" next --human --minutes 15       # 空き時間内に終わる1件
node "$ORCH" next --human --project org/api  # 同じプロジェクトを優先
```

出すのは人間の判断が必要なものと、止まっている理由だけ。順調に動いているAIの作業は表示しない。

## 止まる条件

次のどれかが起きたら、そこで止めて状況を人間に伝える。続きを推測で進めない。

- exit code が 1（エラー）
- `"needs_human": true` が返った
- lint が2回直しても通らない
- `orch next` が空を返した（やることがない、行列が満杯、または段が届いていない）

`blocked: "phase"` が返ったら、設定の段がそこまで来ていないだけ。
**段を上げるか人に聞かない。** 「phase N なので実装は動かさない」と一言伝えて終わる。

## 1周の流れ

```
sync ──→ queue ──→ next --claim ──→ action で分岐
                     │        ├─ sizing / create-children ──→ state set（lint・post は無し）
                     └─ 空なら終了
                              ├─ memo 系 ──→ 生成 ──→ lint memo ──→ post ──→ state更新
                              ├─ split 系 ──→ 生成 ──→ lint split ──→ post ──→ state更新
                              │                                 └─ exit 2 なら作り直し（最大2回）
                              └─ implement 系 ──→ orch worker ──→ PR作成・投稿・state更新
```

## 定期実行

スケジューラは任意。使う場合は Claude Desktop のスケジュールタスクか launchd から次を呼ぶ。

```bash
claude -p "/orch-tick"     # 30分ごと
claude -p "/orch-build"    # 1時間ごと
```

無くても `/orch-tick` を手で打てば同じ動作になる。

## 注意事項

- 行列が満杯なら `orch next` は何も返さない。これは正常な動作で、上限を上げて回避しない
- 1周で扱う件数はスクリプトが決める。まとめて処理して人間の行列を伸ばさない
- `orch sync` を飛ばして `next` だけ実行しない。スタンプの読み取りが漏れる
- マネージャが直接リポジトリを編集しない。実装は必ずワーカーに渡す
- ワーカーが返したエンベロープを信用しすぎない。検証は `orch worker` がやる。落ちたら止める
- `--claim` で取った予約は必ず返す。`orch lease list` で残っているものを確認できる
- `orch sync` の `degraded` を読む。取得できなかったものがあると、その分だけ判断を保留している
- レビュアーの予約が落ちて残ったら `orch assign reap`（生きているものは消さない）
- 予約が残ったまま落ちたときは `orch lease reap`（期限切れ・持ち主が死んだものだけ掃除する）
