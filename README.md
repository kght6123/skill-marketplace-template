# skill-marketplace

Claude Code / Copilot CLI / Codex CLI / OpenCode に対応した Agent Skills の配布リポジトリです。

## スキル一覧

| Skill | Description |
|-------|-------------|
| [example-skill](./plugins/example-skill/) | スキルの作成・フォーマット方法を説明するサンプルスキル |
| [agy-review](./plugins/agy-review/) | agy (Antigravity CLI) を使って変更ファイルのコードレビューを実行するスキル |
| [anima-prompt-craft](./plugins/anima-prompt-craft/) | Anima（CircleStone Labs × Comfy Org の2Bアニメ特化 text-to-image モデル）向けのプロンプトを新規作成・改良・診断するスキル |
| [minimax-h3-prompt-craft](./plugins/minimax-h3-prompt-craft/) | MiniMax H3（音声付き動画生成モデル）向けのプロンプトを新規作成・改良するスキル |
| [wan22-prompt-craft](./plugins/wan22-prompt-craft/) | Wan2.2（Alibaba製オープンソース動画/画像生成モデル）向けのプロンプトを新規作成・修正・改善するスキル |
| [sdxl-original-character-prompt-craft](./plugins/sdxl-original-character-prompt-craft/) | 特定のオリジナルキャラクター向けにSDXL用プロンプト（ポジティブ＋ネガティブ）を生成・改良するスキル |
| [ai-dev-orchestration](./plugins/ai-dev-orchestration/) | 複数プロジェクトのAI開発を、人間の処理量を上限にして回すオーケストレーションのスキル群（orch-core / orch-run / orch-issue-memo / orch-implement / orch-review-triage / orch-memo-check） |

## インストール方法

インストール方法は3通りあります。どれか1つでOKです。

| 方法 | 向いている場面 |
|------|---------------|
| [① `npx skills`](#-npx-skills--全ツール共通おすすめ) | Claude Code 以外のツールでも使いたい／一番手軽 |
| [② Claude Code のプラグイン](#-claude-code--plugin-マーケットプレイス) | Claude Code だけで使う／更新もまとめて管理したい |
| [③ 手動コピー](#-手動コピーgit-clone) | ネットワーク制限下／中身を書き換えて使いたい |

### ① `npx skills` — 全ツール共通（おすすめ）

[Skills CLI](https://github.com/vercel-labs/skills)（`npx skills`）は Agent Skills 用のパッケージマネージャです。インストール済みのツールを自動検出して、それぞれが読むディレクトリへ配置してくれます。このリポジトリはマーケットプレイス定義とは無関係に `SKILL.md` を走査してもらえるので、そのまま指定できます。

```bash
# 収録スキルの一覧を確認（インストールはしない）
npx skills add kght6123/skill-marketplace-template --list

# 対話形式で選んでカレントプロジェクトにインストール
npx skills add kght6123/skill-marketplace-template

# スキル名を指定して、ユーザー全体（-g）にインストール
npx skills add kght6123/skill-marketplace-template --skill wan22-prompt-craft -g

# 全スキルを検出した全ツールへ一括インストール
npx skills add kght6123/skill-marketplace-template --all
```

**配置先**: 実体は `.agents/skills/<skill>`（`-g` 付きなら `~/.agents/skills/<skill>`）に置かれ、そこから Claude Code 用に `.claude/skills/`（`-g` なら `~/.claude/skills/`）へシンボリックリンクが張られます。`.agents/skills/` は Copilot CLI・Codex CLI・OpenCode が共通で読むディレクトリなので、これ1か所で4ツールに効きます。シンボリックリンクを避けたい場合は `--copy` を付けてください。

**その他のコマンド**

| コマンド | 説明 |
|---------|------|
| `npx skills list` | インストール済みスキルの一覧（ツール別） |
| `npx skills update [skill]` | 最新版へ更新 |
| `npx skills remove <skill>` | アンインストール |
| `npx skills find <keyword>` | 公開スキルを検索（カタログ: [skills.sh](https://www.skills.sh/)） |
| `npx skills use kght6123/skill-marketplace-template@wan22-prompt-craft \| claude` | インストールせずその場かぎりで使う |

**主なオプション**: `-s, --skill <names...>`（スキル指定、`'*'` で全件）／ `-a, --agent <agents...>`（`claude-code` `codex` `opencode` `github-copilot` など対象ツールを限定）／ `-g, --global`（ユーザー全体）／ `-l, --list`（一覧のみ）／ `--copy`（コピー配置）／ `-y, --yes`（確認プロンプトを省略）。

### ② Claude Code — `/plugin` マーケットプレイス

Claude Code で使うなら、プラグインとして入れると `/plugin` 側で更新・有効無効まで管理できます。

```
/plugin marketplace add kght6123/skill-marketplace-template
/plugin install wan22-prompt-craft@skill-marketplace-template
```

`/plugin` だけを実行すると管理UIが開き、一覧から選んでインストールすることもできます。

シェルから非対話で入れる場合:

```bash
claude plugin marketplace add kght6123/skill-marketplace-template
claude plugin install wan22-prompt-craft@skill-marketplace-template

# インストール先スコープは --scope user（既定）/ project / local
claude plugin install wan22-prompt-craft@skill-marketplace-template --scope project
```

管理コマンド: `claude plugin list` / `claude plugin update <plugin>` / `claude plugin uninstall <plugin>` / `claude plugin marketplace update`（マーケットプレイス定義の再取得）。

チームのリポジトリ全員に配りたい場合は、`.claude/settings.json` に書いておくと各自の初回起動時に自動で導入されます。

```json
{
  "extraKnownMarketplaces": {
    "skill-marketplace-template": {
      "source": {
        "source": "github",
        "repo": "kght6123/skill-marketplace-template"
      }
    }
  },
  "enabledPlugins": {
    "wan22-prompt-craft@skill-marketplace-template": true
  }
}
```

詳細は [Claude Code のプラグインマーケットプレイスのドキュメント](https://code.claude.com/docs/en/plugin-marketplaces) を参照してください。

### ③ 手動コピー（git clone）

各ツールは所定のディレクトリを自動で走査するので、`SKILL.md` を含むディレクトリごとコピーするだけでも動きます。どのディレクトリがどのツールに効くかは [早見表](#ツール別スキルディレクトリ早見表) を参照してください。

```bash
git clone https://github.com/kght6123/skill-marketplace-template.git
cd skill-marketplace-template

# Copilot CLI・Codex CLI・OpenCode 共通のユーザースキルとして入れる
mkdir -p ~/.agents/skills
cp -r plugins/wan22-prompt-craft/skills/wan22-prompt-craft ~/.agents/skills/

# Claude Code のユーザースキルとして入れる
mkdir -p ~/.claude/skills
cp -r plugins/wan22-prompt-craft/skills/wan22-prompt-craft ~/.claude/skills/

# プロジェクト限定にしたい場合は、リポジトリルートの .agents/skills/ や .claude/skills/ へ
```

コピー後はツールを起動し直してください。Copilot CLI は `/skills` コマンドで認識状況を確認できます。

各ツールの公式ドキュメント:

- [Claude Code — Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [GitHub Copilot — Agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [Codex — Skills](https://developers.openai.com/codex/skills/)
- [OpenCode — Skills](https://opencode.ai/docs/skills/)

---

## ツール別スキルディレクトリ早見表

| ディレクトリ | Claude Code | Copilot CLI | Codex CLI | OpenCode |
|-------------|:-----------:|:-----------:|:---------:|:--------:|
| `~/.claude/skills/` | ✅ | ✅ | — | ✅ |
| `~/.agents/skills/` | — | ✅ | ✅ | ✅ |
| `~/.copilot/skills/` | — | ✅ | — | — |
| `~/.config/opencode/skills/` | — | — | — | ✅ |
| `/etc/codex/skills/` | — | — | ✅ | — |
| `.claude/skills/` | ✅ | ✅ | — | ✅ |
| `.agents/skills/` | — | ✅ | ✅ | ✅ |
| `.github/skills/` | — | ✅ | — | — |
| `.opencode/skills/` | — | — | — | ✅ |

> `~/` 始まりはユーザー個人用、それ以外はリポジトリルートに置くプロジェクト用です。
> `.agents/skills/` は Copilot CLI・Codex CLI・OpenCode の共通置き場、`~/.claude/skills/` は Claude Code・Copilot CLI・OpenCode の3ツールに同時に効きます。Claude Code だけは `.agents/skills/` を読まないため、`npx skills` はここへ自動でシンボリックリンクを張ります。

## リポジトリ構造

```
skill-marketplace-template/
├── README.md                          # このファイル
├── LICENSE                            # MIT License
├── .gitignore
├── .claude-plugin/
│   └── marketplace.json               # マーケットプレイス定義
├── templates/
│   └── SKILL_TEMPLATE.md              # 新規スキル用テンプレート
└── plugins/
    └── example-skill/                 # 各スキルは独立したプラグイン
        ├── .claude-plugin/
        │   └── plugin.json            # プラグインメタデータ
        ├── skills/
        │   └── example-skill/
        │       ├── SKILL.md           # スキル本体
        │       └── references/        # 任意: 参照ドキュメント
        ├── commands/                  # 任意: スラッシュコマンド定義
        │   └── example-skill.md
        └── tests/                     # 任意: スキルのテストケース
            └── test_cases.json
```

## 新しいスキルを追加するには

1. `plugins/<skill-name>/` ディレクトリを作成（[templates/SKILL_TEMPLATE.md](./templates/SKILL_TEMPLATE.md) が雛形）
2. `plugins/<skill-name>/.claude-plugin/plugin.json` にプラグイン定義を記述（`name` / `description` / `version` / `author`）
3. `plugins/<skill-name>/skills/<skill-name>/SKILL.md` にスキル本体を記述（[example-skill](./plugins/example-skill/skills/example-skill/SKILL.md) を参照）
4. 必要であれば `plugins/<skill-name>/commands/<skill-name>.md` にスラッシュコマンドを追加
5. `.claude-plugin/marketplace.json` の `plugins` 配列にエントリを追加
6. このREADMEのスキル一覧テーブルを更新
7. `claude plugin validate .` で定義を検証

`npx skills` からのインストールはリポジトリ内の `SKILL.md` を走査して行われるため、`marketplace.json` への登録は Claude Code のプラグインとして配る場合にのみ必要です。

## ライセンス

MIT License — 詳細は [LICENSE](./LICENSE) を参照してください。
