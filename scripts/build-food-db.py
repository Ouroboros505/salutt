#!/usr/bin/env python3
"""Build the bundled food database that ships with Salutt.

Two sources, chosen for what they are each good at:

  USDA FoodData Central  — generic and whole foods (Foundation, SR Legacy) plus
                           prepared and restaurant dishes (Survey/FNDDS). These
                           are the things you cook with and eat out, and they
                           carry real household portions.
  Open Food Facts        — Aldi private-label groceries, which USDA's branded
                           set does not cover at all (checked: zero products).

Output is a compact array-of-arrays rather than objects — roughly a third the
size — loaded lazily by the app and searched in memory. It is deliberately NOT
inserted into IndexedDB: that stays reserved for foods actually logged, so the
personal library keeps answering instantly.

Usage:  python3 scripts/build-food-db.py [--skip-off]
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request

USDA_DIR = os.path.expanduser("~/Storage/Developer/data/usda")
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "food-db.json")

# FoodData Central nutrient numbers.
KCAL, PROTEIN, FAT, CARBS, FIBER = "208", "203", "204", "205", "291"

SRC_USDA, SRC_OFF = 0, 1

# Aldi US private labels. Their branded goods are absent from USDA entirely,
# so Open Food Facts is the only source for the weekly shop.
ALDI_BRANDS = [
    "Simply Nature", "Millville", "Friendly Farms", "Clancy's", "Specially Selected",
    "Fit & Active", "Southern Grove", "Baker's Corner", "L'oven Fresh", "Priano",
    "Season's Choice", "Happy Farms", "Burman's", "Casa Mamita", "Stonemill",
    "Sundae Shoppe", "Reggano", "Elevation", "Park Street Deli", "Nature's Nectar",
    "Countryside Creamery", "Goldhen", "Kirkwood", "Appleton Farms", "Bremer",
    "Chef's Cupboard", "Benton's", "Cheese Club", "Earth Grown", "Emporium Selection",
    "Fusia", "Mama Cozzi's", "Savoritz", "Tuscan Garden", "Village Bakery",
    "Berryhill", "Happy Harvest", "Dakota's Pride", "Choceur", "Moser Roth",
    "Belmont", "Deutsche Kuche", "Never Any!", "Pueblo Lindo", "Winking Owl",
]


def clean(text):
    return " ".join((text or "").split()).strip()


def implausible(kcal, protein, carbs, fat):
    """Reject entries whose numbers cannot be true.

    Crowd-sourced data contains plenty of nonsense — an Aldi oats entry claiming
    975 kcal/100 g when its own macros imply 355. Shipping those means silently
    logging a meal at triple its real calories, which is worse than not having
    the food at all.
    """
    # Pure fat is 9 kcal/g, so nothing can exceed ~900 kcal per 100 g.
    if kcal <= 0 or kcal > 900:
        return True
    # Nor can the macros weigh more than the food does.
    if protein + carbs + fat > 101:
        return True
    # Where macros are present they should roughly account for the calories.
    # The band is wide on purpose: alcohol, polyols and rounding all shift it,
    # and fibre is counted inside carbohydrate by USDA.
    implied = protein * 4 + carbs * 4 + fat * 9
    if implied > 0 and (kcal > implied * 1.6 + 50 or kcal < implied * 0.5 - 50):
        return True
    return False


def usable_portion(label, grams):
    """Drop portion labels that are really internal codes, and absurd weights."""
    if not label or grams <= 0 or grams > 2000:
        return False
    # USDA leaks sequence numbers such as "90000" into portionDescription.
    if label.replace(".", "").isdigit():
        return False
    return True


def portions_from_usda(rec):
    """Household measures, e.g. ('1 cup', 240.0). Grams-only foods get none."""
    out = []
    for p in (rec.get("foodPortions") or []):
        grams = p.get("gramWeight")
        if not grams or grams <= 0:
            continue
        desc = clean(p.get("portionDescription") or "")
        if not desc or desc.lower() in ("undetermined", "quantity not specified"):
            unit = ((p.get("measureUnit") or {}).get("name") or "").strip()
            amount = p.get("amount")
            bits = []
            if amount:
                bits.append(f"{amount:g}")
            if unit and unit.lower() != "undetermined":
                bits.append(unit)
            mod = clean(p.get("modifier") or "")
            if mod and mod.lower() != "undetermined":
                bits.append(mod)
            desc = " ".join(bits).strip()
        if not usable_portion(desc, float(grams)):
            continue
        out.append([desc[:48], round(float(grams), 1)])
        if len(out) >= 4:
            break
    return out


def read_usda(filename, key, limit_note):
    path = os.path.join(USDA_DIR, filename)
    if not os.path.exists(path):
        print(f"  !! missing {path}", file=sys.stderr)
        return []
    with open(path) as fh:
        records = json.load(fh)[key]

    rows, skipped = [], 0
    for rec in records:
        nutrients = {}
        for n in rec.get("foodNutrients") or []:
            number = (n.get("nutrient") or {}).get("number")
            if number in (KCAL, PROTEIN, FAT, CARBS, FIBER):
                amount = n.get("amount")
                if amount is not None:
                    nutrients[number] = float(amount)
        kcal = nutrients.get(KCAL)
        # Without calories the entry cannot be logged; drop it rather than
        # shipping a food that silently contributes zero.
        if not kcal:
            skipped += 1
            continue
        if implausible(kcal, nutrients.get(PROTEIN, 0.0), nutrients.get(CARBS, 0.0), nutrients.get(FAT, 0.0)):
            skipped += 1
            continue
        name = clean(rec.get("description"))
        if not name:
            skipped += 1
            continue
        rows.append([
            name[:110],
            "",
            round(kcal, 1),
            round(nutrients.get(PROTEIN, 0.0), 2),
            round(nutrients.get(CARBS, 0.0), 2),
            round(nutrients.get(FAT, 0.0), 2),
            round(nutrients.get(FIBER, 0.0), 2),
            portions_from_usda(rec),
            "",
            SRC_USDA,
        ])
    print(f"  {limit_note}: {len(rows)} kept, {skipped} dropped (no calories)")
    return rows


def off_fetch(query, page, page_size=100):
    url = (
        "https://search.openfoodfacts.org/search?q="
        + urllib.parse.quote(query)
        + f"&page={page}&page_size={page_size}"
        + "&fields=code,product_name,brands,nutriments,countries_tags"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Salutt/0.1 (personal food log)"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


OFF_CACHE = os.path.join(USDA_DIR, "off-aldi-cache.json")


def read_off_aldi(max_pages=4):
    if os.path.exists(OFF_CACHE) and "--refresh-off" not in sys.argv:
        with open(OFF_CACHE) as fh:
            cached = json.load(fh)
        rows = [r for r in cached if not implausible(r[2], r[3], r[4], r[5])]
        print(f"    (cached) {len(rows)} kept of {len(cached)}; --refresh-off to re-fetch")
        return rows

    rows, seen = [], set()
    for brand in ALDI_BRANDS:
        query = f'brands:"{brand}" AND countries_tags:"en:united-states"'
        got = 0
        for page in range(1, max_pages + 1):
            try:
                data = off_fetch(query, page)
            except Exception as exc:
                print(f"    {brand}: {exc}", file=sys.stderr)
                break
            hits = data.get("hits") or []
            if not hits:
                break
            for h in hits:
                code = h.get("code") or ""
                if code in seen:
                    continue
                nut = h.get("nutriments") or {}
                kcal = nut.get("energy-kcal_100g")
                if kcal is None and nut.get("energy_100g") is not None:
                    kcal = float(nut["energy_100g"]) / 4.184
                if not kcal:
                    continue
                prot = float(nut.get("proteins_100g") or 0)
                carb = float(nut.get("carbohydrates_100g") or 0)
                fat_ = float(nut.get("fat_100g") or 0)
                if implausible(float(kcal), prot, carb, fat_):
                    continue
                name = clean(h.get("product_name"))
                if not name:
                    continue
                seen.add(code)
                brands = h.get("brands") or []
                if isinstance(brands, str):
                    brands = brands.split(",")
                rows.append([
                    name[:110],
                    clean(brands[0] if brands else brand)[:40],
                    round(float(kcal), 1),
                    round(prot, 2),
                    round(carb, 2),
                    round(fat_, 2),
                    round(float(nut.get("fiber_100g") or 0), 2),
                    [],
                    code,
                    SRC_OFF,
                ])
                got += 1
            if len(hits) < 100:
                break
            time.sleep(0.4)
        print(f"    {brand}: {got}")
    with open(OFF_CACHE, "w") as fh:
        json.dump(rows, fh)
    return rows


def main():
    print("USDA generic, prepared and restaurant foods:")
    foods = []
    foods += read_usda("FoodData_Central_foundation_food_json_2025-04-24.json", "FoundationFoods", "foundation")
    foods += read_usda("FoodData_Central_sr_legacy_food_json_2021-10-28.json", "SRLegacyFoods", "sr legacy")
    foods += read_usda("surveyDownload.json", "SurveyFoods", "survey / FNDDS")

    if "--skip-off" not in sys.argv:
        print("Open Food Facts, Aldi private labels (US):")
        foods += read_off_aldi()

    # Same food from two sources, or repeated within one: keep the first.
    seen, deduped = set(), []
    for f in foods:
        key = (f[0].lower(), f[1].lower())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(f)

    payload = {
        "version": 1,
        "schema": ["name", "brand", "kcal", "protein", "carbs", "fat", "fiber", "portions", "barcode", "source"],
        "sources": ["USDA FoodData Central", "Open Food Facts"],
        "foods": deduped,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)

    size = os.path.getsize(OUT)
    print(f"\n{len(deduped)} foods -> {OUT} ({size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
