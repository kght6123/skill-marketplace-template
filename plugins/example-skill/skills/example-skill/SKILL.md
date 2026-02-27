---
name: example-skill
description: Use this skill when the user asks how to create, format, or structure
  an Agent Skill. Triggers on "how do I create a skill", "show me SKILL.md format",
  "what fields does SKILL.md need", or "help me write a skill description".
---

# Example Skill — スキル作成ガイド

このスキル自体が、新しいスキルを作成する際のリファレンスとして機能します。

## SKILL.md フロントマターフィールド（公式）

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `name` | ✅ | スキルの一意な識別子（ディレクトリ名と一致させる） |
| `description` | ✅ | AIがスキルを選択するトリガー文。**自然言語でユースケースを記述** |
| `disable-model-invocation` | — | `true` にするとモデル呼び出しを無効化（通常不要） |
| `user-invocable` | — | `false` にするとユーザーから直接呼び出し不可にする |
| `allowed-tools` | — | このスキル内で使用可能なツールのリスト |
| `context` | — | スキルに追加コンテキストを渡す設定 |
| `agent` | — | スキルを実行するエージェントの指定 |

> **注意**: `version` や `license` は非公式フィールドです。フロントマターには公式フィールドのみ記述してください。

## description の書き方ガイド

`description` はAIがユーザーのリクエストとスキルをマッチングするために使用します。

**良い例:**
```yaml
description: Use this skill when the user asks to review code for security vulnerabilities,
  check for OWASP top 10 issues, or audit authentication logic.
```

**悪い例:**
```yaml
description: Security tool  # 短すぎる・具体性がない
```

ポイント:
- "Use this skill when..." で始める
- 具体的なユーザーリクエストの例を含める
- トリガーとなるキーワードを自然な文章で含める

## ディレクトリ構造

```
skill-marketplace/
├── .claude-plugin/
│   └── marketplace.json              # マーケットプレイス定義
└── plugins/
    └── <plugin-name>/                # 各スキルは独立したプラグイン
        ├── .claude-plugin/
        │   └── plugin.json           # プラグインメタデータ
        ├── skills/
        │   └── <skill-name>/
        │       └── SKILL.md          # スキル本体（このファイルの形式）
        └── commands/
            └── <skill-name>.md       # スラッシュコマンド定義（オプション）
```

## 新しいスキルの作成手順

1. `plugins/<skill-name>/` ディレクトリを作成
2. `plugins/<skill-name>/.claude-plugin/plugin.json` にプラグイン定義を記述
3. `plugins/<skill-name>/skills/<skill-name>/SKILL.md` にスキル本体を記述（このファイルを参考に）
4. 必要であれば `plugins/<skill-name>/commands/<skill-name>.md` にスラッシュコマンドを追加
5. `.claude-plugin/marketplace.json` の `plugins` 配列にエントリを追加
6. `README.md` のスキル一覧テーブルを更新

## コマンドとスキルの違い

| 種類 | ファイル | トリガー |
|------|---------|---------|
| スキル | `skills/<name>/SKILL.md` | AIが自動選択（`description` でマッチング） |
| コマンド | `commands/<name>.md` | ユーザーが `/<name>` で明示的に呼び出し |

## スキル本文の構成

フロントマターの後は通常のMarkdownで記述します:
- スキルの目的と概要
- 使用例
- 出力フォーマット（テンプレート）
- 注意事項・制約

スキルの本文はAIへの指示として機能します。ユーザーがこのスキルを呼び出した際に、Claude はこの内容に従って応答を生成します。
