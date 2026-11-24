import copy
import importlib.util
import json
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("manga_layout", HERE / "manga_layout.py")
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)

EXAMPLE = HERE.parent / "examples" / "neko-satsuei.spec.json"
MOSS_COMPILER = (HERE.parents[3] / "moss-image-prompt-craft" / "skills" / "moss-image-prompt-craft"
                 / "scripts" / "compile_prompt.py")


def load_example():
    return json.loads(EXAMPLE.read_text(encoding="utf-8"))


class LayoutTemplateTests(unittest.TestCase):
    def test_templates_fit_canvas_and_do_not_overlap(self):
        for name, lay in M.load_layouts().items():
            with self.subTest(layout=name):
                W, H = lay["width"], lay["height"]
                self.assertEqual(W % 16, 0)
                self.assertEqual(H % 16, 0)
                boxes = list(lay["panels"]) + ([lay["title"]] if lay["title"] else [])
                for x0, y0, x1, y1 in boxes:
                    self.assertTrue(0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H)
                ps = sorted(lay["panels"], key=lambda b: b[1])
                for a, b in zip(ps, ps[1:]):
                    self.assertLessEqual(a[3], b[1])
                self.assertEqual(len(lay["panels"]), len(M.ROLES[lay["format"]]))


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
        self.assertTrue(any("title を入れて" in e for e in self.errors(self.spec)))
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
        for name in ("yonkoma-title", "yonkoma-plain", "yonkoma-slim"):
            spec = copy.deepcopy(self.spec)
            spec["layout"] = name
            for pl in M.place(spec, self.layouts[name]):
                x0, y0, x1, y1 = pl["bbox"]
                for item in pl["balloons"] + pl["figures"] + pl["sfx"]:
                    bx0, by0, bx1, by1 = item["bbox"]
                    with self.subTest(layout=name):
                        self.assertTrue(x0 <= bx0 < bx1 <= x1 and y0 <= by0 < by1 <= y1)


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
        result = json.loads(compiler.compile_prompt(M.moss_draft(self.spec, self.layouts)))
        self.assertEqual(result["bbox_format"], "yxyx")

    def test_preview_escapes_text(self):
        self.spec["panels"][0]["balloons"][0]["text"] = "<&>"
        svg = M.preview_svg(self.spec, self.layouts)
        self.assertIn("&lt;&amp;&gt;", svg)
        self.assertTrue(svg.startswith("<svg"))


if __name__ == "__main__":
    unittest.main()
