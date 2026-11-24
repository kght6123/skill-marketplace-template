#!/usr/bin/env python3
"""manga-planner の設計書（spec.json）を検査し、ネーム画像と生成モデル用の下書きを作る。

使い方:
  python3 -I manga_layout.py check   spec.json
  python3 -I manga_layout.py preview spec.json --output name.svg
  python3 -I manga_layout.py moss    spec.json --output moss-draft.json

標準ライブラリだけで動く。コマの位置は assets/layouts.json のテンプレートから決め、
吹き出しとキャラの箱はこのスクリプトが日本式の読み順（右→左、上→下）で配置する。
"""
import argparse
import json
import sys
from html import escape
from pathlib import Path

LAYOUTS_PATH = Path(__file__).resolve().parent.parent / "assets" / "layouts.json"

ROLES = {
    "yonkoma": ["ki", "sho", "ten", "ketsu"],
}
ROLE_EN = {"ki": "setup", "sho": "development", "ten": "twist", "ketsu": "punchline"}
ROLE_JA = {"ki": "起", "sho": "承", "ten": "転", "ketsu": "結"}
SHOT_EN = {
    "long": "long shot showing the whole place",
    "full": "full shot showing the characters head to toe",
    "medium": "medium shot from the waist up",
    "bust": "bust shot from the chest up",
    "closeup": "close-up on the face",
    "extreme-closeup": "extreme close-up on the eyes or a hand",
}
ANGLE_EN = {
    "eye-level": "eye-level angle",
    "high": "high angle looking down",
    "low": "low angle looking up",
    "birds-eye": "bird's-eye view from directly above",
    "over-shoulder": "over-the-shoulder view",
}
BALLOON_TYPES = {"normal", "whisper", "shout", "thought", "narration"}
COLORS = {"monochrome", "full-color"}

MAX_BALLOONS = 2
MAX_CAST = 2
MAX_CHARACTERS = 3
SOFT_TEXT_LIMIT = 12   # MOSS の文字描画が安定しやすい目安
HARD_TEXT_LIMIT = 25   # これを超える吹き出しは漫画として読みにくい


class SpecError(Exception):
    pass


def load_layouts():
    with LAYOUTS_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def text_metrics(text):
    lines = text.split("\n")
    return max(len(line) for line in lines), len(lines)


def is_ascii(s):
    return all(ord(c) < 128 for c in s)


# ---------------------------------------------------------------- 検査

def check(spec, layouts):
    """(errors, warnings) を返す。errors が空なら変換してよい。"""
    errors, warnings = [], []

    def need(obj, key, where):
        v = obj.get(key) if isinstance(obj, dict) else None
        if v in (None, "", []):
            errors.append(f"{where}: {key} がありません")
        return v

    fmt = need(spec, "format", "spec")
    layout_id = need(spec, "layout", "spec")
    if fmt and fmt not in ROLES:
        errors.append(f"spec: format '{fmt}' には未対応です（対応: {', '.join(ROLES)}）")
    layout = layouts.get(layout_id) if layout_id else None
    if layout_id and layout is None:
        errors.append(f"spec: layout '{layout_id}' がありません（候補: {', '.join(layouts)}）")
    if layout and fmt and layout["format"] != fmt:
        errors.append(f"spec: layout '{layout_id}' は format '{layout['format']}' 用です")

    color = spec.get("color", "monochrome")
    if color not in COLORS:
        errors.append(f"spec: color は {sorted(COLORS)} のどれかにしてください")
    style = need(spec, "style_en", "spec")
    if style and not is_ascii(style):
        warnings.append("spec: style_en に英語以外が混じっています（生成モデルには英語が安定）")

    if layout:
        if layout["title"] and not spec.get("title"):
            errors.append(f"spec: layout '{layout_id}' はタイトル枠があるので title を入れてください")
        if not layout["title"] and spec.get("title"):
            warnings.append(f"spec: layout '{layout_id}' にはタイトル枠がないので title は描かれません")

    chars = spec.get("characters") or []
    if not chars:
        errors.append("spec: characters が空です（1人以上必要）")
    if len(chars) > MAX_CHARACTERS:
        errors.append(f"spec: 登場人物は {MAX_CHARACTERS} 人までにしてください（多いと描き分けが崩れます）")
    ids = set()
    for i, c in enumerate(chars):
        where = f"characters[{i}]"
        cid = need(c, "id", where)
        need(c, "name", where)
        look = need(c, "look_en", where)
        if cid in ids:
            errors.append(f"{where}: id '{cid}' が重複しています")
        ids.add(cid)
        if look and not is_ascii(look):
            warnings.append(f"{where}: look_en に英語以外が混じっています")

    panels = spec.get("panels") or []
    if layout and len(panels) != len(layout["panels"]):
        errors.append(f"spec: panels は {len(layout['panels'])} コマ必要です（今は {len(panels)} コマ）")
    roles = ROLES.get(fmt, [])
    for i, p in enumerate(panels):
        where = f"panels[{i}]（{i + 1}コマ目）"
        if not isinstance(p, dict):
            errors.append(f"{where}: オブジェクトではありません")
            continue
        role = need(p, "role", where)
        if roles and i < len(roles) and role and role != roles[i]:
            errors.append(f"{where}: role は '{roles[i]}'（{ROLE_JA[roles[i]]}）にしてください")
        need(p, "beat_ja", where)
        shot = need(p, "shot", where)
        if shot and shot not in SHOT_EN:
            errors.append(f"{where}: shot '{shot}' は未知です（{', '.join(SHOT_EN)}）")
        angle = p.get("angle", "eye-level")
        if angle not in ANGLE_EN:
            errors.append(f"{where}: angle '{angle}' は未知です（{', '.join(ANGLE_EN)}）")
        bg = p.get("background_en", "")
        if bg and not is_ascii(bg):
            warnings.append(f"{where}: background_en に英語以外が混じっています")
        if role == "ki" and not bg:
            warnings.append(f"{where}: 起のコマは場所を見せたいので background_en を書くのがおすすめです")

        cast = p.get("cast") or []
        if len(cast) > MAX_CAST:
            errors.append(f"{where}: 1コマのキャラは {MAX_CAST} 人までにしてください")
        for j, m in enumerate(cast):
            if m.get("id") not in ids:
                errors.append(f"{where}: cast[{j}] の id '{m.get('id')}' が characters にありません")
            acting = need(m, "acting_en", f"{where} cast[{j}]")
            if acting and not is_ascii(acting):
                warnings.append(f"{where} cast[{j}]: acting_en に英語以外が混じっています")
        cast_ids = [m.get("id") for m in cast]

        balloons = p.get("balloons") or []
        if len(balloons) > MAX_BALLOONS:
            errors.append(f"{where}: 吹き出しは {MAX_BALLOONS} つまでにしてください（コマを分けるか台詞を削る）")
        for j, b in enumerate(balloons):
            bw = f"{where} balloons[{j}]"
            btype = b.get("type", "normal")
            if btype not in BALLOON_TYPES:
                errors.append(f"{bw}: type '{btype}' は未知です（{', '.join(sorted(BALLOON_TYPES))}）")
            text = need(b, "text", bw)
            if btype != "narration" and b.get("speaker") not in cast_ids:
                errors.append(f"{bw}: speaker '{b.get('speaker')}' がこのコマの cast にいません")
            if text:
                longest, _ = text_metrics(text)
                total = len(text.replace("\n", ""))
                if total > HARD_TEXT_LIMIT:
                    errors.append(f"{bw}: 台詞が {total} 字あります。{HARD_TEXT_LIMIT} 字以内にするか吹き出しを分けてください")
                elif longest > SOFT_TEXT_LIMIT:
                    warnings.append(f"{bw}: 1行 {longest} 字。{SOFT_TEXT_LIMIT} 字以内にするか \\n で改行すると崩れにくくなります")
        if role == "ketsu" and len(balloons) > 1:
            warnings.append(f"{where}: オチのコマの台詞は1つに絞ると決まりやすいです")
        for j, s in enumerate(p.get("sfx") or []):
            need(s, "text", f"{where} sfx[{j}]")

    if len(panels) == 4 and all(isinstance(p, dict) for p in panels):
        shots = [(p.get("shot"), p.get("angle", "eye-level")) for p in panels]
        if len(set(shots)) == 1:
            warnings.append("全コマが同じショット・アングルです。転かオチで寄るか角度を変えると単調になりません")
        elif shots[2] in shots[:2]:
            warnings.append("転（3コマ目）が前のコマと同じショット・アングルです。絵を大きく変えると意外さが伝わります")

    if not errors and layout:
        try:
            place(spec, layout)
        except SpecError as e:
            errors.append(str(e))
    return errors, warnings


# ---------------------------------------------------------------- 配置

def place(spec, layout):
    """コマごとに、吹き出し・キャラ・擬音の箱を絶対座標で返す。"""
    chars = {c["id"]: c for c in spec["characters"]}
    result = []
    for i, (p, box) in enumerate(zip(spec["panels"], layout["panels"])):
        x0, y0, x1, y1 = box
        pw, ph = x1 - x0, y1 - y0
        inset = round(min(pw, ph) * 0.04)
        fs = max(16, round(pw * 0.045))
        pad = round(fs * 0.8)
        inner = pw - 2 * inset

        # 吹き出し: 上端に、右から左へ並べる（日本式の読み順）
        balloons = []
        right = x1 - inset
        band_bottom = y0 + inset
        for b in p.get("balloons") or []:
            longest, lines = text_metrics(b["text"])
            # 楕円に内接させるため、文字の箱を約1.4倍に広げる
            w = round((longest * fs + pad) * 1.4)
            h = round((lines * fs * 1.3 + pad) * 1.4)
            if w > inner * 0.9:
                raise SpecError(
                    f"panels[{i}]（{i + 1}コマ目）: 「{b['text']}」が1行に長すぎてコマに収まりません。\\n で改行してください")
            left = right - w
            if left < x0 + inset:
                raise SpecError(
                    f"panels[{i}]（{i + 1}コマ目）: 吹き出しが横に並びきりません。台詞を短くするか改行してください")
            bb = [left, y0 + inset, right, y0 + inset + h]
            balloons.append({"balloon": b, "bbox": bb, "font": fs})
            band_bottom = max(band_bottom, bb[3])
            right = left - inset

        # キャラ: 吹き出しの下。最初に話す人を右に置く
        cast = list(p.get("cast") or [])
        speakers = [b["speaker"] for b in p.get("balloons") or [] if b.get("speaker")]
        order = {sid: k for k, sid in enumerate(speakers)}
        cast.sort(key=lambda m: order.get(m["id"], len(order)))
        top = max(band_bottom + inset // 2, y0 + round(ph * 0.18))
        bottom = y1 - inset
        figures = []
        n = len(cast)
        slot_w = (pw - 2 * inset) / max(n, 1)
        for k, m in enumerate(cast):
            r = x1 - inset - k * slot_w
            l = r - slot_w
            side = None if n == 1 else ("right" if k == 0 else "left")
            figures.append({"member": m, "character": chars[m["id"]], "side": side,
                            "bbox": [round(l), top, round(r), bottom]})

        side_of = {f["member"]["id"]: f["side"] for f in figures}
        for bl in balloons:
            bl["speaker_side"] = side_of.get(bl["balloon"].get("speaker"))

        # 擬音: 左の中ほどに重ねる（左上は最後に読む位置なので、余韻の音に向く）
        sfx = []
        for k, s in enumerate(p.get("sfx") or []):
            sw, sh = round(pw * 0.32), round(ph * 0.16)
            sy = y0 + round(ph * 0.55) + k * (sh + inset)
            sfx.append({"sfx": s, "bbox": [x0 + inset, sy, x0 + inset + sw, sy + sh]})

        result.append({"panel": p, "bbox": box, "balloons": balloons, "figures": figures, "sfx": sfx})
    return result


# ---------------------------------------------------------------- MOSS 下書き

BALLOON_CAPTION = {
    "normal": "White oval speech bubble with a thin black outline{tail}, containing black Japanese manga lettering.",
    "whisper": "Small white speech bubble with a dotted outline indicating whispering{tail}, containing black Japanese manga lettering.",
    "shout": "Large spiky shout-style speech bubble with a jagged black outline{tail}, containing bold black Japanese manga lettering.",
    "thought": "Cloud-shaped thought bubble with small trailing circles{tail}, containing black Japanese manga lettering.",
    "narration": "Rectangular narration box with a thin black border and white fill, containing black Japanese manga lettering.",
}


def moss_draft(spec, layouts):
    layout = layouts[spec["layout"]]
    placed = place(spec, layout)
    color = spec.get("color", "monochrome")
    has_title = bool(layout["title"])

    looks = "; ".join(c["look_en"].rstrip(".") for c in spec["characters"])
    caption = (
        f"A vertical four-panel Japanese yonkoma comic strip on a white page"
        f"{', with a short title at the top and' if has_title else ', with'}"
        f" four equal stacked horizontal panels separated by clean white gutters. "
        f"{spec['style_en'].rstrip('.')}. "
        f"{'Black and white with gray screentone' if color == 'monochrome' else 'Full color'}. "
        f"Consistent character design across all panels: {looks}. "
        f"Panels read from top to bottom. Speech bubbles are white with thin black outlines, "
        f"contain short Japanese manga lettering and read from right to left within each panel."
    )
    meta = ["yonkoma", "4-panel manga", "comic strip", "manga"]
    if color == "full-color":
        meta.append("full color")

    items = []
    if has_title:
        items.append({"label": "text",
                      "caption": "Bold black Japanese comic title lettering, centered, with no backing panel.",
                      "text": spec["title"], "bbox": layout["title"]})
    for i, pl in enumerate(placed, 1):
        p = pl["panel"]
        parts = [f"Panel {i} ({ROLE_EN[p['role']]}): a rectangular manga panel with a thick black border",
                 SHOT_EN[p["shot"]], ANGLE_EN[p.get("angle", "eye-level")]]
        cap = ", ".join(parts) + "."
        for extra in (p.get("background_en"), p.get("effects_en")):
            if extra:
                cap += " " + extra.rstrip(".") + "."
        items.append({"label": "object", "caption": cap, "bbox": pl["bbox"]})
        for f in pl["figures"]:
            where = f" on the {f['side']} side of the panel" if f["side"] else ""
            items.append({"label": "character",
                          "caption": f"{f['character']['look_en'].rstrip('.')}{where}, "
                                     f"{f['member']['acting_en'].rstrip('.')}.",
                          "bbox": f["bbox"]})
        for bl in pl["balloons"]:
            b = bl["balloon"]
            btype = b.get("type", "normal")
            if btype == "narration":
                tail = ""
            elif bl["speaker_side"]:
                tail = f" and a tail pointing to the character on the {bl['speaker_side']}"
            else:
                tail = " and a tail pointing to the speaker"
            items.append({"label": "text", "caption": BALLOON_CAPTION[btype].format(tail=tail),
                          "text": b["text"], "bbox": bl["bbox"]})
        for s in pl["sfx"]:
            items.append({"label": "text",
                          "caption": s["sfx"].get("caption_en")
                          or "Bold hand-drawn Japanese sound effect lettering, slightly tilted, with no bubble.",
                          "text": s["sfx"]["text"], "bbox": s["bbox"]})

    return {
        "width": layout["width"], "height": layout["height"],
        "bbox_coord_space": "abs", "bbox_format": "xyxy",
        "summary": {"meta": meta, "canvas": "multi_panel", "caption": caption},
        "items": items,
    }


# ---------------------------------------------------------------- ネーム（SVG）

def svg_text(x, y, text, size, anchor="middle", weight="normal", fill="#000"):
    lines = text.split("\n")
    start = y - (len(lines) - 1) * size * 0.65
    out = []
    for k, line in enumerate(lines):
        out.append(f'<text x="{x}" y="{start + k * size * 1.3:.0f}" font-size="{size}" '
                   f'text-anchor="{anchor}" dominant-baseline="middle" font-weight="{weight}" '
                   f'fill="{fill}">{escape(line)}</text>')
    return "".join(out)


def preview_svg(spec, layouts):
    layout = layouts[spec["layout"]]
    placed = place(spec, layout)
    W, H = layout["width"], layout["height"]
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
           f'font-family="Hiragino Sans, \'Noto Sans JP\', \'Yu Gothic\', sans-serif">',
           f'<rect width="{W}" height="{H}" fill="#fff"/>']
    if layout["title"] and spec.get("title"):
        x0, y0, x1, y1 = layout["title"]
        out.append(svg_text((x0 + x1) / 2, (y0 + y1) / 2, spec["title"], round((y1 - y0) * 0.5), weight="bold"))
    for i, pl in enumerate(placed, 1):
        p = pl["panel"]
        x0, y0, x1, y1 = pl["bbox"]
        out.append(f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" fill="none" stroke="#000" stroke-width="6"/>')
        for f in pl["figures"]:
            fx0, fy0, fx1, fy1 = f["bbox"]
            out.append(f'<rect x="{fx0}" y="{fy0}" width="{fx1 - fx0}" height="{fy1 - fy0}" fill="#f4f4f4" '
                       f'stroke="#aaa" stroke-dasharray="10 6" stroke-width="2"/>')
            out.append(svg_text((fx0 + fx1) / 2, fy0 + 26, f["character"]["name"], 24, weight="bold", fill="#555"))
            note = f["member"].get("acting_ja")
            if note:
                out.append(svg_text((fx0 + fx1) / 2, fy0 + 60, note, 18, fill="#777"))
        if not pl["figures"] and p.get("beat_ja"):
            out.append(svg_text((x0 + x1) / 2, (y0 + y1) / 2, p["beat_ja"], 20, fill="#777"))
        for bl in pl["balloons"]:
            bx0, by0, bx1, by1 = bl["bbox"]
            btype = bl["balloon"].get("type", "normal")
            cx, cy, rx, ry = (bx0 + bx1) / 2, (by0 + by1) / 2, (bx1 - bx0) / 2, (by1 - by0) / 2
            if btype == "narration":
                out.append(f'<rect x="{bx0}" y="{by0}" width="{bx1 - bx0}" height="{by1 - by0}" fill="#fff" stroke="#000" stroke-width="2"/>')
            else:
                dash = ' stroke-dasharray="6 5"' if btype == "whisper" else ""
                width = 5 if btype == "shout" else 2
                out.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#fff" stroke="#000" stroke-width="{width}"{dash}/>')
            out.append(svg_text(cx, cy, bl["balloon"]["text"], bl["font"],
                                weight="bold" if btype == "shout" else "normal"))
        for s in pl["sfx"]:
            sx0, sy0, sx1, sy1 = s["bbox"]
            out.append(svg_text((sx0 + sx1) / 2, (sy0 + sy1) / 2, s["sfx"]["text"],
                                round((sy1 - sy0) * 0.45), weight="bold", fill="#c0392b"))
        label = f"{i} {ROLE_JA[p['role']]}｜{p['shot']} / {p.get('angle', 'eye-level')}｜{p.get('beat_ja', '')}"
        out.append(f'<rect x="{x0 + 3}" y="{y1 - 34}" width="{x1 - x0 - 6}" height="31" fill="#fff" fill-opacity="0.85"/>')
        out.append(svg_text(x0 + 12, y1 - 18, label, 17, anchor="start", fill="#666"))
    out.append("</svg>")
    return "\n".join(out)


# ---------------------------------------------------------------- CLI

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["check", "preview", "moss"])
    ap.add_argument("spec")
    ap.add_argument("--output", "-o")
    args = ap.parse_args(argv)

    with open(args.spec, encoding="utf-8") as f:
        spec = json.load(f)
    layouts = load_layouts()
    errors, warnings = check(spec, layouts)
    for w in warnings:
        print(f"注意: {w}", file=sys.stderr)
    for e in errors:
        print(f"エラー: {e}", file=sys.stderr)
    if errors:
        return 1
    if args.command == "check":
        print("OK")
        return 0

    if args.command == "preview":
        data = preview_svg(spec, layouts)
    else:
        data = json.dumps(moss_draft(spec, layouts), ensure_ascii=False, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(data, encoding="utf-8")
        print(args.output)
    else:
        sys.stdout.write(data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
