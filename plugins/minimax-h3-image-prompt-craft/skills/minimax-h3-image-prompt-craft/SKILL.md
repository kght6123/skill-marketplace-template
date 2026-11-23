---
name: minimax-h3-image-prompt-craft
description: MiniMax-H3-Image（H3ファミリーの16MP画像生成・編集モデル）向けのプロンプトを新規作成・改善・変換するスキル。ユーザーが「H3 Imageのプロンプトを作って」「MiniMax-H3-Image」「H3で画像を作りたい」「参照画像で編集したい」「Picture 1」「ポスター・インフォグラフィック・UI・グリッドをH3で」などと言ったら必ず使う。SDXL/Anima/MOSS-Image用プロンプトをH3 Image形式へ書き換える依頼、ComfyUIのH3 Imageテンプレート（expander OFF）に入れる文章を作る依頼にも積極的に使う。動画（T2VA/I2VA等）は minimax-h3-prompt-craft の担当。
---

# MiniMax-H3-Image プロンプトクラフト

出典: MiniMax公式 `MiniMax-AI/MiniMax-H3-Image` の skills/h3-image-prompt-writing（SKILL.md・references/t2i-en.txt・references/edit-en.txt）、README（Specifications・Request Parameters・Sizes・Prompting Tips）、ComfyUI公式チュートリアル。2026-11-23時点（公式コミット 40850901）の内容を日本語で再構成した。公式の英語ガイドは references/t2i-en.txt（T2I）と references/edit-en.txt（Edit）に無改変で同梱している。迷ったら英語版を正とする。

H3 Imageは「完成した画像の完全な説明文」から一番よく描ける。何のための画像か、何がどこにあるか、どう見えるか、画面に出る文字すべて、を書く。タグ列ではなく英語の文章で書く。

## 前提（モデル仕様で効くもの）

- ネガティブプロンプトは無い（APIでもローカルでも拒否される。CFG=1固定）。避けたいものは本文に書く（例: "No lettering or additional people appear."）。
- ステップ6・CFG1固定。ComfyUIは euler / simple / steps 6 / cfg 1 / denoise 1。
- 約4〜20MPで動き、16MP前後が最良。辺は32の倍数。
- プロンプトは4096トークンで切られる。
- 参照画像は最大16枚。渡した順に `<Picture 1>`, `<Picture 2>`, … になる。
- APIはT2Iでプロンプト拡張（Context-IR）が既定ON、編集では常にON。ローカル（SGLang・vLLM-Omni・ComfyUIでexpander OFF）は書いたまま使われるので、このスキルの出力が拡張の代わりになる。

## ワークフロー

1. **タスクを決める。** 入力画像なし → テキストから画像（T2I）。画像を変える・組み合わせる・借りる → 編集（Edit）。編集なら全入力画像を渡された順に見る。
2. **画像を計画する**（この順）: 目的と成果物 → 全体レイアウト → アスペクト比 → 主題と動作 → 画風 → 文字。普通の空白は自分で埋める（短いアイデアで十分）。頼まれたコピーは自分で書く。例示データは「illustrative」と明記する。見ていない素材は名前付き参照のまま残す。質問するのは、欠けた事実でプロンプトが間違いになるときだけ（例: ユーザー自身の数値のグラフなのに数値が無い）。
3. **書く**（下の共通ルール＋T2I／Editの書き方）。
4. **最終チェック**をする。
5. **出力形式**どおりに渡す。

## 共通ルール

### 基本の説明
- **画風より先にタスク。** 冒頭で「何の画像で何のためか」、次に主な人や物とその状態・動作。画風はその後。
- **細部より先にレイアウト。** 主題の数、位置、視点、余白。情報が多いときは先に領域を名指しし、各領域を埋める（"a title across the top; below it, a photo on the left and three short paragraphs on the right."）。
- **画風は見える細部で。** "premium" "high-end" "masterpiece" などの品質語ではなく、色・素材・光・質感で書く（"soft side light, brushed-metal reflections, generous white space"）。矛盾する細部は削る。

### 文字と情報
- **画面に出る言葉はすべて引用符で囲む。** 原語のまま、スペースもそのまま（全角スペースに置き換えない）。位置・サイズの階層・改行も書く。コピーを任されたら実際の言葉を書く。
- **文字が無いなら言う。** T2Iでは "The image contains no text, letters or numbers." を入れる。編集では「ほかの文字は追加しない」と書く（元画像の文字は残る）。
- **データは正確に。** グラフ・学術図・教育画像は値・単位・関係、時系列なら期間を書く。計算が必要な値（合計など）は自分で計算して書く。架空の数値を本物として出さない。

### 参照画像と編集
- 入力は `<Picture N>` で呼ぶ。`@Picture 1` や `@图1` も `<Picture 1>` のこと。
- 各参照に役割を与える。色だけ借りるなら、形や素材は借りないと書く。
- 変わる所と残る所を分ける。
- 完成後の状態を書く（命令形にしない）。移動・複製・置換・削除のどれかと、削除後の空間が何で埋まるかを書く。
- 複数ラウンドでは、そのラウンドで使う画像・変わる所・残る所を名指しする（"the one from before" のような書き方をしない）。

### グリッド
- "2 rows and 3 columns" や "3×3 (rows × columns)" と書く。"2×3" は曖昧なので使わない。不規則なら "3 panels on top and 2 below"。セルは "row 2, column 1"。
- 行・列の数はキャンバス比を決めない。カルーセルのページ・カード・スライドは、まとめ表示を頼まれない限り別キャンバス。

## T2I（テキストから画像）の書き方

**依頼を画像に育てる**
- はっきりした視覚的焦点を1つ決め、完成したシーンかデザイン物を組み立てる。書くのは画像に写るもの。別の書き手への指示や案の列挙は書かない。
- 指定された固有名・人数や個数・数式・データ・画風・媒体・向き・位置関係は制約として守る。意味のある修飾語と除外も残す。既存プロンプトの改善では、頼まれた範囲だけ変える。
- 細部は目的があるときだけ足す（動作を読み取れるように、素材の説得力、奥行き、光、情報の階層）。媒体と抑制の度合いを守る（抽象画を写実にしない、ミニマルなロゴに風景を足さない）。隠れた背景物語や余計な主役は足さない。

**構図**
- 明示されたキャンバス寸法・向き・パネル配置・読む順を守る。画像全体と、画像内の物・画面・パネルを区別する。
- 形の指定が無いときは成果物と主題から選ぶ: 小さな主題はコンパクトに、比較は横に並べる幅を、縦に積む情報は縦の余裕を。"cinematic" のような画風語でキャンバスを決めない。好みの形に合わせて中身を足さない。この構図でアスペクト比を決める。

**シーンを物理的に読めるように**
- 主題の見える状態や動作、視点、場所、意味のある光を書く。連続を頼まれない限り、1つの止まった瞬間にする。連続なら各出来事と結果を見える証拠で示す（雰囲気だけにしない）。
- 画面の左右、手前と奥、視線、動きの方向を一貫させる。カメラから見た体の向き、見えている体の面、手、支点、接触を合わせる。コート・盤面・道・階段・部屋の構造は、変更を頼まれない限り保つ。

**デザイン物を中身まで完成させる**
- 読む順で情報の階層を作る。各領域に実際の中身を入れる（"some icons" や "a paragraph of copy" では未完成）。
- 文字は置く面に書く。言語・大小文字・句読点・数字・綴り・行順を保つ。禁止されたら文字を足さない。
- 機能的な細部: UIの操作部品と選択状態、グラフの軸・単位・目盛・凡例、科学図のラベル・変数定義・矢印の端点、製品の素材・構造・継ぎ目。ミニマルなデザインならチェックリストで埋めない。
- データの印は与えられた値と目盛に合わせる。頼まれたグラフ種別と測り方を保つ。数値が無いときは、形が自由なら定性的比較に、指定があればそのグラフのまま「データ待ち」と書く。データ表示を装飾画像に置き換えない。
- 架空のデザインには中身を作ってよいが、実在の統計・価格・認証・仕様を作って事実として出さない。
- 対になる図（平面図とレンダー、前と後ろなど）は、同じ物・数・関係を共有させる。

**依存関係と仕上げ**
- 同じ強さの要件が衝突したら、両立する中身を残し、役立つプロンプトが書けないときだけ聞く。事実データを黙って直さない。欠けた項目があっても残りの設計を捨てない。
- 名前付き素材は名前付き参照のままでよい（見た目を作らない、見たふりをしない）。

## Edit（参照画像つき編集）の書き方

1段落の平文で、**参照の定義 → ターゲットの概要と各参照の関係 → 変わる・新しい細部** の順に書く。見出しは出さない。完成状態として書く（"The former location is filled by continuous tabletop."）。

**元画像を見る**
- 観察した元画像の内容と、望むターゲットを分ける。隠れた部分・読めない文字・正確な色値・知らない物の正体を推測しない。密な文字は読める大きさで確認し、名前・略語・値・日付は再確認する。見慣れない綴りを正規化しない。
- 読めない領域は保持し、翻訳や書き起こしが完全だとは言わない。

**1. 参照内容を定義する**
- 冒頭は元画像に根拠のある短い定義: `The red cup at the left of <Picture 1> is <Subject 1>.` `<Picture N>` は渡された順、`<Subject N>` は最後まで同じ番号。1つの対象が複数画像に写るなら各画像を明記する（範囲や "all references" にしない）。
- 独立した関係が必要な範囲ごとにSubjectを作る（物・人・文字ブロック・背景・ポーズ・構図・移せる性質）。1画像1Subjectにしなくてよい。触れない内容は安定する。変更で混乱しそうな目立つ非対象は明示的に追う。
- 性質だけを貸す参照は、物全体ではなく性質として定義する。ターゲットだけの新規内容と、完全に消す・置き換えるだけの内容には番号を付けない。元の内容が何も残らず性質も借りないなら、定義と関係を省いてターゲット概要から始める。
- 文字・データの範囲は、読める行・ラベル・値・欄をここで一度ずつ正確に書き起こす（変える文言も含む）。

**2. ターゲットと各参照の関係**
- 概要は "The target image" で始め、主な結果（局所編集か、参照を使った新しい構図か）を書く。保持を判断する前にレイアウトを決める。
- キャンバス: 指定の寸法やクロップを守る。ベースの構図を保つならベースのキャンバスを保つ。色や同一性の提供元ではなく、ベースか構図参照でフレーミングを決める。幅を150%・高さそのままならアスペクト比は1.5倍。物の大きさを変えてもキャンバスは変わらない。
- 定義した各Subjectに関係を1つずつ書く:

| 関係 | 書き方 |
| --- | --- |
| 完全保持 | 単独の文で正確に `<Subject N> is fully preserved.` |
| 部分保持 | partially preserved と書き、残る要素と変わる要素を書く |
| 属性転写 | 性質と受け手を書く: `<Subject 2> supplies the exact body color transferred to <Subject 1>.` |
| 弱い参照 | 借りる性質と変わってよい所を書く: `<Subject 2> serves as a weak style reference for the new background, with freely adapted forms.` |

- 完全保持は範囲全体（数・位置・状態・見た目・役割）。移動・回転・複製・再照明・遮蔽は変更。完全保持の親に編集される子を含めない（定義を狭めるか部分保持にする）。新しい影や反射も影響する範囲の変更。
- 正確な色の転写では、HEX値を推測したり近い色名に置き換えたりしない。ユーザーが値を指定したら従う。

**3. 変わる・新しい中身を仕上げる**
- 形・素材・接触・奥行き・遠近・光・レイアウトを必要なだけ書く。新しい環境や全体の画風は多めに、局所の色替えは局所に。
- 削除は残った面や空間で書く。移動は位置を変え、複製は個体を足す。区別する。
- 完全保持の後は、必要ならSubjectのトークンだけを錨に使い、見た目を書き直さない。部分保持は変化だけを詳しく。転写と弱い参照は受け手の上の性質を書き、提供元の余計な性質を持ち込まない。
- 文字の編集は、置き換える単語だけでなく結果の行全体を書く。変わらない行は省く。翻訳は実際の訳をここに書き、原文は定義側に残す。
- 書き終えたら止める。埋め草を足さない。

## 出力形式

````text
```text
<プロンプト本文>
```

Aspect ratio: 3:4
推奨サイズ: 3552x4736
````

- 本文は英語。画面に出る文字だけは原語（日本語のコピーは日本語のまま引用符で）。
- T2Iは1段落以上の流れる文章。Editは上の順の1段落。
- アスペクト比は幅:高さで1:3〜3:1。ユーザー指定を守り、範囲外なら一番近い比にしてそう伝える。指定が無ければレイアウトから選ぶ。入力のフレーミングを保つ編集では入力の比。
- 推奨サイズ（ローカル・ComfyUI用、16MP）:

| 比 | サイズ |
| --- | --- |
| 1:1 | 4096x4096 |
| 4:3 / 3:4 | 4736x3552 / 3552x4736 |
| 3:2 / 2:3 | 5024x3360 / 3360x5024 |
| 16:9 / 9:16 | 5472x3072 / 3072x5472 |
| 21:9 | 6272x2688 |

  ほかの比は約16MP・両辺32の倍数で計算する（例 5:4 → 4576x3648）。メモリが足りない環境では約4MPまで下げてよい。
- 案を求められたら、はっきり違う方向の案を最大3つ、それぞれ比つきで。
- ユーザーへの説明は日本語。プロンプト本文の和訳は求められたときだけ付ける。

## 使う環境ごとの注意

- **MiniMax API:** T2Iは `disable_prompt_enhanced: true` にすると書いたまま描く（公式スクリプトの既定）。編集は常に拡張される。出力面積は `4K` が最良。文字が多い画像・グラフ・図は結果がぶれるので2〜4枚出して選ぶ。
- **ComfyUI（公式テンプレート）:** テンプレートはprompt expanderが既定ON。このスキルの文章をそのまま使うならexpanderをOFFにする。参照画像はLoad Imageノードの順が `<Picture N>`（`<Picture 1>` が編集対象）。
- **ローカル（SGLang等）:** `prompt` と `size`（WIDTHxHEIGHT）を送る。seedは整数、`generator_device` は cpu 推奨。
- **ライセンス:** MiniMax-H3-Image Community Licenseの適用地域から EU・英国・韓国・米国 は除外されている。クラウドGPUで重みを動かすときは、インスタンスの所在国に注意する。

## 最終チェック

- 画面に出る言葉はすべて引用符つきで、指定どおりの綴り。頼まれていない文字は足していない（文字なしなら "no text" 文がある）。
- 数・位置・左右・手前と奥・人と物の接触が依頼と合う。
- 値・単位・ラベルが正しく、そろっている。
- 各参照画像に役割があり、残す物が名指しされている（Editは全Subjectに関係が1つずつ）。
- アスペクト比がレイアウトに合う。
- 見える細部で言える所に、あいまいな品質語が残っていない。

## 公式の作例（英語のまま）

### T2I: 物理的な接触があるシーン

依頼: `A woman potter shaping a bowl on a wheel in a sunlit workshop, seen from her left side. Emphasize her hands working the wet clay. No text.`

```text
A naturalistic photograph of a woman potter seated at a pottery wheel in a sunlit workshop, viewed from her left side at approximately hand level. A medium composition includes her profile, shoulders, forearms, hands, and the complete bowl on the wheel, with enough of the wheel and stool visible to make her working posture clear. She leans slightly forward with relaxed shoulders and looks down at the clay. Capture one precise moment as her left hand supports the bowl's outer wall while the fingertips of her right hand shape the inner surface near the rim. Her hands oppose each other gently across the same section of clay; the bowl stays centered on the wheel head. Wet slip coats her fingertips and gathers in fine concentric ridges on the rounded bowl. The rim is smooth, open, and clearly separated from her fingers. Soft sunlight enters from a side window, catching the moisture on the clay and casting gentle shadows beneath her wrists. A worn wooden workbench and quiet shelves recede out of focus, keeping attention on the hands and their contact with the bowl. Warm earth tones, believable skin texture, and subtle workshop wear give the scene a tactile, unposed quality. No lettering or additional people appear.
```

### T2I: データのダッシュボード

依頼: `Design a 16:9 dashboard titled "Quarterly sales". Products A, B, and C sold 12, 18, and 9 units respectively. Include a bar chart, a compact data table, the total, and the best-performing product. Keep it clean and do not invent additional sales data.`

```text
A clean 16:9 sales dashboard on a warm white background uses a restrained charcoal-and-teal palette, crisp sans-serif typography, and a consistent alignment grid. The title "Quarterly sales" sits at the upper left. Two compact summary cards occupy the top row beneath it: "Total units" with the value "39", and "Best-performing product" with "B — 18 units". These values summarize the supplied three-product dataset.

The lower left contains a large vertical bar chart. Its horizontal axis is labeled "Product", with categories "A", "B", and "C" in that order; its vertical axis is labeled "Units" and has evenly spaced ticks at 0, 5, 10, 15, and 20. All bars share the same zero baseline and equal widths. Their heights correspond exactly to 12, 18, and 9, and each value is printed clearly above its bar. Product B is teal; A and C use the same muted gray. Thin horizontal gridlines make the scale readable without competing with the data.

At the lower right, a compact table has the column headings "Product" and "Units", followed by the rows "A | 12", "B | 18", and "C | 9". Its B row carries a subtle teal accent matching the highlighted bar. Balanced spacing separates the summary cards, chart, and table. There are no invented dates, forecasts, percentage changes, or additional data series.
```

### Edit: 局所の色替え

参照: `@Picture 1` は左に赤いカップ、右にレモンがあるテーブル。依頼: `In @Picture 1, change only the red cup to blue. Leave everything else unchanged.`

```text
The red cup on the left in <Picture 1> is <Subject 1>. The lemon on the right in <Picture 1> is <Subject 2>. The target image shows <Subject 1> with a blue finish. <Subject 1> is partially preserved; its shape, material, position, and scale remain while its surface color changes. <Subject 2> is fully preserved. The blue finish follows the existing surface shading and highlights of <Subject 1>, with the rest of the source image unchanged.
```

### Edit: 性質の転写つき新規ポスター

参照: `@Picture 1` は正面向きのベージュのコート、`@Picture 2` は色付きの釉薬の花瓶。依頼: `Create a portrait fashion poster using the coat in @Picture 1. Match its color exactly to the vase's body color in @Picture 2, keep its cut and fabric, and write a short English headline. No brand names or product claims.`

```text
The front-facing beige coat in <Picture 1> is <Subject 1>. The body color of the vase in <Picture 2> is <Subject 2>. The target image is a portrait fashion poster featuring <Subject 1> beneath a short headline. <Subject 1> is partially preserved; its cut, fabric texture, folds, and front-facing presentation remain while its color, scale, and placement change. <Subject 2> supplies the exact body color transferred to <Subject 1>. The transferred color follows the existing garment shading without importing the vase's glaze or shape. <Subject 1> is centered in the lower two-thirds of the poster, with its full hem and sleeves visible. A new warm off-white background extends evenly to the edges, leaving generous space around the garment. The headline 'A quieter kind of bold.' appears above it in large charcoal serif lettering, arranged on two centered lines: 'A quieter kind' followed by 'of bold.' The composition contains no other lettering, brand names, or decorative props.
```
