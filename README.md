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

### Copilot CLI — 手動コピー

Copilot CLI はスキルを以下のディレクトリから自動検出します：

| スコープ | ディレクトリ | 備考 |
|---------|------------|------|
| 個人（Claude Code 共用） | `~/.claude/skills/` | Claude Code と両方に効く |
| 個人（Copilot 専用） | `~/.copilot/skills/` | |
| プロジェクト（Claude Code 共用） | `.claude/skills/` | リポジトリルートに配置 |
| プロジェクト（Copilot 専用） | `.github/skills/` | リポジトリルートに配置 |

```bash
# リポジトリをクローン
git clone https://github.com/kght6123/skill-marketplace.git
cd skill-marketplace

# 個人スキルとしてインストール（Claude Code + Copilot CLI 両方に効く）
cp -r plugins/example-skill/skills/example-skill ~/.claude/skills/

# または Copilot CLI 専用ディレクトリへ
cp -r plugins/example-skill/skills/example-skill ~/.copilot/skills/
```

インストール後、`copilot` を起動して `/skills` コマンドで認識を確認できます。

### Codex CLI — 手動コピー

Codex CLI はスキルを以下のディレクトリから自動検出します：

| スコープ | ディレクトリ | 用途 |
|---------|------------|------|
| ユーザー | `~/.agents/skills/` | 任意のリポジトリで使えるユーザー個人のスキル |
| プロジェクト | `.agents/skills/` | リポジトリルートに配置するチーム共有スキル |
| システム | `/etc/codex/skills/` | システム全体で共有（管理者向け） |

```bash
# リポジトリをクローン（未実施の場合）
git clone https://github.com/kght6123/skill-marketplace.git
cd skill-marketplace

# ユーザースキルとしてインストール
cp -r plugins/example-skill/skills/example-skill ~/.agents/skills/
```

詳細は [Codex Skills ドキュメント](https://developers.openai.com/codex/skills/#where-to-save-skills) を参照してください。

### OpenCode — 手動コピー（未検証）

> 以下は未検証です。OpenCode のドキュメントを確認してください。

```bash
cp -r plugins/example-skill/skills/example-skill ~/.opencode/skills/
```

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
