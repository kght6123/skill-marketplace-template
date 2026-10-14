# 3Blue1Brown風の解説動画（Manim）

3Blue1Brownは数学をアニメーションで解説するYouTubeチャンネル。作者のGrant Sandersonは、
そのために作ったPythonライブラリ Manim を公開している（ここではコミュニティ版 `manim` を使う）。
「3Blue1Brown風」とは次の特徴を指す。

- 暗い背景（ほぼ黒）に、少数の明るい色（青・黄・緑・赤）。
- 要素が1つずつ現れ、変形して次の状態へつながる。画面を一度に切り替えない。
- 1場面に1つの考え。今話していない要素は薄くするか消す。
- 図形・矢印・数式・短いラベルで説明し、長い文を画面に出さない。

## Issue/PRでの使い方
- 長さは30〜90秒、場面は4〜7つ。
- 音声は付けない。ナレーション台本を各場面の下部に字幕（1〜2行）として出す。GitHub上では無音で再生されることが多いため。
- 構成の型：①今の状態 ②問題/変更の要点 ③新しい流れ（Mermaid図と同じ要素を動かす） ④影響範囲 ⑤確認方法の一言。
- Mermaid図と同じ用語・同じ色の対応を使う。読者が図と動画を結び付けられるようにする。

## 書き方
- 日本語フォントを指定する（例：`Text("…", font="Noto Sans CJK JP")`）。無いと文字化けする。
- `Text` を使い、`Tex`/`MathTex` は数式が必要なときだけ使う（LaTeX環境が要るため）。
- `self.play(FadeIn(...))`, `Transform`, `Create`, `Indicate` を中心にする。各 `run_time` は0.5〜1.5秒。
- 1クラス（`class Explain(Scene)`）にまとめる。

## 雛形
```python
from manim import *
FONT = "Noto Sans CJK JP"

class Explain(Scene):
    def caption(self, s):
        t = Text(s, font=FONT, font_size=28).to_edge(DOWN)
        self.play(FadeIn(t), run_time=0.4)
        return t

    def construct(self):
        self.camera.background_color = "#0f0f14"
        title = Text("承認の流れ", font=FONT, font_size=44, color=YELLOW)
        cap = self.caption("登録された情報は、まず承認待ちになる。")
        self.play(Write(title)); self.wait(1)
        a = RoundedRectangle(width=3, height=1, color=BLUE).shift(LEFT*3)
        b = RoundedRectangle(width=3, height=1, color=GREEN).shift(RIGHT*3)
        la = Text("承認待ち", font=FONT, font_size=28).move_to(a)
        lb = Text("承認済み", font=FONT, font_size=28).move_to(b)
        self.play(FadeOut(title), Create(a), Write(la))
        self.play(GrowArrow(Arrow(a.get_right(), b.get_left())), Create(b), Write(lb))
        self.play(FadeOut(cap)); cap = self.caption("確認できたら、承認済みになる。")
        self.wait(2)
```

レンダリングは `scripts/render_manim.sh explain.py Explain` を使う。
