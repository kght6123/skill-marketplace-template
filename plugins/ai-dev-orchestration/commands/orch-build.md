`orch-run` スキルを **build モード**（実装のサイクル）で実行してください。

引数: `$ARGUMENTS`

手順は `orch-run` スキルに書いてあるものが唯一の正です。ここには書きません。
二重に書くと、片方だけが古くなって `--claim` や `--lease` が抜け落ちます。

スキルの「build（実装のサイクル）」の節をそのまま実行してください。特に:

- `orch next --mode build --claim` で予約を取ってから起動する
- `orch worker --key … --action … --prompt … --lease <leaseId>` で予約を渡す
  （成否にかかわらず返り、走っている間に人間が止めたかどうかも確認される）
- マージは `orch merge-train` だけ。`reasons` に納得しても自分でマージしない
