import { hueFor } from "@/lib/format";

const LABEL_X = 24;
const LABEL_WIDTH = 72;
const LABEL_TEXT_WIDTH = LABEL_WIDTH - 8; // padding on each side
const FONT_SIZE = 12;
// Rough average glyph width factor for the display serif -- good enough to
// decide "will this line overflow", not pixel-perfect metrics.
const AVG_CHAR_WIDTH_FACTOR = 0.56;
const MAX_CHARS_PER_LINE = 12;

/** Greedily wraps to at most 2 lines; anything past that gets folded onto
 *  the second line and compressed to fit (see `textLength` below) rather
 *  than growing a third line or truncating the name. */
function wrapBrand(brand: string): string[] {
  const words = brand.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > MAX_CHARS_PER_LINE) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  if (lines.length > 2) {
    return [lines[0], lines.slice(1).join(" ")];
  }
  return lines.length ? lines : ["?"];
}

/**
 * Generated stand-in for a product photo -- not a scraped or licensed image.
 * Tri-band tint echoes the pyramid rail's top/heart/base motif already used
 * on the cards, so it reads as part of the same visual system rather than a
 * bolted-on placeholder. Swap for a real photo (see lib/products.ts) once
 * one exists; this component and its callers can go away in one pass.
 *
 * The brand name is set in the site's own display serif rather than an
 * attempt to match each brand's actual wordmark -- those are almost always
 * custom-cut lettering with nothing to license or fetch, and mimicking a
 * specific brand's mark on a third-party storefront isn't a road worth
 * going down (same reasoning as not scraping Fragrantica's photos).
 *
 * `variant` plus `sku` keep the internal clipPath id unique when the same
 * product's glyph is rendered more than once on a page at a time (e.g. a
 * grid card and its own quick-view modal open simultaneously).
 */
export function BottleGlyph({
  sku,
  brand,
  family,
  variant,
  className,
  style,
}: {
  sku: string;
  brand: string;
  family: string | null;
  variant: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const hue = hueFor(family);
  const lines = wrapBrand(brand);
  const clipId = `bottle-clip-${variant}-${sku}`;
  // Vertically center 1 or 2 lines around the label's midpoint (y=96).
  const lineHeight = 15;
  const startY = 96 - ((lines.length - 1) * lineHeight) / 2 + 4;

  return (
    <svg
      viewBox="0 0 120 160"
      className={className}
      style={style}
      role="img"
      aria-label={`Illustration standing in for a product photo of ${brand}`}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="20" y="42" width="80" height="104" rx="14" />
        </clipPath>
      </defs>

      {/* cap + neck */}
      <rect x="42" y="10" width="36" height="20" rx="4" fill="var(--ink)" />
      <rect x="52" y="28" width="16" height="16" fill="var(--ink)" opacity="0.85" />

      {/* body outline */}
      <rect
        x="20"
        y="42"
        width="80"
        height="104"
        rx="14"
        fill="var(--paper)"
        stroke="var(--edge)"
        strokeWidth="2"
      />

      {/* tri-band tint, echoing the top/heart/base pyramid rail */}
      <g clipPath={`url(#${clipId})`}>
        <rect x="20" y="42" width="80" height="32" fill={hue} opacity="0.3" />
        <rect x="20" y="74" width="80" height="34" fill={hue} opacity="0.55" />
        <rect x="20" y="108" width="80" height="38" fill={hue} opacity="0.85" />
      </g>

      {/* label */}
      <rect x={LABEL_X} y="78" width={LABEL_WIDTH} height="36" rx="2" fill="var(--paper)" />
      <text
        textAnchor="middle"
        fontSize={FONT_SIZE}
        fontFamily="var(--font-display), Georgia, serif"
        fontWeight="600"
        fill={hue}
      >
        {lines.map((line, i) => {
          // Long collapsed lines (see wrapBrand's >2-line fallback) get a
          // smaller size first so textLength isn't doing all the work --
          // squishing glyphs too hard to fit reads worse than just being
          // a little smaller.
          const lineFontSize = line.length > 15 ? FONT_SIZE - 2 : FONT_SIZE;
          const overflows = line.length * lineFontSize * AVG_CHAR_WIDTH_FACTOR > LABEL_TEXT_WIDTH;
          return (
            <tspan
              key={i}
              x="60"
              y={startY + i * lineHeight}
              fontSize={lineFontSize}
              {...(overflows
                ? { textLength: LABEL_TEXT_WIDTH, lengthAdjust: "spacingAndGlyphs" }
                : {})}
            >
              {line}
            </tspan>
          );
        })}
      </text>
    </svg>
  );
}
