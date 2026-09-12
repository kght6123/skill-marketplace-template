`orch-run` スキルを **build モード** で実行してください。

引数: `$ARGUMENTS`

実装のサイクルを1周します。

1. `orch sync` で GitHub の差分とスタンプを読む
2. `orch queue` でセルフレビュー待ちの空きを確認する
3. `orch next --mode build` で対象を決める（空なら終了）
4. 各件のワーカー用の指示を書き、`orch worker --key <key> --action <action> --prompt <file>` で起動する
   （ワーカーは各リポジトリの worktree で動くので、そのリポジトリの CLAUDE.md とフックが効く）
5. `orch merge-train` で条件を満たしたPRをマージする

`merged: false` に付いている `reasons` は条件が揃っていない理由です。
理由に納得しても自分でマージしないでください。

マネージャがリポジトリを直接編集しないでください。実装はワーカーの仕事です。
並行させる場合は `limits.parallelWorkers` の範囲で `orch worker` を同時に起動します。
