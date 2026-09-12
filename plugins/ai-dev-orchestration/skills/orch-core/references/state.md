# state.json

置き場所は `$ORCH_HOME/state.json`（既定 `~/.orch/state.json`）。
スキル＝手順、state＝状態なので、スキルのフォルダとは分ける。

```json
{
  "version": 1,
  "updatedAt": "2026-09-12T09:00:00.000Z",
  "lastSync": "2026-09-12T09:00:00.000Z",
  "issues": {
    "org/order-api#123": {
      "key": "org/order-api#123",
      "depth": 1,
      "parent": null,
      "status": "memo-review",
      "commentId": 2345678901,
      "approvedBy": "body",
      "blockedBy": [],
      "title": "期間指定API",
      "milestoneDue": "2026-09-30",
      "enteredStatusAt": "2026-09-12T01:00:00.000Z",
      "sizing": { "estimatedPrs": 3, "examples": 3 },
      "prs": [
        { "number": 46, "order": 2, "headSha": "def5678",
          "approvalCommentId": 3456789, "approvedSha": "def5678",
          "selfApproved": true, "triageCommentId": null,
          "triageApproved": false, "triageApplied": false, "merged": false }
      ]
    }
  }
}
```

## status

| status | 意味 | 人間待ち |
|---|---|---|
| candidate | 本文にまだ🚀が無い（並び順7「本文スタンプ候補」に出す） | |
| sizing | 規模判定待ち | |
| split-review | 分割案の承認待ち | ✓ |
| split-done | 子の完了待ち | |
| waiting-answer | 起票者の回答待ち | |
| memo-review | メモの承認待ち | ✓ |
| ready | 着手可 | |
| implementing | 実装中 | |
| pr-review | セルフ／レビュアー待ち | ✓ |
| needs-human | 自動で進めない | ✓ |
| parked | 👀 後回し | |
| done | 完了 | |

`candidate` だけは仕様の表に無い。並び順7を出すために追加した。

## 主な遷移（すべて `orch sync` か `orch post` が行う）

| きっかけ | 遷移 |
|---|---|
| Issue本文に有効な🚀 | candidate → sizing |
| 規模判定が小 → メモ投稿（確認事項あり） | sizing → waiting-answer |
| 規模判定が小 → メモ投稿（確認事項なし） | sizing → memo-review |
| 規模判定が大・深さ<3 → 分割案投稿 | sizing → split-review |
| 規模判定が大・深さ3 | sizing → needs-human |
| メモに有効な🚀（確認事項が全部チェック済み） | memo-review → ready |
| 分割案に有効な🚀 | split-review → split-done |
| 全Sub Issueがdone | split-done → done |
| PR作成 | ready/implementing → pr-review |
| 全PRがマージ済み | pr-review → done |
| 👀 | any → parked |
| レビューの block が maxRounds 超過 | any → needs-human |

## 書き込みのロック

`state.json.lock` で直列化する。ロックは**短時間しか持たない**。
`orch sync` は GitHub からの取得をロックの外で済ませ、最後の反映だけロックを取る。
ロックを持ったままネットワークを待つと、遅い日に stale 判定へ引っかかり、
生きているロックを別プロセスに消される。そこからロストアップデートが起きる。

ロックには持ち主のPIDが入っている。持ち主が死んでいれば即座に、
生きていても60秒を超えたら剥がす。

## 失った場合

```bash
node "$ORCH" sync --rebuild
```

コメントの目印（`<!-- ai-memo v1 -->` / `ai-split` / `ai-approve` / `ai-triage`）を探して再構築する。
