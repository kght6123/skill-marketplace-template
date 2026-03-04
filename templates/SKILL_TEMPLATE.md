---
name: スキル名
description: スキルの説明。「トリガーワード1」「トリガーワード2」「トリガーワード3」などで使用。
argument-hint: <引数1> [--オプション1 <オプション1の値>] [--オプション2 選択肢1|選択肢2|選択肢3]
---

# スキルテンプレート

新しいスキルを追加する際のテンプレートです。

## ディレクトリ構造

```
plugins/
└── your-plugin-name/
    ├── .claude-plugin/
    │   └── plugin.json
    └── skills/
        └── your-skill-name/
            └── SKILL.md
```

## 1. plugin.json

`plugins/your-plugin-name/.claude-plugin/plugin.json`:

```json
{
  "name": "your-plugin-name",
  "description": "スキル群の簡潔な説明"
}
```

## 2. SKILL.md

`plugins/your-plugin-name/skills/your-skill-name/SKILL.md`:

```markdown
---
name: スキル名
description: スキルの説明。「トリガーワード1」「トリガーワード2」「トリガーワード3」などで使用。
argument-hint: <引数1> [--オプション1 <オプション1の値>] [--オプション2 選択肢1|選択肢2|選択肢3]
---

# スキル名

## 概要

このスキルが何をするかを簡潔に説明してください。

## ワークフロー

### Step 1: 最初のステップ

具体的な作業手順を記述します。

```bash
# コマンド例
echo "Hello, World!"
```

### Step 2: 次のステップ

次の作業手順を記述します。

### Step 3: 完了

最終的な出力や結果について記述します。

## 出力フォーマット

出力の形式を定義します（該当する場合）。

```
出力例をここに記載
```

## 使用例

```
> ユーザーの入力例
Claude Codeの応答例
```

## 注意事項

- 注意点1
- 注意点2
- 注意点3
```

## 3. marketplace.json への追加

ルートの `marketplace.json` にスキルを追加:

```json
{
  "name": "skill-marketplace-template",
  "description": "Claude Code SKILLマーケットプレイスのテンプレート",
  "plugins": [
    // ... 既存のスキル ...
    {
      "name": "スキル名",
      "source": "./plugins/スキル名",
      "category": "development",
      "description": "スキルの概要"
    }
  ]
}
```

## チェックリスト

- [ ] `plugins/your-plugin-name/.claude-plugin/plugin.json` を作成した
- [ ] `plugins/your-plugin-name/skills/your-skill-name/SKILL.md` を作成した
- [ ] SKILL.md のフロントマターに `name` と `description` を含めた
- [ ] `description` にトリガーワードを3つ以上含めた
- [ ] `marketplace.json` にスキルを追加した
