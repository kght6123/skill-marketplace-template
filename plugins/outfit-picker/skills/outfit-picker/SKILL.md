---
name: outfit-picker
description: AIイラスト（Anima / SDXL / Illustrious / NoobAI / waiANIMA）で描く成人女性キャラの服装を、Danbooruの衣装タグからランダム提案→選ぶかスキップを繰り返すだけで決められる対話型スキル。ユーザーが「服装を決めたい」「衣装を選びたい」「コーデを考えて」「服装ガチャ」「衣装ガチャ」「今回の服どうしよう」「outfit picker」などと言ったら必ず使う。テーマ衣装・トップス・ボトムス・靴・小物・色柄で迷っているときにも積極的に使う。外見は character-look-picker、画風は art-style-picker、構図は composition-picker の担当。
---

# 服装ピッカー

コーデを考えるのは時間がかかるので、ユーザーは「出された候補から選ぶ／スキップする」だけで済むようにする。

## 前提

成人女性キャラ向け。候補は全年齢で使える普通の服装タグに限る（露出目的の衣装や下着は扱わない）。学校制服系は年齢が幼く見えやすいので提案しない。まとめのタグには成人を示すタグ（外見ピッカーで決めた年齢タグ、なければ `adult`）を入れる。

## 流れ

1. `theme` テーマ衣装（メイド・着物・ゴスロリ等）
   - テーマ衣装を選んだら、それだけで全身が決まるので 2〜5（top/bottom/onepiece/outer）は飛ばして `legwear` へ。
   - スキップしたら普段着コーデとして 2 へ。
2. `top` トップス
3. `bottom` ボトムス — ここで「ワンピースにしたい」と言われたら `onepiece` から引く（top と bottom は採用しない）
4. `outer` アウター
5. `legwear` 脚元
6. `shoes` 靴
7. `item` 小物
8. `color` 色・柄

各ラウンドで:

1. 候補を引く:
   `python <skill-dir>/scripts/pick.py --category <cat> --n 4 --exclude "<これまで提示したタグ>"`
   （使えない環境では `references/outfits.tsv` から自分でランダムに4つ選ぶ）
2. AskUserQuestion で提示。label は日本語名、description は `タグ` ＋一言解説。
   theme/top/bottom/onepiece/outer/legwear/shoes は1つに絞るので `multiSelect: false`、item と color は `multiSelect: true`。
   第3ラウンドの選択肢の1つは「ワンピースにする」にしてよい。「Other」欄で「スキップ」「別の候補」「ここで終了」と打てることを一言添える。
3. 回答の扱い：選択→採用して次へ／スキップ→次へ／引き直し→除外付き再抽選／終了→まとめへ／自由入力→タグに直して採用。

テーマと合わない候補は引き直す（例: `kimono` に `sneakers`、`yukata` に `thighhighs`、`armor` に `sandals`）。和装なら `geta` や `sandals`、ドレスなら `high heels` のように合うものを優先して混ぜる。

## まとめ

1. 採用アイテムの一覧（日本語名と一言）
2. どんなコーデかを2〜3文で（シーン・雰囲気）
3. コピペ用タグ。順番は `テーマ, トップス, ボトムス/ワンピース, アウター, 脚元, 靴, 小物, 色柄`。色を個別に効かせたいときは `white shirt, black pleated skirt` のように色をアイテムに直接付けた形も併記する（色が別の服に移りにくくなる）。
   例 `casual, off-shoulder shirt, long skirt, cardigan, sandals, sun hat, pastel clothes`
4. 相性メモ（色移り対策や重み付け案があれば1〜2行）

最後に「外見（character-look-picker）・画風・構図も決める？」と一言聞く。すでに決めたものがあれば全部まとめて1本のプロンプトにする。

## メモ

- 候補を増やしたいときは `references/outfits.tsv` に行を追加（列: category, tag, ja_name, description）。
