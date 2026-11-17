# base モード完全仕様（T2VA / I2VA / FL2VA / L2VA）

> **原文（更新時はこれを取得して差分反映）:** https://huggingface.co/MiniMaxAI/MiniMax-H3/resolve/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md


キーフレーム系4モードの仕様。共通記法（ショット、カメラワーク、話者・台詞、画面内テキスト、2つの音フィールド）は SKILL.md 側にあるので、そちらと併せて使う。

## 目次

1. [4モードの定義](#1-4モードの定義)
2. [プロンプト全体構造](#2-プロンプト全体構造)
3. [先頭の位置合わせ定型文](#3-先頭の位置合わせ定型文)
4. [キーフレームの組み込み方](#4-キーフレームの組み込み方)
5. [`integrated_multimodal_description` の組み立て](#5-integrated_multimodal_description-の組み立て)
6. [完成例](#6-完成例)

---

## 1. 4モードの定義

| モード | 定義 |
|---|---|
| **T2VA** | テキストから音付き映像のタイムライン全体を構築する |
| **I2VA** | T2VA本体 + 1フレーム目の指示 + 1フレーム目から前へ展開する映像の道筋 |
| **FL2VA** | T2VA本体 + 最初と最後のフレームの指示 + 1フレーム目から最終フレームへの連続した道筋 |
| **L2VA** | T2VA本体 + 最終フレームの指示 + もっともらしい先行状態から最終フレームへ収束する道筋 |

どのモードも「T2VA本体」を含む。つまり `integrated_multimodal_description` / `overall_soundscape` / `non_diegetic_music` の3フィールドは常に必要で、モードによる違いは**先頭に何を置くか**と**画像をどう本文に織り込むか**だけ。

---

## 2. プロンプト全体構造

### パート1：指示行

T2VA は画像との位置合わせがないので、指示行なしで3つのコアフィールドから直接始める。

I2VA / FL2VA / L2VA は §3 の定型文を**プロンプトの1行目**に置き、その後に空白行を1つ入れてからコアフィールドに入る。

### パート2：3つのコアフィールド

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

- **integrated_multimodal_description** — タイムラインに沿って、映像・アクション・ショット・話者・台詞・歌唱・劇中音を記述する
- **overall_soundscape** — 動画全体の環境音、物理的な動作音、非言語の人声を要約する
- **non_diegetic_music** — 登場人物には聞こえず観客だけに聞こえるBGMを記述する

---

## 3. 先頭の位置合わせ定型文

**一字一句そのまま出力する。**綴り・記号・ダッシュ（`—`）・角括弧の有無まで含めて固定。

### I2VA

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

### FL2VA

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
```

### L2VA

```text
How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.
```

### プレースホルダの置き換え

- `N` — 実際の最終ショットの番号。単一ショットなら `1`
- `S.SS` — 実効的な動画尺。**必ず小数点以下2桁**（8秒なら `8.00`、6.5秒なら `6.50`）

### 表記ゆれに注意

FL2VA の定型文だけ `Picture 1` / `Shot 1` と**山括弧も角括弧も付かない**。I2VA と L2VA は `<Picture 1>` / `[Shot 1]` と付く。原文の仕様がそうなっているので、統一せずそのまま従う。

---

## 4. キーフレームの組み込み方

### 4.1 I2VA — 画像から始めて前へ展開する

`<Picture 1>` は0.00秒の実際の1フレーム目であり、`[Shot 1]` に属する。まず画像の中のスタイル・被写体・構図・シーンのアンカーを確立し、その上で次のアクションを記述する。人物の同一性、服装、色、重要な小道具、空間関係は一貫させる。

**推奨構造：1フレーム目のアンカー → アクションの開始 → 連続した展開 → 結果または反応**

### 4.2 FL2VA — 最初と最後の間の道筋を書く

Picture 1 が始まり、Picture 2 が終わり。焦点は「被写体がどう動くか」「ポーズがどう変わるか」「物体がどう操作されるか」「構図がどう変化するか」「シーンや照明がどう遷移するか」。

FL2VA は原則として**単一ショット**を選ぶ。モデルが1フレーム目から最終フレームまで連続的に補間できるようにするため。複数ショットはユーザーが明示的に指定したときだけ使う。最終フレームは動画の末尾で最終 `[Shot N]` に到達させる。

**推奨構造：1フレーム目の状態 → 観察可能な中間変化 → 差分が徐々に縮まる過程 → 最終フレームの状態**

2枚の静止画の描写を並べるだけにしないこと。本体は「間をどう繋ぐか」。

### 4.3 L2VA — 冒頭を推論し、最後に画像へ着地する

`<Picture 1>` は動画の最終フレームであり、最終 `[Shot N]` に属する。**Shot 1 に属するわけではない**点に注意。ユーザーの意図と最終フレームからもっともらしい先行状態を推論し、そこから人物・物体・カメラ・シーンが徐々に参照画像へ近づいていく過程を書く。

**推奨構造：もっともらしい先行状態 → 明示的なアクションと遷移の道筋 → 最終ショットでの段階的な収束 → 最終フレームへの着地**

着地の記述では、参照画像で確立されている要素（ポーズ、物体配置、カメラアングル、照明、最終構図）に一致させることを明示する。

---

## 5. `integrated_multimodal_description` の組み立て

書き換え後プロンプトの本体。すべてのディテールが**見えるもの・聞こえるもの**に対応している必要がある。含める要素：

- 映像スタイル
- 初期構図
- 被写体の外見と位置
- シーンと重要な小道具
- アクションと反応
- ショットの切り替え
- 話される言語
- 同期する劇中音

`[Shot 1]` の冒頭で全体のスタイルと初期構図を述べる。

```text
[Shot 1] Live-action, cinematic, a medium-wide shot frames...
```

スタイル語の例：`Cinematic` / `live-action` / `2D-animated` / `3D CG` / `claymation` / `watercolor` / `vintage film`。キーフレームがあるタスクでは参照画像からスタイルを導く。T2VA ではユーザーのテキストから選ぶ。

ショット、カット、カメラワーク、話者ID、`<d>` 記法、`<scenetrans>` / `<cutoff>`、画面内テキストの扱いは SKILL.md の共通記法に従う。

---

## 6. 完成例

以下は本スキル用に書き下ろした作例。フォーマットの参照用であり、内容はテーマに応じて作り直す。

### 例1：T2VA

参照画像がないので、テキストからタイムライン全体を構築する。ユーザーの意図と矛盾しない範囲で、シーン・人物・アクション・音のディテールを補ってよい。

```text
integrated_multimodal_description: [Shot 1] Live-action, cinematic, a low-angle medium shot frames a lone night-shift mechanic rolling out from under a truck on a creeper in a dim garage. The camera pedestals up with small amplitude at slow speed as he sits up, wipes his hands on a rag, and looks toward the open bay door. The mechanic in his fifties, with a low gravelly voice and a slow deliberate pace (S1), says: <d>[English] That's the last one tonight.</d> He drops the rag onto the toolbox lid. [Shot 2] At 00:04.000, the camera cuts to a wide shot from outside the bay, the garage light spilling onto wet asphalt as he pulls the shutter down.

overall_soundscape: A fluorescent tube buzzes overhead while the creeper wheels rattle across the concrete floor. A wrench settles onto metal, followed by heavy footsteps and the long rolling clatter of the shutter closing.

non_diegetic_music: A slow electric-bass line with brushed drums entering halfway through, thinning to a single sustained organ note at the end.
```

### 例2：I2VA

先に1フレーム目の指示行を書き、Picture 1 の被写体・構図・シーンを Shot 1 の出発点にしてから、そこからどう展開するかを書く。

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, the elderly woman shown in <Picture 1> remains seated at the wooden kitchen table, preserving her cardigan, the teacup in front of her, the window light from the left, and the layout of the room. The camera pushes in with small amplitude at slow speed as she reaches across the table and turns a photograph face-up. Her hand flattens the curled corner while she leans closer. The elderly woman with a thin, unhurried voice (S1) says: <d>[English] This one was taken before the fence went up.</d> She keeps her fingertips resting on the edge of the print.

overall_soundscape: A wall clock ticks steadily in a quiet room with faint traffic passing outside. Ceramic scrapes softly against the tabletop and paper crinkles as the photograph is turned.

non_diegetic_music: Widely spaced acoustic-guitar notes at a slow tempo with a sustained low string underneath, fading out before the end.
```

### 例3：FL2VA

2枚の画像がそれぞれ冒頭と終端を固定する。本文は2つの静止画の描写を繰り返すのではなく、両者を繋ぐ**動きの道筋**を供給する。以下は8秒の単一ショット。

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 8.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, a barista begins in the position and framing established by Picture 1, holding a metal pitcher above an untouched cup of espresso. The camera arcs right with small amplitude at slow speed as she tilts the pitcher, lowers the spout toward the crema, and lets the first white ring spread outward. She raises the pitcher, draws a steady line back through the center, and the pattern pulls into a leaf shape. Her wrist settles, the surface stops moving, and the cup, hand position, and composition match those established by Picture 2 at the end of the shot.

overall_soundscape: Low café room tone continues with an espresso machine hissing briefly in the background. Milk pours with a soft steady sound and the pitcher touches the counter once at the end.

non_diegetic_music: N/A
```

### 例4：L2VA

画像が固定するのは最終瞬間だけ。まず矛盾しない先行状態を作り、アクション・物体の状態・構図が最終ショットで Picture 1 に着地するようにする。以下は6秒の単一ショット。

```text
How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the 6.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, a close shot begins on an empty windowsill in a dim bedroom, with the same curtain fabric and morning light direction visible in <Picture 1>. The camera tilts down with small amplitude at slow speed as a hand enters from the left and sets down a folded paper crane, adjusts its angle, and withdraws. A second crane is placed beside it, then a third, each nudged into alignment. Toward the end, the hand leaves the frame and the three cranes rest in the exact spacing, orientation, shadow direction, and final composition established by <Picture 1>.

overall_soundscape: Quiet room tone with faint birdsong through the glass. Paper taps lightly against wood three times, followed by the soft rustle of a sleeve leaving the frame.

non_diegetic_music: A single sustained synth pad at a slow tempo with sparse bell tones, holding without swell through the final frame.
```
