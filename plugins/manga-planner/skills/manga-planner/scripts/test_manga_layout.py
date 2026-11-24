import copy
import importlib.util
import json
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("manga_layout", HERE / "manga_layout.py")
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)

EXAMPLES = HERE.parent / "examples"
EXAMPLE = EXAMPLES / "neko-satsuei.spec.json"
MOSS_COMPILER = (HERE.parents[3] / "moss-image-prompt-craft" / "skills" / "moss-image-prompt-craft"
                 / "scripts" / "compile_prompt.py")


def load_example():
    return json.loads(EXAMPLE.read_text(encoding="utf-8"))


def reading_order_ok(panels, reading):
    """日本式の読み順になっているか。columns: 右の列から上→下。rows: 上の段から右→左。"""
    def key(b):
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        return (-cx, cy) if reading == "columns" else None
    if reading == "columns":
        return panels == sorted(panels, key=key)
    for a, b in zip(panels, panels[1:]):
        same_row = a[1] < b[3] and b[1] < a[3]
        if same_row and not b[2] <= a[0]:
            return False
        if not same_row and not b[1] >= a[3]:
            return False
    return True


class LayoutTemplateTests(unittest.TestCase):
    def test_templates_fit_canvas_and_do_not_overlap(self):
        for name, lay in M.load_layouts().items():
            with self.subTest(layout=name):
                W, H = lay["width"], lay["height"]
                self.assertEqual(W % 16, 0)
                self.assertEqual(H % 16, 0)
                self.assertLessEqual(W * H, 4 * 1024 * 1024)  # MOSS の上限 4M 画素
                boxes = [b for page in lay["pages"] for b in page["panels"] + page["titles"]]
                for x0, y0, x1, y1 in boxes:
                    self.assertTrue(0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H)
                for i, a in enumerate(boxes):
                    for b in boxes[i + 1:]:
                        overlap = a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]
                        self.assertFalse(overlap, (a, b))
                for page in lay["pages"]:
                    self.assertTrue(reading_order_ok(page["panels"], lay["reading"]))
                if lay.get("fold"):
                    mid = W / 2
                    for pi, page in enumerate(lay["pages"]):
                        for b in page["panels"]:
                            if b[0] < mid < b[2]:
                                continue  # ページをまたぐ大ゴマ
                            # 1ページ目は右半分、2ページ目は左半分
                            self.assertTrue(b[0] >= mid if pi == 0 else b[2] <= mid, (name, b))
                roles = M.FORMATS[lay["format"]]["roles"]
                if isinstance(roles, list):
                    self.assertEqual(len(M.panel_boxes(lay)), len(roles))


class CheckTests(unittest.TestCase):
    def setUp(self):
        self.layouts = M.load_layouts()
        self.spec = load_example()

    def errors(self, spec):
        return M.check(spec, self.layouts)[0]

    def test_example_is_valid(self):
        self.assertEqual(self.errors(self.spec), [])

    def test_panel_count_must_match_layout(self):
        self.spec["panels"].append(copy.deepcopy(self.spec["panels"][0]))
        self.assertTrue(any("4 コマ必要" in e for e in self.errors(self.spec)))

    def test_role_order_is_kishotenketsu(self):
        self.spec["panels"][2]["role"] = "ketsu"
        self.assertTrue(any("role は 'ten'" in e for e in self.errors(self.spec)))

    def test_speaker_must_be_in_cast(self):
        self.spec["panels"][3]["balloons"][0]["speaker"] = "cat"
        self.assertTrue(any("speaker 'cat'" in e for e in self.errors(self.spec)))

    def test_too_many_balloons(self):
        b = {"speaker": "mina", "type": "normal", "text": "あ"}
        self.spec["panels"][0]["balloons"] = [b, b, b]
        self.assertTrue(any("吹き出しは 2 つまで" in e for e in self.errors(self.spec)))

    def test_too_long_dialogue(self):
        self.spec["panels"][0]["balloons"][0]["text"] = "あ" * 30
        self.assertTrue(any("30 字" in e for e in self.errors(self.spec)))

    def test_line_too_wide_for_panel(self):
        self.spec["panels"][0]["balloons"][0]["text"] = "あ" * 20
        self.assertTrue(any("改行" in e for e in self.errors(self.spec)))
        self.spec["panels"][0]["balloons"][0]["text"] = "あ" * 10 + "\n" + "あ" * 10
        self.assertEqual(self.errors(self.spec), [])

    def test_title_required_for_title_layout(self):
        del self.spec["title"]
        self.assertTrue(any("title を文字列で" in e for e in self.errors(self.spec)))
        self.spec["layout"] = "yonkoma-plain"
        self.assertEqual(self.errors(self.spec), [])

    def test_unknown_character_in_cast(self):
        self.spec["panels"][0]["cast"][0]["id"] = "nobody"
        self.assertTrue(any("'nobody'" in e for e in self.errors(self.spec)))

    def test_flat_direction_warns(self):
        for p in self.spec["panels"]:
            p["shot"], p["angle"] = "medium", "eye-level"
        warnings = M.check(self.spec, self.layouts)[1]
        self.assertTrue(any("全コマが同じ" in w for w in warnings))


class PlacementTests(unittest.TestCase):
    def setUp(self):
        self.layouts = M.load_layouts()
        self.spec = load_example()

    def test_first_speaker_is_on_the_right_and_reads_first(self):
        p = self.spec["panels"][0]
        p["cast"] = list(reversed(p["cast"]))  # 入力順に関係なく、先に話す人を右へ
        p["balloons"] = [
            {"speaker": "mina", "type": "normal", "text": "いた！"},
            {"speaker": "cat", "type": "normal", "text": "にゃ"},
        ]
        placed = M.place(self.spec, self.layouts["yonkoma-title"])[0]
        first, second = placed["balloons"]
        self.assertGreater(first["bbox"][0], second["bbox"][2] - 1)
        right_fig = max(placed["figures"], key=lambda f: f["bbox"][0])
        self.assertEqual(right_fig["member"]["id"], "mina")
        self.assertEqual(first["speaker_side"], "right")

    def test_boxes_stay_inside_their_panel(self):
        for name in [k for k, v in self.layouts.items() if v["format"] == "yonkoma"]:
            spec = copy.deepcopy(self.spec)
            spec["layout"] = name
            for pl in M.place(spec, self.layouts[name]):
                x0, y0, x1, y1 = pl["bbox"]
                for item in pl["balloons"] + pl["figures"] + pl["sfx"]:
                    bx0, by0, bx1, by1 = item["bbox"]
                    with self.subTest(layout=name):
                        self.assertTrue(x0 <= bx0 < bx1 <= x1 and y0 <= by0 < by1 <= y1)


class HachikomaTests(unittest.TestCase):
    def setUp(self):
        self.layouts = M.load_layouts()
        self.spec = json.loads((EXAMPLES / "zaitaku.spec.json").read_text(encoding="utf-8"))

    def test_example_is_valid(self):
        self.assertEqual(M.check(self.spec, self.layouts)[0], [])

    def test_each_strip_needs_kishotenketsu(self):
        self.spec["panels"][4]["role"] = "sho"
        errors = M.check(self.spec, self.layouts)[0]
        self.assertTrue(any("5コマ目" in e and "'ki'" in e for e in errors))

    def test_two_titles_required(self):
        self.spec["title"] = "ひとつだけ"
        errors = M.check(self.spec, self.layouts)[0]
        self.assertTrue(any("2 個のリスト" in e for e in errors))

    def test_right_strip_is_read_first(self):
        placed = M.place(self.spec, self.layouts["hachikoma-title"])
        self.assertGreater(placed[0]["bbox"][0], placed[4]["bbox"][2])

    def test_moss_draft_titles_and_caption(self):
        draft = M.moss_draft(self.spec, self.layouts)
        texts = [i["text"] for i in draft["items"] if i["label"] == "text"]
        self.assertEqual(texts[:2], ["オンライン会議", "昼休み"])
        self.assertIn("right strip first", draft["summary"]["caption"])
        self.assertEqual(sum(1 for i in draft["items"] if i["label"] == "object"), 8)


class PageTests(unittest.TestCase):
    def setUp(self):
        self.layouts = M.load_layouts()
        self.spec = json.loads((EXAMPLES / "jisui.spec.json").read_text(encoding="utf-8"))

    def test_example_is_valid(self):
        self.assertEqual(M.check(self.spec, self.layouts)[0], [])

    def test_roles_must_not_go_backwards(self):
        self.spec["panels"][3]["role"] = "sho"
        self.spec["panels"][2]["role"] = "ten"
        errors = M.check(self.spec, self.layouts)[0]
        self.assertTrue(any("起→承→転→結の順" in e for e in errors))

    def test_all_four_roles_required(self):
        for p in self.spec["panels"][1:4]:
            p["role"] = "sho"
        errors = M.check(self.spec, self.layouts)[0]
        self.assertTrue(any("転 がありません" in e for e in errors))

    def test_big_panel_used_for_sho_warns(self):
        self.spec["layout"] = "page-big-opening-5"
        self.spec["panels"][0]["role"] = "ki"
        roles = ["sho", "sho", "sho", "ten", "ketsu"]
        for p, r in zip(self.spec["panels"], roles):
            p["role"] = r
        self.spec["panels"][0]["role"] = "ki"
        self.assertEqual(M.check(self.spec, self.layouts)[1], [])
        self.spec["layout"] = "page-big-ending-5"
        self.spec["panels"][4]["role"] = "sho"
        self.spec["panels"][3]["role"] = "sho"
        warnings = M.check(self.spec, self.layouts)[1]
        self.assertTrue(any("大ゴマ" in w for w in warnings))

    def test_panel_count_follows_template(self):
        self.spec["layout"] = "page-basic-6"
        errors = M.check(self.spec, self.layouts)[0]
        self.assertTrue(any("6 コマ必要" in e for e in errors))

    def test_moss_caption_describes_page(self):
        draft = M.moss_draft(self.spec, self.layouts)
        self.assertIn("single Japanese manga page with 5 panels", draft["summary"]["caption"])
        self.assertEqual((draft["width"], draft["height"]), (1440, 2032))


class SquarePageTests(unittest.TestCase):
    def setUp(self):
        self.layouts = M.load_layouts()
        self.spec = load_example()  # 4コマの作例を正方形1ページに流し込む
        self.spec["format"] = "page"
        del self.spec["title"]

    def test_sns_template_has_four_square_panels(self):
        panels = self.layouts["page-square-4"]["pages"][0]["panels"]
        sizes = {(b[2] - b[0], b[3] - b[1]) for b in panels}
        self.assertEqual(len(panels), 4)
        self.assertEqual(len(sizes), 1)
        w, h = sizes.pop()
        self.assertEqual(w, h)

    def test_four_panel_story_fits_every_square_template(self):
        for name in ("page-square-4", "page-square-big-ending-4", "page-square-big-opening-4"):
            with self.subTest(layout=name):
                self.spec["layout"] = name
                self.assertEqual(M.check(self.spec, self.layouts)[0], [])
                draft = M.moss_draft(self.spec, self.layouts)
                self.assertEqual((draft["width"], draft["height"]), (1536, 1536))
                self.assertIn("single square Japanese manga page", draft["summary"]["caption"])


class SpreadTests(unittest.TestCase):
    def setUp(self):
        self.layouts = M.load_layouts()
        self.spec = json.loads((EXAMPLES / "amagasa.spec.json").read_text(encoding="utf-8"))

    def warnings(self):
        errors, warnings = M.check(self.spec, self.layouts)
        self.assertEqual(errors, [])
        return warnings

    def test_example_is_valid_without_warnings(self):
        self.assertEqual(self.warnings(), [])

    def test_page_turn_value(self):
        self.spec["page_turn"] = "flip"
        errors = M.check(self.spec, self.layouts)[0]
        self.assertTrue(any("page_turn" in e for e in errors))

    def test_turn_wants_twist_after_the_turn(self):
        self.spec["panels"][5]["role"] = "sho"
        self.assertTrue(any("めくり" in w for w in self.warnings()))

    def test_spread_hides_punchline_on_first_page(self):
        self.spec["page_turn"] = "spread"
        self.assertEqual(self.warnings(), [])
        self.spec["panels"][3]["role"] = "ten"
        for p in self.spec["panels"][4:]:
            p["role"] = "ketsu"
        self.assertTrue(any("見開き" in w for w in self.warnings()))

    def test_one_wide_draft_with_both_pages(self):
        draft = M.moss_draft(self.spec, self.layouts)
        self.assertEqual((draft["width"], draft["height"]), (2304, 1632))
        self.assertIn("right half is page 1", draft["summary"]["caption"])
        objects = [i for i in draft["items"] if i["label"] == "object"]
        self.assertEqual(len(objects), 10)
        self.assertGreaterEqual(objects[0]["bbox"][0], 1152)  # 1コマ目は右ページ
        self.assertLessEqual(objects[5]["bbox"][2], 1152)     # 6コマ目は左ページ

    def test_spanning_panel_needs_spread_mode(self):
        self.spec["layout"] = "spread-climax-8"
        self.spec["panels"] = self.spec["panels"][:3] + self.spec["panels"][5:]
        roles = ["ki", "ki", "sho", "ten", "ten", "ten", "ketsu", "ketsu"]
        for p, r in zip(self.spec["panels"], roles):
            p["role"] = r
        errors = M.check(self.spec, self.layouts)[0]
        self.assertTrue(any("ページをまたぐコマ" in e for e in errors))
        self.spec["page_turn"] = "spread"
        self.assertEqual(M.check(self.spec, self.layouts)[0], [])
        draft = M.moss_draft(self.spec, self.layouts)
        self.assertIn("spans across both pages", draft["summary"]["caption"])

    def test_preview_shows_fold(self):
        svg = M.preview_svg(self.spec, self.layouts)
        self.assertIn("p1（めくり前）", svg)
        self.assertIn('x1="1152"', svg)


class OutputTests(unittest.TestCase):
    def setUp(self):
        self.layouts = M.load_layouts()
        self.spec = load_example()

    def test_moss_draft_keeps_dialogue_verbatim(self):
        draft = M.moss_draft(self.spec, self.layouts)
        texts = [i["text"] for i in draft["items"] if i["label"] == "text"]
        for p in self.spec["panels"]:
            for b in p.get("balloons", []):
                self.assertIn(b["text"], texts)
        self.assertEqual(draft["summary"]["canvas"], "multi_panel")
        self.assertEqual((draft["width"], draft["height"]), (768, 2048))

    @unittest.skipUnless(MOSS_COMPILER.exists(), "moss-image-prompt-craft が同じリポジトリにない")
    def test_moss_draft_compiles(self):
        spec = importlib.util.spec_from_file_location("compile_prompt", MOSS_COMPILER)
        compiler = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(compiler)
        for name in sorted(EXAMPLES.glob("*.spec.json")):
            spec = json.loads(name.read_text(encoding="utf-8"))
            with self.subTest(example=name.name):
                result = json.loads(compiler.compile_prompt(M.moss_draft(spec, self.layouts)))
                self.assertEqual(result["bbox_format"], "yxyx")

    def test_thought_balloon_is_a_cloud(self):
        self.spec["panels"][0]["balloons"][0]["type"] = "thought"
        pl = M.place(self.spec, self.layouts["yonkoma-title"])[0]
        svg = "".join(M.panel_svg(pl))
        self.assertGreaterEqual(svg.count("<circle"), 10)  # 縁の円8個以上＋しっぽの丸2個
        self.assertNotRegex(svg, r'<ellipse[^>]*stroke="#000"')  # 普通の楕円の吹き出しを描いていない

    def test_long_notes_are_shortened_inside_the_panel(self):
        long_note = "とても長い注記がここに入ってコマの幅をこえてしまう場合のテスト用の文章です"
        self.spec["panels"][0]["cast"][0]["acting_ja"] = long_note
        self.spec["panels"][0]["beat_ja"] = long_note * 2
        pl = M.place(self.spec, self.layouts["yonkoma-title"])[0]
        svg = "".join(M.panel_svg(pl))
        self.assertIn("…</text>", svg)
        self.assertIn(f"<title>{long_note}</title>", svg)
        x0, _, x1, _ = pl["figures"][0]["bbox"]
        self.assertLessEqual(M.text_width(M.fit_text(long_note, x1 - x0 - 12, 18), 18), x1 - x0 - 12)

    def test_preview_escapes_text(self):
        self.spec["panels"][0]["balloons"][0]["text"] = "<&>"
        svg = M.preview_svg(self.spec, self.layouts)
        self.assertIn("&lt;&amp;&gt;", svg)
        self.assertTrue(svg.startswith("<svg"))


if __name__ == "__main__":
    unittest.main()
