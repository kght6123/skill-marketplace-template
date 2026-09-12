---
name: orch-issue-memo
description: GitHub Issue の規模判定・分割案・理解メモを生成するスキル。ユーザーが「理解メモを作って」「このIssueの規模を判定して」「Issueを分割して」「分割案を出して」「メモを作り直して」「起票者の回答をメモに反映して」「Sub Issueを作って」などと言ったら使う。実装前に「何をやるか」を人間が5分で確認できる形にするのが目的で、コードは書かない。orch-core の orch CLI で行列の空きを確認し、生成後に lint を通してから投稿する。
argument-hint: <org/repo#123> [--mode sizing|split|memo|memo-update|memo-redo|create-children]
---

# orch-issue-memo

実装の前に「意図」を人間に読ませるための生成スキル。コードは書かない。

スクリプトの場所と実行の鉄則は `orch-core/SKILL.md` を読む。以下 `$ORCH` はその手順で解決したパス。

## モード

`orch next --mode memo` が返した `action` をそのまま使う。自分で選ばない。

| action | 対象 | やること |
|---|---|---|
| `sizing` | sizing | 見積もりPR数と例の数を返すだけ。大小の判定はスクリプト |
| `split` | 大・深さ<3 | 分割案を投稿 → split-review |
| `memo` | 小 | 理解メモを投稿 → 確認事項の有無で分岐 |
| `memo-update` | 回答あり | 同じコメントを上書き |
| `memo-redo` / `split-redo` | 👎😕👀 | 新コメントを投稿し、旧を折りたたむ |
| `create-children` | 分割案に🚀 | 表を解析して Sub Issue を作成 |

## 手順

### 1. 何を処理するか決める

```bash
node "$ORCH" sync
node "$ORCH" next --mode memo        # items が空なら何もせず終了
```

`items` は最大3件。返ってきた `key` と `action` 以外には手を出さない。

### 2. Issue を読む

```bash
gh issue view <number> --repo <org/repo> --json title,body,comments
```

### 3. action ごとの生成

**sizing** — 見積もりだけを返す。判定はしない。

```bash
node "$ORCH" state set <key> --set '{"sizing":{"estimatedPrs":3,"examples":4}}'
```

見積もりPR数は「利用者から見た変化」1つを1PRとして数える。例の数は受け入れ条件になる入出力の組。

**memo / memo-update / memo-redo** — `references/memo-template.md` の形で本文を書き、ファイルに保存する。
`memo-redo` のときは、押されたスタンプ（`state get` の `redo`）が示す方向に直す。
👎＝理解がズレ、😕＝例が違う、👀＝長い（読むのが大変）。

**split / split-redo** — `references/split-template.md` の形で書く。

**create-children** — 分割案の表を解析して Sub Issue を作る。

```bash
gh issue create --repo <org/repo> --title "..." --body "..." --parent <number>
node "$ORCH" state set <child-key> --set '{"depth":2,"parent":"<key>","blockedBy":["..."]}' --status sizing
node "$ORCH" state set <key> --set '{"childrenCreated":true}'
```

### 4. lint を通す

```bash
node "$ORCH" lint memo /tmp/memo.md
```

exit 2 なら **作り直し**。同じ内容を投稿しない。2回直しても通らなければ needs-human にして止める。

```bash
node "$ORCH" state set <key> --status needs-human
```

### 5. 投稿する

```bash
node "$ORCH" post --key <key> --kind memo --body /tmp/memo.md          # 新規
node "$ORCH" post --key <key> --kind memo --body /tmp/memo.md --update # 回答反映
```

`gh issue comment` を直接叩かない。commentId の記録と状態遷移が飛ぶ。

## 生成ルール（ここを外すと読む量が増えて元の問題に戻る）

- **やること** は1行。詳細は「なぜ・現状・範囲」の3行固定
- 例は最大5行、確認事項は選択肢付きで最大3つ、スケルトンは20行以内
- **Issue本文の言い換えは禁止**。書いていないことを補うためにメモがある
- 答えによって例が変わるなら確認事項、内部実装だけ変わるなら仮定に書く
- 全体の処理フロー図はここで1枚だけ作る。各PRで使い回す
- 分割案の Sub Issue は件数の上限なし。各1行

## lint が使えない環境でのチェックリスト

スクリプトが見つからないときは、投稿前に目視で確認する。

- [ ] 先頭に `<!-- ai-memo v1 -->`（または `ai-split`）がある
- [ ] **やること** が1行
- [ ] 引用行（なぜ・現状・範囲）がちょうど3行
- [ ] 例の表のデータ行が5行以内
- [ ] 確認事項のチェックボックスが3つ以内
- [ ] スケルトンが20行以内
- [ ] mermaid図が1枚だけ
- [ ] フッタにスタンプの案内がある（文面は `orch stamps` が出す）

## 注意事項

- 行列が満杯のとき `orch next --mode memo` は何も返さない。投稿を増やさないための仕様なので、無理に処理しない
- スタンプを押さない。押すのは人間
- 確認事項に未チェックが残っている限り、🚀があってもメモは承認されない
