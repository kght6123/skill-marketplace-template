#!/usr/bin/env python3
"""選択肢の候補をランダムに引く（ピッカー系スキルと同じ使い方）。

使い方:
  python3 -I pick.py --category genre  --n 4 [--exclude "gag,daily"]
  python3 -I pick.py --layouts --format page --n 3 [--exclude "page-basic-6"] [--square|--no-square]

カテゴリ: genre / ending / theme / setting / twist / style（references/catalog.tsv）
出力: 1行1候補の TSV
  カタログ:     category, key, ja_name, description, en
  テンプレート: format, key, label_ja, note_ja, コマ数
"""
import argparse
import csv
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CATALOG = HERE.parent / "references" / "catalog.tsv"


def load_catalog():
    with CATALOG.open(encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def pick_catalog(category, n, exclude):
    rows = [r for r in load_catalog() if r["category"] == category and r["key"] not in exclude]
    return random.sample(rows, min(n, len(rows)))


def pick_layouts(fmt, n, exclude, square=None):
    sys.path.insert(0, str(HERE))
    import manga_layout
    rows = []
    for key, lay in manga_layout.load_layouts().items():
        if lay["format"] != fmt or key in exclude:
            continue
        if square is not None and (lay["width"] == lay["height"]) != square:
            continue
        rows.append((key, lay))
    return random.sample(rows, min(n, len(rows)))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--category")
    g.add_argument("--layouts", action="store_true")
    ap.add_argument("--format", help="--layouts のとき: yonkoma / hachikoma / page / spread")
    ap.add_argument("--n", type=int, default=4)
    ap.add_argument("--exclude", default="", help="除外する key（カンマ区切り）")
    sq = ap.add_mutually_exclusive_group()
    sq.add_argument("--square", dest="square", action="store_true", default=None)
    sq.add_argument("--no-square", dest="square", action="store_false")
    a = ap.parse_args(argv)
    exclude = {t.strip() for t in a.exclude.split(",") if t.strip()}

    if a.category:
        if a.category not in {r["category"] for r in load_catalog()}:
            ap.error(f"未知のカテゴリ: {a.category}")
        for r in pick_catalog(a.category, a.n, exclude):
            print("\t".join([r["category"], r["key"], r["ja_name"], r["description"], r["en"] or ""]))
        return 0
    if not a.format:
        ap.error("--layouts には --format が必要です")
    for key, lay in pick_layouts(a.format, a.n, exclude, a.square):
        count = sum(len(p["panels"]) for p in lay["pages"])
        print("\t".join([lay["format"], key, lay["label_ja"], lay["note_ja"], str(count)]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
