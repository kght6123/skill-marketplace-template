# 分割案のテンプレート

規模判定が「大」（見積もりPR数 > 10 または 例 > 5）で、深さが3未満のときだけ作る。

````markdown
<!-- ai-split v1 -->
## 分割案
**やること**: 管理画面CSVに期間フィルタを追加
> なぜ: … ／ 現状: … ／ 範囲: …

| # | Sub Issue | 対象 | 依存 |
|---|---|---|---|
| 1 | 期間指定をAPIに追加 | order-api | - |
| 2 | 画面に期間入力を追加 | admin-web | 1 |
| 3 | ファイル名に期間を付与 | admin-web | 1 |

**確認事項** @起票者（分割に影響するものだけ）

---
<sub>🚀 分割OK ／ 😄 後回し
作り直し: 👎 粒度がズレ ／ 😕 順番が違う</sub>
````

## 決まり

- Sub Issue の件数に上限はない。各1行で書く
- 依存は `#` 列の番号で書く。子Issue作成時に `blockedBy` へ変換する
- 確認事項は分割の形に影響するものだけ。実装の詳細は各子Issueの理解メモで聞く
- 深さ3で「大」と判定されたら自動分割しない。`needs-human` にして人間に渡す

## 🚀 のあと（create-children）

1. 表の各行を Sub Issue として作成する

```bash
gh issue create --repo <org/repo> --title "期間指定をAPIに追加" \
  --body "親: #123\n\n対象: order-api" --parent 123
```

2. 作った子を state に登録する（担当は自分、深さ+1、依存付きで sizing）

```bash
node "$ORCH" state set org/order-api#201 \
  --set '{"depth":2,"parent":"org/order-api#123","blockedBy":[]}' --status sizing
```

3. 親に `childrenCreated` を立てる

```bash
node "$ORCH" state set org/order-api#123 --set '{"childrenCreated":true}'
```

親IssueのGitHub上のクローズは全Sub Issue完了時。`orch sync` が自動で done にする。
