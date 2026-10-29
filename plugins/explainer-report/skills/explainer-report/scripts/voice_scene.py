"""Manim の解説動画で、字幕・ナレーション・チャプターの時刻を自動でそろえる。
長い動画（ロング版）で、台本の "at" を手で合わせなくてよくするためのもの。

  from voice_scene import VoiceScene, FONT
  class Explain(VoiceScene):
      def construct(self):
          self.chapter("今の流れ")                   # 章の見出しを出す（YouTube のチャプターにもなる）
          self.say("今は承認待ちで止まるのだ。", caption="今は承認待ちで止まる。")
          self.play(Create(box))                      # 読み上げ中に動かしてよい
          self.say("次の文なのだ。")                  # 前の読み上げが終わるまで待ってから次の字幕を出す

render_manim.sh で描画すると、台本（<出力先>.narration.json）と字幕（.srt）が自動で出る。
--voice を付けたときは VOICEVOX で各文の長さを測り、読み終わるまで次の字幕を出さない。
付けないときは文字数から長さを見積もる。
"""
import json, os, sys
from manim import DOWN, YELLOW, FadeIn, FadeOut, Scene, Text, Write, config
import narrate

FONT = os.environ.get("MANIM_FONT", "Hiragino Sans" if sys.platform == "darwin" else "Noto Sans CJK JP")
VOICE = os.environ.get("EXPLAINER_VOICE") == "1"  # render_manim.sh が VOICEVOX を起動できたときだけ 1
SPEAKER = int(os.environ.get("VOICEVOX_SPEAKER", 3))

class VoiceScene(Scene):
    caption_size = 28

    def setup(self):
        self.camera.background_color = "#0f0f14"
        self._lines, self._cap, self._until, self._chapter = [], None, 0.0, None

    def _length(self, text):
        return narrate.timeline([{"text": text}], SPEAKER, VOICE, quiet=True)[0][2]

    def wait_voice(self):
        """今の読み上げが終わるまで待つ。"""
        rest = self._until - self.time
        if rest > 0.02: self.wait(rest)

    def say(self, text, caption=None, chapter=None):
        """字幕を出し、読み上げを始める。読み上げの間に self.play で図を動かせる。"""
        self.wait_voice()
        item = {"text": text, "at": round(self.time, 2)}
        if caption: item["caption"] = caption
        if chapter: item["chapter"] = chapter
        elif self._chapter: item["chapter"], item["chapter_at"] = self._chapter; self._chapter = None
        self._lines.append(item)
        cap = Text(caption or text, font=FONT, font_size=self.caption_size)
        if cap.width > config.frame_width - 1: cap.scale_to_fit_width(config.frame_width - 1)
        cap.to_edge(DOWN)
        self.play(FadeIn(cap), *([FadeOut(self._cap)] if self._cap else []), run_time=0.3)
        self._cap = cap
        self._until = item["at"] + self._length(text) + narrate.GAP

    def chapter(self, title):
        """画面を片付けて章の見出しを出す。次の say がその章の始まりになる。"""
        self.wait_voice()
        start = round(self.time, 2)
        rest = [m for m in self.mobjects if m is not self._cap]
        if self._cap: rest.append(self._cap); self._cap = None
        if rest: self.play(*[FadeOut(m) for m in rest], run_time=0.6)
        t = Text(title, font=FONT, font_size=48, color=YELLOW)
        self.play(Write(t), run_time=0.8); self.wait(0.6); self.play(FadeOut(t), run_time=0.4)
        self._chapter = (title, start)

    def tear_down(self):
        self.wait_voice(); self.wait(0.5)
        out = os.environ.get("NARRATION_OUT")
        if out and self._lines:
            with open(out, "w", encoding="utf-8") as f: json.dump(self._lines, f, ensure_ascii=False, indent=2)
