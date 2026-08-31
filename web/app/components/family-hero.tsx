import { FAMILY_BLURB, hueFor } from "@/lib/format";
import { ProductPhoto } from "./product-photo";
import type { Product } from "@/lib/products";

/**
 * Shown above the grid only when a specific scent family is active (see
 * app/page.tsx) -- not on the unfiltered "Everything" view, where there's no
 * single family to introduce. Uses the same real bottle photography as the
 * grid itself (ProductPhoto, same licensing basis -- see root CLAUDE.md's
 * "Product images" section), arranged as a small overlapping cluster rather
 * than a single hero image, so it reads as "a few examples from this
 * family" rather than picking one bottle to represent the whole category.
 */
export function FamilyHero({ family, products }: { family: string; products: Product[] }) {
  const hue = hueFor(family);
  const blurb = FAMILY_BLURB[family];
  // A handful of real photos have no transparent (background-removed) variant
  // at all -- fraganty.ai's own catalog doesn't have one for every match (see
  // sync_fraganty_images.py) -- and those render with a visible white
  // rectangle against this section's colored backdrop, unlike everywhere else
  // on the site where every photo sits on a plain card. Grid tiles hide this;
  // this decorative cluster can't, so it prefers photos that do have a
  // transparent variant and only falls back to ones that don't if a family
  // has fewer than 4 qualifying products.
  const withTransparent = products.filter((p) => p.image_transparent_url);
  const withoutTransparent = products.filter((p) => !p.image_transparent_url);
  const cluster = [...withTransparent, ...withoutTransparent].slice(0, 4);

  return (
    <section className="family-hero" style={{ ["--family-hue" as string]: hue }}>
      <div className="family-hero-text">
        <p className="family-hero-eyebrow">Scent family</p>
        <h1 className="family-hero-name">{family}</h1>
        {blurb && <p className="family-hero-blurb">{blurb}</p>}
      </div>

      {cluster.length > 0 && (
        <div className="family-hero-cluster" aria-hidden="true">
          {cluster.map((p, i) => (
            <ProductPhoto
              key={p.sku}
              sku={p.sku}
              brand={p.brand}
              family={p.scent_family}
              variant="hero"
              className="family-hero-photo"
              imageUrl={p.image_url}
              imageTransparentUrl={p.image_transparent_url}
              style={{ "--i": i } as React.CSSProperties}
            />
          ))}
        </div>
      )}
    </section>
  );
}
