`orch-run` スキルを **build モード** で実行してください。

引数: `$ARGUMENTS`

実装のサイクルを1周します。

1. `orch sync` で GitHub の差分とスタンプを読む
2. `orch queue` でセルフレビュー待ちの空きを確認する
3. `orch next --mode build` で対象を決める（空なら終了）
4. `orch-implement` に渡して実装 → AIレビュー → PR作成
5. `orch merge-train` で条件を満たしたPRをマージする

`merged: false` に付いている `reasons` は条件が揃っていない理由です。
理由に納得しても自分でマージしないでください。
