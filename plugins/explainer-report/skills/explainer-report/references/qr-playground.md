# HTML/CSS の成果物を QR とリンクで試せるようにする

成果物が HTML と CSS だけでできているとき、読者がその場で動かせるように QR 画像と URL を付ける。
読み取り先は [Tailwind QR Playground](https://github.com/kght6123/tailwind-qr-playground)。
コードは URL そのものに入り、保存先のサーバーは無い。プレイグラウンドでは編集もできる。
（kght6123/tailwindcss-v4-matome の `tools/qr/` と同じ CLI を使う）

## 付ける場面
次の全部に当てはまるときだけ付ける。当てはまらなければ付けず、スクショと画面録画だけにする。
- 成果物が HTML/CSS（静的なページ、UI 部品、メール文面、Tailwind のサンプルなど）。
- JS が無くても見た目が成り立つ。`<script>`（Tailwind の読み込みは除く）やイベント属性があれば対象外。
- 見せたいものが画像・外部フォント・外部 CSS に頼っていない（プレイグラウンドは外部の資源を読まない）。

React/Vue などのコンポーネントや、サーバーで描画するテンプレートは対象外。描画後の HTML を
別に用意しても、それは成果物そのものではないため、付けない。

## 作る
```bash
python3 scripts/qr_sample.py path/to/page.html out/qr_page.png --title "承認フローのカード"
# 別ファイルの CSS を足す：--css path/to/extra.css（複数可）
```
- 完全な HTML 文書を渡してよい。`<body>` の中身を HTML に、`<style>` とローカルの `<link rel="stylesheet">` を CSS にまとめる。Tailwind を読む `<script>` は外す（プレイグラウンドは Tailwind 4.3.3 を内蔵している）。
- JS を含むと終了コード 2 で止まる。そのときは QR を付けない。
- 結果は標準出力の JSON：`png`（QR 画像）、`url`（1枚目の QR の URL）、`qrCount`、`warnings`。
- `warnings` に画像やリンクの警告が出たら、プレイグラウンドでは表示が違うことを本文に書く。
- `qrCount` が 1 なら、`url` を開くだけでコード全体が復元される。2 以上なら、URL を開いたあと残りの QR を読む必要があるので、本文にそう書く。見せたいところだけの HTML に分けて 1 枚に収まるなら、分けた方が読者は楽になる。ただし成果物のコードを勝手に削らない。
- 初回は `npx` が CLI を取得する（Node.js 22.12 以上と Git が要る）。隣にクローンがあれば `QR_CLI=../tailwind-qr-playground/cli/index.mjs` でそれを使える。

## 確かめる
1. `png` を開き、タイトルが欠けていないか確かめる。
2. `url` をブラウザで開き、プレビューが成果物と同じに見えるか確かめる（スクショを撮って並べてもよい）。

## 置き方
「画面」節に、QR 画像とリンクを並べる。
```markdown
### 試す（Tailwind QR Playground）
[プレイグラウンドで開く](<url>)：ブラウザで開くと、コードの編集とプレビューができる。
![QR：承認フローのカード](assets/qr_page.png)
```
- gh では QR 画像を `--attach "./out/qr_page.png#QR：承認フローのカード"` で添付する。リンクは本文に書く。
- URL は長い（数百文字）。表やコードブロックに入れず、リンクの文字にする。
- コードは暗号化されず、URL を知る人は誰でも復元できる。社外秘のコード・文言・データを含む成果物には付けない。
