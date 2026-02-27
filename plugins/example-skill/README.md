# example-skill

スキルの作成・フォーマット方法を説明するサンプルスキルです。

このスキルを呼び出すと、`SKILL.md` のフロントマターフィールド解説・ディレクトリ構造・`description` の書き方ガイドを参照できます。

## インストール方法

### 1. Claude Code（推奨）— `/plugin` コマンド経由

```
/plugin marketplace add kght6123/skill-marketplace
/plugin install example-skill@skill-marketplace
```

### 2. 手動コピー

```bash
cp -r plugins/example-skill ~/.claude/plugins/local/
```

### 3. シンボリックリンク（opencode / 他ツール対応）

```bash
ln -s /path/to/skill-marketplace/plugins/example-skill ~/.claude/plugins/local/example-skill
```

## 使い方

インストール後、以下のようなリクエストでスキルがトリガーされます:

- "スキルの作成方法を教えて"
- "SKILL.md のフォーマットを見せて"
- "description の書き方は？"
- "新しいスキルを追加したい"
