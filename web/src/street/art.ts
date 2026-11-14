// All street art is drawn here in code (no external assets): a 3x5 pixel font, villagers built
// from the same deterministic avatar generator as the React UI, three house styles, the
// sari-sari store, jeepney, cat, palm, volcano and small props. Each function returns a canvas.

import { avatarGrid } from "../art/Avatar";
import { hash32, pick, seeded } from "../art/pixel";
import { shortName } from "../near/format";

export type Canvas = HTMLCanvasElement;

export function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): Canvas {
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  return el;
}

function rect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
}

// ------------------------------------------------------------------ 3x5 pixel font

const GLYPHS: Record<string, string> = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
  E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
  I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100",
  Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111", "0": "111101101101111", "1": "010110010010111",
  "2": "110001010100111", "3": "110001010001110", "4": "101101111001001", "5": "111100110001110",
  "6": "011100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001110",
  ".": "000000000000010", "-": "000000111000000", _: "000000000000111", "?": "110001010000010",
  "!": "010010010000010", "+": "000010111010000", ":": "000010000010000", "/": "001001010100100",
  "'": "010010000000000", " ": "000000000000000", "%": "101001010100101", ",": "000000000010100",
};

/** Draws text with the 3x5 font. Returns the width in pixels. */
export function drawText(c: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, scale = 1): number {
  let cx = x;
  // 3x5 glyphs have no room for accents: "Zañiga" is drawn as "ZANIGA".
  for (const ch of text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS["?"];
    for (let i = 0; i < 15; i++) if (g[i] === "1") rect(c, cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale, color);
    cx += 4 * scale;
  }
  return cx - x - scale;
}

export function textWidth(text: string, scale = 1) {
  return Math.max(0, text.length * 4 * scale - scale);
}

/** A small label with a background plate. */
export function label(text: string, fg: string, bg: string, border = "#2b1d16"): Canvas {
  const w = textWidth(text) + 4;
  return canvas(w + 2, 9, (c) => {
    rect(c, 0, 0, w + 2, 9, border);
    rect(c, 1, 1, w, 7, bg);
    drawText(c, text, 3, 2, fg);
  });
}

/** Speech bubble with a tail pointing down. */
export function bubble(text: string): Canvas {
  const w = Math.max(12, textWidth(text) + 6);
  return canvas(w + 2, 12, (c) => {
    rect(c, 1, 0, w, 1, "#2b1d16");
    rect(c, 0, 1, 1, 7, "#2b1d16");
    rect(c, w + 1, 1, 1, 7, "#2b1d16");
    rect(c, 1, 8, w, 1, "#2b1d16");
    rect(c, 1, 1, w, 7, "#fffaf0");
    drawText(c, text, 4, 2, "#2b1d16");
    const tx = Math.floor(w / 2);
    rect(c, tx, 9, 3, 1, "#2b1d16");
    rect(c, tx + 1, 9, 1, 1, "#fffaf0");
    rect(c, tx + 1, 10, 1, 1, "#2b1d16");
  });
}

// ------------------------------------------------------------------ villagers

const PANTS = ["#2b2b3a", "#3a4f7a", "#5a4632", "#2f5a3a", "#6b6b6b", "#7a2f1f"];

/** 16x24 villager. frame 0 = standing, 1 = stride. */
export function villager(name: string, frame: 0 | 1): Canvas {
  const grid = avatarGrid(name);
  const r = seeded(name + "#legs");
  const pants = pick(r, PANTS);
  const skirt = r() < 0.35;
  const shirt = grid[14][7] ?? "#d0562c";
  return canvas(16, 24, (c) => {
    grid.forEach((row, y) => row.forEach((col, x) => col && rect(c, x, y, 1, 1, col)));
    rect(c, 4, 16, 8, 2, shirt);
    if (skirt) {
      rect(c, 4, 18, 8, 3, pants);
      rect(c, 3, 20, 10, 1, pants);
    } else {
      rect(c, 5, 18, 6, 1, pants);
    }
    const legs = frame === 0 ? [5, 9] : [4, 10];
    for (const lx of legs) {
      if (!skirt) rect(c, lx, 19, 2, 3, pants);
      else rect(c, lx, 21, 2, 1, "#c98d5b");
      rect(c, lx, 22, 2, 2, "#2b1d16");
    }
  });
}

// ------------------------------------------------------------------ houses

const WALLS = ["#f3c9a0", "#cfe5d6", "#e8d6f0", "#f6e2a8", "#d6e4f2", "#f4cfc4", "#e9e1cf"];
const ROOFS = ["#a8604a", "#3f6f8a", "#2c7a4b", "#8a3a3a", "#9a9aa2", "#c27a2a"];

export type HouseStyle = "concrete" | "kubo" | "apartment";

export function houseStyle(name: string): HouseStyle {
  return (["concrete", "kubo", "apartment", "concrete"] as const)[hash32(name + "#house") % 4];
}

export const HOUSE_W = 56;
export const HOUSE_H = 64;

/** A neighbour's house. Door bottom-centre is at (28, 64). */
export function house(name: string): Canvas {
  const r = seeded(name + "#house");
  const style = houseStyle(name);
  const wall = pick(r, WALLS);
  const roof = pick(r, ROOFS);
  const trim = "#5a3020";
  return canvas(HOUSE_W, HOUSE_H, (c) => {
    if (style === "kubo") {
      // bahay kubo: bamboo on stilts with a nipa roof
      for (const x of [8, 20, 34, 46]) rect(c, x, 50, 3, 14, "#8a6a45");
      rect(c, 4, 26, 48, 25, "#d8b46a");
      for (let x = 5; x < 52; x += 3) rect(c, x, 26, 1, 25, "#b8934e");
      rect(c, 4, 50, 48, 2, "#8a6a45");
      for (let i = 0; i < 16; i++) {
        const y = 8 + i;
        const inset = Math.max(0, 16 - i);
        rect(c, inset, y, HOUSE_W - inset * 2, 1, i % 3 === 0 ? "#9a7a3a" : "#c2a050");
      }
      rect(c, 0, 24, HOUSE_W, 3, "#8a6a2a");
      rect(c, 9, 32, 12, 9, "#5a3a20");
      rect(c, 10, 33, 10, 7, "#3b2a20");
      rect(c, 15, 33, 1, 7, "#8a6a45");
      rect(c, 24, 30, 10, 21, "#7a4a2a");
      rect(c, 26, 32, 6, 19, "#5a3020");
      // ladder
      rect(c, 25, 52, 1, 12, "#6b5034");
      rect(c, 32, 52, 1, 12, "#6b5034");
      for (let y = 54; y < 64; y += 3) rect(c, 25, y, 8, 1, "#6b5034");
      rect(c, 38, 32, 10, 9, "#3b2a20");
      rect(c, 38, 32, 10, 1, "#8a6a45");
    } else if (style === "apartment") {
      rect(c, 6, 6, 44, 58, wall);
      rect(c, 4, 4, 48, 3, trim);
      rect(c, 6, 32, 44, 2, "#ffffff55");
      // upper windows + balcony with laundry
      rect(c, 10, 12, 12, 10, "#3b4a5e");
      rect(c, 34, 12, 12, 10, "#3b4a5e");
      rect(c, 10, 12, 12, 2, "#f0e6d0");
      rect(c, 34, 12, 12, 2, "#f0e6d0");
      rect(c, 6, 24, 44, 1, trim);
      for (let x = 7; x < 50; x += 3) rect(c, x, 25, 1, 5, trim);
      rect(c, 6, 29, 44, 1, trim);
      rect(c, 8, 9, 40, 1, "#ffffff");
      const shirts = ["#d0562c", "#3a5ea8", "#f2c14e", "#e86a8a"];
      shirts.forEach((col, i) => rect(c, 11 + i * 9, 10, 5, 4, col));
      // ground floor
      rect(c, 10, 40, 12, 10, "#3b4a5e");
      rect(c, 10, 40, 12, 1, "#f0e6d0");
      for (let x = 11; x < 22; x += 3) rect(c, x, 40, 1, 10, "#2f5a3a");
      rect(c, 30, 42, 14, 22, "#7a4a2a");
      rect(c, 32, 44, 10, 8, "#8a5a35");
      rect(c, 40, 54, 2, 2, "#f2c14e");
      rect(c, 6, 62, 44, 2, "#b7a483");
    } else {
      rect(c, 4, 26, 48, 38, wall);
      for (let y = 30; y < 64; y += 5) rect(c, 4, y, 48, 1, "#00000010");
      // corrugated tin roof
      for (let i = 0; i < 18; i++) {
        const y = 8 + i;
        const inset = Math.max(0, 14 - Math.floor(i * 0.9));
        for (let x = inset; x < HOUSE_W - inset; x++) rect(c, x, y, 1, 1, x % 4 < 2 ? roof : shade(roof));
      }
      rect(c, 0, 26, HOUSE_W, 2, trim);
      // window with grill and plants
      rect(c, 8, 34, 14, 12, "#3b4a5e");
      rect(c, 8, 34, 14, 3, "#f0e6d0");
      for (let x = 9; x < 22; x += 3) rect(c, x, 34, 1, 12, "#2f5a3a");
      rect(c, 7, 46, 16, 2, trim);
      rect(c, 9, 43, 4, 3, "#3f8f4d");
      // door
      rect(c, 24, 38, 14, 26, trim);
      rect(c, 25, 39, 12, 25, "#8a5a35");
      rect(c, 27, 42, 8, 8, "#7a4a2a");
      rect(c, 34, 52, 2, 2, "#f2c14e");
      rect(c, 42, 34, 8, 12, "#3b4a5e");
      rect(c, 42, 34, 8, 2, "#f0e6d0");
      rect(c, 41, 46, 10, 2, trim);
      // potted plant
      rect(c, 44, 58, 6, 6, "#b5562f");
      rect(c, 43, 53, 8, 5, "#2c8a4b");
    }
  });
}

/** Window glow overlay for night (same footprint as house). */
export function houseGlow(name: string): Canvas {
  const style = houseStyle(name);
  return canvas(HOUSE_W, HOUSE_H, (c) => {
    const g = "#ffd86b";
    if (style === "kubo") {
      rect(c, 10, 33, 10, 7, g);
      rect(c, 38, 33, 10, 8, g);
    } else if (style === "apartment") {
      rect(c, 10, 14, 12, 8, g);
      rect(c, 34, 14, 12, 8, g);
      rect(c, 10, 41, 12, 9, g);
    } else {
      rect(c, 8, 37, 14, 9, g);
      rect(c, 42, 36, 8, 10, g);
    }
  });
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.floor(v * 0.78));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ------------------------------------------------------------------ the sari-sari store (my own design)

export const STORE_W = 112;
export const STORE_H = 84;

export function store(opts: { closed: boolean; owner: string | null }): Canvas {
  return canvas(STORE_W, STORE_H, (c) => {
    // tin roof
    for (let i = 0; i < 18; i++) {
      const y = 2 + i;
      const inset = Math.max(0, 14 - i);
      for (let x = inset; x < STORE_W - inset; x++) {
        const rusty = (x * 7 + y * 3) % 23 < 3;
        rect(c, x, y, 1, 1, rusty ? "#8e4a2c" : x % 4 < 2 ? "#a8604a" : "#c98466");
      }
    }
    rect(c, 0, 20, STORE_W, 3, "#5a3020");
    // wall
    rect(c, 4, 23, STORE_W - 8, 61, "#f3e2c0");
    for (let y = 28; y < 84; y += 6) rect(c, 4, y, STORE_W - 8, 1, "#e4cfa6");
    // sign
    rect(c, 8, 24, 96, 15, "#5a3020");
    rect(c, 9, 25, 94, 13, opts.closed ? "#8a6a5a" : "#c8402f");
    for (let x = 11; x < 102; x += 6) rect(c, x, 25, 2, 1, opts.closed ? "#6a5a50" : "#ffe9a0");
    const title = "SARI-SARI";
    drawText(c, title, 56 - Math.floor(textWidth(title, 2) / 2), 28, "#5a3020", 2);
    drawText(c, title, 55 - Math.floor(textWidth(title, 2) / 2), 27, opts.closed ? "#d8c7a0" : "#f2c14e", 2);
    // window
    const wx = 8;
    const wy = 42;
    rect(c, wx, wy, 70, 30, "#5a3020");
    rect(c, wx + 1, wy + 1, 68, 27, "#3b2a20");
    if (opts.closed) {
      rect(c, wx + 1, wy + 1, 68, 27, "#9a6a42");
      for (let y = wy + 3; y < wy + 28; y += 4) rect(c, wx + 1, y, 68, 1, "#7a4a2a");
      const t = "SARADO";
      drawText(c, t, wx + 35 - Math.floor(textWidth(t) / 2), wy + 12, "#fff8e7");
    } else {
      rect(c, wx + 1, wy + 10, 68, 1, "#8a5a35");
      rect(c, wx + 1, wy + 19, 68, 1, "#8a5a35");
      const jar = ["#e86a5a", "#f2c14e", "#7bc47f", "#d8577e", "#9b7ad1"];
      [3, 10, 46, 53, 60].forEach((x, i) => {
        rect(c, wx + x, wy + 4, 5, 6, "#bfe3ea");
        rect(c, wx + x + 1, wy + 6, 3, 4, jar[i]);
        rect(c, wx + x + 1, wy + 3, 3, 1, "#d0562c");
      });
      [3, 6, 9].forEach((x) => {
        rect(c, wx + x, wy + 13, 2, 6, "#3d2a1a");
        rect(c, wx + x, wy + 12, 2, 1, "#d0402f");
      });
      [46, 51, 56, 61].forEach((x, i) => {
        rect(c, wx + x, wy + 14, 4, 5, i % 2 ? "#3a5ea8" : "#e8b33c");
        rect(c, wx + x, wy + 15, 4, 1, "#ffffff");
      });
      // sachet strips
      const sachet = ["#7b4fa8", "#d0562c", "#3a5ea8", "#d8577e", "#2c8a4b", "#e8833a"];
      [18, 24, 38].forEach((x, s) => {
        for (let i = 0; i < 4; i++) rect(c, wx + x, wy + 2 + i * 5, 4, 4, sachet[(s * 2 + i) % sachet.length]);
      });
      // grill (opening in the middle for the counter)
      for (let x = 2; x < 69; x += 5) rect(c, wx + x, wy + 1, 1, x > 24 && x < 46 ? 9 : 27, "#2f5a3a");
      rect(c, wx + 1, wy + 10, 68, 1, "#2f5a3a");
    }
    // counter
    rect(c, wx - 2, wy + 28, 74, 4, "#8a5a35");
    rect(c, wx - 2, wy + 28, 74, 1, "#b07a4a");
    // name plaque
    const name = opts.owner ? shortName(opts.owner).slice(0, 14) : "";
    rect(c, 10, 75, 66, 8, "#fffaf0");
    if (name) drawText(c, name, 43 - Math.floor(textWidth(name) / 2), 77, "#2b1d16");
    // door
    rect(c, 84, 42, 22, 42, "#5a3020");
    rect(c, 86, 44, 18, 40, "#8a5a35");
    rect(c, 88, 47, 14, 12, "#7a4a2a");
    rect(c, 88, 63, 14, 18, "#7a4a2a");
    rect(c, 100, 62, 2, 2, "#f2c14e");
    rect(c, 89, 50, 12, 6, opts.closed ? "#6a5a50" : "#2c8a4b");
    drawText(c, opts.closed ? "OFF" : "OPEN", opts.closed ? 90 : 87, 51, "#fffaf0");
  });
}

/** Lit window for night. */
export function storeGlow(): Canvas {
  return canvas(STORE_W, STORE_H, (c) => {
    rect(c, 9, 43, 68, 27, "#ffcf6b");
  });
}

// ------------------------------------------------------------------ props

/** A barangay hall for streets you visit (your own street has your store instead). */
export function hall(barangay: string): Canvas {
  const name = "BRGY " + barangay.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const lines = name.length > 18 ? [name.slice(0, name.lastIndexOf(" ", 18)), name.slice(name.lastIndexOf(" ", 18) + 1)] : [name];
  return canvas(STORE_W, STORE_H, (c) => {
    rect(c, 6, 20, STORE_W - 12, 64, "#e9e1cf");
    for (let y = 26; y < 84; y += 6) rect(c, 6, y, STORE_W - 12, 1, "#d8cdb4");
    rect(c, 2, 16, STORE_W - 4, 5, "#3a5ea8");
    rect(c, 0, 14, STORE_W, 2, "#253f78");
    // flag
    rect(c, 54, 0, 1, 15, "#4a4a52");
    rect(c, 55, 1, 10, 3, "#3a5ea8");
    rect(c, 55, 4, 10, 3, "#d0402f");
    rect(c, 55, 1, 3, 6, "#fffaf0");
    rect(c, 56, 3, 1, 1, "#f2c14e");
    // sign
    rect(c, 10, 24, 92, lines.length * 7 + 5, "#253f78");
    lines.forEach((l, i) => drawText(c, l, 56 - Math.floor(textWidth(l) / 2), 27 + i * 7, "#fffaf0"));
    // windows + door + steps
    for (const x of [12, 30, 70, 88]) {
      rect(c, x, 46, 12, 12, "#3b4a5e");
      rect(c, x, 46, 12, 2, "#f0e6d0");
    }
    rect(c, 46, 50, 20, 34, "#5a3020");
    rect(c, 48, 52, 16, 32, "#8a5a35");
    rect(c, 55, 52, 2, 32, "#5a3020");
    rect(c, 40, 82, 32, 2, "#b7a483");
  });
}

/** Jeepney stop (waiting shed) at the edge of every street. */
export function jeepStop(): Canvas {
  return canvas(40, 46, (c) => {
    rect(c, 2, 14, 2, 32, "#4a4a52");
    rect(c, 34, 14, 2, 32, "#4a4a52");
    rect(c, 0, 10, 40, 5, "#2c7a4b");
    rect(c, 0, 9, 40, 1, "#2b6a37");
    rect(c, 6, 36, 26, 3, "#8a5a35");
    rect(c, 8, 39, 2, 7, "#6b5034");
    rect(c, 28, 39, 2, 7, "#6b5034");
    rect(c, 6, 0, 28, 9, "#f2c14e");
    rect(c, 6, 0, 28, 1, "#2b1d16");
    drawText(c, "JEEP", 12, 2, "#2b1d16");
  });
}

export function jeepney(): Canvas {
  return canvas(50, 18, (c) => {
    rect(c, 0, 3, 44, 10, "#d9dde3");
    rect(c, 0, 1, 40, 2, "#b5462f");
    rect(c, 2, 0, 34, 1, "#f2c14e");
    for (const x of [3, 9, 15, 21, 27]) rect(c, x, 4, 4, 4, "#3b4a5e");
    rect(c, 33, 4, 6, 4, "#9fd3e0");
    rect(c, 40, 6, 7, 7, "#c9ced6");
    rect(c, 46, 9, 2, 3, "#f2c14e");
    rect(c, 0, 9, 40, 1, "#d0562c");
    rect(c, 0, 10, 40, 1, "#3a5ea8");
    rect(c, 0, 11, 40, 1, "#f2c14e");
    rect(c, 40, 2, 2, 4, "#e8b33c");
    for (const x of [5, 33]) {
      rect(c, x, 12, 6, 5, "#1d1d1d");
      rect(c, x + 2, 13, 2, 2, "#8a8a8a");
    }
  });
}

export function cat(frame: 0 | 1): Canvas {
  return canvas(10, 7, (c) => {
    const o = "#e8833a";
    rect(c, 0, frame ? 1 : 0, 1, 1, o);
    rect(c, 2, frame ? 1 : 0, 1, 1, o);
    rect(c, 0, 1, 3, 3, o);
    rect(c, 1, 2, 1, 1, "#2b1d16");
    rect(c, 0, 3, 10, 2, o);
    rect(c, 1, 4, 1, 1, "#c8662a");
    rect(c, 4, 4, 1, 1, "#c8662a");
    rect(c, 1, 5, 1, 2, o);
    rect(c, 3, 5, 1, 2, o);
    rect(c, 6, 5, 1, 2, o);
    rect(c, 8, 5, 1, 2, o);
    rect(c, 9, frame ? 1 : 2, 1, frame ? 2 : 1, o);
  });
}

export function palm(): Canvas {
  return canvas(30, 64, (c) => {
    for (let y = 10; y < 64; y++) rect(c, 13 + Math.round(Math.sin(y / 12) * 2), y, 3, 1, y % 6 === 0 ? "#6b5034" : "#8a6a45");
    const g = "#3f8f4d";
    rect(c, 2, 8, 12, 3, g);
    rect(c, 15, 6, 13, 3, g);
    rect(c, 0, 11, 6, 2, g);
    rect(c, 24, 9, 6, 2, g);
    rect(c, 9, 2, 10, 5, "#2b6a37");
    rect(c, 6, 5, 4, 2, g);
    rect(c, 19, 4, 5, 2, g);
    rect(c, 12, 10, 3, 3, "#7a5a2a");
    rect(c, 15, 10, 3, 3, "#7a5a2a");
  });
}

export function lamp(): Canvas {
  return canvas(10, 48, (c) => {
    rect(c, 4, 6, 2, 42, "#4a4a52");
    rect(c, 4, 4, 6, 2, "#4a4a52");
    rect(c, 7, 6, 3, 2, "#e8e0c0");
  });
}

export const SKYLINE_W = 320;
const SKYLINE_H = 74;

interface Tower {
  x: number;
  w: number;
  h: number;
  color: string;
}

function skylineTowers(): Tower[] {
  const r = seeded("ortigas-shaw-skyline");
  const towers: Tower[] = [];
  let x = 0;
  const colors = ["#a9b6cc", "#b9aecd", "#c7bfd8", "#aec3cf", "#c9bba6", "#9fb0c4"];
  let i = 0;
  while (x < SKYLINE_W) {
    const w = 12 + Math.floor(r() * 16);
    const tall = r() < 0.35;
    const h = tall ? 46 + Math.floor(r() * 24) : 18 + Math.floor(r() * 20);
    towers.push({ x, w, h, color: colors[i++ % colors.length] });
    x += w + (r() < 0.3 ? 3 : 0);
  }
  return towers;
}

/** One seamless tile of skyline: towers, the MRT-3 viaduct on its pillars and an EDSA flyover ramp. */
export function skyline(): Canvas {
  return canvas(SKYLINE_W, SKYLINE_H, (c) => {
    const base = SKYLINE_H - 1;
    for (const t of skylineTowers()) {
      rect(c, t.x, base - t.h, t.w - 1, t.h, t.color);
      rect(c, t.x, base - t.h, t.w - 1, 2, "#8e9bb3");
      for (let wy = base - t.h + 4; wy < base - 10; wy += 5)
        for (let wx = t.x + 2; wx < t.x + t.w - 3; wx += 4) rect(c, wx, wy, 2, 2, "#e4e9f2");
      if (t.h > 55) rect(c, t.x + Math.floor(t.w / 2) - 1, base - t.h - 6, 1, 6, "#6b6b74");
    }
    // EDSA flyover ramp
    for (let i = 0; i < 60; i++) rect(c, 200 + i, base - 6 - Math.floor(i / 6), 1, 2, "#8a8f99");
    rect(c, 260, base - 16, 60, 2, "#8a8f99");
    // MRT-3 viaduct
    rect(c, 0, base - 22, SKYLINE_W, 4, "#8a8f99");
    rect(c, 0, base - 18, SKYLINE_W, 1, "#6b6f78");
    for (let x = 10; x < SKYLINE_W; x += 40) rect(c, x, base - 17, 4, 17, "#7d828c");
    // a train on the viaduct
    rect(c, 60, base - 27, 42, 5, "#d9dde3");
    rect(c, 60, base - 25, 42, 1, "#3a5ea8");
    for (let x = 63; x < 100; x += 6) rect(c, x, base - 27, 3, 2, "#3b4a5e");
  });
}

/** Lit windows for the skyline at night (same footprint). */
export function skylineGlow(): Canvas {
  return canvas(SKYLINE_W, SKYLINE_H, (c) => {
    const base = SKYLINE_H - 1;
    const r = seeded("skyline-lights");
    for (const t of skylineTowers()) {
      for (let wy = base - t.h + 4; wy < base - 10; wy += 5)
        for (let wx = t.x + 2; wx < t.x + t.w - 3; wx += 4) if (r() < 0.55) rect(c, wx, wy, 2, 2, "#ffd86b");
      if (t.h > 55) rect(c, t.x + Math.floor(t.w / 2) - 1, base - t.h - 6, 1, 1, "#ff5a4a");
    }
    for (let x = 63; x < 100; x += 6) rect(c, x, base - 27, 3, 2, "#ffe9a0");
  });
}

export function cloud(w = 26): Canvas {
  return canvas(w, 8, (c) => {
    rect(c, 0, 4, w, 4, "#ffffff");
    rect(c, 5, 1, w - 12, 3, "#ffffff");
    rect(c, 9, 0, 6, 1, "#ffffff");
  });
}

export function coin(): Canvas {
  return canvas(6, 6, (c) => {
    rect(c, 1, 0, 4, 6, "#c8922a");
    rect(c, 0, 1, 6, 4, "#c8922a");
    rect(c, 1, 1, 4, 4, "#f2c14e");
    rect(c, 2, 1, 1, 2, "#fff3b8");
  });
}

export function sparkle(): Canvas {
  return canvas(5, 5, (c) => {
    rect(c, 2, 0, 1, 5, "#fff6c8");
    rect(c, 0, 2, 5, 1, "#fff6c8");
    rect(c, 2, 2, 1, 1, "#ffffff");
  });
}

export function confetti(color: string): Canvas {
  return canvas(2, 2, (c) => rect(c, 0, 0, 2, 2, color));
}

export function bayadMunaSign(): Canvas {
  return canvas(26, 24, (c) => {
    rect(c, 12, 14, 2, 10, "#6b5034");
    rect(c, 0, 0, 26, 15, "#2b1d16");
    rect(c, 1, 1, 24, 13, "#fffaf0");
    rect(c, 1, 1, 24, 1, "#d0402f");
    drawText(c, "BAYAD", 3, 3, "#9e2a1f");
    drawText(c, "MUNA", 5, 9, "#9e2a1f");
  });
}

export function bench(): Canvas {
  return canvas(24, 11, (c) => {
    rect(c, 0, 2, 24, 2, "#8a5a35");
    rect(c, 0, 5, 24, 2, "#a8703f");
    rect(c, 2, 7, 2, 4, "#4a4a52");
    rect(c, 20, 7, 2, 4, "#4a4a52");
    rect(c, 0, 0, 24, 1, "#6b4428");
  });
}

export function pottedPlant(): Canvas {
  return canvas(12, 14, (c) => {
    rect(c, 2, 8, 8, 6, "#b5562f");
    rect(c, 1, 8, 10, 1, "#8e4024");
    rect(c, 1, 2, 10, 6, "#3f8f4d");
    rect(c, 3, 0, 6, 3, "#2c7a4b");
    rect(c, 5, 1, 2, 2, "#e86a8a");
  });
}

/** Bobbing quest arrow pointing down. */
export function questArrow(): Canvas {
  return canvas(11, 12, (c) => {
    const k = "#2b1d16";
    const y = "#f2c14e";
    rect(c, 3, 0, 5, 7, k);
    rect(c, 4, 1, 3, 6, y);
    rect(c, 0, 6, 11, 1, k);
    rect(c, 1, 7, 9, 1, k);
    rect(c, 2, 7, 7, 1, y);
    rect(c, 2, 8, 7, 1, k);
    rect(c, 3, 8, 5, 1, y);
    rect(c, 3, 9, 5, 1, k);
    rect(c, 4, 9, 3, 1, y);
    rect(c, 4, 10, 3, 1, k);
    rect(c, 5, 10, 1, 1, y);
    rect(c, 5, 11, 1, 1, k);
  });
}

export function star(): Canvas {
  return canvas(1, 1, (c) => rect(c, 0, 0, 1, 1, "#fff6d8"));
}
