`orch-run` スキルを **tick モード** で実行してください。

引数: `$ARGUMENTS`

理解メモのサイクルを1周します。

1. `orch sync` で GitHub の差分とスタンプを読む
2. `orch queue` で行列の空きを確認する
3. `orch next --mode memo` で対象を決める（空なら終了）
4. 各件を `orch-issue-memo` に渡して生成 → `orch lint memo` → `orch post`

`orch next` が返した件数と対象以外には手を出さないでください。
lint が exit 2 を返したら作り直し（最大2回）、通らなければ `needs-human` にして止めます。
