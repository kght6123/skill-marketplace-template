---
name: orch-memo-check
description: PRの差分と本文が理解メモと食い違っていないかを検査し、共通JSON形式で返す組み込みレビュアー。ユーザーが「メモとの整合性をチェックして」「memo-checkを実行して」「PRが理解メモとズレていないか見て」などと言ったとき、または orch のAIレビューpipelineで builtin memo-consistency が指定されたときに使う。実装したコンテキストとは別に実行する。無効化できない。
argument-hint: <org/repo#123> --pr <番号>
---

# orch-memo-check

理解メモは人間が読んで🚀を押したもの。**メモと違うものが入るなら、それは人間が知らない変更**。
ここで捕まえる。

スクリプトの場所と実行の鉄則は `orch-core/SKILL.md` を読む。以下 `$ORCH` はその手順で解決したパス。

## 手順

### 1. メモとPRを並べる

```bash
node "$ORCH" state get <key>                      # commentId
gh api repos/<org/repo>/issues/comments/<id>      # 理解メモ本文
gh pr diff <pr> --repo <org/repo>
gh pr view <pr> --repo <org/repo> --json title,body
```

### 2. 4点を突き合わせる

| 見るもの | 落とす条件 |
|---|---|
| 例の表 ↔ テストの表 | 1対1でない（例にあるのにテストが無い／テストにあるのに例が無い） |
| 確認事項の回答 ↔ 実装 | 回答と違う実装になっている |
| 仮定 ↔ 実装 | 仮定と違うのに、PR本文の「メモにない判断」に書かれていない |
| 範囲 ↔ 変更ファイル | メモの「範囲」に無いリポジトリ・領域を触っている |

### 3. 共通形式で返す

```json
{
  "reviewer": "memo-check",
  "findings": [
    { "severity": "block", "file": "src/export.ts", "line": 42,
      "message": "メモの例「開始>終了 → エラー表示」に対応するテストが無い" },
    { "severity": "warn", "file": "src/format.ts", "line": 8,
      "message": "メモの範囲は order-api のみだが admin-web を変更している" }
  ]
}
```

ファイルに保存して渡す。

```bash
node "$ORCH" review record --key <key> --pr <pr> --step memo-check --result /tmp/memo-check.json
```

## severity の基準

| severity | 使うとき |
|---|---|
| `block` | 例とテストの不一致、確認事項の回答と違う実装 |
| `warn` | 範囲外への変更、仮定と違うが本文に説明がある |
| `info` | メモにない小さな判断（エラーメッセージの文言など） |

## 注意事項

- メモが古い可能性もある。その場合は「メモ側を直す」提案を message に書く
- 実装が正しくてもメモと違えば指摘する。判断するのは人間
- コードの良し悪しは見ない。それは他のレビュアーの仕事
- 実装したコンテキストで実行しない。自分の書いたコードは通ってしまう
