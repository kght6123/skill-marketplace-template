# フルリファレンスモード完全仕様

> **原文（更新時はこれを取得して差分反映）:** https://huggingface.co/MiniMaxAI/MiniMax-H3/resolve/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md


参照画像・参照動画・参照音声から特徴を取り出して生成する、動画を編集する、動画の続きを作る、といったタスクの書式。base モード（T2VA / I2VA / FL2VA / L2VA）とは**フィールド構成が違う**ので混ぜないこと。

ショット、カメラワーク、話者、台詞、通常の音の基本書式は SKILL.md の共通記法と同じ。このファイルはフルリファレンス固有の**参照ラベル・分析セクション・書式差分**を扱う。

## 目次

1. [全体構造（6セクション）](#1-全体構造6セクション)
2. [`subject_definitions` と4種のラベル](#2-subject_definitions-と4種のラベル)
3. [`summary` とタスクタイプ](#3-summary-とタスクタイプ)
4. [`retention_analysis` と保持関係マーカー](#4-retention_analysis-と保持関係マーカー)
5. [`detailed_description`](#5-detailed_description)
6. [音の2セクション](#6-音の2セクション)
7. [完成例](#7-完成例)

---

## 1. 全体構造（6セクション）

6つのセクションを**この順番で**書く。

| セクション | 役割 |
|---|---|
| `subject_definitions` | 参照コンテンツとその参照ラベルを定義する |
| `summary` | タスクタイプ、ターゲット動画、主な参照関係を要約する |
| `retention_analysis` | 参照コンテンツがどう保持・転移・再利用されるかを記述する |
| `detailed_description` | 映像・アクション・ショット・音・台詞を再生順に記述する |
| `overall_soundscape` | 環境音と物理音を要約する |
| `non_diegetic_music` | 観客だけに聞こえるBGMを記述する |

6セクションすべて**英語で書く**。原語を保持するのは `<d>` 内の台詞・歌詞と、画面内に実際に映る文字だけ。

**記述の粒度：**`detailed_description` は可能な限り詳細かつ明示的に書く。各ショットについて、現在の構図、被写体の外見と位置、環境と照明、アクションと状態変化、カメラワーク、その時点の音、そして**参照コンテンツが実際に登場する／効き始める箇所**を明確に確立する。あらすじ要約や参照関係の箇条書きに縮退させないこと。

---

## 2. `subject_definitions` と4種のラベル

参照元と役割を識別する4種類のラベルを使う。

| ラベル | 意味 |
|---|---|
| `<Subject N>` | 参照素材から抽出された、ターゲット動画で再利用・改変できる可視コンテンツ |
| `<Picture N>` | 具体的なターゲットフレーム、またはショット設計のアンカーとして使う参照画像 |
| `<Video N>` | 編集元、継続の開始点、動画全体の時間構造を提供する参照動画 |
| `<Audio N>` | コピーまたは参照される音声信号 |

一度あるコンテンツにラベルを割り当てたら、`subject_definitions` / `summary` / `retention_analysis` / `detailed_description` / 音声セクションを通じて**同じ意味を保つ**。

`subject_definitions` では、あとで個別に追跡する必要がある参照コンテンツ（人物、環境、元動画の構造、音声トラックなど）を**1項目1行**で定義する。そのラベルが何を指すか、参照上の役割、従うべき主要特徴を説明する。出自を明示する必要があるときは対応する元素材の名前も書く。

`<Picture N>` や `<Video N>` が**他の参照項目の出所を示すだけ**で、あとで単独に分析・使用されないなら、独立した行を作らずその項目の定義の中で引用する。

### 2.1 `<Subject N>`

再利用可能な可視コンテンツに使う：

- 人物、動物、物体
- シーン、背景、環境
- 衣装、小道具、インターフェース、視覚エフェクト
- スタイル、アクション、表情、ポーズ

ファイルそのものではなく、**ターゲット動画で実際に使われるコンテンツ単位**を表す。1つの Subject が複数の参照素材から定義されることもあり、1つの参照素材が複数の Subject を提供することもある。

```text
<Subject 1> is the young woman in <Picture 1>, with long dark hair, a blue cardigan, and a thin silver necklace.
```

同じ Subject が複数素材に由来する場合は、出所を統合して各素材が何を提供するかを述べる。

```text
<Subject 1> is the woman whose appearance comes from <Picture 1> and whose walking motion comes from <Video 1>.
```

### 2.2 `<Picture N>`

参照画像そのものがショットの1フレーム目・キーフレーム・最終フレーム・編集キーフレーム・構図アンカーとして機能する場合に、独立した `<Picture N>` を立てる。

```text
<Picture 2> is the first frame of [Shot 1], showing a woman seated beside a café window.
```

画像が**キャラクター・シーン・衣装・スタイルの定義のためだけ**に使われるなら、独立した Picture 項目は作らず、対応する `<Subject N>` の定義の中で画像出所を引用する。

画像が絵コンテ／ショット設計の参照として働く場合は、どのショットに対応し、どんな設計情報を与えるかを述べる。

```text
<Picture 3> is a storyboard reference for [Shot 1] and [Shot 2], defining their viewpoint, subject placement, and shot order.
```

### 2.3 `<Video N>`

動画全体レベルの関係にのみ使う：

- 元動画を編集する
- 元動画の末尾から継続する
- 元動画のカメラワーク、カット、リズム、時間構造を参照する

```text
<Video 1> is the source video for the target video edit.
```

参照動画から人物・物体・シーン・アクション・エフェクトを**可視コンテンツとして再利用**する場合、それは `<Subject N>` に属する。`<Video N>` は素材や構造の出所を識別するだけで、Subject ラベルを置き換えない。

### 2.4 `<Audio N>`

独立した音声素材、または参照動画の有効化された同期音声トラックを表す。主な用途：

- 音声信号の全体または一部のコピー
- BGMスタイルの参照
- 話者の声質・話し方の参照
- 元音声の台詞・歌詞・効果音の使用
- ビート、リズム、音声の連続性の参照

`<Audio N>` がターゲットの話者に明確に対応する場合、その話者のグローバルIDを定義内で再利用する。Subject に対応する話者なら `<Subject N> (Sx)`、そうでなければ安定した声の説明のあとに `(Sx)` を置く。IDはターゲット動画のグローバルな話者順から来るものであり、音声定義の中で独自に割り当てたり振り直したりしない（§5.4 参照）。

```text
<Audio 1> is the voice-timbre reference for <Subject 1> (S1).
```

1つの音声素材が複数の役割を持つ場合は、小見出しを増やさず自然な1文でそれらの役割を記述する。

### 2.5 同一参照動画の映像トラックと音声トラック

`<Video N>` と `<Audio N>` は**独立に番号付けされる**。各インデックスは自カテゴリ内での順序を示すだけで、2つのカテゴリ間の対応関係を符号化しない。同じ参照動画が `<Video 1>` と `<Audio 2>` に対応することがあり、番号が違っても同一素材由来であることを妨げない。

ファイルに音が含まれているというだけでは、通常の参照動画に `<Audio N>` は作らない。

`<Audio N>` の定義は主に音声の役割を述べるものであり、由来する `<Video N>` を必ずしも名指ししなくてよい。出自の曖昧さを解消する必要があるときだけ共通の出所を明示する。

```text
<Video 1> is the source video for the target video edit.
<Audio 2> is the synchronized audio track of <Video 1> and is reused in the target video.
```

---

## 3. `summary` とタスクタイプ

英語の短い1段落で、ターゲット動画とその参照関係を要約する。角括弧で囲んだ**タスクタイプの接頭辞**から始める。

```text
[reference generation] ...
[video editing + reference generation + audio reuse] ...
```

### タスクタイプ

| タスクタイプ | 使う場面 |
|---|---|
| `keyframe completion` | 画像がターゲット動画の1フレーム目、キーフレーム、最終フレーム、編集キーフレーム、その他の具体的なフレームアンカーとして機能する |
| `reference generation` | 画像・動画・音声が、キャラクター・シーン・スタイル・アクション・カメラワーク・絵コンテなどの生成ガイドを提供する。具体的なフレームとしても、編集・継続される元動画としても機能しない場合 |
| `video editing` | 既存の元動画を直接改変する。画像の編集や静止キーフレーム間の生成はこれに含まれない |
| `video continuation` | 既存の元動画から継続・延長・再開・遷移する新規コンテンツ |
| `audio reuse` | 同じ音声信号を全体または一部再利用する |
| `audio reference` | 音声信号を直接コピーせず、音楽スタイル・声質・台詞や歌詞の内容・効果音の質感・ビート・連続性だけを参照する |

複数の関係を満たす場合は ` + ` で連結し、同じタイプを重複させない。例：元動画から継続しつつ画像を最終フレームに使うなら `[video continuation + keyframe completion]`。元動画を編集しつつ元音声を保持するなら `[video editing + audio reuse]`。

動画や音声が存在するというだけでは対応するタスクタイプは自動的に発生しない。参照動画がカメラワーク・カット・リズムだけを提供するなら、通常は `reference generation` に属する。`video editing` / `video continuation` はその動画が直接編集・継続される場合にのみ使う。

元動画を編集する際、元音声が聞こえたままなら `audio reuse` も併用する。元動画を継続する際、音声信号を直接コピーせず元トラックの可聴特性を継続するだけなら `audio reference` を使う。

### 記述

`summary` は既に定義した `<Subject N>` / `<Picture N>` / `<Video N>` / `<Audio N>` を使って、主要な被写体、ショットの流れ、参照素材の役割を記述する。**このセクションで新しい参照ラベルを導入しない。**

動画編集タスクでは、タスクタイプ接頭辞の直後を次の文で始める：

```text
The target video is an edited version of <Video 1>.
```

---

## 4. `retention_analysis` と保持関係マーカー

各参照コンテンツがターゲット動画でどう保持・転移・コピー・参照されるかを記述する。**参照ラベル1つにつき1行**を使い、`subject_definitions` で確立した意味を保つ。

### 4.1 可視コンテンツ

`<Subject N>` / `<Picture N>` / `<Video N>` は以下のマーカーを使う。これらは出力書式上の**固定の英語値**で、言い換えない。

| マーカー | 意味 |
|---|---|
| `fully_preserved` | 参照コンテンツの定義された役割が完全に保持される |
| `partially_preserved` | 参照コンテンツは使われるが、定義された特徴の一部が変更されるか部分的にしか保持されない |
| `attribute_transfer` | 参照された特徴が、別の識別可能なターゲット被写体へ転移される |
| `weak_reference` | スタイル・カテゴリ・構図・雰囲気の大まかな類似性のみ保持される |

```text
<Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - ...
<Picture 2> ([Shot 1] first frame): fully_preserved - ...
<Video 1> (cut and pacing structure): weak_reference - ...
```

### 4.2 音声

`<Audio N>` は以下のマーカーを使う。

| マーカー | 意味 |
|---|---|
| `fully_copy` | 元音声の全体がターゲット動画の完全な最終音声トラックになる |
| `partially_copy` | タイムラインの一部や選択された音声レイヤーのみコピーされる、またはコピー後に他の音が追加・削除・置換される |
| `reference` | 信号は直接コピーされず、音色・リズム・音楽スタイル・台詞内容・音の質感のみが参照される |
| `weak_reference` | カテゴリや雰囲気の大まかな類似性のみ保持される |

```text
<Audio 1>: fully_copy - <Audio 1> is reused 1:1 as the target video's complete final audio track.
<Audio 2>: reference - the target speaker follows <Audio 2>'s voice timbre and measured delivery without copying the original signal.
```

各マーカーは、そのラベルについて `subject_definitions` で既に定義した参照役割の範囲内でのみ選ぶ。ターゲット動画に新しく加わったアクション・背景・出来事を、参照忠実度の損失として扱わないこと。

**`retention_analysis` には `(Sx)` を書かない。**

---

## 5. `detailed_description`

フルリファレンス書き換えの本体。ターゲット動画の再生順にショットごとの映像・アクション・音・台詞を記述し、該当箇所に参照ラベルを挿入する。

### 5.1 base モードとの差分

| 次元 | T2VA（base） | フルリファレンス |
|---|---|---|
| 本体フィールド名 | `integrated_multimodal_description` | `detailed_description` |
| スタイルの提示位置 | `[Shot 1]` の**後** | `[Shot 1]` の**前**に英語1〜2文で確立する |
| 参照情報 | 参照ラベルを使わない | `<Subject N>` `<Picture N>` `<Video N>` `<Audio N>` を初出時と役割が効く箇所に挿入する |
| 音声関係 | ターゲット動画自身の音を記述 | 該当するショットや音声フェーズで `<Audio N>` を引用し、信号がコピーなのか参照なのかを述べる |

冒頭の書き方：

```text
The target video is in a cinematic, literary music-video style with soft lighting and a slightly desaturated color palette.
[Shot 1] The scene opens in a crowded urban street...
[Shot 2] At 00:09.000, the shot cuts to an extreme close-up...
```

### 5.2 分量

生成タスクでは `detailed_description` は通常**英語350〜500語**。台詞が密なコンテンツでは、機械的に語数を満たすことより完全な発話タイムラインを収めることを優先する。動画編集の記述は元動画の複雑さに応じてスケールし、生成タスクの範囲に従わなくてよい。

単一ショットであることは短い記述を自動的に正当化しない。情報量に応じて複数ショットにディテールを配分する。

### 5.3 ショット内での参照ラベルの使い方

重要な `<Subject N>` の最初の明確な登場箇所で、そのショットで実際に見えている範囲において、参照された特徴・画面内の位置・現在のアクションを記述する。以降のショットでは同じラベルを使い続け、そのラベルが何を表すかを再定義しない。

具体的なフレームアンカーには自然な言い回しを使う：

```text
the shot begins from <Picture 1>
the shot's keyframe corresponds to <Picture 2>
the shot ends on <Picture 3>
```

元動画を編集・継続する場合、その元状態・構造・継続関係が該当する箇所で `<Video N>` を自然に引用する。`<Audio N>` は音声関係が有効になっているショットまたは意味的フェーズで引用する。

### 5.4 話者・音源・台詞

話者IDと `<d>` の基本書式は base モードと同じ（SKILL.md 参照）。参照された被写体が実際に発話する場合、**視覚参照ラベルと話者IDの両方を保持する**。

```text
<Subject 2> (S1) turns toward the woman and says, <d>[English] Last summer, I went to my grandfather's house. He talked about you.</d>
```

`<Subject N>` は参照された被写体を、`(Sx)` は実際の話者を識別する。被写体が話すときは `<Subject N> (Sx)` と書く。同じ被写体が画面外で話す場合も同じ形を保ち、`off-screen` と明示する。話者が定義済みの被写体に対応しない場合は、安定した声の説明のあとに `(Sx)` を置く。

**BGM内の音声：**発話内容が直接再利用されたBGMや完全なサウンドトラックの中の一要素にすぎず、人物・キャラクター・ナレーターなど独立した発声源が物理的にそれを発していない場合、`<Audio N>` を可聴の音源として使い、追加の `(Sx)` を作らない。具体的な発声源が声を出している場合は、その音源に `(Sx)` を割り当てて再利用する。

```text
When <Audio 1> reaches the phrase <d>[English] I'm lonely lonely lonely lonely lonely I'm lonely</d>, <Subject 1> performs the corresponding hand gesture without becoming a separate speaker source.
```

**台詞の再利用：**参照音声の台詞・ナレーション・歌詞を直接再利用する場合、またはユーザーが再演を明示的に要求した場合、`<d>` 内に元の語と原語を正確に保持する。聞き取れない箇所は推測や言い換えをせず `[unclear]` と書く。句読点は文を表すのに必要な基本記号（`,` `.` `?` `!`）に正規化し、繰り返しのチルダ・絵文字・中黒・装飾的な句読点は削除する。平叙文・疑問文・感嘆文は `</d>` の前をそれぞれ `.` `?` `!` で終える。

音色・リズム・感情・話し方だけを参照する場合、参照音声の元台詞をターゲット動画に持ち込まない。

**ID割り当て：**`(Sx)` はターゲット動画における実際の発声イベントの順序に従って一度だけ割り当てる。`detailed_description` のすべての実際の発声イベントで対応するIDを再利用する。`subject_definitions` でターゲット話者に紐付いた `<Audio N>` も同じ `(Sx)` を再利用するのであって、新しいIDを独自に割り当てることはない。

---

## 6. 音の2セクション

`overall_soundscape` と `non_diegetic_music` の定義は base モードと同じ（SKILL.md 参照）。

`overall_soundscape` は動画全体の環境音と物理音を要約する。台詞・歌唱・特定のショットに同期した音イベントは `detailed_description` 側に残す。

```text
overall_soundscape: Quiet indoor room tone and a low ventilation hum continue throughout the video.
```

`non_diegetic_music` は観客だけに聞こえるBGMを記述する。音楽がある場合は楽器編成・テンポ・強弱の展開を述べる。

```text
non_diegetic_music: A restrained solo-piano score at a slow tempo, with sustained low cello underneath and no swell.
```

参照音声を使う場合、そのコピー／参照関係は**可聴レイヤーに対応するセクションでのみ**述べる。環境音と効果音は `overall_soundscape`、観客専用のスコアは `non_diegetic_music`。同じ音声が両方のコンテンツを提供するなら、それぞれのセクションで対応する関係を記述する。

```text
overall_soundscape: The copied ambience layer from <Audio 1> continues throughout the target video.
non_diegetic_music: <Audio 2> is directly reused as the complete audience-only score.
```

完全な台詞と歌詞は `detailed_description` の `<d>` 内にのみ書き、この2セクションで繰り返さない。

---

## 7. 完成例

本スキル用に書き下ろした作例。参照画像2枚（人物1枚・店舗内装1枚）と参照音声1本（声質参照）を使った3ショット構成。

```text
subject_definitions:
<Subject 1> is the record-shop interior in <Picture 1>, with floor-to-ceiling wooden crates, a hand-painted price board, warm tungsten downlights, and a worn checkerboard floor.
<Subject 2> is the man in his sixties in <Picture 2>, with close-cropped grey hair, round wire glasses, and a faded denim work apron over a dark shirt.
<Audio 1> is the voice-timbre reference for <Subject 2> (S1), containing a spoken English vocal layer with a low, weathered timbre and an unhurried pace.

summary:
[reference generation + audio reference] The target video shows <Subject 2> working alone in <Subject 1> after closing, pulling a record from a crate and setting it on a turntable. A young customer knocks at the locked door and is waved in across three shots. <Audio 1> guides the voice timbre of <Subject 2> without copying the original signal.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the wooden crates, hand-painted price board, tungsten downlights, and checkerboard floor are retained.
<Subject 2> (appears in [Shot 1], [Shot 3]): fully_preserved - the grey close-cropped hair, round wire glasses, and denim work apron over a dark shirt are retained.
<Audio 1>: reference - its low weathered timbre and unhurried delivery guide the speech of <Subject 2> without copying the original signal.

detailed_description:
The target video uses a warm, grainy live-action style with tungsten-weighted lighting and soft falloff into the corners of the frame.
[Shot 1] A medium-wide shot establishes <Subject 1>, the record shop after closing, its wooden crates lit by low tungsten downlights and the hand-painted price board hanging above the counter. <Subject 2>, the man in his sixties with close-cropped grey hair, round wire glasses, and a faded denim work apron, stands at the middle crate with his back half-turned to the camera. The camera trucks left with small amplitude at slow speed as he walks his fingers along the record spines, stops, and eases one sleeve upward. He tilts it toward the light and reads the label. Using the low, weathered timbre referenced from <Audio 1>, <Subject 2> (S1) says quietly to himself, <d>[English] Still here after all this time.</d> He closes his mouth and slides the sleeve free of the crate.
[Shot 2] At 00:04.000, the shot cuts to a close-up of the turntable on the counter, the checkerboard floor of <Subject 1> visible beyond it. Two hands lower the record onto the platter and lift the tonearm. The camera pushes in with small amplitude at slow speed as the needle settles into the groove and the platter begins to turn. Beyond the counter, a shape moves past the front window.
[Shot 3] At 00:08.000, the shot cuts to a wide shot from behind the counter, framing <Subject 2> in profile against the locked glass door of <Subject 1>. A young customer knocks twice and gestures at the darkened sign. <Subject 2> (S1) looks up, raises an open hand, and calls out in the same low weathered voice referenced from <Audio 1>, <d>[English] It's open. Come in, come in.</d> He closes his lips into a small smile, wipes his hands on the denim apron, and walks toward the door as the record continues playing behind him.

overall_soundscape:
Low room tone continues throughout with a faint electrical hum from the ceiling lights. Cardboard sleeves slide against each other, a needle clicks into a groove with a soft crackle, and two knocks land on glass near the end.

non_diegetic_music:
N/A
```

この例で守られている点を確認すること：セクションが規定の順序で並ぶ／ラベルが全セクションを通じて同じ意味を保つ／`retention_analysis` に `(Sx)` が出てこない／スタイルが `[Shot 1]` の前に置かれる／ターンテーブルの音は劇中音なので `detailed_description` 側にあり、`non_diegetic_music` は `N/A`。
