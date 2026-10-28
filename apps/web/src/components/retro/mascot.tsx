import { cn } from "@/lib/site";

// Alror's mascot, "Spark": an abstract agent core. A faceted pixel diamond
// (lilac light side, mint shade side, bright girdle) with data bits in orbit.
// Drawn on a 15×15 grid centred on (7, 7); the orbit needs the wider viewBox.

type Px = { x: number; y: number; fill: string };

const C = 7;
/** Half-width of the diamond on row y (rows 1..13), or -1 outside it. */
const half = (y: number, grow = 0) => (y < 1 - grow || y > 13 + grow ? -1 : (y <= 7 ? y - 1 : 13 - y) + grow);

function facet(x: number, y: number, w: number): string {
  if (y === 7) return "#ffffff"; // girdle
  if (x === C + w) return "var(--rx-mint-deep)"; // right edge
  if (y < 7) return x < C ? "var(--rx-lilac)" : x === C ? "#ece6ff" : "var(--rx-mint)";
  return x < C ? "var(--rx-mint)" : "var(--rx-mint-deep)";
}

const outline: Px[] = [];
const core: Px[] = [];
for (let y = 0; y <= 14; y++) {
  const wo = half(y, 1);
  for (let x = C - wo; wo >= 0 && x <= C + wo; x++) outline.push({ x, y, fill: "var(--rx-ink)" });
  const w = half(y);
  for (let x = C - w; w >= 0 && x <= C + w; x++) core.push({ x, y, fill: facet(x, y, w) });
}
// Glint on the light facet.
core.push({ x: 5, y: 4, fill: "#ffffff" }, { x: 6, y: 3, fill: "#ffffff" });

const BITS: Px[] = [
  { x: -2, y: 3, fill: "var(--rx-mint)" },
  { x: 16, y: 10, fill: "var(--rx-lilac)" },
  { x: 12, y: -2, fill: "var(--rx-butter)" },
  { x: 2, y: 16, fill: "var(--rx-sky)" },
];

const rect = (p: Px, k: string, size = 1.02) => <rect key={k} x={p.x} y={p.y} width={size} height={size} fill={p.fill} />;

/** The mascot as a die-cut sticker. The bits orbit and the core glows unless motion is reduced. */
export function Mascot({ className, title = "Spark, the Alror agent" }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="-3 -3 21 21"
      className={cn("rx-mascot", className)}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      shapeRendering="crispEdges"
    >
      <g className="rx-orbit">{BITS.map((b, i) => rect(b, `b${i}`, 1.4))}</g>
      <g className="rx-core">
        {outline.map((p) => rect(p, `o${p.x}-${p.y}`))}
        {core.map((p) => rect(p, `c${p.x}-${p.y}`))}
      </g>
    </svg>
  );
}
