# skill-marketplace

Claude Code / Copilot CLI / Codex CLI / OpenCode など複数のAIコーディングツールに対応した Agent Skills の配布リポジトリです。

## スキル一覧

| Skill | Description |
|-------|-------------|
| [example-skill](./plugins/example-skill/) | スキルの作成・フォーマット方法を説明するサンプルスキル |

## インストール方法

### Claude Code — `/plugin` コマンド経由（推奨）

```
/plugin marketplace add kght6123/skill-marketplace
/plugin install example-skill@skill-marketplace
```

### 手動コピー（ツール別）

```bash
# リポジトリをクローン
git clone https://github.com/kght6123/skill-marketplace.git
cd skill-marketplace

# ツール別コピー先
cp -r plugins/example-skill/skills/example-skill ~/.claude/skills/        # Claude Code（direct）
cp -r plugins/example-skill/skills/example-skill ~/.copilot/skills/       # Copilot CLI
cp -r plugins/example-skill/skills/example-skill ~/.codex/skills/         # Codex CLI
cp -r plugins/example-skill/skills/example-skill ~/.opencode/skills/      # OpenCode
```

| ツール | インストールコマンド |
|--------|-------------------|
| Claude Code（plugin） | `/plugin install example-skill@skill-marketplace` |
| Claude Code（direct） | `cp -r plugins/example-skill/skills/example-skill ~/.claude/skills/` |
| Copilot CLI | `cp -r plugins/example-skill/skills/example-skill ~/.copilot/skills/` |
| Codex CLI | `cp -r plugins/example-skill/skills/example-skill ~/.codex/skills/` |
| OpenCode | `cp -r plugins/example-skill/skills/example-skill ~/.opencode/skills/` |

## リポジトリ構造

```
skill-marketplace/
├── README.md                          # このファイル
├── LICENSE                            # MIT License
├── .gitignore
├── .claude-plugin/
│   └── marketplace.json               # マーケットプレイス定義
└── plugins/
    └── example-skill/                 # 各スキルは独立したプラグイン
        ├── .claude-plugin/
        │   └── plugin.json            # プラグインメタデータ
        ├── skills/
        │   └── example-skill/
        │       └── SKILL.md           # スキル本体
        └── commands/
            └── example-skill.md       # スラッシュコマンド定義
```

## 新しいスキルを追加するには

1. `plugins/<skill-name>/` ディレクトリを作成
2. `plugins/<skill-name>/.claude-plugin/plugin.json` にプラグイン定義を記述
3. `plugins/<skill-name>/skills/<skill-name>/SKILL.md` にスキル本体を記述（[example-skill](./plugins/example-skill/skills/example-skill/SKILL.md) を参照）
4. 必要であれば `plugins/<skill-name>/commands/<skill-name>.md` にスラッシュコマンドを追加
5. `.claude-plugin/marketplace.json` の `plugins` 配列にエントリを追加
6. このREADMEのスキル一覧テーブルを更新

## ライセンス

MIT License — 詳細は [LICENSE](./LICENSE) を参照してください。
