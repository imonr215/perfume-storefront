"""
generate_descriptions.py -- rewrite the "Description (optional)" column with
richer, less repetitive shop copy generated from the inventory's own note
pyramid / scent family / gender / concentration data.

Not pulled from Fragrantica or anywhere else -- same reasoning as the
storefront's generated bottle-glyph work (see app/components/bottle-glyph.tsx):
their write-ups are copyrighted editorial content, not ours to republish.
Every fragrance here already has real top/heart/base notes, a scent family,
a gender, and a concentration in this spreadsheet -- this script writes
better prose around facts that were already there, instead of the templated
one-liner the demo data shipped with ("Crisp and herbal everyday scent —
opens with bergamot and settles into ambroxan.", repeated almost verbatim
for every Aromatic fragrance and ignoring the heart notes entirely).

Usage:
    python generate_descriptions.py --file Perfume_Inventory_100.xlsx --dry-run
    python generate_descriptions.py --file Perfume_Inventory_100.xlsx --write-xlsx
    python generate_descriptions.py --file Perfume_Inventory_100.xlsx --sql-out update_descriptions.sql
"""

import argparse
import hashlib
import re

import pandas as pd

SHEET_NAME = "Inventory"
HEADER_ROW = 1

# A handful of varied phrasings per scent family so products in the same
# family don't all read identically -- rotated deterministically by SKU
# (see `pick`), not randomly, so re-runs are stable.
FAMILY_PHRASES = {
    "Citrus": [
        "Bright and zesty from the first spray, effervescent rather than sweet",
        "Sharp and sparkling, built for warm afternoons",
        "Sunlit and clean, never heavy",
    ],
    "Fresh/Aquatic": [
        "Cool and marine, like sea spray on skin",
        "Clean and breezy, the fragrance equivalent of an open window",
        "Airy and transparent, built to feel weightless",
    ],
    "Green": [
        "Crisp and leafy, like something just cut from the garden",
        "Verdant and cool, with a bitter-green backbone",
        "Grassy and sharp, unmistakably outdoors",
    ],
    "Aromatic": [
        "Herbal and crisp, with a peppery, energetic edge",
        "Sharp and green-tinged, built for movement",
        "Brisk and confident, the classic aromatic snap",
    ],
    "Fougère": [
        "Classically barbershop-fresh, lavender over ferny green",
        "Structured and cool, a modern take on an old formula",
        "Crisp and herbal with a soapy, clean-shaven finish",
    ],
    "Floral": [
        "Soft-petaled and radiant, built around a true floral heart",
        "Delicate but never quiet, a bouquet that lingers",
        "Romantic and airy, blooming outward as it wears",
    ],
    "Chypre": [
        "Mossy and complex, old-world in the best way",
        "Earthy and refined, with real depth to it",
        "Structured and sophisticated, rewards a second sniff",
    ],
    "Woody": [
        "Warm and grounded, built around a real wood backbone",
        "Smooth and confident, fills a room quietly",
        "Dry and textured, more sweater than cologne",
    ],
    "Amber/Oriental": [
        "Warm and resinous, glowing rather than shouting",
        "Rich and enveloping, built for cooler nights",
        "Spiced and sensual, the kind of scent people lean in for",
    ],
    "Gourmand": [
        "Sweet and edible without tipping into dessert",
        "Warm and comforting, like something baked",
        "Indulgent and cozy, built around real sweetness",
    ],
    "Leather": [
        "Smoky and supple, real leather rather than an idea of it",
        "Dry and worn-in, with real edge to it",
        "Dark and textured, with some grit to it",
    ],
    "Spicy": [
        "Warm-spiced and alive, with real heat to it",
        "Peppery and confident, built to be noticed",
        "Richly spiced, the opposite of quiet",
    ],
}

GENDER_PHRASES = {
    "Masculine": [
        "a dependable, everyday men's signature",
        "an easy, no-fuss pick for daily wear",
        "a confident one-bottle-does-it-all choice",
    ],
    "Feminine": [
        "a versatile, everyday signature",
        "an easy, wear-anywhere choice",
        "a confident one-bottle-does-it-all pick",
    ],
    "Unisex": [
        "built to wear well on anyone",
        "genuinely unisex, no gendered marketing required",
        "flexible enough for any wardrobe",
    ],
}

CONCENTRATION_PHRASES = {
    "EDT": "light enough for daytime, with a few hours of wear",
    "EDP": "concentrated enough to carry into the evening",
    "Parfum": "the most concentrated cut here, built to last all day",
    "Cologne": "a lighter, splashier cut, best refreshed through the day",
}

DEFAULT_FAMILY_PHRASE = "Distinctive and well-built, a scent with real character"
DEFAULT_GENDER_PHRASE = "a versatile, everyday choice"
DEFAULT_CONCENTRATION_PHRASE = "true to its concentration in how long it wears"


def slug(text) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", str(text).upper()).strip("-")


def pick(pool: dict, key: str, sku: str):
    """Deterministic rotation through a phrase pool, keyed by SKU so the
    same product gets the same phrasing every time this is re-run."""
    options = pool.get(key)
    if not options:
        return None
    index = int(hashlib.sha256(sku.encode()).hexdigest(), 16) % len(options)
    return options[index]


def parse_notes(value) -> list[str]:
    if pd.isna(value) or not str(value).strip():
        return []
    return [n.strip() for n in str(value).split(",") if n.strip()]


def join_notes(notes: list[str], limit: int) -> str | None:
    picked = [n.lower() for n in notes[:limit] if n]
    if not picked:
        return None
    if len(picked) == 1:
        return picked[0]
    if len(picked) == 2:
        return f"{picked[0]} and {picked[1]}"
    return f"{', '.join(picked[:-1])} and {picked[-1]}"


def build_description(row, sku: str) -> str:
    top = join_notes(parse_notes(row.get("Top Notes")), 3)
    heart = join_notes(parse_notes(row.get("Heart Notes")), 2)
    base = join_notes(parse_notes(row.get("Base Notes")), 2)

    clauses = []
    if top:
        clauses.append(f"opens with {top}")
    if heart:
        clauses.append(f"moves through {heart}")
    if base:
        clauses.append(f"settles into {base}")
    sentence1 = (", ".join(clauses) + ".").capitalize() if clauses else ""

    family = str(row.get("Scent Family") or "").strip()
    gender = str(row.get("Gender") or "").strip()
    concentration = str(row.get("Concentration") or "").strip()

    family_phrase = pick(FAMILY_PHRASES, family, sku) or DEFAULT_FAMILY_PHRASE
    gender_phrase = pick(GENDER_PHRASES, gender, sku) or DEFAULT_GENDER_PHRASE
    concentration_phrase = CONCENTRATION_PHRASES.get(concentration, DEFAULT_CONCENTRATION_PHRASE)

    sentence2 = f"{family_phrase} — {gender_phrase}, {concentration_phrase}."

    return f"{sentence1} {sentence2}".strip()


def load(file: str) -> pd.DataFrame:
    df = pd.read_excel(file, sheet_name=SHEET_NAME, header=HEADER_ROW)
    df.columns = [c.strip() for c in df.columns]
    df = df[df["Brand"].notna() & df["Product Name"].notna() & df["Size"].notna()].copy()
    df["SKU"] = df.apply(lambda r: slug(f"{r['Brand']}-{r['Product Name']}-{r['Size']}"), axis=1)
    return df.reset_index(drop=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--dry-run", action="store_true", help="preview only, no writes")
    ap.add_argument("--write-xlsx", action="store_true", help="overwrite the Description column in the workbook")
    ap.add_argument("--sql-out", help="write a SQL file that UPDATEs dim_products.description by sku")
    args = ap.parse_args()

    df = load(args.file)
    df["New Description"] = df.apply(lambda r: build_description(r, r["SKU"]), axis=1)

    print(f"{len(df)} products.\n")
    sample = df.sample(min(6, len(df)), random_state=1)
    for _, r in sample.iterrows():
        print(f"{r['Brand']} {r['Product Name']} ({r['SKU']})")
        print(f"  old: {r['Description (optional)']}")
        print(f"  new: {r['New Description']}\n")

    if args.dry_run:
        return

    if args.sql_out:
        with open(args.sql_out, "w", encoding="utf-8") as f:
            f.write("-- Generated by generate_descriptions.py -- shop copy built from the\n")
            f.write("-- inventory's own note/family/gender/concentration data, not scraped.\n")
            f.write("BEGIN;\n")
            for _, r in df.iterrows():
                escaped = r["New Description"].replace("'", "''")
                f.write(
                    f"UPDATE dim_products SET description = '{escaped}', updated_at = now() "
                    f"WHERE sku = '{r['SKU']}';\n"
                )
            f.write("COMMIT;\n")
        print(f"Wrote {args.sql_out} ({len(df)} statements).")

    if args.write_xlsx:
        import openpyxl

        wb = openpyxl.load_workbook(args.file)
        ws = wb[SHEET_NAME]
        header_row_idx = HEADER_ROW + 1  # openpyxl rows are 1-indexed
        headers = {cell.value: cell.column for cell in ws[header_row_idx]}
        desc_col = headers["Description (optional)"]
        brand_col, name_col, size_col = headers["Brand"], headers["Product Name"], headers["Size"]

        new_by_sku = dict(zip(df["SKU"], df["New Description"]))
        updated = 0
        for row_idx in range(header_row_idx + 1, ws.max_row + 1):
            brand = ws.cell(row_idx, brand_col).value
            name = ws.cell(row_idx, name_col).value
            size = ws.cell(row_idx, size_col).value
            if not brand or not name or not size:
                continue
            sku = slug(f"{brand}-{name}-{size}")
            if sku in new_by_sku:
                ws.cell(row_idx, desc_col).value = new_by_sku[sku]
                updated += 1
        wb.save(args.file)
        print(f"Updated {updated} descriptions in {args.file}.")


if __name__ == "__main__":
    main()
