# skill-marketplace

Claude Code / Copilot CLI / Codex CLI / OpenCode など複数のAIコーディングツールに対応した Agent Skills の配布リポジトリです。

## スキル一覧

| Skill | Description |
|-------|-------------|
| [example-skill](./skills/example-skill/SKILL.md) | スキルの作成・フォーマット方法を説明するサンプルスキル |

## インストール方法

### Claude Code — `/plugin` コマンド経由（推奨）

```
/plugin marketplace add kght6123/skill-marketplace
/plugin install skill-marketplace@skill-marketplace
```

### 手動コピー（ツール別）

```bash
# リポジトリをクローン
git clone https://github.com/kght6123/skill-marketplace.git
cd skill-marketplace

# ツール別コピー先
cp -r skills/example-skill ~/.claude/skills/        # Claude Code（direct）
cp -r skills/example-skill ~/.copilot/skills/       # Copilot CLI
cp -r skills/example-skill ~/.codex/skills/         # Codex CLI
cp -r skills/example-skill ~/.opencode/skills/      # OpenCode
```

| ツール | インストールコマンド |
|--------|-------------------|
| Claude Code（plugin） | `/plugin install skill-marketplace@skill-marketplace` |
| Claude Code（direct） | `cp -r skills/example-skill ~/.claude/skills/` |
| Copilot CLI | `cp -r skills/example-skill ~/.copilot/skills/` |
| Codex CLI | `cp -r skills/example-skill ~/.codex/skills/` |
| OpenCode | `cp -r skills/example-skill ~/.opencode/skills/` |

## リポジトリ構造

```
skill-marketplace/
├── README.md                          # このファイル
├── LICENSE                            # MIT License
├── .gitignore
├── .claude-plugin/
│   ├── marketplace.json               # マーケットプレイス定義（source: "."）
│   └── plugin.json                    # プラグインメタデータ
├── skills/
│   └── example-skill/
│       └── SKILL.md                   # スキル本体（唯一の配置場所）
└── commands/
    └── example-skill.md               # スラッシュコマンド定義
```

## 新しいスキルを追加するには

1. `skills/<skill-name>/` ディレクトリを作成
2. `skills/<skill-name>/SKILL.md` にスキル本体を記述（[example-skill](./skills/example-skill/SKILL.md) を参照）
3. 必要であれば `commands/<skill-name>.md` にスラッシュコマンドを追加
4. このREADMEのスキル一覧テーブルを更新

> スキルを追加するだけで Claude Code に自動認識されます。`marketplace.json` への追記は不要です。

## ライセンス

MIT License — 詳細は [LICENSE](./LICENSE) を参照してください。
