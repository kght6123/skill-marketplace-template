---
name: manga-planner
description: 漫画に詳しくない人でも、選択肢を選んでいくだけで日本式の4コマ・8コマ漫画（起承転結・コマ割り・ショット・台詞・吹き出し・擬音）を設計できる対話型スキル。設計書（spec.json）とネーム画像（SVG）を作り、MOSS-Image 用の Layout 下書きに変換して moss-image-prompt-craft に渡す。ユーザーが「漫画を作りたい」「4コマを作りたい」「4コマ漫画の設計」「8コマ漫画」「ネームを作って」「コマ割りを考えて」「漫画の話を考えて」「MOSSで4コマ漫画」「manga planner」などと言ったら必ず使う。画像生成AIで漫画を作る前に、話とコマ割りを固めたいときにも積極的に使う。
---

# 漫画プランナー

ユーザーは漫画に詳しくない。**考えるのは Claude、ユーザーは選ぶだけ**。各ステップで候補を出し、選んでもらって次へ進む。出来上がるのは画像ではなく、モデルに依存しない **漫画の設計書（spec.json）** と、その確認用の **ネーム画像（SVG）** 。生成用のプロンプトは設計書から作る。

現在の対応: **4コマ・8コマ（4コマ×2列）** ／ 出力先 **MOSS-Image**。1ページ・2ページ、MiniMax-H3-Image・H3 への出力はまだない。頼まれたらそう伝え、対応している形式で作るか聞く。

## 選択肢の出し方

AskUserQuestion がある環境では、それで出す（1回に最大4問、各2〜4択）。各 option の label は短い日本語、description に一言の説明。「Other」欄で自由に書き込めることを一言添える。AskUserQuestion がない環境では、番号付きリストをテキストで出して返事を待つ。

ユーザーが「おまかせ」と答えたら、Claude が一番良いと思う案を選び、選んだものを1行で伝えて先へ進む。

## 流れ

### Step 1: 基本設定（1回でまとめて聞く）

題材がメッセージに書いてあればそれを使う（なければ Step 3 でジャンルから考える）。

| 質問 | 選択肢 |
|---|---|
| 形式 | 4コマ（迷ったらこれ）／8コマ（4コマ×2列） |
| ジャンル | ギャグ／日常／ラブコメ／解説（ちょっとシリアスは Other で） |
| オチの型 | ボケ／どんでん返し／ほっこり／ツッコミ（説明は `references/story-structures.md` §2） |
| 色 | モノクロ＋トーン（王道）／フルカラー |

形式が決まったら、`assets/layouts.json` のうちその `format` のテンプレートを、`label_ja` と `note_ja` で選択肢にして聞く。

| 形式 | テンプレート |
|---|---|
| 4コマ（`yonkoma`） | `yonkoma-title` 縦・タイトルあり（迷ったらこれ）／`yonkoma-plain` 縦・タイトルなし／`yonkoma-slim` 細長 |
| 8コマ（`hachikoma`） | `hachikoma-title` 2列・列ごとにタイトル／`hachikoma-plain` 2列・タイトルなし |

8コマは、さらに「2本立て（別々の4コマを2本）」か「前後編（1本目のオチが2本目の起になる）」かを聞く（`story-structures.md` §6）。

### Step 2: 登場人物

| 質問 | 選択肢 |
|---|---|
| 人数 | 1人／2人（3人は Other。4コマでは2人までがおすすめ） |
| 見た目の決め方 | おまかせ／言葉で指定する／character-look-picker・outfit-picker で選ぶ |

- おまかせなら、ジャンルに合う見た目を Claude が決めて1行で伝える
- ピッカーを選んだら、そのスキルで決めた結果を受け取って使う
- 各キャラについて `name`（日本語の呼び名）、`look_ja`、`look_en`（髪型・髪色・服・持ち物の3〜4特徴。`references/direction.md` §6）を決める。動物や物も、演技するなら1人として数える

### Step 3: ネタを選ぶ

`references/story-structures.md` を読み、**3案** をそれぞれ「タイトル＋起・承・転・結を各1行（台詞つき）」で作る。8コマなら1案に2本分（右の列→左の列）を書く。選択肢は3案＋「別の3案を出して」。選ばれた案の一部だけ直したいと言われたら、そこだけ直して再提示する。

### Step 4: コマの演出を確認する

`references/direction.md` を読み、各コマの shot・angle・キャラの動き・吹き出しの種類・擬音を Claude が決めて、次の表で見せる。

| コマ | 出来事 | ショット／アングル | 台詞（吹き出し） | 擬音 |
|---|---|---|---|---|

選択肢: このままでOK／台詞を変えたい／絵の見せ方を変えたい／話を選び直す。変更があれば直して再提示する。台詞はユーザーの言葉を一字一句変えずに使う。

### Step 5: 画風

選択肢: きれいな線＋グレートーン（モノクロの王道）／アニメ塗りのフルカラー／やわらかい水彩風／art-style-picker で選ぶ。Step 1 の色と矛盾しないものだけ出す。選んだ画風を英語1文にして `style_en` に入れる。

### Step 6: 設計書とネームを作る

1. 作業ディレクトリに `manga/<題材の英小文字スラッグ>/spec.json` を書く。書式は作例（4コマ `examples/neko-satsuei.spec.json`、8コマ `examples/zaitaku.spec.json`）と下の「spec の項目」に合わせる
2. 同梱スクリプトで検査とネーム出力をする。スクリプトのパスは作業ディレクトリではなく、この SKILL.md のあるディレクトリから解決し、絶対パスで実行する:

```bash
python3 -I <このスキルのディレクトリ>/scripts/manga_layout.py check   spec.json
python3 -I <このスキルのディレクトリ>/scripts/manga_layout.py preview spec.json --output name.svg
```

3. 「エラー」が出たら spec を直して再実行する。台詞が長すぎるエラーは、勝手に削らず、改行・吹き出しの分割・言い換えの候補を選択肢で出す。「注意」は直すか、意図どおりなら残す
4. `name.svg` をユーザーに見せる（画像として送れる環境なら送る）。ネームでは、灰色の点線の箱がキャラの位置、楕円が吹き出し、赤字が擬音、下の灰色の文字がコマ番号・役割・演出

### Step 7: 生成用に変換する（MOSS-Image）

```bash
python3 -I <このスキルのディレクトリ>/scripts/manga_layout.py moss spec.json --output moss-draft.json
```

`moss-draft.json` は moss-image-prompt-craft の「編集用ドラフト」の形式。moss-image-prompt-craft スキルの §4 の手順（`compile_prompt.py` でコンパイル）と §6 の納品フォーマットで仕上げる。そのスキルが入っていなければ、次で入れるよう案内する:

```bash
npx skills add kght6123/skill-marketplace-template --skill moss-image-prompt-craft
```

コマ割り・台詞・演出を直すときは、`moss-draft.json` ではなく **spec.json を直して Step 6 から再実行** する（座標はスクリプトが毎回計算し直す）。

## spec の項目

| 項目 | 必須 | 内容 |
|---|---|---|
| `format` | ○ | `yonkoma` / `hachikoma` |
| `layout` | ○ | `assets/layouts.json` のキー（その format 用のもの） |
| `title` | タイトル枠ありなら○ | 画像に描くタイトル（日本語のまま）。枠が1つなら文字列、2つ以上なら読む順のリスト（8コマは右の列が先） |
| `genre` / `ending` | | 記録用（`story-structures.md` の値） |
| `color` | | `monochrome`（既定）/ `full-color` |
| `style_en` | ○ | 画風を英語1文 |
| `characters[]` | ○ | `id`・`name`・`look_ja`・`look_en`。最大3人 |
| `panels[]` | ○ | テンプレートのコマ数分を読む順に。下の表 |

| panels の項目 | 必須 | 内容 |
|---|---|---|
| `role` | ○ | 4コマは順に `ki` `sho` `ten` `ketsu`。8コマはそれを2回（右の列、左の列） |
| `beat_ja` | ○ | そのコマで起きることを日本語1行 |
| `shot` / `angle` | shotは○ | `direction.md` §1・§2 の値（angle 既定は `eye-level`） |
| `background_en` | 起は推奨 | 場所・背景を英語で |
| `effects_en` | | 集中線などの効果を英語で |
| `cast[]` | | `id`・`acting_en`（動作と表情を英語で）・`acting_ja`（ネーム用の短いメモ）。最大2人。先に話す人が右に配置される |
| `balloons[]` | | `speaker`（cast の id。narration は不要）・`type`・`text`。最大2つ、読む順に書く |
| `sfx[]` | | `text`、任意で `caption_en` |

`*_en` は英語で書く（生成モデルには英語が安定する）。画像に描く文字（`title`・`text`）は日本語のまま。

## 仕上げに伝えること

1. 決まった内容の要約（タイトル・起承転結を各1行・キャラ）
2. 作ったファイルのパス（spec.json・name.svg・moss-draft.json）
3. MOSS で仕上げたプロンプト（moss-image-prompt-craft の納品フォーマット）
4. 次の一手を1つ（例: 「文字が崩れたら、吹き出しの台詞を短くして再生成」）

## 保守

- コマ割りを増やすときは `assets/layouts.json` にテンプレートを足す（幅・高さは16の倍数、座標は左上原点のピクセル `[x0, y0, x1, y1]`）
- テスト: `python3 -I scripts/test_manga_layout.py`
