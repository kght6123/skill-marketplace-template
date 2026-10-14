---
name: character-look-picker
description: AIイラスト（Anima / SDXL / Illustrious / NoobAI / waiANIMA）で描く成人女性キャラの外見（髪色・髪型・目・表情・体型・肌・アクセント）を、Danbooruタグからランダム提案→選ぶかスキップを繰り返すだけで決められる対話型スキル。ユーザーが「キャラの見た目を決めたい」「好みの女の子の特徴を選びたい」「外見ガチャ」「髪型や体型を提案して」「キャラデザを決めたい」「character picker」などと言ったら必ず使う。新キャラや今回の女性キャラの容姿で迷っているときにも積極的に使う。画風は art-style-picker、構図は composition-picker の担当。
---

# キャラ外見ピッカー

キャラの見た目を考えるのは時間がかかるので、ユーザーは「出された候補から選ぶ／スキップする」だけで済むようにする。

## 前提：成人女性

このスキルで作るキャラは成人女性。最初のラウンドで年齢感を決め、まとめのタグには必ず `adult` か `mature female` などの成人を示すタグを入れる。幼く見せるタグ（loli、child、petite で幼児体型を狙うもの、school uniform と組み合わせた低年齢表現など）は提案せず、ユーザーが求めても使わない。アニメ絵は年齢が若く見えやすいので、成人タグを明示しておくと生成も安定する。

候補は全年齢で使える外見タグに限る（露出や性的な部位描写のタグは扱わない）。

## 流れ

カテゴリ順に1ラウンドずつ（全8ラウンド、途中で終了可）:

1. `age` 年齢感（ここはスキップ不可。選ばれなければ `adult` を自動採用）
2. `hair` 髪色
3. `hairstyle` 髪型・前髪
4. `eyes` 目
5. `face` 表情・顔のポイント
6. `body` 体型
7. `skin` 肌
8. `accent` アクセント

各ラウンドで:

1. 候補を引く:
   `python <skill-dir>/scripts/pick.py --category <cat> --n 4 --exclude "<これまで提示したタグ>"`
   （使えない環境では `references/looks.tsv` から自分でランダムに4つ選ぶ）
2. AskUserQuestion で提示。label は日本語名、description は `タグ` ＋一言解説。
   `hair` と `skin` は1つに絞るので `multiSelect: false`、他は `multiSelect: true`。
   「Other」欄で「スキップ」「別の候補」「ここで終了」と打てることを一言添える。
3. 回答の扱い：選択→採用して次へ／スキップ→次へ／引き直し→除外付き再抽選／終了→まとめへ／自由入力→タグに直して採用。

矛盾する候補は引き直して避ける（例: `short hair` 採用後の `twintails`、`slender` 採用後の `curvy`、`smile` と `expressionless`）。

## まとめ

1. 採用した特徴の一覧（日本語名と一言）
2. どんな女性かを2〜3文で（第一印象・雰囲気）
3. コピペ用タグ。順番は `1girl, adult(年齢タグ), 髪色, 髪型, 目, 顔, 体型, 肌, アクセント`
   例 `1girl, mature female, silver hair, long hair, swept bangs, golden eyes, tareme, light smile, mole under eye, slender, long legs, pale skin, earrings`
4. 相性メモ（効きにくいタグの重み付け案などがあれば1〜2行）

最後に「画風（art-style-picker）や構図（composition-picker）も決める？」と一言聞く。すでに決めていれば全部まとめた1本のプロンプトにして出す。

## メモ

- 候補を増やしたいときは `references/looks.tsv` に行を追加（列: category, tag, ja_name, description）。
