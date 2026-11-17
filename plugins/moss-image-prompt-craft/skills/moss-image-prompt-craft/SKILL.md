---
name: moss-image-prompt-craft
description: MOSS-Image（OpenMOSS製5B DiT画像生成モデル）のプロンプトを作成・改善するスキル。「MOSSのプロンプトを書いて」「MOSS-Image用に直して」「文字入りポスターをMOSSで」「レイアウトJSONを作って」「MOSSで4コマ漫画」などで使う。キャプション/タグ/Layout JSONと推奨設定・ネガティブを出力。
---

# MOSS-Image プロンプトクラフト

OpenMOSS公式 [USERGUIDE](https://github.com/OpenMOSS/MOSS-Image/blob/main/USERGUIDE.md) と公式スキル `moss-image-prompt-enhancer`（Apache-2.0、`LICENSE.upstream`）に基づき、MOSS-Image-Base に貼り付けられるプロンプトを作る。画像生成そのものは行わない。公式原文は `references/USERGUIDE.md`、Layout仕様は `references/layout.md`。

## 1. 出力形式を決める

ユーザーの明示指定を優先する。指定がなければ次で選ぶ。

| 形式 | 使う場面 |
|---|---|
| **キャプション（自然文）** | 写真・イラスト・通常のシーン。既定 |
| **タグ列** | アニメ系キャラ絵でタグ指定を望まれたとき |
| **Layout JSON** | 文字の配置指定、ポスター、複数コマ、物体の位置関係を厳密に制御したいとき |

「細かい絵」というだけで Layout にしない。被写体・人数・関係・画材・スタイル・除外事項・描く文字は必ず保持し、軽い創作上の空白は自分で埋める。結果が大きく変わる欠落だけ質問する。

## 2. 共通ルール（公式推奨）

1. **説明文は英語で書く** — 学習データが最も多い。ユーザーが別言語を指定したらそれに従う（中国語なども対応）
2. **画像内に描く文字は原文のまま** — 翻訳・言い換えしない。句読点・大小文字・改行も保持し、`"..."` で囲む
3. **改行は明示する** — 文字の改行位置を制御したい場合はプロンプト内に実際の改行（JSONでは `\n`）を入れる
4. **見えるものだけ書く** — 被写体と動作、外見、場所、カメラ/構図、画材、光、素材、配色、ムード。冗長な品質タグ、頼まれていない画風変更、制作手順の説明は入れない
5. **デザイン画像は情報と絵を一緒に組む** — 読む順序・強弱・グループを決め、「headline here」のようなプレースホルダーではなく実際のコピーを書く
6. **短いプロンプトはCFGを上げる前提** — 長文なら CFG 3.0 で十分

### タグ列の順序

`Quality → Score → Meta → Year → Character → Series → Artist → General`

```text
best quality, highres, hatsune miku, vocaloid, @foo bar, 1girl, blue hair
```

アーティストは `@名前` 形式。

## 3. キャプションの作り方

ひとまとまりの散文で書く（段落分けは可）。空間関係は言葉で表し、描く文字は正確に引用する。座標やJSONフィールドを混ぜない。

例（公式）:

```text
A wide view of a refrigerator beside a kitchen counter with a fruit bowl. A small sticky note on the refrigerator door is handwritten in Chinese:
“记得买牛奶和鸡蛋！
牛奶两盒，鸡蛋一打。
顺便带一袋面包。”
```

## 4. Layout の作り方

1. `references/layout.md` を読む
2. **編集用ドラフト**を書く：`width`/`height`（16の倍数）、`bbox_coord_space:"abs"`、`bbox_format:"xyxy"`、`summary`、フラットな `items`
   - bbox は **左上原点の実ピクセル `[x_min,y_min,x_max,y_max]`**。中心化・並べ替え・丸めを手でやらない
   - `label` は `object` / `character` / `text`。`text` には表示文字を正確に
   - サイズ指定がなければ 1024×1024（媒体に合う比率があればそちら）。指定サイズが16の倍数でなければ黙って変えず指摘する
3. ドラフトを作業ディレクトリに保存し、同梱コンパイラでモデル用JSON（中心原点 `abs_centralized` / `yxyx`）に変換する。スクリプトのパスは作業ディレクトリではなく、この SKILL.md のあるディレクトリから解決し、実際の絶対パスで実行する：

```bash
python3 -I <このスキルのディレクトリ>/scripts/compile_prompt.py draft.json --output prompt.txt
```

4. エラーが出たらドラフトを直して再実行する。座標を手計算した中心化JSONで回避しない
5. 出力を読み返し、被写体・文字列・配置・キャンバスサイズを確認する。文字量が箱に収まらないなら箱を広げるか構図を組み直す（文字を勝手に削らない）

Layout は実験的機能。自然文と組み合わせることもできる。

### 4コマ漫画・複数コマ

4コマ漫画や複数コマの漫画を頼まれたら、`references/four-koma.md` を読み、`templates/four-koma-draft.json`（768×2048・縦4コマの完成例）をコピーして書き換える。先に起承転結を1コマ1行で決めてから JSON にする（話の骨組みを決めずに絵を並べるとオチが弱くなるため）。

## 5. 推奨生成設定（毎回添える）

| 項目 | 推奨値 |
|---|---|
| 解像度 | 総画素 1M / 1.5M / 2M（0.25M〜4M可）。幅・高さは16の倍数 |
| Steps | 50以上 |
| CFG | 3.0（3.0〜6.0。短いプロンプトほど上げる） |
| Shift | 5.0 |
| Sampler | Euler |
| SLG | 標準: scale 3, 0.01-1.0／2パス: `uncond skip`、skip layer 22（24, 26も可）。OFFだと写実的だが細部が崩れやすい |

**ネガティブプロンプト（公式推奨）:**

```text
nsfw, worst quality, bad anatomy, watermark, jpeg artifact
```

## 6. 納品フォーマット

```
### Positive Prompt
（キャプション / タグ列 / コンパイル済みLayout JSON 1行）

### Negative Prompt
nsfw, worst quality, bad anatomy, watermark, jpeg artifact

### Settings
WxH / Steps 50 / CFG 3.0 / Shift 5.0 / Euler（＋SLG）

### メモ
（日本語で意図・調整ポイントを2〜3行）
```

- Layout では **width×height をプロンプト外に必ず明記**する（モデル用JSONにはサイズが含まれない）。コンパイル済みJSONは整形し直さずそのまま貼る
- 編集用ドラフト（`draft.json`）のパスも伝え、修正時はドラフトを直して再コンパイルする

## 保守

公式の更新は `references/USERGUIDE.md` と upstream の `skills/moss-image-prompt-enhancer/` を見比べて反映する。同梱スクリプトのテスト: `python3 -I scripts/test_compile_prompt.py`。
