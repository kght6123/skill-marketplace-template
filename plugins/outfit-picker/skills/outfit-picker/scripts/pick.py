#!/usr/bin/env python3
"""outfits.tsv からランダムに服装候補を引く。
使い方: python pick.py [--category theme] [--n 4] [--exclude "tag1,tag2"]
出力: 1行1候補の TSV (category, tag, ja_name, description)
"""
import argparse, csv, random
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--category", default=None, help="theme/top/bottom/onepiece/outer/legwear/shoes/item/color")
p.add_argument("--n", type=int, default=4)
p.add_argument("--exclude", default="", help="除外するタグ（カンマ区切り）")
a = p.parse_args()

path = Path(__file__).resolve().parent.parent / "references" / "outfits.tsv"
with open(path, encoding="utf-8") as f:
    rows = list(csv.DictReader(f, delimiter="\t"))

ex = {t.strip() for t in a.exclude.split(",") if t.strip()}
rows = [r for r in rows if r["tag"] not in ex and (not a.category or r["category"] == a.category)]
for r in random.sample(rows, min(a.n, len(rows))):
    print("\t".join([r["category"], r["tag"], r["ja_name"], r["description"]]))
