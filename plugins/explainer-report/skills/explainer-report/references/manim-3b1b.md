# 3Blue1Brown風の解説動画（Manim）

3Blue1Brownは数学をアニメーションで解説するYouTubeチャンネル。作者のGrant Sandersonは、
そのために作ったPythonライブラリ Manim を公開している（ここではコミュニティ版 `manim` を使う）。
「3Blue1Brown風」とは次の特徴を指す。

- 暗い背景（ほぼ黒）に、少数の明るい色（青・黄・緑・赤）。
- 要素が1つずつ現れ、変形して次の状態へつながる。画面を一度に切り替えない。
- 1場面に1つの考え。今話していない要素は薄くするか消す。
- 実物（スクショ・コード・ログ）と、それを指す図形・矢印で説明し、長い文を画面に出さない。箱とラベルだけで作らない。

**Manim のスクリプトを書く前に、`references/storyboard.md` で絵コンテ表を作る。** 何を描けば分かるか（6つの描き方、描かない判断、1カットごとの3つの問い）、安く確認できる段階、描画後の見直しはそこに書いてある。

## 長さ：標準とロング
ユーザーが「ロング版」「長めに」「詳しい動画」「時間がかかってもいい」などと言ったらロングにする。言わなければ標準にする。

| | 標準 | ロング |
|---|---|---|
| 長さ | 30〜90秒 | 5〜15分 |
| 章 | なし（場面4〜7つ） | 5〜10章（各章に場面2〜5つ。1章30秒〜2分） |
| 書き方 | `VoiceScene` | `VoiceScene` |
| 確認 | 絵コンテ表と静止画を自分で確かめる | 絵コンテ表と静止画をユーザーに見せる（`references/storyboard.md` 第6節） |
| ナレーション | 任意 | 付ける（ユーザーが断ったときだけ外す） |
| 置き場所 | Issue/PR に添付 | YouTube も勧める（チャプターが付き、100MB の上限も無い。`references/youtube.md`） |

### ロングの構成
標準の5つの型を、章に広げる。どの章も「この章で分かること」を1文で言ってから始め、最後に1文でまとめる。
1. **背景と目的**：何に困っていたか、誰のための変更か。
2. **全体像**：変更前と変更後の流れを1枚で比べる（Mermaid 図と同じ要素）。
3. **変更点ごとの詳しい説明**：1つの変更点を1章にする。前の状態 → 変えたところ（短いコードの抜粋は `Code` で見せる）→ 後の状態。
4. **設計の判断**：選んだ案と、選ばなかった案と、その理由。
5. **影響範囲と注意**：変わるもの、変わらないもの、移行の手順。
6. **確かめ方**：確認の手順、テスト、画面録画で見せた操作の要点。
7. **まとめ**：章ごとの要点を1行ずつ振り返る。

- 先に章立てと台本（文の一覧）を書き、レポートの事実メモと突き合わせる。事実メモに無いことを足さない。
- 1文は字幕で30文字程度まで。長い説明は文を分ける。
- 描画に時間がかかるので、まず `QUALITY=l` の下書きで流れと時刻を確かめてから、本番（既定の720p）を描画する。Manim は描画済みのアニメーションを再利用するので、直した章だけが描き直される。

## Issue/PRでの使い方
- 長さは「長さ：標準とロング」の表に従う。標準なら30〜90秒、場面は4〜7つ。
- 字幕は必ず出す。GitHub上では無音で再生されることが多いため。
- ナレーションは任意（Karpathy氏の原文は音声付きを想定）。付けるときはローカルTTS（VOICEVOX）で場面ごとに読み上げ、`scripts/narrate.py` で動画と合成する。有料APIは使わない。
- 構成の型：①今の状態 ②問題/変更の要点 ③新しい流れ（Mermaid図と同じ要素を動かす） ④影響範囲 ⑤確認方法の一言。
- Mermaid図と同じ用語・同じ色の対応を使う。読者が図と動画を結び付けられるようにする。

## 書き方
- 日本語フォントを指定する（例：`Text("…", font="Noto Sans CJK JP")`）。無いと文字化けする。
- `Text` を使い、`Tex`/`MathTex` は数式が必要なときだけ使う（LaTeX環境が要るため）。
- `self.play(FadeIn(...))`, `Transform`, `Create`, `Indicate` を中心にする。各 `run_time` は0.5〜1.5秒。
- 1クラス（`class Explain(VoiceScene)`）にまとめる。長いときは章ごとにメソッドを分ける。

## VoiceScene（雛形）
`scripts/voice_scene.py` の `VoiceScene` を継ぐ。`Scene` を直接使うのは、手で書いた台本に合わせるときだけにする。
- `self.say()` を呼んだ時刻が台本の時刻になる。読み上げが終わるまで次の字幕を出さないので、字幕・音声・図がずれない。
- 字幕の後ろに暗い帯を敷くので、明るいスクショの上でも読める。
- `play` のたびに、文字のはみ出し・字幕へのかぶり・文字の重なりを記録する。
`render_manim.sh` が `scripts/` を import できるようにするので、`sys.path` を足さなくてよい。

```python
from manim import *
from voice_scene import VoiceScene, FONT, screenshot

class Explain(VoiceScene):
    def construct(self):
        self.chapter("今の流れ")                    # 画面を片付けて章の見出しを出す。YouTube のチャプターになる
        shot = screenshot("out/before_list.png", width=8)   # 実物の画面から入る
        self.say("申請の一覧で、新しい申請は承認待ちに入るのだ。", caption="新しい申請は、承認待ちに入る。")
        self.play(FadeIn(shot))
        self.wait_word("承認待ち")                  # 「承認待ち」を読み始める時刻まで待つ
        row = SurroundingRectangle(shot, color=YELLOW).stretch_to_fit_height(0.5).shift(UP*1.2)
        self.sfx("pop"); self.play(Create(row))     # その言葉と同時に、その行を指す
        self.say("承認者が見るまで、ここで止まるのだ。", caption="承認者が見るまで、ここで止まる。")   # 前の文を読み終えてから次へ進む
        self.play(Group(shot, row).animate.scale(1.3).shift(UP*0.8), run_time=1)   # 指した行ごと1段寄る（字幕の帯にかからない大きさまで）
        self.chapter("新しい流れ")
        ...
```
```bash
QUALITY=l scripts/render_manim.sh explain.py Explain out/draft.mp4 --sfx    # 下書き（音声なし・長さは文字数から見積もる）
python3 scripts/review_video.py out/draft.mp4 --stills 4,18,40              # 一覧画像・静止画・検査
scripts/render_manim.sh explain.py Explain out/explain.mp4 --voice --sfx    # 本番
```

| 書くこと | 働き |
|---|---|
| `say(text, caption=None, chapter=None)` | 字幕を出して読み上げを始める。`text` は読み上げ、`caption` は字幕（無ければ `text`） |
| `wait_word(word)` | 今の文で `word` を読み始める時刻まで待つ。直後の `play` がその言葉と同時に動く（VOICEVOX の音の長さから計算する） |
| `chapter(title)` | 前の章の図を全部消し、見出しを出す |
| `sfx(name)` | 今の時刻に効果音を置く。`pop`（出現）、`tick`（数が進む）、`whoosh`（寄る・移る）、`thud`（落ち着く・止まる）、`chime`（分かった瞬間）。`--sfx` を付けたときだけ鳴る |
| `screenshot(path, width)` | スクショを枠付きで置く。寄るときは `.animate.scale()` と `.shift()` |

- 効果音は1回の変化に1つ。問い・結論で止める間（描き方⑥）には鳴らさない。
- 出力：`<出力先>.mp4`、`.srt`（字幕）、`.narration.json`（台本と時刻）、`.sfx.json`（効果音の時刻）、`.layout.json`（文字の警告。描画の最後にも表示する）。
- チャプター行：`python3 scripts/narrate.py chapters out/explain.narration.json`（YouTube の概要に貼る）。
- 字幕は `say` が出すので、自前の字幕は書かない。

## ナレーションを付ける場合（オプション）
音声は既定でオフ。`--voice` を付けたときだけ、VOICEVOX のずんだもん（話者ID 3）で読み上げる。
`VoiceScene` を使うなら、下の1・3は要らない（`--voice` だけでよい）。`Scene` を直接使うときは次の手順で台本を手で書く。

1. 台本を `narration.json` に書く。字幕と同じ内容の文を、その字幕を出す時刻（秒）と一緒に書く：
   `[{"text": "このPRは5つのスキルを足すのだ。", "at": 0.5}, ...]`
2. VOICEVOX を起動する：`scripts/voicevox.sh start`。Apple container（`container` コマンド）があれば使い、無ければ docker を使う。イメージは `voicevox/voicevox_engine:cpu-latest`（arm64 対応）。初回はイメージの取得に1〜2分かかる。
3. 各文の長さを確かめる：`python3 scripts/narrate.py durations narration.json`。次の文の `at` より長い文があれば、Manim の `self.wait()` を延ばす。
4. レンダリングと合成を一度に行う：`scripts/render_manim.sh explain.py Explain out/explain.mp4 --voice narration.json`
5. 終わったら止める：`scripts/voicevox.sh stop`

- 音声をオフにする：`--voice` を付けない。または `VOICE=off` を付けて実行する。
- 話者を変える：`VOICEVOX_SPEAKER=1`（ずんだもん あまあま）など。ID は `curl -s localhost:50021/speakers` で調べる。
- ずんだもんで読むときは、台本の語尾を「〜のだ」「〜なのだ」にしてよい。字幕は本文と同じ STE 風の文のままにする。
- 本文の「解説動画」の節に `VOICEVOX:ずんだもん` とクレジットを書く（VOICEVOX とキャラクターの利用規約による）。
- VOICEVOX を起動できなければ、`render_manim.sh` は字幕のみの動画を出力する。その旨をユーザーに伝える。
