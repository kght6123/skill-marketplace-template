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

worktree は `worktreeRoot`（既定 `$ORCH_HOME/worktrees`）の下に作られ、`orch worker` が無ければ作る。
接頭辞は `branchPrefix`（既定 `orch/`）。

同じIssueに複数のワーカーが来たら、連番で分ける。動いているワーカーは worktree に
`.orch-worker.lock` を置くので、空いている番号が選ばれる。終われば1番から再利用される。

| 本数 | ディレクトリ | ブランチ |
|---|---|---|
| 1本目 | `<repo>-125` | `orch/125` |
| 2本目 | `<repo>-125-2` | `orch/125-2` |
| 3本目 | `<repo>-125-3` | `orch/125-3` |

連番の上限は `limits.parallelWorkers`。すべて埋まっていればエラーで止まる。

## 役割の境界（スクリプトが強制する）

ワーカーは `ORCH_ROLE=worker` 付きで起動される。この環境変数があると `orch` 自身が次を拒否する。

```
sync / post / merge-train / worker / apply / state set / review
```

ワーカーができるのは `lint` `queue` `state get` `state list` `conflict` の読み取り系だけ。
state.json を書くのはマネージャだけなので、ワーカーを並行させても更新が消えない。

## 連携の方式（Claude Code 限定にしない）

マネージャとワーカーの間で使うのは、次の5つだけ。Claude Code のセッション間連携機能や
サブエージェントは使わない。

| 向き | 手段 |
|---|---|
| 往路: 指示 | プロセス起動の引数（または標準入力） |
| 往路: 作業場所 | 子プロセスの作業ディレクトリ（worktree） |
| 往路: 役割 | 環境変数 `ORCH_ROLE` `ORCH_KEY` `ORCH_ACTION` |
| 復路: 結果 | 標準出力のエンベロープ |
| 復路: 失敗 | 終了コード |

どれも普通のUNIXの仕組みなので、「プロンプトを受け取って標準出力に書くCLI」なら何でもワーカーになる。
実際、架空のシェルスクリプトをワーカーにして1周通すテストを入れてある。

### 起動コマンドの設定

`args` に `{prompt}` があればその位置に、無ければ末尾にプロンプトを足す。

```json
{ "worker": { "command": "claude", "args": ["-p"], "promptVia": "arg", "timeoutMin": 30 } }
```

| ツール | 設定 |
|---|---|
| Claude Code | `{ "command": "claude", "args": ["-p"] }` |
| Codex CLI | `{ "command": "codex", "args": ["exec"] }` |
| Copilot CLI | `{ "command": "copilot", "args": ["-p", "{prompt}", "--allow-all-tools"] }` |

### モデルを分ける

**マネージャは良いモデル、ワーカーは安いモデル**にするのが基本。理由は仕事の質が違うから。

| | 仕事 | 推奨 |
|---|---|---|
| マネージャ | 理解メモ・分割案の生成。人間が読む文章の質がこの仕組みの要 | `claude-opus-5` |
| ワーカー | 承認済みのメモとテスト名に沿った実装。範囲が決まっている | `claude-sonnet-5` |

理解メモが長かったり的外れだと、人間の読む量が増えて元の問題に戻る。ここをケチらない。
逆にワーカーは「メモに書いてあることを実装する」だけなので、安いモデルで足りる。

ワーカーのモデルは設定で渡す。

```json
{ "worker": { "command": "claude", "args": ["-p"], "model": "claude-sonnet-5" } }
```

マネージャのモデルは設定では決められない。**人間が起動するときに指定する。**

```bash
claude --model claude-opus-5      # マネージャのセッション
```

`opus` `sonnet` のような短い別名も使える。Codex CLI / Copilot CLI も `--model` を持つので、
`modelFlag` を変えれば同じ形で渡せる。

`promptVia: "stdin"` にするとプロンプトを標準入力から渡す。既定では**標準入力は閉じて**起動する。
開いたままだと EOF を待って止まるCLIがあるため（`codex exec` に既知の問題がある）。

出力は**プレーンテキスト**にする。`--output-format json` のようにツール側でJSONに包む設定にすると、
エンベロープがエスケープされて読めなくなる。

### 手で回す

自動起動を使わなくてもよい。完全にツール非依存で回すなら、次の2ステップで足りる。

```bash
# 1. 起動すべきコマンドと作業ディレクトリを出す（worktree もここで作られる）
node "$ORCH" worker --key org/order-api#125 --prompt /tmp/task.md --dry-run

# 2. 人間が好きなツールでそこで作業し、出力を保存して反映する
node "$ORCH" apply --file /tmp/worker-output.txt
```

## ワーカーの結果（エンベロープ）

ワーカーは最後にこれを標準出力へ出す。マネージャはこれ以外を読まない。

```
<<<ORCH_RESULT>>>
{
  "key": "org/order-api#125",
  "action": "implement",
  "status": "pr-review",
  "prs": [{ "number": 50, "order": 1, "headSha": "aaa111", "branch": "orch/125" }],
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

マネージャが `orch worker` を複数同時に起動してよい。件数は `limits.parallelWorkers`（既定12）。

- state.json への書き込みはロックで直列化される
- 同じIssueに2本来ても worktree は連番で分かれる（上の表）
- 人間の行列がボトルネックなので、並行度を上げても全体は速くならない。上げる前に `orch queue` を見る
