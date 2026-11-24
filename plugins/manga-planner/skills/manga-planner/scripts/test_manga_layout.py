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
                for page in lay["pages"]:
                    boxes = page["panels"] + page["titles"]
                    for x0, y0, x1, y1 in boxes:
                        self.assertTrue(0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H)
                    for i, a in enumerate(boxes):
                        for b in boxes[i + 1:]:
                            overlap = a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]
                            self.assertFalse(overlap, (a, b))
                    self.assertTrue(reading_order_ok(page["panels"], lay["reading"]))
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
        drafts = M.moss_drafts(self.spec, self.layouts)
        self.assertEqual(len(drafts), 1)
        texts = [i["text"] for i in drafts[0]["items"] if i["label"] == "text"]
        self.assertEqual(texts[:2], ["オンライン会議", "昼休み"])
        self.assertIn("right strip first", drafts[0]["summary"]["caption"])
        self.assertEqual(sum(1 for i in drafts[0]["items"] if i["label"] == "object"), 8)


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
        draft = M.moss_drafts(self.spec, self.layouts)[0]
        self.assertIn("single Japanese manga page with 5 panels", draft["summary"]["caption"])
        self.assertEqual((draft["width"], draft["height"]), (1440, 2032))


class OutputTests(unittest.TestCase):
    def setUp(self):
        self.layouts = M.load_layouts()
        self.spec = load_example()

    def test_moss_draft_keeps_dialogue_verbatim(self):
        draft = M.moss_drafts(self.spec, self.layouts)[0]
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
            for draft in M.moss_drafts(spec, self.layouts):
                with self.subTest(example=name.name):
                    result = json.loads(compiler.compile_prompt(draft))
                    self.assertEqual(result["bbox_format"], "yxyx")

    def test_preview_escapes_text(self):
        self.spec["panels"][0]["balloons"][0]["text"] = "<&>"
        svg = M.preview_svg(self.spec, self.layouts)
        self.assertIn("&lt;&amp;&gt;", svg)
        self.assertTrue(svg.startswith("<svg"))


if __name__ == "__main__":
    unittest.main()
