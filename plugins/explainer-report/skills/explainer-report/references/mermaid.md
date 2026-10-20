# 図の選び方と書き方（Mermaid／画像）

図の種類は「何を伝えたいか」で選ぶ。1つのIssue/PRに伝えたいことが複数あれば、その数だけ図を作る。

## 1. 伝えたいこと → 図の種類

| 伝えたいこと | 図 |
|---|---|
| 処理や判断の流れ | `flowchart` |
| 誰が誰に何を、どの順で送るか | `sequenceDiagram` |
| 状態がどう変わるか | `stateDiagram-v2` |
| テーブルとその関係 | `erDiagram` |
| クラス・型・モジュールの関係 | `classDiagram` |
| 変更前と後の違い | `flowchart` の `subgraph` を左右に並べる（または前後2枚） |
| ブランチ・リリースの流れ | `gitGraph` |
| 作業の段取り・期限 | `gantt` / `timeline` |
| 画面配置、数値の推移、分布 | Mermaidを使わず画像（SVG/matplotlibのPNG）を添付（出力先の方法で） |

## 2. Issue/PRの種類 → 作る図の候補

| 種類 | 伝えたいこと | 図の候補 |
|---|---|---|
| 機能追加PR | 新しい流れ、どこに入るか | 変更前後の `flowchart`、`sequenceDiagram` |
| バグ修正PR | どこで壊れていて、どう直したか | 失敗箇所に印を付けた `sequenceDiagram` か `flowchart`、修正後の同じ図 |
| リファクタリングPR | 構造がどう変わったか（振る舞いは同じ） | 変更前後の `classDiagram` か `flowchart` |
| DB変更PR | テーブルと関係の変化 | 変更前後の `erDiagram` |
| 状態・ワークフロー変更 | 状態の増減、遷移の条件 | `stateDiagram-v2` |
| バグ報告Issue | 再現時に何が起きるか | 失敗箇所に印を付けた `sequenceDiagram` |
| 機能要望・設計Issue | 目指す姿、選択肢の比較 | 目標の `flowchart`、案ごとの図 |
| 計画・タスク分割Issue | 段取りと依存 | `gantt` か `flowchart`（タスク依存） |
| リリース・運用Issue | 手順、ブランチ | `gitGraph`、手順の `flowchart` |

複数の行に当てはまるなら、すべての図を作る。

## 3. 読みやすくするコツ
- **1図1メッセージ、8要素程度**：超えるなら分割するか抽象度を上げる。枚数は増えてよい。
- **図の前に1文**：その図で何を見てほしいかを書く（例：「赤い箇所でタイムアウトが起きる」）。
- **変更箇所を色で示す**：追加は緑、削除は赤、変更は黄。凡例は図の前の1文に書く。
  ```
  classDef add fill:#1b5e20,color:#fff
  classDef del fill:#b71c1c,color:#fff,stroke-dasharray:4
  classDef mod fill:#f9a825,color:#000
  class NewStep add
  ```
- **ラベルは本文・コードと同じ用語**：関数名やテーブル名はそのまま書く。図はラベルが間違っていても正しく見えるので、コードと照合する。
- **矢印に動詞を書く**：`A -->|承認する| B`。
- **向きはLR（左→右）を基本**：縦に長い流れだけTD。
- **定番の種類に絞る**：`architecture-beta`、`block-beta`、`mindmap` などはGitHubのMermaidのバージョン次第で描画されないことがある。
- **日本語ラベルは `"..."` で囲む**：括弧や記号を含むとパースが壊れるため。

## 4. 検証
```bash
# 本文から mermaid ブロックを取り出し、1つずつ描画する
mmdc -i body.md -o out/check.md   # 失敗した図はエラーで分かる
```
エラーが出たら直してから投稿する。
