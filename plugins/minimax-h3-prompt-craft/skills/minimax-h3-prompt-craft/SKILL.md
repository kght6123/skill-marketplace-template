---
name: minimax-h3-prompt-craft
description: MiniMax H3（Hailuo 3 / MiniMax-H3。映像とステレオ音声を同時生成するオムニモーダル動画生成モデル）向けの構造化プロンプトを新規作成・変換・修正するスキル。ユーザーが「H3のプロンプトを作って」「MiniMax H3」「Hailuo 3」「T2VA」「I2VA」「FL2VA」「L2VA」「ref2va」「integrated_multimodal_description」「subject_definitions」「retention_analysis」「first-last frameのプロンプト」「参照画像つき動画プロンプト」などと言ったら必ず使う。台詞・リップシンク・環境音・BGMまで指定する動画プロンプト、first/last frame制御、参照画像/参照動画/参照音声を使った生成、動画編集・動画継続のプロンプト、既存のWan2.2やSora系プロンプトをH3形式へ書き換える依頼にも積極的に使う。
---

# MiniMax H3 プロンプトクラフト

MiniMax H3 は映像と音声を1パスで同時生成するモデルで、プロンプトは「タグの羅列」ではなく **固定フィールド名を持つ構造化ドキュメント** として書く。フィールド名・記法・定型文はモデルが学習した通りの綴りでなければ効かないため、本スキルの literal（英語の定型文字列）は一字一句そのまま出力する。

## 前提スペック

- 尺 4〜15秒 / 24fps。ショット数は尺に対して過密にしない（5秒なら1〜2ショットが上限目安）
- 映像と音声は同時生成。音を書かないと「無音の映像」ではなく「適当な音」が付く
- 参照は画像最大9枚・動画3本・音声3本まで1コンテキストに混在可能
- 出力プロンプト本体は**英語で書く**。ただし `<d>` 内の台詞・歌詞、および画面内に映る文字は**原語のまま**保持する

## Step 1: モードを判定する

ユーザーの入力素材で決まる。判定を誤ると先頭の定型文が変わってしまうので、曖昧なら聞き返す。

| 入力 | モード | 読むファイル |
|---|---|---|
| テキストのみ | **T2VA** | `references/base-modes.md` |
| 画像1枚を1フレーム目にする | **I2VA** | `references/base-modes.md` |
| 画像2枚を最初と最後にする | **FL2VA** | `references/base-modes.md` |
| 画像1枚を最終フレームにする | **L2VA** | `references/base-modes.md` |
| 人物/背景/スタイル/動きの「参照」として素材を使う、参照動画・参照音声がある、既存動画の編集・継続 | **フルリファレンス** | `references/full-reference.md` |

判定のコツ：画像がその**フレームそのもの**になるなら base 側（キーフレーム）、画像から**特徴だけ取り出して別の絵を作る**ならフルリファレンス。参照動画や参照音声が1つでも絡んだら必ずフルリファレンス。

該当するリファレンスファイルを読んでから書き始める。このSKILL.mdに載っているのは**両モード共通の記法**だけで、フィールド構成・先頭の定型文・参照ラベルの規則はリファレンス側にある。

## Step 2: タイムラインを組む

本文は再生順に書く。すべての記述は「画面に見える」か「耳に聞こえる」ものに対応させる。「彼女は不安を感じている」のような内面描写は書かない。「彼女の指がカップの縁を繰り返しなぞる」と書く。

### ショットとカット

```text
[Shot 1] Live-action, cinematic, a medium-wide shot frames ...
[Shot 2] At 00:03.500, the camera cuts to ...
```

- `[Shot 1]` にタイムスタンプは付けない
- 2ショット目以降は `[Shot N] At MM:SS.mmm,` で始め、カット時刻は**厳密に増加**させ、尺の中に収める
- カット動詞は `the camera cuts to` / `the shot cuts to` / `the shot transitions to` / `the shot changes to` / `the shot switches to`。ユーザーが明示的に求めた場合のみ cross-dissolve / fade / wipe を使う
- カットは被写体・空間・状態・視点・時間のいずれかに**新情報**をもたらすときだけ切る。寄り引きや微妙な角度変更だけならカットせずカメラワークで処理する

### スタイル指定

`[Shot 1]` の冒頭に映像スタイルと初期構図を置く。よく使う語：`Cinematic` / `live-action` / `2D-animated` / `3D CG` / `claymation` / `watercolor` / `vintage film`。参照画像があるモードでは**画像から読み取ったスタイル**を書く。T2VA ではユーザーのテキストから選ぶ。

（フルリファレンスモードだけはスタイルを `[Shot 1]` の**前**に1〜2文で置く。詳細は `references/full-reference.md`。）

## Step 3: カメラワークを書く

カメラワークは「動きの種類 + 振れ幅 + 速度」の3次元で表現する。振れ幅・速度は**意味があるときだけ**付ける（中程度・通常速度は省略するのが正しい）。

| 次元 | 表現 | 意味 |
|---|---|---|
| 種類 | `Zoom In / Zoom Out` | カメラ本体は固定で焦点距離が変わる |
| 種類 | `Push In / Pull Out` | カメラ本体が前進 / 後退 |
| 種類 | `Pan Left / Pan Right` | 位置は固定でレンズが水平に振れる |
| 種類 | `Truck Left / Truck Right` | カメラが水平に平行移動 |
| 種類 | `Tilt Up / Tilt Down` | 位置は固定でレンズが垂直に振れる |
| 種類 | `Pedestal Up / Pedestal Down` | カメラ全体が上昇 / 下降 |
| 種類 | `Arc Shot` | 被写体を中心に弧を描いて移動 |
| 種類 | `Tracking Shot` | 動く被写体を追う |
| 種類 | `Static Shot` | 位置もレンズも動かない |
| 種類 | `Shake Slightly / Shake Strongly` | 軽い / 強い手ブレ |
| 種類 | `POV` | 被写体の主観視点 |
| 種類 | `Roll Clockwise / Roll Counterclockwise` | レンズ軸まわりの時計回り / 反時計回り回転 |
| 振れ幅 | `with small amplitude` / `with large amplitude` | 変化の範囲 |
| 速度 | `at slow speed` / `at fast speed` | 変化のテンポ |

ラベルを文末に積み上げるのではなく、ショットの中の**自然な英文の動作**として書く。

```text
The camera pushes in with small amplitude at slow speed toward the folded letter in her hands.
The camera pans right with large amplitude at fast speed, revealing the open doorway.
The camera holds a static shot as the runner exits the frame.
```

## Step 4: 話者・台詞・歌唱

発話・歌唱・オフスクリーンの人声を出す主体には `(S1)` `(S2)` … の安定IDを与える。複数人が同時に発話・歌唱するときは `(S1,S2)` のように連結する。IDはショットをまたいでも同じものを使い、**一度も声を出さない登場人物にはIDを付けない**。

初出時は、キャラクタータイプ・年齢・性別・画面内かどうか・声の高さ・音色・話速・訛りなど、同一性が安定する程度の情報を添える。

**`<d>` の中には言語タグと実際の発話内容だけを入れる。**話者の識別語・ID・動作・言い方はすべて `<d>` の外側に置く。台詞の語と句読点は原文のまま保持し、翻訳も書き換えもしない。

```text
The young woman with a quiet, breathy voice (S1) says: <d>[English] I get off at the next station.</d>
The two children (S1,S2) shout together, <d>[English] Wait for us!</d>
```

**ボイスオーバー**は `says in an off-screen voiceover` という句をそのまま使い、`<d>` ブロックの直後に、対応する画面内キャラクターの唇が閉じたままであることを明記する。

```text
The man (S1) says in an off-screen voiceover: <d>[English] I still remember that road.</d> while his lips remain completely closed.
```

**カットをまたぐ台詞・歌詞**は、両側の接続点に `<scenetrans>` を置き、音声がカットを越えて続くことを明示する。動画の終端で発話が途切れる場合は `<cutoff>` を使う。継続の言い回しは `continues seamlessly across the cut` / `continues uninterrupted into the next shot` / `carries over from the previous shot` / `remains audible across the transition`。

## Step 5: 画面内テキスト

看板・バナー・ラベル・字幕・ネオンなど、**実際に画面に映る文字**は英語のダブルクォートで囲む。原文と句読点をそのまま保ち、翻訳しない。

```text
A red neon sign reading "営業中" glows above the doorway.
```

## Step 6: 音の2フィールドを埋める

### `overall_soundscape`

動画全体の環境音・物理的な動作音・非言語の人声（風、雨、交通音、足音、衣擦れ、衝撃音、呼吸、笑い、息切れなど）を、**英語1〜4文の連続した1段落**で要約する。台詞・歌唱・劇中音楽は本文側に書くものなので、ここで繰り返さない。`N/A` は、ユーザーが全編無音を明示的に求めた場合に限る。

```text
overall_soundscape: Steady rain taps against the café windows while low room ambience continues underneath. The entrance bell rings once, followed by wet footsteps and the soft scrape of a chair.
```

### `non_diegetic_music`

登場人物には聞こえず観客だけに聞こえるBGMを**英語1〜3文**で書く。楽器編成・テンポ・リズム・強弱の変化に集中し、抽象的なムード語や「感情を高める役割」といった説明は書かない。登場人物に聞こえる歌唱・演奏・ラジオ・テレビ・スマホの音は劇中音であり本文側に書く。BGMがなければ `N/A`。

```text
non_diegetic_music: Sparse piano notes at a slow tempo, joined by sustained low strings that gradually increase in volume before fading out.
```

## 出力の作法

- 完成プロンプトは**そのままコピペできる1つのコードブロック**で出す。フィールド間には空白行を1つ入れる
- 先頭の位置合わせ定型文（I2VA / FL2VA / L2VA / フルリファレンス）は必ず1行目に置き、その後に空白行を1つ入れてからフィールド本体に入る
- コードブロックの外に、日本語で「モード判定の根拠」「尺とショット構成」「カメラワークの意図」を数行で添える。ユーザーが調整したい箇所を見つけやすくする
- 既存プロンプト（Wan2.2 / Sora / Veo 形式など）の変換依頼では、元の意図を保ったままH3の構造に載せ替える。元プロンプトに音の指定がなければ、映像から自然に導ける音を補って2つの音フィールドを必ず埋める

## よくある失敗

- **音フィールドを空にする** — H3は音を同時生成するので、指定しないと勝手な音が乗る。`N/A` は明示的な要求がある場合のみ
- **`<d>` の中に話者情報や言い方を入れる** — IDも「〜と叫ぶ」もすべて外側
- **短い尺にカットを詰め込む** — 5秒に4ショットは破綻する。寄り引きはカメラワークで解決する
- **振れ幅・速度を全カメラワークに付ける** — 中程度・通常速度は書かない方が正しく出る
- **内面・感情の描写** — 見えるもの・聞こえるものだけに変換する
- **キーフレーム画像の静止描写を並べるだけ** — FL2VA / L2VA で最も多い失敗。画像間を**どう動いて繋ぐか**が本体

## リファレンス

- `references/base-modes.md` — T2VA / I2VA / FL2VA / L2VA の完全仕様。先頭定型文、フィールド構成、キーフレームの組み込み方、4モードの完成例
- `references/full-reference.md` — フルリファレンスモードの完全仕様。6セクション構成、`<Subject N>` 等4種のラベル、タスクタイプ、保持関係マーカー、完成例

## 出典と更新

本スキルの仕様は MiniMax 公式のプロンプトガイドに基づく。原文（Markdown生データ、そのまま取得できる）：

| 対応リファレンス | 原文URL |
|---|---|
| `references/base-modes.md` | https://huggingface.co/MiniMaxAI/MiniMax-H3/resolve/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md |
| `references/full-reference.md` | https://huggingface.co/MiniMaxAI/MiniMax-H3/resolve/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md |

ドキュメント一覧（新しいガイドが追加されていないかの確認用）：
https://huggingface.co/MiniMaxAI/MiniMax-H3/tree/main/docs

**更新手順** — ユーザーが「H3のガイドが更新された」「仕様を最新にして」等と言った場合、または定型文が効かなくなったという報告があった場合：

1. 上記2つのURLを取得する
2. 特に次の項目を差分確認する。ここが変わると出力が壊れる
   - 先頭の位置合わせ定型文3種（I2VA / FL2VA / L2VA）の文字列
   - フィールド名（`integrated_multimodal_description` / `subject_definitions` / `retention_analysis` など）
   - カメラワーク語彙表の値
   - 保持関係マーカー（`fully_preserved` / `fully_copy` など）とタスクタイプ名
   - `<d>` `<scenetrans>` `<cutoff>` などのタグ記法
3. 変更があった箇所だけ該当リファレンスに反映する。作例は書式が変わった場合のみ直す

`resolve/main/` のURLは常に最新リビジョンを返すため、固定リビジョンで確認したい場合は `main` をコミットハッシュに置き換える。
