# 出力先：markdown（ローカルの .md レポート）

調査結果、設計案、障害報告などをローカルのMarkdownファイルにまとめるときの「出す」手順。
GitHub・VS Code・Obsidian などのプレビューで、図と画像がそのまま見られる形にする。

## 置き場所
1つのレポートを1つのフォルダにまとめる。フォルダごと渡せば、そのまま読める。

```
reports/<YYYY-MM-DD>-<短い名前>/
  README.md        … 本文（Mermaidはコードブロックのまま書く）
  assets/
    explain.mp4    … 解説動画
    before_*.png / after_*.png / *.mp4  … スクショ・画面録画
    diagram-*.svg  … Mermaidを描画できない読者向けの図（任意）
```

フォルダの場所をユーザーが指定しなければ、リポジトリ内なら `reports/`、それ以外ならカレントディレクトリに作る。

## 書き方
- 画像は相対パスで埋め込む：`![変更後：商品一覧](assets/after_items.png)`。`[]` の中に「変更前/後：画面名」を書く。
- 動画は `<video>` で埋め込み、リンクも並べる。`<video>` を描画しないビューアのため。
  ```markdown
  <video src="assets/explain.mp4" controls width="720"></video>

  [解説動画（mp4）](assets/explain.mp4)
  ```
- Mermaidは ```` ```mermaid ```` のコードブロックで書く。Mermaidを描画しない環境で読まれるなら、`mmdc -i README.md -o README.rendered.md` で SVG に置き換えた版も作る。
- ファイルサイズの上限は無い。ただしリポジトリにコミットするなら、動画は数MBに収め、大きいものはコミットしない。

## 仕上げ
1. 本文のリンク切れが無いか確かめる：`grep -o '](assets/[^)]*)' README.md | sed 's/](//;s/)//' | xargs -I{} test -f {} || echo 切れ`（`reports/<…>/` の中で実行する）。
2. 作ったフォルダのパスをユーザーに伝える。
