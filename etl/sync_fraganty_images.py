"""
sync_fraganty_images.py -- match catalog products to fraganty.ai photos and
store the resulting URLs on dim_products (image_url, image_transparent_url),
AND best-effort infer scent_family from the same match's accords when a
product doesn't have one yet.

Paid API tier only -- see root CLAUDE.md's "Product images" section for the
licensing basis (commercial-distribution license grant + IP warranty +
indemnification, verified against the business owner's own read of
https://fraganty.ai/terms; fraganty.ai blocks automated access to that page,
so this was never independently re-checked by tooling). Requires
FRAGANTY_API_KEY in .env.

Matching is deliberately conservative: brand must share a token with the
candidate's brand (hard gate), and the product name's token-overlap score
against the best remaining candidate must clear MIN_SCORE. A wrong match
(showing a different product's bottle) is worse than no photo at all, and
the storefront already falls back to BottleGlyph's generated artwork
whenever image_url is NULL -- there's no broken-image case either way.

Family inference (added once the real 334-product inventory landed with
~68% of rows missing scent_family entirely) reuses the exact same search
match rather than a second pass -- fraganty doesn't return one family
field, it returns a weighted "accords" list (e.g. Sauvage: "Fresh Spicy"
100%, "Amber" 59%, "Citrus" 56%), so ACCORD_TO_FAMILY maps fraganty's
finer-grained accord vocabulary down to this catalog's own broader family
set, walking accords strongest-first and using the first one with a known
mapping. This is a best-effort heuristic, not a verified perfumer
classification -- an accord this mapping doesn't recognize is skipped
rather than guessed at, and a product with none of its accords mapped
stays NULL rather than getting a wrong label. Never overwrites a
scent_family that's already set (COALESCE at the SQL layer, belt-and-braces
with the Python-side selection query below).

Idempotent by default: skips products that already have BOTH image_url and
scent_family set, so re-running doesn't re-spend API calls on rows that are
already fully filled in. --force re-checks everything (e.g. once fraganty's
own catalog has grown, or to redo family inference with an updated
ACCORD_TO_FAMILY map).

The paid tier's daily request quota is a real, hard limit -- confirmed live
when a full 331-product run exhausted it outright (further calls the same
day came back {"error": "Daily limit exceeded", "dailyRemaining": 0}). A
plain re-run of this script the next day (no flags) is the intended retry:
it's already incremental (see above), so it naturally only re-queries
whatever's still missing image_url/scent_family, which by construction is
exactly last run's unmatched list. See also clean_search_query() and
SEARCH_LIMIT below -- both added after that same run showed the literal
DB product_name (colons and all) returning zero fraganty candidates for
several very mainstream products, not the narrow candidate pool a genuine
catalog gap would produce.

Usage:
    python sync_fraganty_images.py              # match unmatched products only
    python sync_fraganty_images.py --force       # re-check every active product
    python sync_fraganty_images.py --dry-run     # print matches, write nothing
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.parse

import psycopg
from dotenv import load_dotenv

API_BASE = "https://fraganty.ai/api"
MIN_SCORE = 0.5
# Confirmed live that the API rate-limits well under 0.2s spacing (see the
# retry-on-429 handling in search_fraganty) -- paced slower so most requests
# don't need that reactive backoff at all, just fewer, more predictable waits.
REQUEST_DELAY_SECONDS = 2.0
# 5 (fraganty's own apparent default) turned out too narrow for a generic,
# single-word product name shared across many brands ("Blue", "Man",
# "Woman") -- the real candidate can rank outside the top 5 and never reach
# best_match()'s brand-token gate at all. Wider costs nothing extra against
# the daily quota (still one request), just returns more candidates.
SEARCH_LIMIT = 15

# Stripped before comparing tokens -- present in our product_name/
# concentration or fraganty's title inconsistently enough that leaving them
# in would cost real matches (e.g. "Interlude Man Eau de Parfum" vs
# "Interlude Man") without adding any actual signal.
NOISE_WORDS = {
    "eau", "de", "parfum", "toilette", "cologne", "edp", "edt", "edc",
    "spray", "for", "men", "women", "man", "woman", "unisex", "ml",
}

# fraganty's accord names (Fragrantica-style, ~50-100 fine-grained terms) ->
# this catalog's own broader scent_family set. Deliberately incomplete
# rather than guessed wide: an accord not listed here is skipped in favor of
# the next-strongest one that IS, rather than forced into a family it
# doesn't really belong to. Family set matches what's actually in the real
# inventory after the Spicy/Green singleton merge (see CLAUDE.md/this
# migration's family-simplification pass) -- e.g. "Warm Spicy" maps to
# Amber/Oriental and plain "Green" maps to Fresh/Aquatic, matching where
# those two merged singletons went, not their own former buckets.
ACCORD_TO_FAMILY = {
    # Woody
    "woody": "Woody", "woody aromatic": "Woody", "cedar": "Woody",
    "sandalwood": "Woody", "oud": "Woody", "patchouli": "Woody",
    "vetiver": "Woody", "earthy": "Woody", "dry woods": "Woody",
    "mossy woods": "Woody", "nutty": "Woody", "tobacco": "Woody",
    "leather": "Woody",
    # Amber/Oriental
    "amber": "Amber/Oriental", "warm spicy": "Amber/Oriental",
    "spicy": "Amber/Oriental", "balsamic": "Amber/Oriental",
    "powdery": "Amber/Oriental", "musky": "Amber/Oriental",
    "animalic": "Amber/Oriental", "incense": "Amber/Oriental",
    "resinous": "Amber/Oriental", "oriental": "Amber/Oriental",
    "smoky": "Amber/Oriental", "honey": "Amber/Oriental",
    # Floral
    "floral": "Floral", "white floral": "Floral", "rose": "Floral",
    "jasmine": "Floral", "powdery floral": "Floral", "tuberose": "Floral",
    "iris": "Floral", "violet": "Floral", "ylang ylang": "Floral",
    "fruity floral": "Floral",
    # Aromatic
    "aromatic": "Aromatic", "lavender": "Aromatic", "herbal": "Aromatic",
    "anisic": "Aromatic", "fennel": "Aromatic",
    # Fresh/Aquatic
    "fresh": "Fresh/Aquatic", "aquatic": "Fresh/Aquatic",
    "marine": "Fresh/Aquatic", "ozonic": "Fresh/Aquatic",
    "fresh spicy": "Fresh/Aquatic", "watery": "Fresh/Aquatic",
    "green": "Fresh/Aquatic",
    # Fougère
    "fougere": "Fougère", "aromatic fougere": "Fougère",
    # Gourmand
    "vanilla": "Gourmand", "sweet": "Gourmand", "gourmand": "Gourmand",
    "coffee": "Gourmand", "chocolate": "Gourmand", "caramel": "Gourmand",
    "praline": "Gourmand", "fruity sweet": "Gourmand", "tonka": "Gourmand",
    # Citrus
    "citrus": "Citrus", "fresh citrus": "Citrus", "bergamot": "Citrus",
    "lemon": "Citrus", "orange": "Citrus", "yuzu": "Citrus",
    "grapefruit": "Citrus",
    # Chypre folds into Woody rather than getting its own family: this
    # catalog's real accord mix only ever produced one Chypre-classified
    # product (Nishane Hacivat, reassigned to Woody -- its own mossy/oakmoss
    # base is exactly the "mossy woods" case already mapped to Woody above),
    # and a scent-family filter option with a single result isn't useful.
    # If the catalog ever grows enough distinct chypre fragrances to justify
    # a real filter bucket, split this back out deliberately -- don't let it
    # happen by accident one fraganty match at a time.
    "chypre": "Woody", "mossy": "Woody",
}


def family_from_accords(accords):
    """Walk accords strongest-first, return the family of the first one
    with a known mapping, or None if none of them map to anything."""
    if not accords:
        return None
    for accord in sorted(accords, key=lambda a: a.get("strength", 0), reverse=True):
        family = ACCORD_TO_FAMILY.get((accord.get("name") or "").strip().lower())
        if family:
            return family
    return None


def get_conn():
    load_dotenv()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set in .env")
    # prepare_threshold=None: psycopg auto-prepares a repeated query
    # server-side after 5 uses by default. Confirmed live -- this script
    # runs the same parameterized UPDATE once per match in a loop, and the
    # 6th+ use failed with "prepared statement ... does not exist" once
    # Supabase's transaction-mode pooler routed a later request to a
    # different backend connection than the one that PREPAREd it. Same
    # underlying issue as `prepare: false` on the Node side in lib/db.ts --
    # the pooler doesn't support prepared statements in transaction mode.
    return psycopg.connect(url, prepare_threshold=None)


def get_api_key():
    load_dotenv()
    key = os.environ.get("FRAGANTY_API_KEY")
    if not key:
        sys.exit("FRAGANTY_API_KEY is not set in .env")
    return key


def normalize(text):
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return [t for t in text.split() if t and t not in NOISE_WORDS]


def token_overlap_score(a_tokens, b_tokens):
    if not a_tokens or not b_tokens:
        return 0.0
    a, b = set(a_tokens), set(b_tokens)
    return len(a & b) / len(a | b)


def clean_search_query(product_name: str) -> str:
    """Strip a "Line: Variant" colon before searching -- confirmed live
    that querying fraganty for the literal DB spelling ("Brit: For Her")
    returns zero candidates, while the same product minus the colon almost
    certainly doesn't (Burberry Brit is far too mainstream to actually be
    missing from a fragrance database). This is our own product_name's
    formatting convention, not fraganty's -- "212: Rose New York", "Coach
    Dreams: moonlight", "Flora: Gorgeous Gardenia" all follow it. Collapses
    to a single space rather than just deleting the colon, so no words run
    together."""
    return re.sub(r"\s*:\s*", " ", product_name).strip()


def search_fraganty(api_key, query, limit=SEARCH_LIMIT):
    # Shells out to curl rather than urllib/ssl: this server's TLS chain is
    # missing an intermediate cert that Windows' native TLS stack (which
    # curl uses here) fetches on the fly via AIA chaining -- Python's
    # OpenSSL-based ssl module doesn't do that by default, and fails the
    # same way whether it's pointed at the Windows cert store or certifi's
    # static bundle. curl has been reliable against this exact domain
    # throughout development; don't "simplify" this back to urllib.
    url = f"{API_BASE}/perfumes?{urllib.parse.urlencode({'q': query, 'limit': limit})}"

    # The API rate-limits (confirmed live: {"error": "Rate limit exceeded",
    # "retryAfterMs": N}) rather than returning empty results -- treating
    # that response as "no match" would have silently mislabeled real
    # products as unmatched. Back off for exactly as long as it says and
    # retry the same request instead.
    while True:
        # encoding="utf-8" explicitly -- fraganty's JSON responses are UTF-8
        # (accented brand/perfume names throughout: Estée Lauder, Grès,
        # Rosé, 360°...), but text=True alone decodes subprocess output
        # using the ambient console codepage, cp1252 on this Windows
        # machine. Confirmed live: that's silently produced mojibake all
        # session ("Est?e Lauder") for characters that happen to have SOME
        # cp1252 mapping, and hard-crashed with UnicodeDecodeError for ones
        # that don't (Givenchy's catalog has one) -- explicit encoding
        # fixes both at once.
        result = subprocess.run(
            ["curl", "-s", "--max-time", "15", "-H", f"X-API-Key: {api_key}", url],
            capture_output=True, text=True, encoding="utf-8", check=True,
        )
        data = json.loads(result.stdout)
        if isinstance(data, dict) and data.get("error") == "Rate limit exceeded":
            wait_s = (data.get("retryAfterMs", 5000) / 1000) + 1
            print(f"    rate limited, waiting {wait_s:.0f}s...")
            time.sleep(wait_s)
            continue
        return data


def url_ok(url):
    result = subprocess.run(
        ["curl", "-s", "-o", os.devnull, "-w", "%{http_code}", "--max-time", "10", "-I", url],
        capture_output=True, text=True,
    )
    return result.stdout.strip() == "200"


def best_match(brand, product_name, candidates):
    brand_tokens = normalize(brand)
    name_tokens = normalize(product_name)

    best, best_score = None, 0.0
    for c in candidates:
        c_brand_tokens = normalize(c.get("brand"))
        # Hard gate: brand must share at least one token. High name-overlap
        # against the wrong house is exactly the false positive this exists
        # to block (e.g. matching "Chrome" to the wrong brand's "Chrome").
        if not brand_tokens or not c_brand_tokens:
            continue
        if not (set(brand_tokens) & set(c_brand_tokens)):
            continue

        score = token_overlap_score(name_tokens, normalize(c.get("name")))
        if score > best_score:
            best, best_score = c, score

    if best and best_score >= MIN_SCORE:
        return best, best_score
    return None, best_score


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-check products that already have a match")
    ap.add_argument("--dry-run", action="store_true", help="print matches without writing to the DB")
    args = ap.parse_args()

    api_key = get_api_key()
    conn = get_conn()
    # Commit per-row rather than one transaction around the whole run -- if
    # the tier's rate limit means this can't finish in one sitting, every
    # match found before that point is already saved and already showing up
    # on the site, not sitting invisible in an uncommitted transaction that
    # a kill/crash would roll back to nothing. Must be set before the first
    # query -- psycopg won't allow flipping it mid-transaction.
    conn.autocommit = True

    with conn.cursor() as cur:
        if args.force:
            cur.execute(
                "SELECT sku, brand, product_name, scent_family FROM dim_products "
                "WHERE is_active ORDER BY brand, product_name"
            )
        else:
            cur.execute(
                "SELECT sku, brand, product_name, scent_family FROM dim_products "
                "WHERE is_active AND (image_url IS NULL OR scent_family IS NULL) "
                "ORDER BY brand, product_name"
            )
        rows = cur.fetchall()

    print(f"Checking {len(rows)} product(s) against fraganty.ai...", flush=True)
    matched = 0
    unmatched = []

    family_inferred = 0

    for i, (sku, brand, product_name, current_family) in enumerate(rows, 1):
        # Search matches phrases against fraganty's `name` field alone --
        # brand isn't part of that text, so a combined "Dior Sauvage" query
        # matches nothing where "Sauvage" (the actual title) matches
        # perfectly. Query by name only; the brand-token gate in
        # best_match() does the brand filtering against the candidates
        # this turns up.
        try:
            result = search_fraganty(api_key, clean_search_query(product_name))
        except Exception as e:
            print(f"  [{i}/{len(rows)}] ERROR searching for {brand} {product_name!r}: {e}", flush=True)
            unmatched.append((sku, brand, product_name, "api error"))
            time.sleep(REQUEST_DELAY_SECONDS)
            continue

        candidates = result.get("data", [])
        match, score = best_match(brand, product_name, candidates)

        if not match:
            print(
                f"  [{i}/{len(rows)}] no match: {brand} {product_name!r} (best score {score:.2f})",
                flush=True,
            )
            unmatched.append(
                (sku, brand, product_name, f"no confident match (best score {score:.2f})")
            )
            time.sleep(REQUEST_DELAY_SECONDS)
            continue

        image_url = match.get("image")
        transparent_url = match.get("imageTransparent")
        if not transparent_url or not url_ok(transparent_url):
            transparent_url = None

        inferred_family = None
        if current_family is None:
            inferred_family = family_from_accords(match.get("accords"))
            if inferred_family:
                family_inferred += 1

        family_note = f", family -> {inferred_family!r}" if inferred_family else ""
        print(
            f"  [{i}/{len(rows)}] MATCH {brand} {product_name!r} -> {match.get('name')!r} "
            f"(score {score:.2f}{family_note})",
            flush=True,
        )
        matched += 1

        if not args.dry_run:
            with conn.cursor() as cur:
                # COALESCE on scent_family: never overwrite one that's
                # already set, belt-and-braces with the WHERE clause above
                # already excluding rows that have one (force mode doesn't).
                cur.execute(
                    "UPDATE dim_products SET image_url = %s, image_transparent_url = %s, "
                    "scent_family = COALESCE(dim_products.scent_family, %s), "
                    "updated_at = now() WHERE sku = %s",
                    (image_url, transparent_url, inferred_family, sku),
                )

        time.sleep(REQUEST_DELAY_SECONDS)

    print(f"\nMatched {matched}/{len(rows)} (family inferred for {family_inferred}).", flush=True)
    if unmatched:
        print(f"{len(unmatched)} unmatched (falls back to BottleGlyph):")
        for sku, brand, product_name, reason in unmatched:
            print(f"  {sku}: {brand} {product_name!r} -- {reason}")

    if args.dry_run:
        print("\n(dry run -- nothing written)")


if __name__ == "__main__":
    main()
