---
name: composition-picker
description: AIイラスト（Anima / SDXL / Illustrious / NoobAI / waiANIMA）の構図を、Danbooruの構図・ポーズ系タグからランダム提案→選ぶかスキップを繰り返すだけで決められる対話型スキル。ユーザーが「構図を決めたい」「構図を選びたい」「次のイラストの構図どうしよう」「構図ガチャ」「ポーズを提案して」「アングルを決めたい」「composition picker」などと言ったら必ず使う。ショットサイズ・カメラアングル・ポーズ・視線・画面配置・演出で迷っているとき、プロンプト作成前に絵の組み立てを固めたいときにも積極的に使う。画風を決めたいときは art-style-picker を使う。
---

# 構図ピッカー

構図を考えるのは時間がかかるので、ユーザーは「出された候補から選ぶ／スキップする」だけで済むようにする。考えるのはClaudeの役割、ユーザーは選ぶだけ。

## 流れ

カテゴリ順に1ラウンドずつ進める（全6ラウンド、途中で終了可）:

1. `shot` ショットサイズ（どこまで写すか）
2. `angle` カメラアングル
3. `pose` ポーズ
4. `direction` 視線・体の向き
5. `layout` 画面配置
6. `effect` 演出・レンズ効果

各ラウンドで:

1. 候補を引く:
   `python <skill-dir>/scripts/pick.py --category <cat> --n 4 --exclude "<これまで提示したタグ>"`
   （スクリプトが使えない環境では `references/compositions.tsv` を読み、自分でランダムに4つ選ぶ）
2. AskUserQuestion で提示する。各optionは
   - label: 日本語名（例「あおり」）
   - description: `タグ` ＋ 一言解説（例 `from below` — 下から見上げる。迫力・存在感）
   `shot` と `angle` は1つに絞らないと絵が破綻しやすいので `multiSelect: false`、それ以外は `multiSelect: true`。
   質問文にラウンド番号とカテゴリを入れ、「Other」欄で「スキップ」「別の候補」「ここで終了」と打てることを一言添える。
3. 回答の扱い:
   - 選択あり → 採用リストに追加して次へ
   - 「スキップ」→ 何も足さず次へ
   - 「別の候補」「引き直し」→ 同じカテゴリで除外付きで再抽選
   - 「終了」→ まとめへ
   - 自由入力で構図の希望が書かれたら、タグに直して採用する

既に選んだものと物理的に両立しない候補は引き直して避ける（例: `face` 採用後の `full body` 系ポーズ、`sitting` 採用後の `jumping`、`from behind` 採用後の `looking at viewer` は `looking back` に寄せる）。破綻する組み合わせを出しても選ぶ手間が増えるだけなので。

AskUserQuestion が無い環境では、番号付きリスト（1〜4＋「s:スキップ」「r:引き直し」「q:終了」）をテキストで出し、返事を待つ。

## まとめ

1. 採用した構図の一覧（日本語名と一言の狙い）
2. 完成イメージを2〜3文で（どこから、どんな姿勢の子を、どう切り取った絵か）
3. コピペ用タグ（SDXL系・Anima系共通、スペース区切り・カンマ区切り）。並びは shot → angle → pose → direction → layout → effect の順にすると効きが安定しやすい。
   例 `cowboy shot, from below, leaning forward, looking at viewer, rule of thirds, depth of field`
4. 相性メモ（効きにくいタグの重み付け `(tag:1.2)` 案や、ControlNet/OpenPoseを使った方が早いポーズがあれば1〜2行）

最後に「このままキャラ込みのプロンプトにする？」と一言聞く。art-style-picker で画風も決めていれば両方まとめ、ひよりあかね用なら hiyori-prompt-craft スキルに引き継いで完成プロンプトを作れる。

## メモ

- 候補は全年齢向けの一般的な構図・ポーズタグに限る。
- 候補を増やしたいときは `references/compositions.tsv` に行を追加するだけでよい（列: category, tag, ja_name, description）。
