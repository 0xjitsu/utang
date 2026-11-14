// Tiny pixel-art toolkit: draw ASCII sprites or colour grids as crisp SVG rects.
import { memo } from "react";

export type Grid = (string | null)[][];

/** Renders a colour grid, merging horizontal runs into single rects. */
export const PixelRects = memo(function PixelRects({
  grid,
  x = 0,
  y = 0,
  scale = 1,
}: {
  grid: Grid;
  x?: number;
  y?: number;
  scale?: number;
}) {
  const rects: JSX.Element[] = [];
  grid.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      const color = row[c];
      if (!color) {
        c++;
        continue;
      }
      let w = 1;
      while (c + w < row.length && row[c + w] === color) w++;
      rects.push(
        <rect key={`${r}-${c}`} x={x + c * scale} y={y + r * scale} width={w * scale} height={scale} fill={color} />,
      );
      c += w;
    }
  });
  return <g shapeRendering="crispEdges">{rects}</g>;
});

/** ASCII sprite -> grid. '.' or ' ' is transparent; other chars map through the palette. */
export function sprite(rows: string[], palette: Record<string, string>): Grid {
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((row) => {
    const out: (string | null)[] = [];
    for (let i = 0; i < width; i++) {
      const ch = row[i] ?? ".";
      out.push(ch === "." || ch === " " ? null : palette[ch] ?? null);
    }
    return out;
  });
}

export function Sprite({
  rows,
  palette,
  size = 24,
  title,
  className,
}: {
  rows: string[];
  palette: Record<string, string>;
  size?: number;
  title?: string;
  className?: string;
}) {
  const grid = sprite(rows, palette);
  const w = grid[0]?.length ?? 1;
  const h = grid.length;
  return (
    <svg
      className={className}
      width={size}
      height={(size * h) / w}
      viewBox={`0 0 ${w} ${h}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <PixelRects grid={grid} />
    </svg>
  );
}

/** FNV-1a 32-bit hash. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small deterministic PRNG seeded by a string. */
export function seeded(s: string): () => number {
  let a = hash32(s) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}
