"""
sku.py -- the one, shared place SKUs get built from spreadsheet fields.

Used by clover_import.py, sync_products.py, and generate_descriptions.py.
Before this file existed, all three had their own copy-pasted slug()/SKU
logic -- which is exactly the trap CLAUDE.md's "One function, used
everywhere" gotcha warns about for make_sku(): three independent copies
drift the moment any one of them changes, and nothing catches it until a
join silently breaks. Import from here, don't re-implement.

Concentration is part of the key as of 2026-08-16: a real inventory import
(Perry Ellis "360deg", Lacoste "L.12.12 Blanc", Bvlgari "Pour Homme") turned
up genuine Brand+Name+Size collisions across EDT/EDP variants of the same
fragrance -- the importer's own duplicate-SKU guard (square_import.py at the
time; the same check lives in clover_import.py now) caught it and refused
to import rather than silently merging two distinct real products. This
also brought dim_products in line with how the catalog importer already
grouped products: one group per brand+name+concentration, with size as the
variant -- make_sku() was the one place still missing concentration from
that grouping key.

Concentration is skipped from the slug (not left as an empty segment) when
blank -- some products genuinely don't have one on record yet (e.g. a
classic cologne that predates the EDT/EDP split), and "BRAND-NAME--SIZE"
with a stray double dash is worse than just "BRAND-NAME-SIZE".
"""

import re


def slug(text) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", str(text).upper()).strip("-")


def make_sku(brand, name, concentration, size) -> str:
    parts = [slug(brand), slug(name)]
    # concentration may arrive as None, "", or pandas' NaN for a genuinely
    # blank cell (e.g. Coty Aspen, never split into EDT/EDP) -- NaN is
    # truthy in Python, so a plain `if concentration` check doesn't catch
    # it and str(nan) would otherwise slug into a bogus "NAN" segment.
    conc_str = "" if concentration is None else str(concentration).strip()
    if conc_str.lower() in ("", "nan", "none"):
        conc_str = ""
    # Check the *slugged* result, not just the raw string -- a concentration
    # that's non-blank but entirely non-alphanumeric (e.g. "***") slugs to
    # "", and appending that anyway would leave a stray double dash
    # ("COTY-ASPEN--118ML") instead of skipping the segment cleanly.
    conc_slug = slug(conc_str) if conc_str else ""
    if conc_slug:
        parts.append(conc_slug)
    parts.append(slug(size))
    return "-".join(parts)
