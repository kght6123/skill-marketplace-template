# どこで起動するか（マネージャとワーカー）

リポジトリを跨いでオーケストレーションするので、セッションは2種類に分かれる。

```
マネージャ（$ORCH_HOME で起動）
  ├ GitHub API と state.json だけを触る。コードは読まない
  ├ 理解メモ・分割案・トリアージ（リポジトリ非依存）
  └ ワーカーを起動する ──┬─ ワーカー A（~/src/order-api の worktree で起動）
                          └─ ワーカー B（~/src/admin-web の worktree で起動）
                               実装・テスト・AIレビュー・PR作成
```

## なぜ分けるのか

Claude Code の設定は**セッションの作業ディレクトリ**に紐づく。

| 読まれるもの | 読まれる場所 |
|---|---|
| `CLAUDE.md` | 作業ディレクトリとその上位（起動時）。サブディレクトリのものはそこのファイルを読んだとき |
| `.claude/settings.json`（権限・フック） | **セッションの主作業ディレクトリのみ** |
| プロジェクトのスキル・コマンド | 同上 |
| `--add-dir` で足したディレクトリの `CLAUDE.md` | 既定では読まれない（`CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` が要る） |

ホームで1つのセッションを起動して全リポジトリを実装すると、**各リポジトリの権限設定とフックが効かない**。
テストコマンドもコーディング規約も、そのリポジトリの CLAUDE.md に書いてあるものが使われない。
サブエージェントも親の作業ディレクトリを引き継ぐので、これは解決しない。

だから実装だけは、そのリポジトリの worktree を作業ディレクトリにした別セッションで動かす。

## リポジトリの場所

`orch.config.json` の `repos` に、ローカルのチェックアウト先を書く。

```json
{ "repos": [
    { "name": "org/order-api", "path": "~/src/order-api" },
    { "name": "org/admin-web", "path": "~/src/admin-web" }
] }
```

**AIはクローンしない。** path が無ければ `orch worker` はエラーで止まる。人間に置き場所を聞く。

worktree は `worktreeRoot`（既定 `$ORCH_HOME/worktrees`）の下に `<repo>-<issue番号>` で作られ、
ブランチは `ai/<issue番号>`。`orch worker` が無ければ作る。

## 役割の境界（スクリプトが強制する）

ワーカーは `ORCH_ROLE=worker` 付きで起動される。この環境変数があると `orch` 自身が次を拒否する。

```
sync / post / merge-train / worker / apply / state set / review
```

ワーカーができるのは `lint` `queue` `state get` `state list` `conflict` の読み取り系だけ。
state.json を書くのはマネージャだけなので、ワーカーを並行させても更新が消えない。

## ワーカーの結果（エンベロープ）

ワーカーは最後にこれを標準出力へ出す。マネージャはこれ以外を読まない。

```
<<<ORCH_RESULT>>>
{
  "key": "org/order-api#125",
  "action": "implement",
  "status": "pr-review",
  "prs": [{ "number": 50, "order": 1, "headSha": "aaa111", "branch": "ai/125" }],
  "review": [{ "reviewer": "memo-check", "findings": [] }],
  "comments": [{ "kind": "approve", "pr": 50, "bodyFile": "/path/to/approve.md" }],
  "needs_human": false,
  "notes": "テストを3件追加"
}
<<<END>>>
```

`comments` は「マネージャに投稿してほしいコメント」。ワーカーは投稿できないので、本文だけを返す。
マネージャは `orch post --key … --kind approve --pr 50 --body <bodyFile>` で投稿する。

マネージャ側の処理:

```bash
node "$ORCH" worker --key org/order-api#125 --action implement --prompt /tmp/task.md
# 別の方法で起動したワーカーの出力を手で反映する場合
node "$ORCH" apply --file /tmp/worker-output.txt
```

`status` が status 一覧に無い、`findings` の形式が違う、エンベロープが無い、のいずれかなら
`needs_human` で止まる。ワーカーの言い分をそのまま state に入れない。

## 並行実行

マネージャが `orch worker` を複数同時に起動してよい。件数は `limits.parallelWorkers`（既定2）。

- state.json への書き込みはロックで直列化される
- 同じリポジトリの同じIssueに対して2つ起動しない（worktreeが衝突する）
- 人間の行列がボトルネックなので、並行度を上げても全体は速くならない。上げる前に `orch queue` を見る
