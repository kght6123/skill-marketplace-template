# orch.config.json

置き場所は `$ORCH_HOME/orch.config.json`（既定 `~/.orch/orch.config.json`）。
`node "$ORCH" init` で雛形が作られる。

> 仕様（ToDo#59）はYAMLで書かれているが、依存ゼロで動かすため既定はJSONにしている。
> キー構成は仕様と1対1。`js-yaml` が解決できる環境なら `orch.config.yaml` も読む。

```json
{
  "account": "kght6123",
  "repos": ["org/order-api", "org/admin-web"],

  "wip": { "selfReview": 3, "memoReview": 3, "splitReview": 2 },
  "sizing": { "maxPrs": 10, "maxExamples": 5, "maxDepth": 3 },
  "limits": { "memoPerTick": 3, "implementPerBuild": 1, "maxStackedPrs": 10 },

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
| `account` | スタンプの押し主判定。**必須** |
| `repos` | 監視対象。**必須** |
| `wip.*` | 行列ごとの上限。超えるとその行列を増やす処理が止まる |
| `sizing.maxPrs` / `maxExamples` | 見積もりPR数 > maxPrs または 例 > maxExamples なら「大」 |
| `sizing.maxDepth` | この深さで「大」なら自動分割せず needs-human |
| `limits.memoPerTick` | tick 1回で処理するメモの最大件数 |
| `limits.implementPerBuild` | build 1回で実装する件数 |
| `review.maxRounds` | block の修正を試す回数。超えたら needs-human |
| `review.onError` | レビュー結果が不正だったとき。`needs-human` か `skip` |
| `review.steps[].skill\|subagent\|command\|builtin` | 指定方法は4種類。`skill` / `subagent` はAIが実行し `orch review record` で結果を渡す |
| `review.steps[].when.paths` | 変更ファイルがマッチしたときだけ実行 |
| `merge.method` | `merge`（マージコミット）を推奨 |
| `merge.conflict.humanPaths` | ここにマッチする競合は必ず人間へ |
| `merge.conflict.regenerate` | 競合したら再生成するファイルとコマンド |
| `reviewers.assign` | `one`（依頼中が最少の1人）か `all` |
| `reviewers.away` | 不在。候補から外す |
