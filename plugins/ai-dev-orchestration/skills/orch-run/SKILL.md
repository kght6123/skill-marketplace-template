---
name: orch-run
description: AI開発オーケストレーションの1周（tick / build）を回す司令塔スキル。ユーザーが「AI開発を1周進めて」「orchのtickを回して」「buildを実行して」「今やることを教えて」「orchを回して」「次のタスクは？」などと言ったら使う。自分では生成せず、orch CLI で対象を決めて orch-issue-memo / orch-implement / orch-review-triage に渡し、lint・投稿・state更新・マージまでを順に実行する。
argument-hint: [tick|build|next] [--minutes N] [--project org/repo]
---

# orch-run

分岐と実行だけを担当する。理解メモもコードも、このスキルは書かない。

スクリプトの場所と実行の鉄則は `orch-core/SKILL.md` を読む。以下 `$ORCH` はその手順で解決したパス。

## tick（理解メモのサイクル）

```bash
node "$ORCH" sync
node "$ORCH" queue
node "$ORCH" next --mode memo
```

`items` が空なら何もせずに終わる。空でなければ、各 `item` について:

1. `action` を `orch-issue-memo` に渡して生成させる
2. `node "$ORCH" lint memo <file>` — exit 2 なら作り直し（最大2回）
3. `node "$ORCH" post --key <key> --kind memo|split --body <file>`

最大件数は `limits.memoPerTick`（既定3）。`orch next` が返した件数を超えて処理しない。

## build（実装のサイクル）

```bash
node "$ORCH" sync
node "$ORCH" queue
node "$ORCH" next --mode build
```

`items` の `action` で分岐する。

| action | 渡す先 |
|---|---|
| `implement` / `implement-continue` | `orch-implement` |
| `apply-triage` | `orch-implement`（指摘対応モード） |

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
- `orch next` が空を返した（やることがない、または行列が満杯）

## 1周の流れ

```
sync ──→ queue ──→ next ──→ 生成スキル ──→ lint ──→ post ──→ state更新
                     │                        │
                     └─ 空なら終了            └─ exit 2 なら作り直し（最大2回）
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
