---
description: Show the Agent Skill format reference (frontmatter fields, directory structure, and description writing guide)
argument-hint: [topic]
---

# Example Skill — スキル作成ガイド

ユーザーが `/example-skill` を実行しました。引数: $ARGUMENTS

`plugins/example-skill/skills/example-skill/SKILL.md` の内容をもとに、スキルの作成方法を説明してください。

## 説明すべき内容

1. **SKILL.md フロントマターフィールド** — `name`, `description` の意味と使い方（公式フィールドのみ）
2. **description の書き方** — AIがスキルを選択するトリガー文の書き方（"Use this skill when..." 形式）
3. **ディレクトリ構造** — `plugins/<skill-name>/skills/<skill-name>/SKILL.md` の構成
4. **コマンドとスキルの違い** — `commands/` (スラッシュコマンド) vs `skills/` (自動トリガー)
5. **新しいスキルの追加手順** — 6ステップのチェックリスト

引数が指定された場合（`$ARGUMENTS`）は、その特定のトピックに絞って詳しく説明してください。
