# orch.config.json

置き場所は `$ORCH_HOME/orch.config.json`（既定 `~/.orch/orch.config.json`）。
`node "$ORCH" init` で雛形が作られる。

> 元の仕様はYAMLで書かれているが、依存ゼロで動かすため既定はJSONにしている。
> キー構成は元の仕様と1対1。`js-yaml` が解決できる環境なら `orch.config.yaml` も読む。

## プロファイル（モデルの組み合わせ）

プロファイル名は**マネージャのモデル**。ワーカーはその1段下を既定にしている。
プランによる自動判別はできないので、明示的に選ぶ。

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

切り替えは3通り。上から優先される。

```bash
node "$ORCH" worker --profile opus ...   # コマンドごと
ORCH_PROFILE=opus node "$ORCH" ...       # シェルごと
# orch.config.json の "profile" キー       # 既定
node "$ORCH" profile --human             # 今どれで動いているか
```

プロファイルは設定全体に上書きで効くので、`limits.parallelWorkers` や `wip` を足せば
モデルごとに並行度も変えられる。既定のプロファイルはモデルだけを指定している。

---

```json
{
  "account": "kght6123",
  "phase": 5,
  "stamps": { "approve": ["rocket", "+1", "heart"], "park": ["laugh"], "redo": ["-1", "confused", "eyes"] },
  "repos": [
    { "name": "org/order-api", "path": "~/src/order-api" },
    { "name": "org/admin-web", "path": "~/src/admin-web" }
  ],
  "worktreeRoot": "~/.orch/worktrees",
  "branchPrefix": "orch/",
  "worker": {
    "command": "claude",
    "args": ["-p"],
    "promptVia": "arg",
    "model": "claude-sonnet-5",
    "modelFlag": "--model",
    "timeoutMin": 30
  },

  "wip": { "selfReview": 3, "memoReview": 3, "splitReview": 2 },
  "sizing": { "maxPrs": 10, "maxExamples": 5, "maxDepth": 3 },
  "limits": { "memoPerTick": 3, "implementPerBuild": 1, "maxStackedPrs": 10, "parallelWorkers": 12, "leaseTtlMin": 60 },

  "nextTask": {
    "focus": { "sameProjectFirst": true, "timeboxMin": 45 },
    "interrupt": ["triage"],
    "audit": { "at": "17:00" },
    "priority": ["blocking", "milestoneDue", "age"]
  },

  "review": {
    "maxRounds": 2,
    "onError": "needs-human",
    "steps": [
      { "id": "memo-check", "builtin": "memo-consistency" },
      { "id": "general", "subagent": "code-reviewer" },
      { "id": "security", "skill": "security-review", "when": { "paths": ["**/auth/**", "**/api/**"] } },
      { "id": "lint", "command": "./scripts/review-lint.sh" }
    ]
  },

  "merge": {
    "method": "merge",
    "conflict": {
      "humanPaths": ["**/auth/**", "**/migrations/**"],
      "regenerate": { "pnpm-lock.yaml": "pnpm install" }
    }
  },

  "reviewers": {
    "default": { "users": ["tanaka", "suzuki"], "assign": "one", "maxOpenPerReviewer": 3 },
    "repos": {
      "org/order-api": { "users": ["sato"] },
      "org/admin-web": { "users": ["tanaka", "yamada"], "assign": "all" }
    },
    "away": ["suzuki"]
  }
}
```

## 項目

| キー | 効果 |
|---|---|
| `profile` / `profiles` | 設定の上書き。名前はマネージャのモデル。`ORCH_PROFILE` と `--profile` が優先 |
| `manager.model` | マネージャの起動に使うモデルの目安。`orch profile` が起動コマンドを出す |
| `stamps.approve` / `park` / `redo` | どのリアクションをどの意味に使うか。既定は 🚀👍❤️ / 😄 / 👎😕👀。1つの意味に複数割り当ててよい。詳細は `stamps.md` |
| `phase` | どこまで自動でやるか（1〜5、既定5）。4未満で実装、5未満でマージが止まる。詳細は `rollout.md` |
| `account` | スタンプの押し主判定。**必須** |
| `repos` | 監視対象。**必須**。`"org/repo"` でも `{ name, path }` でも書ける |
| `repos[].path` | ローカルのチェックアウト先。ワーカーの起動に要る。**AIはcloneしない** |
| `worktreeRoot` | worktree を作る場所。既定は `$ORCH_HOME/worktrees` |
| `branchPrefix` | AIが作るブランチの接頭辞。既定 `orch/`。force push を許すのはこの接頭辞だけ |
| `worker.command` / `args` | ワーカーの起動コマンド。既定は `claude -p`。`args` の `{prompt}` の位置にプロンプトが入る（無ければ末尾） |
| `worker.promptVia` | `arg`（既定）か `stdin`。ツール別の設定例は `topology.md` |
| `worker.model` / `modelFlag` | ワーカーのモデル。指定すると `modelFlag`（既定 `--model`）と一緒に渡す |
| `worker.timeoutMin` | ワーカー1件の上限時間 |
| `wip.*` | 行列ごとの上限。超えるとその行列を増やす処理が止まる |
| `sizing.maxPrs` / `maxExamples` | 見積もりPR数 > maxPrs または 例 > maxExamples なら「大」 |
| `sizing.maxDepth` | この深さで「大」なら自動分割せず needs-human |
| `limits.memoPerTick` | tick 1回で処理するメモの最大件数 |
| `limits.implementPerBuild` | build 1回で実装する件数 |
| `limits.parallelWorkers` | 同時に起動するワーカーの数（既定12）。同じIssueに割り当てる worktree の連番の上限でもある |
| `limits.leaseTtlMin` | 予約（lease）の有効期限（分）。既定は `worker.timeoutMin` の2倍。短すぎると処理中の件を他のマネージャに取られる |
| `defaultBranch` | スタック1本目の分岐元と、変更ファイルの比較先（既定 `main`） |
| `reviewers.repos` | リポジトリ別の上書き。キーは **`org/repo` 形式**（短いリポジトリ名では効かない） |
| `reviewers.default.assign` | `one`（依頼中が最少の1人）か `all`（余裕のある全員） |
| `review.maxRounds` | block の修正を試す回数。超えたら needs-human |
| `review.onError` | レビューが落ちた・結果が不正・結果が返らなかったとき。`needs-human`（既定、止める）か `skip`（飛ばす） |
| `review.steps[].skill\|subagent\|command\|builtin` | 指定方法は4種類。`skill` / `subagent` はAIが実行し `orch review record` で結果を渡す |
| `review.steps[].when.paths` | 変更ファイルがマッチしたときだけ実行 |
| `merge.method` | `merge`（マージコミット）を推奨 |
| `merge.conflict.humanPaths` | ここにマッチする競合は必ず人間へ |
| `merge.conflict.regenerate` | 競合したら再生成するファイルとコマンド |
| `reviewers.assign` | `one`（依頼中が最少の1人）か `all` |
| `reviewers.away` | 不在。候補から外す |
