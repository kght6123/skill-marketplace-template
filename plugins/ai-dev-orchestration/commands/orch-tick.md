`orch-run` スキルを **tick モード**（理解メモのサイクル）で実行してください。

引数: `$ARGUMENTS`

手順は `orch-run` スキルに書いてあるものが唯一の正です。ここには書きません。
二重に書くと、片方だけが古くなって `--claim` のような安全策が抜け落ちます。

スキルの「tick（理解メモのサイクル）」の節をそのまま実行してください。特に:

- `orch next --mode memo --claim` で予約を取ってから処理する
- `action` ごとに手順が違う（`sizing` と `create-children` は lint も post もしない、
  理解メモは `lint memo`、分割案は `lint split`）
- 取った予約は `orch lease release` で返す
