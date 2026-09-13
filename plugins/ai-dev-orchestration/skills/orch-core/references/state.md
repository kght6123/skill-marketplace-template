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
      "parkedFrom": null,
      "lease": null,
      "pendingApply": null,
      "parkedBy": null,
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
| parked | 後回しスタンプ（既定😄）。一時停止レイヤー | |
| done | 完了 | |

`candidate` だけは仕様の表に無い。並び順7を出すために追加した。

## 主な遷移（すべて `orch sync` か `orch post` が行う）

| きっかけ | 遷移 |
|---|---|
| Issue本文に有効な承認スタンプ | candidate → sizing |

| 規模判定が小 → メモ投稿（確認事項あり） | sizing → waiting-answer |
| 規模判定が小 → メモ投稿（確認事項なし） | sizing → memo-review |
| 規模判定が大・深さ<3 → 分割案投稿 | sizing → split-review |
| 規模判定が大・深さ3 | sizing → needs-human |
| メモに有効な承認スタンプ（確認事項が全部チェック済み） | memo-review → ready |
| 分割案に有効な承認スタンプ | split-review → split-done |
| 全Sub Issueがdone | split-done → done |
| PR作成 | ready/implementing → pr-review |
| 全PRがマージ済み | pr-review → done |
| 後回しスタンプ | any → parked（元の status を `parkedFrom` に保存） |
| 後回しが外れた | parked → `parkedFrom`（元の状態へ戻す） |
| レビューの block が maxRounds 超過 | any → needs-human |

## parked は一時停止

後回しは通常の業務状態ではなく、どの status からでも掛けられる一時停止。
掛けたときの status を `parkedFrom` に、どの面（本文かコメントか）で押されたかを
`parkedBy` に残す。外れたら `parkedFrom` へ戻す。

## 予約（lease）

`lease` は「この件は今このマネージャが処理している」という印。status とは別の層で、
**マネージャを2つ以上動かすときの二重実行と WIP 超過を防ぐ**ためだけにある。

```json
{ "id": "…", "action": "implement", "pid": 1234, "hostname": "…",
  "startedAt": "…", "expiresAt": "…" }
```

- `orch next --claim` が、選択と同時にロックの中で取る。取れた側だけが処理する
- 予約中の件は、他のマネージャの `orch next` には出ない
- 予約中の件は、まだ status が動いていなくても WIP の枠を1つ使う
- 生きている判定は**期限が主**。期限を過ぎていても、同じホストで持ち主のプロセスが
  動いていれば奪わない（長く走っているワーカーの横取りを防ぐ）
- 返すのは `orch lease release` か `orch worker --lease <id>`（成否にかかわらず返る）
- 落ちて残ったものは `orch lease reap` が掃除する（生きているものは消さない）

## やり残し（pendingApply）

外に出すコメントは、PRを作る前に**本文と「通ったらどの status にするつもりだったか」を一緒に**
ここへ預ける。全部投稿できてから status を進めるので、投稿だけが落ちても
「pr-review なのに押すコメントが無い」状態にならない。

```json
{ "action": "implement-continue", "leaseId": "…", "finalStatus": "implementing",
  "comments": [{ "kind": "approve", "pr": 50, "body": "…" }] }
```

`finalStatus` を持つのは、**コメントの種類から status を逆算しないため**。approve コメントでも
スタックの途中なら `implementing` のまま進む。逆算すると、一時的なAPI障害で
「続きを作る状態」が失われる。

残っていれば `orch next` が `post-pending` を返し、`orch post --pending` でやり直せる。
最後の遷移は予約と status を再確認してから行うので、投稿している数秒の間に人間が
後回しにしていれば、コメントは投稿済みでも status は動かない。

worktree の枠のロックとは別物。あちらは「同じディレクトリに2本入らない」ためで、
こちらは「同じ Issue を2本が処理しない」ため。worktree の枠だけでは二重実装は防げない。

戻り先を覚えていないと、pr-review で止めたものが sizing まで巻き戻る。
また「外れた」と判断するのは、本文とコメントの両方を確認できたときだけ。
取得に失敗した状態で外れたと見なすと、止めていたものが勝手に動き出す。

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
