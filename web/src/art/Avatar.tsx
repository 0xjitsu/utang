// Deterministic 16x16 pixel neighbour, generated from the NEAR account name.
import { memo, useMemo } from "react";
import { PixelRects, pick, seeded, type Grid } from "./pixel";

const SKIN = [
  ["#f3c9a0", "#d9a77c"],
  ["#e2ae7e", "#c48c5c"],
  ["#c98d5b", "#a86f42"],
  ["#a8693d", "#87512b"],
  ["#7d4a2a", "#5f361d"],
] as const;
const HAIR = ["#2b1d16", "#3d2617", "#5a3420", "#1b1b2a", "#8a8a8a", "#d8d2c4", "#7a2f1f", "#c58b2d"];
const SHIRT = ["#d0562c", "#0a8a9e", "#7b4fa8", "#e8b33c", "#3f8f4d", "#d8577e", "#3a5ea8", "#f2efe4", "#b5462f"];
const BG = ["#fde3b5", "#d9efe0", "#e7dcf6", "#fbd5c9", "#d6e8f6", "#f6eab8"];

type HairStyle = "short" | "long" | "bun" | "cap" | "lolo" | "spiky" | "bob";
const STYLES: HairStyle[] = ["short", "long", "bun", "cap", "lolo", "spiky", "bob"];

function buildGrid(name: string): { grid: Grid; bg: string } {
  const r = seeded(name);
  const [skin, skinDark] = pick(r, SKIN);
  const style = pick(r, STYLES);
  const hair = style === "lolo" ? pick(r, ["#cfcfcf", "#e6e2d8", "#9a9a9a"]) : pick(r, HAIR);
  const shirt = pick(r, SHIRT);
  const cap = pick(r, ["#c8402f", "#2f6db5", "#2c8a4b", "#f0c040"]);
  const bg = pick(r, BG);
  const glasses = r() < 0.22;
  const blush = r() < 0.5;
  const towel = r() < 0.25; // the classic bimpo over the shoulder
  const smile = pick(r, ["smile", "grin", "flat"] as const);
  const eye = "#1d1410";

  const g: Grid = Array.from({ length: 16 }, () => Array<string | null>(16).fill(null));
  const set = (x: number, y: number, c: string | null) => {
    if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = c;
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };

  // shirt & shoulders
  fill(2, 13, 13, 15, shirt);
  fill(3, 12, 12, 12, shirt);
  // neck
  fill(7, 11, 8, 12, skinDark);
  // face
  fill(4, 4, 11, 10, skin);
  fill(5, 11, 10, 11, skin);
  set(4, 10, null);
  set(11, 10, null);
  // ears
  fill(3, 7, 3, 8, skinDark);
  fill(12, 7, 12, 8, skinDark);
  // eyes
  set(6, 7, eye);
  set(9, 7, eye);
  if (blush) {
    set(5, 9, "#e98b7a");
    set(10, 9, "#e98b7a");
  }
  // mouth
  if (smile === "smile") {
    set(6, 9, "#7a2d22");
    fill(7, 10, 8, 10, "#7a2d22");
    set(9, 9, "#7a2d22");
  } else if (smile === "grin") {
    fill(6, 9, 9, 9, "#7a2d22");
    fill(7, 9, 8, 9, "#ffffff");
  } else {
    fill(7, 9, 8, 9, "#7a2d22");
  }
  // hair
  switch (style) {
    case "short":
      fill(4, 2, 11, 4, hair);
      fill(3, 3, 3, 6, hair);
      fill(12, 3, 12, 6, hair);
      fill(5, 5, 7, 5, hair);
      break;
    case "spiky":
      fill(4, 3, 11, 4, hair);
      for (const x of [4, 6, 8, 10]) set(x, 2, hair);
      for (const x of [5, 9]) set(x, 1, hair);
      fill(3, 4, 3, 6, hair);
      fill(12, 4, 12, 6, hair);
      break;
    case "long":
      fill(4, 2, 11, 4, hair);
      fill(2, 3, 3, 12, hair);
      fill(12, 3, 13, 12, hair);
      fill(9, 5, 11, 5, hair);
      break;
    case "bob":
      fill(4, 2, 11, 5, hair);
      fill(3, 3, 3, 10, hair);
      fill(12, 3, 12, 10, hair);
      fill(5, 6, 5, 6, skin);
      break;
    case "bun":
      fill(4, 3, 11, 4, hair);
      fill(6, 0, 9, 2, hair);
      fill(3, 4, 3, 7, hair);
      fill(12, 4, 12, 7, hair);
      break;
    case "cap":
      fill(4, 2, 11, 4, cap);
      fill(2, 5, 11, 5, cap);
      set(7, 3, "#ffffff");
      fill(12, 4, 12, 7, hair);
      fill(3, 5, 3, 7, hair);
      break;
    case "lolo":
      fill(3, 5, 3, 8, hair);
      fill(12, 5, 12, 8, hair);
      fill(5, 3, 10, 3, skin);
      fill(4, 4, 4, 4, hair);
      fill(11, 4, 11, 4, hair);
      // moustache
      fill(6, 8, 9, 8, hair);
      break;
  }
  if (glasses) {
    const fr = "#2a2a2a";
    fill(5, 6, 7, 6, fr);
    fill(8, 6, 10, 6, fr);
    set(5, 7, fr);
    set(7, 7, fr);
    set(8, 7, fr);
    set(10, 7, fr);
  }
  if (towel) {
    fill(10, 12, 12, 15, "#f7f4ea");
    fill(11, 13, 11, 15, "#d9d4c4");
  }
  return { grid: g, bg };
}

export const Avatar = memo(function Avatar({
  name,
  size = 48,
  framed = true,
  className,
}: {
  name: string;
  size?: number;
  framed?: boolean;
  className?: string;
}) {
  const { grid, bg } = useMemo(() => buildGrid(name), [name]);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-label={`${name} avatar`}
      style={{ flex: "none" }}
    >
      {framed ? <rect width="16" height="16" fill={bg} /> : null}
      <PixelRects grid={grid} />
    </svg>
  );
});

/** Raw grid for embedding in other SVG scenes. */
export function avatarGrid(name: string): Grid {
  return buildGrid(name).grid;
}
