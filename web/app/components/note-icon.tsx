/**
 * Small line-art icon per fragrance note. Original geometry built from
 * primitive shapes (circles/ellipses/lines, mostly arranged by rotating a
 * shape around a center point) -- not traced or copied from any reference
 * icon set. There are ~185 distinct note names across the catalog, so this
 * isn't a bespoke icon per note: it's a curated set for the ~25 most common
 * ingredients (covers most of the note *occurrences*, since a handful of
 * notes like bergamot/vanilla/jasmine repeat constantly) plus a handful of
 * category fallbacks resolved by keyword, and one final generic fallback so
 * every note still gets *something*.
 */

const PETAL_ANGLES_5 = [0, 72, 144, 216, 288];
const PETAL_ANGLES_6 = [0, 60, 120, 180, 240, 300];

/** 5 (or 6) petals as thin ellipses rotated around the center -- the
 *  building block for every flower-shaped icon below. */
function Petals({
  angles = PETAL_ANGLES_5,
  rx = 2,
  ry = 4.4,
  offset = 4.2,
  filled = false,
}: {
  angles?: number[];
  rx?: number;
  ry?: number;
  offset?: number;
  filled?: boolean;
}) {
  return (
    <>
      {angles.map((deg) => (
        <ellipse
          key={deg}
          cx="12"
          cy={12 - offset}
          rx={rx}
          ry={ry}
          transform={`rotate(${deg} 12 12)`}
          fill={filled ? "currentColor" : "none"}
          fillOpacity={filled ? 0.15 : undefined}
        />
      ))}
    </>
  );
}

/** A rounded flower built from overlapping circles instead of pointed
 *  petals -- reads as a fuller bloom (rose, peony) rather than a star. */
function RoundBloom({ angles = PETAL_ANGLES_5, r = 3.4, offset = 3.4 }) {
  return (
    <>
      {angles.map((deg) => (
        <circle
          key={deg}
          cx="12"
          cy={12 - offset}
          r={r}
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
    </>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  citrus: (
    <>
      <circle cx="12" cy="12" r="8" />
      {PETAL_ANGLES_6.map((deg) => (
        <line
          key={deg}
          x1="12"
          y1="12"
          x2="12"
          y2="5"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  neroli: (
    <>
      <Petals rx={2.4} ry={4} offset={4} />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    </>
  ),
  vanilla: (
    <>
      <path d="M6,19 C4,13 6,6 17,5 C18,8 15,10 12,11 C10,13 9,16 6,19 Z" />
      <line x1="9" y1="15" x2="10.5" y2="13.5" />
      <line x1="11.5" y1="12.5" x2="13" y2="11" />
      <line x1="14" y1="9.5" x2="15.3" y2="8.3" />
    </>
  ),
  jasmine: <Petals rx={1.8} ry={4.6} offset={4.4} />,
  rose: (
    <>
      <RoundBloom r={3.2} offset={3.2} />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  amber: <path d="M12,3 C16,9 19,13 19,16 A7,7 0 1,1 5,16 C5,13 8,9 12,3 Z" />,
  musk: (
    <>
      <ellipse cx="12" cy="13" rx="5.5" ry="7.5" />
      <line x1="12" y1="5.5" x2="12" y2="3" />
      <line x1="9.5" y1="12" x2="14.5" y2="12" />
      <line x1="9.5" y1="15.5" x2="14.5" y2="15.5" />
    </>
  ),
  patchouli: (
    <>
      <path d="M12,3 C18,7 19,14 12,21 C5,14 6,7 12,3 Z" />
      <line x1="12" y1="6" x2="12" y2="18" />
      <line x1="12" y1="10" x2="9" y2="8" />
      <line x1="12" y1="10" x2="15" y2="8" />
      <line x1="12" y1="14" x2="9" y2="16" />
      <line x1="12" y1="14" x2="15" y2="16" />
    </>
  ),
  wood: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5.2" />
      <circle cx="12" cy="12" r="1.8" />
    </>
  ),
  tonka: (
    <>
      <path d="M12,4 C18,4 20,9 20,13 C20,18 16,20.5 12,20.5 C8,20.5 4,18 4,13 C4,9 6,4 12,4 Z" />
      <path d="M8,7 C10,10 10,15 8,18" />
    </>
  ),
  lavender: (
    <>
      <line x1="12" y1="21" x2="12" y2="9" />
      {[9, 11, 13, 15, 17].map((y) => (
        <ellipse key={y} cx="12" cy={y} rx="2.3" ry="1.4" />
      ))}
    </>
  ),
  vetiver: (
    <>
      <path d="M8,21 C7,15 8,9 6,4" />
      <path d="M12,21 C12,14 13,8 12,3" />
      <path d="M16,21 C17,15 16,9 18,4" />
    </>
  ),
  cardamom: (
    <>
      <ellipse cx="12" cy="12" rx="5" ry="8" />
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="7.3" y1="12" x2="16.7" y2="12" />
      <line x1="8" y1="16" x2="16" y2="16" />
    </>
  ),
  iris: (
    <>
      {[-28, 0, 28].map((deg) => (
        <path
          key={deg}
          d="M12,20 C11,13 10,8 12,4 C14,8 13,13 12,20 Z"
          transform={`rotate(${deg} 12 20)`}
        />
      ))}
    </>
  ),
  herb: (
    <>
      <line x1="12" y1="21" x2="12" y2="5" />
      {[7, 10, 13, 16].map((y, i) => (
        <g key={y}>
          <path d={`M12,${y} C9,${y - 1} 7.5,${y - 2.5} 7,${y - 4}`} />
          {i % 2 === 0 && <path d={`M12,${y} C15,${y - 1} 16.5,${y - 2.5} 17,${y - 4}`} />}
        </g>
      ))}
    </>
  ),
  geranium: <Petals angles={PETAL_ANGLES_6} rx={2.6} ry={3.6} offset={3.6} />,
  leather: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path
        d="M4,8 h16 M4,12 h16 M4,16 h16"
        strokeDasharray="1.6 1.6"
      />
    </>
  ),
  pepper: (
    <>
      <circle cx="9.5" cy="10" r="3.2" />
      <circle cx="15" cy="9" r="2.6" />
      <circle cx="12" cy="15" r="3" />
    </>
  ),
  ginger: (
    <path d="M6,15 C4,12 6,8 9,8 C9,5 13,4 14,7 C17,6 19,9 17,12 C19,14 18,18 14,17 C13,20 8,20 8,17 C5,18 4,16 6,15 Z" />
  ),
  violet: (
    <>
      <Petals rx={2.6} ry={3.4} offset={3.2} />
      <path d="M10,15.5 C10.5,17.5 13.5,17.5 14,15.5" />
    </>
  ),
  saffron: (
    <>
      {[-25, 0, 25].map((deg) => (
        <path key={deg} d="M12,20 C11,15 10,9 13,4" transform={`rotate(${deg} 12 20)`} />
      ))}
      <circle cx="12" cy="20" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  spice: (
    <>
      {PETAL_ANGLES_6.map((deg) => (
        <path key={deg} d="M12,12 L12,4 L14.3,7.5 Z" transform={`rotate(${deg} 12 12)`} />
      ))}
      <circle cx="12" cy="12" r="1.6" />
    </>
  ),
  peony: (
    <>
      <RoundBloom r={3.6} offset={3} />
      <RoundBloom angles={[36, 108, 180, 252, 324]} r={2.2} offset={5.2} />
    </>
  ),
  honey: (
    <>
      <path d="M9,4 L15,4 L17,8 L17,16 L12,20 L7,16 L7,8 Z" />
      <line x1="7" y1="8" x2="17" y2="8" />
      <path d="M12,11 C10,13 10,16 12,17.5 C14,16 14,13 12,11 Z" fill="currentColor" strokeWidth="0.8" />
    </>
  ),
  tobacco: (
    <>
      <path d="M12,3 C18,7 18,14 12,21 C6,14 6,7 12,3 Z" />
      <line x1="12" y1="6" x2="12" y2="18" />
      <path d="M12,9 C14,9 15,10 15,11" />
      <path d="M12,14 C10,14 9,15 9,16" />
    </>
  ),
  apple: (
    <>
      <path d="M12,9 C8,9 6,12 6,15 C6,18 8,20 10,20 C11,20 11.5,19.5 12,19.5 C12.5,19.5 13,20 14,20 C16,20 18,18 18,15 C18,12 16,9 12,9 Z" />
      <path d="M12,9 C12,6.5 13,5.5 15,5" />
    </>
  ),
  berry: (
    <>
      {[[9, 10], [15, 10], [12, 15]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.4" />
      ))}
      <line x1="12" y1="6" x2="12" y2="9.5" />
    </>
  ),
  coffee: (
    <>
      <ellipse cx="12" cy="12" rx="6" ry="8" />
      <path d="M12,4.5 C9,8 9,16 12,19.5" />
    </>
  ),
  pear: (
    <>
      <circle cx="12" cy="15" r="6" />
      <path d="M12,9 C10,9 10,6.5 11,5" />
      <path d="M12.5,5 C13.5,5 14,5.8 13.5,7" />
    </>
  ),
  marine: (
    <>
      <path d="M3,9 C6,7 9,7 12,9 C15,11 18,11 21,9" />
      <path d="M3,14 C6,12 9,12 12,14 C15,16 18,16 21,14" />
      <path d="M3,19 C6,17 9,17 12,19 C15,21 18,21 21,19" />
    </>
  ),
  green: (
    <>
      <line x1="12" y1="20" x2="12" y2="6" />
      <path d="M12,10 C9,9 7,6 7,4 C10,4 12,7 12,10 Z" />
      <path d="M12,15 C15,14 17,11 17,9 C14,9 12,12 12,15 Z" />
    </>
  ),
  floral: <Petals rx={2.4} ry={4.2} offset={4} angles={[0, 90, 180, 270]} />,
  fruit: (
    <>
      <circle cx="12" cy="14" r="6.5" />
      <path d="M12,7.5 C12,5.5 13,4.5 15,4" />
    </>
  ),
  generic: <path d="M12,4 C16,10 18,13 18,16 A6,6 0 1,1 6,16 C6,13 8,10 12,4 Z" />,
};

const RULES: [RegExp, string][] = [
  [/orange\s*blossom|neroli|olive\s*blossom|african\s*orange\s*flower/i, "neroli"],
  [/bergamot|grapefruit|\blemon\b|\blime\b|yuzu|citron|\bmandarin\b|tangerine|\borange\b/i, "citrus"],
  [/vanilla/i, "vanilla"],
  [/jasmine/i, "jasmine"],
  [/\brose\b|turkish rose|grasse rose|white rose|champagne ros/i, "rose"],
  [/amber|labdanum|benzoin|styrax|resin|frankincense|balsam/i, "amber"],
  [/\bmusk\b|ambrette/i, "musk"],
  [/patchouli/i, "patchouli"],
  [/cedar|sandalwood|rosewood|guaiac|\boud\b|agarwood|woody|\bwoods?\b|mahogany|redwood|\boak\b|\bbirch\b/i, "wood"],
  [/tonka|coumarin/i, "tonka"],
  [/lavender/i, "lavender"],
  [/vetiver/i, "vetiver"],
  [/cardamom/i, "cardamom"],
  [/\biris\b|orris/i, "iris"],
  [/\bsage\b|rosemary|\bbasil\b|oregano|tarragon/i, "herb"],
  [/geranium/i, "geranium"],
  [/leather|suede/i, "leather"],
  [/pepper|paprika/i, "pepper"],
  [/ginger/i, "ginger"],
  [/violet/i, "violet"],
  [/saffron/i, "saffron"],
  [/nutmeg|cinnamon|\bclove\b|cumin|coriander|star anise|licorice|\banise\b/i, "spice"],
  [/peony/i, "peony"],
  [/honey/i, "honey"],
  [/tobacco/i, "tobacco"],
  [/\bapple\b/i, "apple"],
  [/blackcurrant|blackberry|raspberry|red berries|cranberry|\bberry\b|berries/i, "berry"],
  [/coffee|cacao|chocolate|praline|caramel|whipped cream|kulfi|coconut/i, "coffee"],
  [/\bpear\b/i, "pear"],
  [/sea notes|marine|sea salt|driftwood|seaweed|ozone/i, "marine"],
  [/oakmoss|\bmoss\b|galbanum|green tea|fresh notes|verbena|fig leaf|bay leaf|cucumber|\bice\b/i, "green"],
  [
    /tuberose|freesia|magnolia|gardenia|hyacinth|osmanthus|\blily\b|lily of the valley|orchid|ylang|frangipani|rangoon|bellflower|aldehyde/i,
    "floral",
  ],
  [/quince|peach|litchi|melon|\bfig\b|passion fruit|pomegranate|cherry|almond|pineapple|plum|rhubarb/i, "fruit"],
];

function resolveIconKey(note: string): string {
  for (const [pattern, key] of RULES) {
    if (pattern.test(note)) return key;
  }
  return "generic";
}

export function NoteIcon({
  note,
  className,
  style,
}: {
  note: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const key = resolveIconKey(note);
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[key]}
    </svg>
  );
}
