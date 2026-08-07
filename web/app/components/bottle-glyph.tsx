import { hueFor } from "@/lib/format";

/**
 * Generated stand-in for a product photo -- not a scraped or licensed image.
 * Tri-band tint echoes the pyramid rail's top/heart/base motif already used
 * on the cards, so it reads as part of the same visual system rather than a
 * bolted-on placeholder. Swap for a real photo (see lib/products.ts) once
 * one exists; this component and its callers can go away in one pass.
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
}: {
  sku: string;
  brand: string;
  family: string | null;
  variant: string;
  className?: string;
}) {
  const hue = hueFor(family);
  const initial = brand.trim().charAt(0).toUpperCase() || "?";
  const clipId = `bottle-clip-${variant}-${sku}`;

  return (
    <svg
      viewBox="0 0 120 160"
      className={className}
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
      <rect x="32" y="80" width="56" height="32" rx="2" fill="var(--paper)" />
      <text
        x="60"
        y="104"
        textAnchor="middle"
        fontSize="24"
        fontFamily="var(--font-display), Georgia, serif"
        fontWeight="600"
        fill={hue}
      >
        {initial}
      </text>
    </svg>
  );
}
