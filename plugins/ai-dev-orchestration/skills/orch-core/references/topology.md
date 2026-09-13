# どこで起動するか（マネージャとワーカー）

リポジトリを跨いでオーケストレーションするので、セッションは2種類に分かれる。

```
マネージャ（$ORCH_HOME で起動）
  ├ GitHub API と state.json だけを触る。コードは読まない
  ├ 理解メモ・分割案・トリアージ（リポジトリ非依存）
  ├ PR作成・コメント投稿・state更新（ワーカーの依頼を受けて代行する）
  └ ワーカーを起動する ──┬─ ワーカー A（~/src/order-api の worktree で起動）
                          └─ ワーカー B（~/src/admin-web の worktree で起動）
                               実装・テスト・AIレビュー・PR本文の作成
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

## 3つを混ぜない

| | 守るもの | 仕組み |
|---|---|---|
| 予約（lease） | 同じ Issue / action を2本が処理しない・WIP を超えない | `orch next --claim`（state のロック内で選択と予約） |
| スタックのブランチ | PR 1本目 / 2本目 / 3本目 を別ブランチにする | `<branchPrefix><番号>/<スタック>` |
| worktree の枠 | 同じディレクトリを2本が使わない | `<dir>.lock` を `O_EXCL` で取る |

ブランチは**スタックの何本目か**で決まり、枠の番号とは無関係。
以前は枠の連番からブランチを作っていたので、逐次に `implement-continue` すると
枠1が空いていて同じブランチに戻り、2本目のスタックが作れなかった。

| | ディレクトリ | ブランチ |
|---|---|---|
| スタック1本目 | `<repo>-125-slot-1` | `orch/125/1` |
| スタック2本目 | `<repo>-125-slot-1`（枠は使い回す） | `orch/125/2`（1本目から分岐） |
| 別のワーカーが同時に来た | `<repo>-125-slot-2` | — |

スタックの位置は state の `prs` から決めるので、ワーカーは指定できない。
`apply-triage` は新しいスタックを作らず、対象PRのブランチで作業する。
同じスタック位置を2本が同時に実装しようとしたら、git がブランチの二重 checkout を
拒むので**その場で止まる**（枠を変えても解決しないため、別の枠を試さない）。

## worktree の枠

枠は worktree の**隣**に置く `<dir>.lock`（`O_EXCL` で作る）で押さえる。
ディレクトリの中に置くと `git worktree add` が「既に存在する」で落ちるため。
ロックには PID とホスト名を書く。

- 枠を取ってから worktree を作る。作ってから取ると、同じディレクトリを2本が掴む窓が残る
- 古いロックでも、書いてある PID が同じホストで生きていれば奪わない。タイムアウトだけで奪うと、
  長く走っているワーカーの worktree を横取りしてしまう
- 使い回す worktree は、`git status --porcelain` で汚れていれば `reset --hard` と `clean -fd` を
  かけてから渡す。前のワーカーの中断跡の上で実装させない
- 終われば1番から再利用される
- `--dry-run` は割り当て先を計算して返すだけで、worktree もブランチも作らない

枠の上限は `limits.parallelWorkers`。すべて埋まっていればエラーで止まる。
枠のロックは、エンベロープの `bodyFile` を読み終わるまで離さない。先に離すと、
別のワーカーが同じ枠を取って `reset --hard` で本文を消せてしまう。

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
| 往路: 役割 | 環境変数 `ORCH_ROLE` `ORCH_KEY` `ORCH_ACTION` `ORCH_BRANCH` |
| 往路: 本文の受け渡し | 環境変数 `ORCH_OUTBOX`（1回の起動ごとに作られ、終わると消える） |
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

ワーカーのモデルは設定で渡す。マネージャのモデルは設定では決められないので、
**人間が起動するときに指定する。**

```json
{ "worker": { "command": "claude", "args": ["-p"], "model": "sonnet" } }
```

```bash
claude --model opus      # マネージャのセッション
```

モデルIDを直接書いてもよいが（`claude-opus-5` / `claude-sonnet-5` / `claude-haiku-4-5`）、
**別名（`opus` / `sonnet` / `haiku` / `default`）を推奨する。** 世代が上がっても追随するのと、
`default` はプランで解決先が変わるため。

### プロファイルで切り替える

プロファイル名は**マネージャのモデル**。ワーカーはその1段下を既定にしている。

| プロファイル | マネージャ | ワーカー |
|---|---|---|
| `sonnet` | sonnet | sonnet |
| `opus` | opus | sonnet |
| `fable` | fable | opus |

```json
{
  "profile": "opus",
  "profiles": {
    "sonnet": { "manager": { "model": "sonnet" }, "worker": { "model": "sonnet" } },
    "opus":   { "manager": { "model": "opus" },   "worker": { "model": "sonnet" } },
    "fable":  { "manager": { "model": "fable" },  "worker": { "model": "opus" } }
  }
}
```

```bash
node "$ORCH" profile --human              # 今のプロファイルとマネージャの起動コマンド
node "$ORCH" worker --profile opus ...    # コマンドごとに切り替え
ORCH_PROFILE=opus node "$ORCH" ...        # シェルごとに切り替え
```

契約（Pro / Max）による自動判別はできない。使う側が選ぶ。`default` だけは例外で、
Claude Code が契約を見て解決先を変える。

| プラン | `default` の解決先 |
|---|---|
| Max / Team Premium / Enterprise / API | Opus 5 |
| Pro / Team Standard | Sonnet 5 |

Pro で `opus` を選べば使用量は早く減る。並行ワーカーが多いとなおさらなので、
プロファイルに `limits` を足して並行度も一緒に落とすとよい。

Codex CLI / Copilot CLI も `--model` を持つので、`modelFlag` を変えれば同じ形で渡せる。

`promptVia: "stdin"` にするとプロンプトを標準入力から渡す。既定では**標準入力は閉じて**起動する。
開いたままだと EOF を待って止まるCLIがあるため（`codex exec` に既知の問題がある）。

出力は**プレーンテキスト**にする。`--output-format json` のようにツール側でJSONに包む設定にすると、
エンベロープがエスケープされて読めなくなる。

### 手で回す

自動起動を使わなくてもよい。完全にツール非依存で回すなら、次の2ステップで足りる。

```bash
# 1. 起動すべきコマンドと作業ディレクトリを出す（--dry-run は何も作らない）
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
  "pullRequest": { "title": "feat(order-api): … [1/3] #125", "head": "orch/125",
                   "base": "orch/124", "bodyFile": "/path/to/pr-body.md" },
  "review": [{ "reviewer": "memo-check", "findings": [] }],
  "comments": [{ "kind": "approve", "bodyFile": "/path/to/approve.md" }],
  "needs_human": false,
  "notes": "テストを3件追加"
}
<<<END>>>
```

**返してよいのは観測した事実だけ。** マネージャは受け取った値をそのまま信じない。

| 項目 | ワーカー | マネージャ |
|---|---|---|
| `prs[].number` `order` `headSha` `branch` `base` `title` | ✓（既存PRの観測値） | |
| `pullRequest`（作ってほしいPRの中身） | ✓（依頼だけ） | 実際に作る |
| `merged` `selfApproved` `approvalCommentId` `approvedSha` `triageApproved` `triageApplied` | | ✓ |
| `status` | action ごとの許可リスト内だけ | |
| `review` `comments` `notes` `needs_human` | ✓ | |

`status` の許可リストは action で決まる。

| action | 遷移できる先 |
|---|---|
| `implement` / `implement-continue` | `implementing` `pr-review` `needs-human` |
| `apply-triage` | `pr-review` `needs-human` |

範囲外の項目や遷移が入っていたら、**黙って捨てずにエンベロープごと拒否**して
needs-human にする。ワーカーが仕様を誤解したまま進むのを止めるため。
指摘対応が終わったかどうか（`triageApplied`）は、ワーカーの自己申告ではなく
action と実行結果からマネージャが決める。

### PR を作るのはマネージャ

`pullRequest` は「作ってほしいPRの中身」。ワーカーはコミットして push するところまでで、
`gh pr create` は叩かない。マネージャは受け取った本文に **もう一度 `lint pr` をかけてから** 作る。
ワーカー側で作らせると、テンプレートの上限（本文60行・見てほしい所3つ）をすり抜けられるため。
lint が通らなければPRは作らず、そのIssueは止まる。

`bodyFile` で指せるのは **worktree の中** と **`$ORCH_OUTBOX` の中** だけ。ワーカーが決めた文字列を
そのまま読むと、`/etc/passwd` のようなファイルをコメントとして投稿させられるため、
範囲外を指していたらエラーで止まる。手で回す場合は `orch apply --cwd <worktree>` で範囲を渡す。

判定は**実体（realpath）**で行い、symlink そのものを拒否する。パスの文字列だけを見ると
`ln -s /etc/passwd ./approve.md` で「worktree の中」を指したまま外のファイルを読ませられる。
`$ORCH_OUTBOX` 自体が symlink に差し替えられていないかも毎回確かめる。

### AIレビューの完了もマネージャが確かめる

`review.steps` のうち、この変更で必要なもの（`when.paths` に当たるもの＋必須の `memo-check`）が
1つでも欠けていたらPRを作らない。変更ファイルはマネージャが `git diff` で自分で数える。
ワーカーの申告から `when.paths` を評価すると、対象ファイルを隠して security レビューを飛ばせる。

`comments` は「マネージャに投稿してほしいコメント」。ワーカーは投稿できないので、本文だけを返す。
マネージャは `orch post --key … --kind approve --pr 50 --body <bodyFile>` で投稿する。
新しく作るPR宛てのコメントは `pr` を省いてよい。マネージャが作成後の番号に差し替える。

マネージャ側の順番は固定で、`orch worker` / `orch apply` がこの順で実行する。

```
0. 前提の再確認（予約が生きているか・status が開始条件のままか）
1. 投稿するコメントを本文ごと state に預ける（pendingComments）
2. PR作成（lint pr → head の照合 → gh pr create → headSha を記録）
3. state 反映（PRだけ。status はまだ進めない）
4. コメント投稿 → 全部通ってから status を進める
```

**0 が要る理由**: 予約は開始時に取るが、ワーカーが走っている間に人間が 😄 や
needs-human にできる。再確認せずに反映すると、古いワーカーの結果が人間の停止操作を
上書きしてしまう。外に何かを作る前に落とすので、止められた件にPRもコメントも作らない。

**4 を分ける理由**: 先に `pr-review` にすると、承認用コメントの投稿が落ちたときに
「pr-review なのに人間が押すコメントが無い」状態が残り、自分では直せない。
預けたコメントが残っていれば `orch next` が `post-pending` を返し、
`orch post --pending --key <key>` でPRを作り直さずに復旧できる。

`headSha` はPR作成時に取る。次の `sync` を待つと、その間に押された承認スタンプが
どのコミットへの承認かを決められず、マージ判定が1周遅れる。

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
