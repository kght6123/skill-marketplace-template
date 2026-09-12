## 何のため
経理が月次締めで前月分だけCSV出力したい。Part of #123

## 全体のどこか
```mermaid
graph LR
  A[画面で期間入力<br/>#47] --> B[APIへ送信<br/>#45]
  B --> C[期間を検証<br/>#46]:::cur
  C --> D[期間で絞込<br/>#46]:::cur
  D --> E[CSV生成<br/>済]
  classDef cur fill:#dbeafe,stroke:#2563eb
```

## このPRですること
`exportCsv` に期間の絞り込みを追加。画面側は #47 で対応。

```mermaid
graph LR
  A2[CSV出力] --> D2[期間検証]:::new
  D2 --> B2[期間で絞込]:::chg
  B2 --> C2[CSV生成]
  classDef new fill:#dcfce7,stroke:#16a34a
  classDef chg fill:#fef9c3,stroke:#ca8a04
```

## 見てほしい所
- `export.ts:42` 終了日なしのとき今日までにしている扱い
- タイムゾーンはJST固定（#123 Q1 の回答どおり）

## テスト
| 例 | テスト |
|---|---|
| 8/1〜8/31 | ✅ |
| 終了日なし | ✅ |
| 開始>終了 | ✅ |

<details><summary>メモとの差分・AIレビュー結果</summary>

**メモにない判断**: エラーは400で返す（既存APIに合わせた）
**指摘**: warn 2件 / info 5件
</details>
