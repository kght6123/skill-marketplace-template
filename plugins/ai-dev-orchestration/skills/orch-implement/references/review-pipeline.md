# AIレビューの pipeline

実装したコンテキストとは**別に**実行する。自分が書いたコードを自分で見ると通ってしまう。

## 設定（orch.config.json の review）

```json
{
  "review": {
    "maxRounds": 2,
    "onError": "needs-human",
    "steps": [
      { "id": "memo-check", "builtin": "memo-consistency" },
      { "id": "general", "subagent": "code-reviewer" },
      { "id": "security", "skill": "security-review", "when": { "paths": ["**/auth/**", "**/api/**"] } },
      { "id": "lint", "command": "./scripts/review-lint.sh" }
    ]
  }
}
```

指定方法は `skill` / `subagent` / `command` / `builtin` の4種類。
`memo-check` は組み込みで、**無効化できない**。

## 実行の分担

| 種類 | 実行するもの |
|---|---|
| `command` | `orch review run` がその場で実行する |
| `builtin: memo-consistency` | AI が `orch-memo-check` スキルで実行する |
| `skill` / `subagent` | AI が実行する |

```bash
# command 型を実行し、AI が回すべき step を pending で受け取る
node "$ORCH" review run --key <key> --pr <pr> --files "a.ts,b.ts"

# pending の step を実行し、結果を渡す
node "$ORCH" review record --key <key> --pr <pr> --step security --result /tmp/security.json

# 集計して次の行動を決める
node "$ORCH" review status --key <key> --pr <pr>
```

## 出力形式（共通）

どの step もこの形で返す。形式が違うと `onError` に従って止まる。

```json
{
  "reviewer": "security",
  "findings": [
    { "severity": "block", "file": "src/export.ts", "line": 42, "message": "fromの検証なし" }
  ]
}
```

`severity` は `block` / `warn` / `info` の3つだけ。

## 判定（スクリプトが決める）

| status の decision | 意味 | 次にやること |
|---|---|---|
| `pass` | block なし | PR作成へ進む |
| `fix` | block あり、round < maxRounds | 直して `memo-check` と指摘元だけ再実行 |
| `needs-human` | block あり、round >= maxRounds | 止める。残った block は PR 先頭に「未解決の指摘」として載せる |

`warn` / `info` は捨てない。PR本文の折りたたみに全件記載する。
