import { BottleGlyph } from "./bottle-glyph";

/**
 * Drop-in for BottleGlyph (see that file's own comment: "this component and
 * its callers can go away in one pass") -- real product photography from the
 * fraganty.ai paid API where a confident match exists (etl/sync_fraganty_images.py),
 * falling back to the generated glyph otherwise. See root CLAUDE.md's
 * "Product images" section for the licensing basis for these photos.
 *
 * No client-side fallback logic on purpose: the sync script already
 * confirmed each URL it wrote resolves (HEAD-checked at sync time, and
 * these CDN URLs are documented immutable/cached for a year), so a null
 * imageUrl is the only "no photo" case the storefront ever needs to
 * handle, and that's known at render time -- no onError, no client JS.
 */
export function ProductPhoto({
  sku,
  brand,
  family,
  variant,
  className,
  imageUrl,
  imageTransparentUrl,
  style,
}: {
  sku: string;
  brand: string;
  family: string | null;
  variant: string;
  className?: string;
  imageUrl?: string | null;
  imageTransparentUrl?: string | null;
  style?: React.CSSProperties;
}) {
  const src = imageTransparentUrl ?? imageUrl;
  if (!src) {
    return (
      <BottleGlyph
        sku={sku}
        brand={brand}
        family={family}
        variant={variant}
        className={className}
        style={style}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- external CDN
    // image with no fixed dimensions known ahead of time (varies per photo);
    // next/image would need width/height or a sized relative wrapper at
    // every call site for what's otherwise a straight swap-in for an SVG
    // that's always sized by its className alone.
    <img
      src={src}
      alt={`${brand} bottle`}
      loading="lazy"
      className={className ? `${className} product-photo` : "product-photo"}
      style={style}
    />
  );
}
