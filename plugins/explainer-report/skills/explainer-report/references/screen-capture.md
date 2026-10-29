# 画面のスクショと画面録画

## 必要か判断する
次のどれかに当てはまれば撮る。
- 差分に画面に関わるファイルがある（`*.html *.erb *.vue *.tsx *.jsx *.css *.scss`、テンプレート、UIコンポーネント、表示文言）。
- Issueが画面の不具合・見た目の要望・操作の要望。
- 生成物がHTMLやグラフなど目で見るもの。

## 撮るもの
| 対象 | スクショ | 画面録画（mp4） |
|---|---|---|
| 見た目だけの変更（色、配置、文言） | 変更前・変更後 | 不要 |
| 操作の変更（クリック、入力、遷移、モーダル、アニメーション） | 変更前・変更後 | 変更後の操作（必要なら変更前も） |
| バグ修正 | 再現時・修正後 | 再現手順の操作 |
| バグ報告Issue | 再現時 | 再現手順の操作 |
| 要望Issue | 現状 | 現状の操作（流れが論点のとき） |

レスポンシブに関わる変更は、PC幅（1280）とスマホ幅（390）の両方を撮る。

## 変更前を撮る
```bash
git worktree add ../_before origin/<ベースブランチ>   # 変更前を別ディレクトリで起動
# それぞれ別ポートで起動して撮る。撮り終えたら git worktree remove ../_before
```
起動できない（DB等が必要）なら、変更後だけ撮り、本文にその旨を書く。

## コマンド（scripts/capture.py）
```bash
# スクショ（全体）
python scripts/capture.py http://localhost:3000/items out/after_items.png
# スマホ幅
python scripts/capture.py http://localhost:3000/items out/after_items_sp.png --width 390 --height 844
# 操作の画面録画：steps.json に操作を書く
python scripts/capture.py http://localhost:3000/items out/after_flow.mp4 --video --steps steps.json
```
steps.json の例（上から順に実行。`wait` はミリ秒）：
```json
[
  {"click": "text=新規作成"},
  {"fill": ["#title", "テスト商品"]},
  {"click": "button[type=submit]"},
  {"wait": 1000}
]
```
録画は1本30秒程度まで。長い操作は場面ごとに分ける。

## 字幕とナレーションを付ける（画面録画）
操作の意味が画面だけで伝わりにくいときは、ステップに `say` を書く。その操作の時刻に字幕が焼き込まれる。
`--voice` を付けると、同じ時刻にずんだもん（VOICEVOX）の読み上げも入る。付けなければ字幕だけ。
```json
[
  {"say": "新規作成ボタンを押すのだ。", "caption": "新規作成ボタンを押す。", "click": "text=新規作成"},
  {"say": "商品名を入れるのだ。", "fill": ["#title", "テスト商品"]},
  {"say": "保存すると、一覧に戻るのだ。", "click": "button[type=submit]", "wait": 1000}
]
```
```bash
python scripts/capture.py http://localhost:3000/items out/after_flow.mp4 --video --steps steps.json --voice
```
- `say` は読み上げる文。`caption` があれば字幕はそちらにする（字幕は STE 風、読み上げは「〜のだ」でよい）。
- 読み上げの長さは録画の前に測り、読み終わるまで次の操作を待つ。`wait` は読み上げより長く止めたいときだけ書く。
- 1ステップ1文にする。字幕が長いと画面からはみ出るので、1文25文字程度までにする。
- `out/after_flow.srt`（字幕）と `out/after_flow.narration.json`（台本と時刻）も出る。YouTube に上げるときに使う（`references/youtube.md`）。
- VOICEVOX を起動できなければ、字幕だけの動画になる。音声を止めるには `VOICE=off`、話者は `VOICEVOX_SPEAKER` で変える。
- ナレーションを付けたら、本文に `VOICEVOX:ずんだもん` とクレジットを書く。

## 置き方
ファイル名は `before_*` / `after_*` に揃え、レポートの「画面」節で前後が並ぶようにする。
画像には「変更前/後：画面名」の説明を付ける。動画の説明は「画面」節に文で書く。
説明の付け方とサイズの上限は出力先で違う。`references/targets/` の該当ファイルを見る。
個人情報・本番データ・トークンが写っていないか確認してから載せる。開発用のダミーデータで撮る。
