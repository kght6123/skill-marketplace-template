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

## 添付
画像は `--attach "out/before_items.png#変更前：商品一覧"` のように `#` の後に「変更前/後：画面名」を書く。
動画は `#` を付けない（`--attach out/after_flow.mp4`）。付けると `cannot set alt text on video` で失敗する。動画の説明は本文の「画面」節に文で書く。
ファイル名も `before_*` / `after_*` に揃え、本文の「画面」節で前後が並ぶようにする。
上限：画像10MB、動画100MB（有料プラン）。
個人情報・本番データ・トークンが写っていないか確認してから添付する。開発用のダミーデータで撮る。
