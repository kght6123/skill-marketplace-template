# skill-marketplace

Claude Code / Copilot CLI / Codex CLI / OpenCode など複数のAIコーディングツールに対応した Agent Skills の配布リポジトリテンプレートです。

## スキル一覧

| Skill | Description | Version |
|-------|-------------|---------|
| [example-skill](./plugins/example-skill/) | スキルの作成・フォーマット方法を説明するサンプルスキル | 1.0.0 |

## インストール方法

### 1. Claude Code（推奨）— `/plugin` コマンド経由

```
/plugin marketplace add kght6123/skill-marketplace
/plugin list @skill-marketplace
/plugin install example-skill@skill-marketplace
```

### 2. 手動コピー

```bash
# リポジトリをクローン
git clone https://github.com/kght6123/skill-marketplace.git

# スキルをコピー
cp -r skill-marketplace/plugins/example-skill ~/.claude/plugins/local/
```

### 3. シンボリックリンク（opencode / 他ツール対応）

```bash
git clone https://github.com/kght6123/skill-marketplace.git /path/to/skill-marketplace

ln -s /path/to/skill-marketplace/plugins/example-skill ~/.claude/plugins/local/example-skill
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
        └── README.md                  # スキル個別のインストール手順
```

## 新しいスキルを追加するには

1. `plugins/<skill-name>/` ディレクトリを作成
2. `.claude-plugin/plugin.json` にプラグイン定義を記述
3. `skills/<skill-name>/SKILL.md` にスキル本体を記述（`example-skill` を参照）
4. `.claude-plugin/marketplace.json` の `plugins` 配列にエントリを追加
5. このREADMEのスキル一覧テーブルを更新

## ライセンス

MIT License — 詳細は [LICENSE](./LICENSE) を参照してください。
