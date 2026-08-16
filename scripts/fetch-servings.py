#!/usr/bin/env python3
"""Give the Open Food Facts products in the bundled database real portions.

The search API does not return serving sizes and the legacy search endpoint is
usually 503, so the Aldi products arrived with grams only — meaning "1 patty"
has to be re-entered as "64 g" every single time it is logged. The per-product
endpoint does return them, so this walks the cached harvest and asks for each
barcode once.

Slow and one-off by design: a small delay per request, results cached, safe to
interrupt and resume.

Usage:  python3 scripts/fetch-servings.py
        python3 scripts/build-food-db.py     # then rebuild with the portions
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

USDA_DIR = os.path.expanduser("~/Storage/Developer/data/usda")
OFF_CACHE = os.path.join(USDA_DIR, "off-aldi-cache.json")
SERVING_CACHE = os.path.join(USDA_DIR, "off-servings.json")

FIELDS = "code,serving_size,serving_quantity,product_quantity"
DELAY = 0.15


def load(path, default):
    if os.path.exists(path):
        with open(path) as fh:
            return json.load(fh)
    return default


def plausible(label, grams):
    """Reject serving sizes that are obviously not a portion of this food."""
    if not grams or grams <= 0 or grams > 1000:
        return False
    # Some entries put the whole package weight in the serving field.
    if not label:
        return False
    return True


METRIC_ONLY = re.compile(r"^[\d.,]+\s*(g|ml|gr|grams?|millilitres?|milliliters?)$", re.I)


def clean_label(raw, grams):
    """Turn '2.1 oz (64 g/1 patty)' into '1 patty'.

    Returns None when the serving is only a weight. A label of "100 g" tells
    you nothing you did not already know and would just add a useless chip.
    """
    text = " ".join((raw or "").split())
    if not text:
        return None

    # A household phrase in brackets is usually the useful part.
    for piece in re.findall(r"\(([^)]*)\)", text):
        for part in re.split(r"[/,]", piece):
            part = part.strip()
            if part and not METRIC_ONLY.match(part):
                return part[:40]

    # Otherwise drop a bracketed weight and any leading metric quantity:
    # "1 slice (28 g)" -> "1 slice", "64 g patty" -> "patty".
    text = re.sub(r"\s*\([^)]*\)\s*$", "", text).strip()
    text = re.sub(r"^[\d.,]+\s*(g|ml|oz|gram|grams)\s+", "", text, flags=re.I).strip()

    if not text or METRIC_ONLY.match(text):
        return None
    return text[:40]


def main():
    products = load(OFF_CACHE, None)
    if not products:
        print(f"no harvest at {OFF_CACHE}; run build-food-db.py --refresh-off first", file=sys.stderr)
        return 1

    servings = load(SERVING_CACHE, {})
    codes = [row[8] for row in products if row[8] and row[8] not in servings]
    print(f"{len(products)} products, {len(servings)} already known, {len(codes)} to fetch")

    found = 0
    for i, code in enumerate(codes, 1):
        url = f"https://world.openfoodfacts.org/api/v2/product/{code}.json?fields={FIELDS}"
        req = urllib.request.Request(url, headers={"User-Agent": "Salutt/0.1 (personal food log)"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
            servings[code] = None
            continue

        product = data.get("product") or {}
        grams = product.get("serving_quantity")
        try:
            grams = float(grams) if grams else 0
        except (TypeError, ValueError):
            grams = 0
        label = clean_label(product.get("serving_size"), grams)

        if plausible(label, grams):
            servings[code] = [label, round(grams, 1)]
            found += 1
        else:
            servings[code] = None

        if i % 100 == 0:
            with open(SERVING_CACHE, "w") as fh:
                json.dump(servings, fh)
            print(f"  {i}/{len(codes)} — {found} with a usable portion", flush=True)
        time.sleep(DELAY)

    with open(SERVING_CACHE, "w") as fh:
        json.dump(servings, fh)
    usable = sum(1 for v in servings.values() if v)
    print(f"done — {usable} of {len(servings)} products now have a named portion")
    return 0


if __name__ == "__main__":
    sys.exit(main())
