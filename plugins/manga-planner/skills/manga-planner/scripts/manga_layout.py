#!/usr/bin/env python3
"""manga-planner の設計書（spec.json）を検査し、ネーム画像と生成モデル用の下書きを作る。

使い方:
  python3 -I manga_layout.py check   spec.json
  python3 -I manga_layout.py preview spec.json --output name.svg
  python3 -I manga_layout.py moss    spec.json --output moss-draft.json

標準ライブラリだけで動く。コマの位置は assets/layouts.json のテンプレートから決め、
吹き出しとキャラの箱はこのスクリプトが日本式の読み順（右→左、上→下）で配置する。
ページが複数あるレイアウトでは、moss は1ページ1ファイル（-p1, -p2 …）を書き出す。
"""
import argparse
import json
import sys
from html import escape
from pathlib import Path

LAYOUTS_PATH = Path(__file__).resolve().parent.parent / "assets" / "layouts.json"

KISHOTENKETSU = ["ki", "sho", "ten", "ketsu"]
# roles: 固定の並び（list）か、起承転結の順を守れば何コマでもよい "flow"
FORMATS = {
    "yonkoma": {"roles": KISHOTENKETSU, "label_ja": "4コマ"},
    "hachikoma": {"roles": KISHOTENKETSU * 2, "label_ja": "8コマ（4コマ×2列）"},
    "page": {"roles": "flow", "label_ja": "1ページ"},
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


def panel_boxes(layout):
    """[(ページ番号, bbox), …] を読む順に返す。"""
    return [(pi, box) for pi, page in enumerate(layout["pages"]) for box in page["panels"]]


def title_slots(layout):
    return [(pi, box) for pi, page in enumerate(layout["pages"]) for box in page["titles"]]


def titles_of(spec, layout):
    """タイトル枠の数に合わせた文字列のリスト。足りなければ SpecError。"""
    slots = title_slots(layout)
    t = spec.get("title")
    if not slots:
        return []
    if isinstance(t, str) and t:
        t = [t]
    if not isinstance(t, list) or len(t) != len(slots) or not all(isinstance(s, str) and s for s in t):
        raise SpecError(f"spec: layout '{spec['layout']}' はタイトル枠が {len(slots)} つあるので、"
                        f"title を{'文字列' if len(slots) == 1 else f' {len(slots)} 個のリスト（読む順）'}で入れてください")
    return t


def role_errors(roles_spec, roles):
    """役割の並びを検査してエラー文のリストを返す。"""
    errs = []
    if isinstance(roles_spec, list):
        for i, (want, got) in enumerate(zip(roles_spec, roles)):
            if got != want:
                errs.append(f"panels[{i}]（{i + 1}コマ目）: role は '{want}'（{ROLE_JA[want]}）にしてください")
        return errs
    order = [KISHOTENKETSU.index(r) for r in roles if r in KISHOTENKETSU]
    if len(order) != len(roles):
        return errs  # 未知の役割は個別に報告済み
    if any(b < a for a, b in zip(order, order[1:])):
        errs.append("role は起→承→転→結の順に並べてください（同じ役割が続くのはよい）")
    missing = [ROLE_JA[r] for r in KISHOTENKETSU if r not in roles]
    if missing:
        errs.append(f"role に {'・'.join(missing)} がありません。起承転結をすべて1コマ以上入れてください")
    return errs


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
    if fmt and fmt not in FORMATS:
        errors.append(f"spec: format '{fmt}' には未対応です（対応: {', '.join(FORMATS)}）")
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
        try:
            titles_of(spec, layout)
        except SpecError as e:
            errors.append(str(e))
        if not title_slots(layout) and spec.get("title"):
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
    boxes = panel_boxes(layout) if layout else []
    if layout and len(panels) != len(boxes):
        errors.append(f"spec: panels は {len(boxes)} コマ必要です（今は {len(panels)} コマ）")
    for i, p in enumerate(panels):
        where = f"panels[{i}]（{i + 1}コマ目）"
        if not isinstance(p, dict):
            errors.append(f"{where}: オブジェクトではありません")
            continue
        role = need(p, "role", where)
        if role and role not in KISHOTENKETSU:
            errors.append(f"{where}: role '{role}' は未知です（{', '.join(KISHOTENKETSU)}）")
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

    valid_panels = [p for p in panels if isinstance(p, dict)]
    if fmt in FORMATS and len(valid_panels) == len(panels) == len(boxes) and boxes:
        errors.extend(role_errors(FORMATS[fmt]["roles"], [p.get("role") for p in panels]))
        warnings.extend(direction_warnings(panels))
        if FORMATS[fmt]["roles"] == "flow":
            warnings.extend(big_panel_warnings(panels, boxes))

    if not errors and layout:
        try:
            place(spec, layout)
        except SpecError as e:
            errors.append(str(e))
    return errors, warnings


def direction_warnings(panels):
    """起承転結の区切りごとに、転の絵が単調でないかを見る。"""
    warnings = []
    shots = [(p.get("shot"), p.get("angle", "eye-level")) for p in panels]
    if len(set(shots)) == 1:
        warnings.append("全コマが同じショット・アングルです。転かオチで寄るか角度を変えると単調になりません")
        return warnings
    for i, p in enumerate(panels):
        if p.get("role") == "ten" and (i == 0 or panels[i - 1].get("role") != "ten"):
            before = [shots[k] for k in range(i) if panels[k].get("role") in ("ki", "sho")
                      and k >= i - 2]
            if shots[i] in before:
                warnings.append(f"{i + 1}コマ目（転の最初）が直前のコマと同じショット・アングルです。"
                                "絵を大きく変えると意外さが伝わります")
    return warnings


def big_panel_warnings(panels, boxes):
    """コマの大きさがそろっていないページで、大ゴマを承に使っていないかを見る。"""
    areas = [(b[2] - b[0]) * (b[3] - b[1]) for _, b in boxes]
    if max(areas) < min(areas) * 1.5:
        return []
    big = max(range(len(areas)), key=areas.__getitem__)
    if panels[big].get("role") == "sho":
        return [f"{big + 1}コマ目は一番大きいコマ（大ゴマ）ですが、役割が承です。"
                "大ゴマは起（場所や登場）・転（山場）・結（オチ）に使うと効きます"]
    return []


# ---------------------------------------------------------------- 配置

def place(spec, layout):
    """コマごとに、ページ番号と吹き出し・キャラ・擬音の箱（ページ内の絶対座標）を返す。"""
    chars = {c["id"]: c for c in spec["characters"]}
    result = []
    for i, (p, (page, box)) in enumerate(zip(spec["panels"], panel_boxes(layout))):
        x0, y0, x1, y1 = box
        pw, ph = x1 - x0, y1 - y0
        inset = round(min(pw, ph) * 0.04)
        fs = max(16, round(min(pw, ph * 1.6) * 0.045))
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
            if y0 + inset + h > y0 + ph * 0.6:
                raise SpecError(
                    f"panels[{i}]（{i + 1}コマ目）: 「{b['text']}」が縦に長すぎてコマに収まりません。行を減らしてください")
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

        # 擬音: 左の中ほどに重ねる（左は最後に読む位置なので、余韻の音に向く）
        sfx = []
        for k, s in enumerate(p.get("sfx") or []):
            sw, sh = round(pw * 0.32), round(ph * 0.16)
            sy = y0 + round(ph * 0.55) + k * (sh + inset)
            sfx.append({"sfx": s, "bbox": [x0 + inset, sy, x0 + inset + sw, sy + sh]})

        result.append({"index": i, "page": page, "panel": p, "bbox": box,
                       "balloons": balloons, "figures": figures, "sfx": sfx})
    return result


# ---------------------------------------------------------------- MOSS 下書き

BALLOON_CAPTION = {
    "normal": "White oval speech bubble with a thin black outline{tail}, containing black Japanese manga lettering.",
    "whisper": "Small white speech bubble with a dotted outline indicating whispering{tail}, containing black Japanese manga lettering.",
    "shout": "Large spiky shout-style speech bubble with a jagged black outline{tail}, containing bold black Japanese manga lettering.",
    "thought": "Cloud-shaped thought bubble with small trailing circles{tail}, containing black Japanese manga lettering.",
    "narration": "Rectangular narration box with a thin black border and white fill, containing black Japanese manga lettering.",
}


def page_description(fmt, layout, page_index, n_titles):
    """summary.caption の最初の文（ページの体裁と読み順）。"""
    if fmt == "yonkoma":
        return ("A vertical four-panel Japanese yonkoma comic strip on a white page"
                + (", with a short title at the top and" if n_titles else ", with")
                + " four equal stacked horizontal panels separated by clean white gutters. "
                "Panels read from top to bottom.")
    if fmt == "hachikoma":
        return ("Two vertical four-panel Japanese yonkoma comic strips placed side by side on one white page"
                + (", each with a short title at the top" if n_titles else "")
                + ", eight equal panels in total separated by clean white gutters. "
                "Read the right strip first from top to bottom, then the left strip from top to bottom.")
    if fmt == "page":
        n = len(layout["pages"][page_index]["panels"])
        return (f"A single Japanese manga page with {n} panels of varied sizes separated by clean white gutters, "
                "with wider gutters between rows. Panels read right to left within a row, rows top to bottom.")
    raise SpecError(f"format '{fmt}' の説明文がありません")


def moss_drafts(spec, layouts):
    """ページごとの MOSS 編集用ドラフトのリストを返す。"""
    layout = layouts[spec["layout"]]
    placed = place(spec, layout)
    titles = titles_of(spec, layout)
    slots = title_slots(layout)
    color = spec.get("color", "monochrome")
    looks = "; ".join(c["look_en"].rstrip(".") for c in spec["characters"])
    meta = {"yonkoma": ["yonkoma", "4-panel manga", "comic strip", "manga"],
            "hachikoma": ["yonkoma", "4-panel manga", "comic strip", "manga"],
            "page": ["manga", "manga page", "comic"]}.get(spec["format"], ["manga"])
    meta = list(meta) + (["full color"] if color == "full-color" else [])

    drafts = []
    for pi, _page in enumerate(layout["pages"]):
        page_titles = [(box, text) for (tp, box), text in zip(slots, titles) if tp == pi]
        caption = (
            f"{page_description(spec['format'], layout, pi, len(page_titles))} "
            f"{spec['style_en'].rstrip('.')}. "
            f"{'Black and white with gray screentone' if color == 'monochrome' else 'Full color'}. "
            f"Consistent character design across all panels: {looks}. "
            f"Speech bubbles are white with thin black outlines, "
            f"contain short Japanese manga lettering and read from right to left within each panel."
        )
        items = []
        for box, text in page_titles:
            items.append({"label": "text",
                          "caption": "Bold black Japanese comic title lettering, centered, with no backing panel.",
                          "text": text, "bbox": box})
        page_panels = [pl for pl in placed if pl["page"] == pi]
        for n, pl in enumerate(page_panels, 1):
            items.extend(panel_items(n, pl))
        drafts.append({
            "width": layout["width"], "height": layout["height"],
            "bbox_coord_space": "abs", "bbox_format": "xyxy",
            "summary": {"meta": meta, "canvas": "multi_panel", "caption": caption},
            "items": items,
        })
    return drafts


def panel_items(n, pl):
    p = pl["panel"]
    items = []
    cap = ", ".join([f"Panel {n} ({ROLE_EN[p['role']]}): a rectangular manga panel with a thick black border",
                     SHOT_EN[p["shot"]], ANGLE_EN[p.get("angle", "eye-level")]]) + "."
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
    return items


# ---------------------------------------------------------------- ネーム（SVG）

PAGE_GAP = 48


def svg_text(x, y, text, size, anchor="middle", weight="normal", fill="#000"):
    lines = text.split("\n")
    start = y - (len(lines) - 1) * size * 0.65
    out = []
    for k, line in enumerate(lines):
        out.append(f'<text x="{x:.0f}" y="{start + k * size * 1.3:.0f}" font-size="{size}" '
                   f'text-anchor="{anchor}" dominant-baseline="middle" font-weight="{weight}" '
                   f'fill="{fill}">{escape(line)}</text>')
    return "".join(out)


def page_offsets(layout):
    """ページの左上 x 座標。日本の本なので1ページ目を右に置く。"""
    n = len(layout["pages"])
    W = layout["width"]
    return [(n - 1 - pi) * (W + PAGE_GAP) for pi in range(n)]


def preview_svg(spec, layouts):
    layout = layouts[spec["layout"]]
    placed = place(spec, layout)
    titles = titles_of(spec, layout)
    offs = page_offsets(layout)
    n = len(layout["pages"])
    W, H = layout["width"], layout["height"]
    TW = n * W + (n - 1) * PAGE_GAP
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{TW}" height="{H}" viewBox="0 0 {TW} {H}" '
           f'font-family="Hiragino Sans, \'Noto Sans JP\', \'Yu Gothic\', sans-serif">',
           f'<rect width="{TW}" height="{H}" fill="#ddd"/>']
    for pi in range(n):
        out.append(f'<g transform="translate({offs[pi]},0)"><rect width="{W}" height="{H}" fill="#fff"/>')
        if n > 1:
            out.append(svg_text(W - 16, 24, f"p{pi + 1}", 22, anchor="end", fill="#999"))
        for (tp, box), text in zip(title_slots(layout), titles):
            if tp == pi:
                x0, y0, x1, y1 = box
                out.append(svg_text((x0 + x1) / 2, (y0 + y1) / 2, text, round((y1 - y0) * 0.5), weight="bold"))
        for pl in placed:
            if pl["page"] == pi:
                out.extend(panel_svg(pl))
        out.append("</g>")
    out.append("</svg>")
    return "\n".join(out)


def panel_svg(pl):
    out = []
    p = pl["panel"]
    i = pl["index"] + 1
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
    return out


# ---------------------------------------------------------------- CLI

def page_paths(output, n):
    if n == 1:
        return [Path(output)]
    p = Path(output)
    return [p.with_name(f"{p.stem}-p{k + 1}{p.suffix}") for k in range(n)]


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
        if args.output:
            Path(args.output).write_text(data, encoding="utf-8")
            print(args.output)
        else:
            sys.stdout.write(data)
        return 0

    drafts = moss_drafts(spec, layouts)
    texts = [json.dumps(d, ensure_ascii=False, indent=2) + "\n" for d in drafts]
    if args.output:
        for path, text in zip(page_paths(args.output, len(texts)), texts):
            path.write_text(text, encoding="utf-8")
            print(path)
    elif len(texts) == 1:
        sys.stdout.write(texts[0])
    else:
        print("エラー: ページが複数あるので --output を指定してください", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
