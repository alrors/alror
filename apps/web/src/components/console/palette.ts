// Hex mirror of the console colour tokens in src/app/globals.css, for places
// that need a literal colour (SVG attributes, inline chart styles, gradients).
// Keep the two in step.

export const SURFACE = {
  bg: "#0b0f17",
  panel: "#111722",
  raised: "#161d2a",
  row: "#1b2332",
  line: "#232c3b",
  lineHover: "#34405a",
  fg: "#e8edf5",
  fg2: "#a3aec2",
  fg3: "#8691a5",
  spark: "#4a5670",
} as const;

export const BRAND = "#35e08f";

export const ACCENT = {
  mint: "#35e08f",
  lilac: "#a78bfa",
  lilacSoft: "#c3b3ff",
  sky: "#60a5fa",
  skySoft: "#8fd3ff",
  butter: "#fbd34d",
  butterSoft: "#ffd84d",
  orchid: "#f0abfc",
  coral: "#ff6b6b",
} as const;

export const STATUS = {
  good: "#35e08f",
  warn: "#f5c04a",
  bad: "#ff6b6b",
  info: "#60a5fa",
  idle: "#8691a5",
} as const;

/**
 * Categorical chart series, in order. Hues are spread far apart and differ in
 * lightness as well, so neighbours stay distinct with common colour-vision
 * deficiencies; always pair with a legend or direct label.
 */
export const SERIES = [ACCENT.sky, ACCENT.butter, ACCENT.mint, ACCENT.orchid, ACCENT.lilac, "#8691a5"] as const;
