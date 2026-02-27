---
name: example-skill
description: Use this skill when the user asks how to create, format, or structure an Agent Skill. Triggers on requests like "how do I create a skill", "show me the skill format", "what fields does SKILL.md need", or "help me write a skill description".
version: 1.0.0
license: MIT
---

# Example Skill — スキル作成ガイド

このスキル自体が、新しいスキルを作成する際のリファレンスとして機能します。

## SKILL.md フロントマターフィールド

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `name` | ✅ | スキルの一意な識別子（ディレクトリ名と一致させる） |
| `description` | ✅ | AIがスキルを選択するトリガー文。**自然言語でユースケースを記述** |
| `version` | 推奨 | セマンティックバージョニング（例: `1.0.0`） |
| `license` | 推奨 | ライセンス識別子（例: `MIT`, `Apache-2.0`） |

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
plugins/
└── <plugin-name>/
    ├── .claude-plugin/
    │   └── plugin.json          # プラグインメタデータ
    ├── skills/
    │   └── <skill-name>/
    │       └── SKILL.md         # スキル本体（このファイルの形式）
    └── README.md                # インストール手順
```

## 新しいスキルの作成手順

1. `plugins/` 以下に新しいプラグインディレクトリを作成
2. `.claude-plugin/plugin.json` でスキルを登録
3. `skills/<skill-name>/SKILL.md` にスキル本体を記述
4. `.claude-plugin/marketplace.json` の `plugins` 配列にエントリを追加
5. `README.md` のスキル一覧テーブルを更新

## スキル本文の構成

フロントマターの後は通常のMarkdownで記述します:
- スキルの目的と概要
- 使用例
- 出力フォーマット（テンプレート）
- 注意事項・制約

スキルの本文はAIへの指示として機能します。ユーザーがこのスキルを呼び出した際に、Claude はこの内容に従って応答を生成します。
