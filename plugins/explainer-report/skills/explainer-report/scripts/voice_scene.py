"""Manim の解説動画で、字幕・ナレーション・チャプター・効果音の時刻を自動でそろえ、文字のはみ出しを検査する。

  from voice_scene import VoiceScene, FONT, screenshot
  class Explain(VoiceScene):
      def construct(self):
          self.chapter("今の流れ")                   # 章の見出しを出す（YouTube のチャプターにもなる）
          self.say("申請を差し戻せるのだ。", caption="申請を差し戻せる。")
          self.wait_word("差し戻")                   # 「差し戻」を読み始める時刻まで待つ
          self.sfx("pop"); self.play(GrowArrow(arrow))  # その言葉と同時に矢印を出し、効果音を鳴らす
          self.say("次の文なのだ。")                  # 前の読み上げが終わるまで待ってから次の字幕を出す

render_manim.sh で描画すると、次のファイルが自動で出る（<出力先> は mp4 の拡張子を除いた名前）。
  <出力先>.narration.json  台本と時刻      <出力先>.srt  字幕
  <出力先>.sfx.json        効果音の時刻    <出力先>.layout.json  文字のはみ出し・重なりの警告
--voice を付けたときは VOICEVOX で各文と各単語の時刻を測る。付けないときは文字数から見積もる。
"""
import json, os, sys
from manim import (DOWN, WHITE, YELLOW, BackgroundRectangle, FadeIn, FadeOut, Group, ImageMobject, MarkupText,
                   Paragraph, Scene, SurroundingRectangle, Text, VGroup, Write, config)
import narrate

FONT = os.environ.get("MANIM_FONT", "Hiragino Sans" if sys.platform == "darwin" else "Noto Sans CJK JP")
VOICE = os.environ.get("EXPLAINER_VOICE") == "1"  # render_manim.sh が VOICEVOX を起動できたときだけ 1
SPEAKER = int(os.environ.get("VOICEVOX_SPEAKER", 3))
TEXTS = (Text, MarkupText, Paragraph)

def _visible(m):  # ImageMobject などは不透明度を持たないので、見えているものとして扱う
    try: return m.get_fill_opacity() + m.get_stroke_opacity() > 0.05
    except AttributeError: return True

def screenshot(path, width=9, border=WHITE):
    """スクショ（capture.py で撮ったもの）を枠付きで置く。寄るときは .animate.scale() と move_to() を使う。"""
    img = ImageMobject(path); img.width = width
    return Group(img, SurroundingRectangle(img, color=border, buff=0.04, stroke_width=2))

class VoiceScene(Scene):
    caption_size = 28

    def setup(self):
        self.camera.background_color = "#0f0f14"
        self._lines, self._sfx, self._layout = [], [], []
        self._cap, self._until, self._chapter, self._line = None, 0.0, None, None

    def _length(self, text):
        return narrate.timeline([{"text": text}], SPEAKER, VOICE, quiet=True)[0][2]

    def wait_voice(self):
        """今の読み上げが終わるまで待つ。"""
        rest = self._until - self.time
        if rest > 0.02: self.wait(rest)

    def wait_word(self, word):
        """今の文の中で word を読み始める時刻まで待つ。その直後の play がその言葉と同時に動く。"""
        start, text = self._line
        rest = start + narrate.offset(text, word, SPEAKER, VOICE) - self.time
        if rest > 0.02: self.wait(rest)

    def sfx(self, name, gain=None):
        """今の時刻に効果音を置く（pop / tick / whoosh / thud / chime）。--sfx を付けて描画したときだけ鳴る。"""
        if name not in narrate.SFX: raise ValueError(f"効果音は {list(narrate.SFX)} のどれか")
        self._sfx.append({"at": round(self.time, 2), "name": name, **({"gain": gain} if gain is not None else {})})

    def say(self, text, caption=None, chapter=None):
        """字幕を出し、読み上げを始める。読み上げの間に self.play で図を動かせる。"""
        self.wait_voice()
        item = {"text": text, "at": round(self.time, 2)}
        if caption: item["caption"] = caption
        if chapter: item["chapter"] = chapter
        elif self._chapter: item["chapter"], item["chapter_at"] = self._chapter; self._chapter = None
        self._lines.append(item); self._line = (item["at"], text)
        words = Text(caption or text, font=FONT, font_size=self.caption_size)
        if words.width > config.frame_width - 1: words.scale_to_fit_width(config.frame_width - 1)
        # 明るい画面の上でも読めるように、字幕の後ろに暗い帯を敷く
        cap = VGroup(BackgroundRectangle(words, color="#0f0f14", fill_opacity=0.8, buff=0.12), words).to_edge(DOWN)
        old, self._cap = self._cap, cap
        self.play(FadeIn(cap), *([FadeOut(old)] if old else []), run_time=0.3)
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

    def play(self, *args, **kwargs):
        super().play(*args, **kwargs)
        self._check()

    def _check(self):
        """画面の外にはみ出した文字、字幕にかぶった物、重なった文字を記録する。"""
        w, h = config.frame_width / 2, config.frame_height / 2
        texts = [t for m in self.mobjects for t in m.get_family() if isinstance(t, TEXTS) and _visible(t)]
        def box(m): return m.get_left()[0], m.get_right()[0], m.get_bottom()[1], m.get_top()[1]
        def hit(a, b): return a[0] < b[1] and b[0] < a[1] and a[2] < b[3] and b[2] < a[3]
        def say(kind, m, other=None):
            name = lambda x: (getattr(x, "text", "") or type(x).__name__)[:20]
            msg = {"at": round(self.time, 2), "kind": kind, "text": name(m)}
            if other is not None: msg["with"] = name(other)
            if not any(x["kind"] == kind and x["text"] == msg["text"] and x.get("with") == msg.get("with") for x in self._layout[-20:]):
                self._layout.append(msg)
        for t in texts:
            l, r, b, top = box(t)
            if l < -w or r > w or b < -h or top > h: say("画面の外にはみ出している", t)
        if self._cap:
            cb = box(self._cap)
            for m in self.mobjects:
                if m is not self._cap and _visible(m) and hit(box(m), cb):
                    say("字幕にかぶっている", m)
        capfam = set(self._cap.get_family()) if self._cap else set()
        others = [t for t in texts if t not in capfam]
        for i, a in enumerate(others):
            for b in others[i + 1:]:
                if a not in b.get_family() and b not in a.get_family() and hit(box(a), box(b)):
                    say("文字どうしが重なっている", a, b)

    def tear_down(self):
        self.wait_voice(); self.wait(0.5)
        out = os.environ.get("NARRATION_OUT")
        if not out: return
        base = out.removesuffix(".narration.json")
        for path, data in ((out, self._lines), (base + ".sfx.json", self._sfx), (base + ".layout.json", self._layout)):
            with open(path, "w", encoding="utf-8") as f: json.dump(data, f, ensure_ascii=False, indent=2)
        for x in self._layout: print(f"layout: {x['at']:6.1f}s {x['kind']}: {x['text']}" + (f" / {x['with']}" if "with" in x else ""))
