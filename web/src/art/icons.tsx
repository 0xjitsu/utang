// Hand-drawn pixel icons: coin, badges, nav icons, heart.
import { Sprite } from "./pixel";

const P = {
  k: "#2b1d16", // ink
  w: "#fffaf0",
  r: "#d0402f",
  R: "#9e2a1f",
  y: "#f2c14e",
  Y: "#c8922a",
  o: "#e8833a",
  g: "#3f8f4d",
  G: "#2b6a37",
  b: "#3a5ea8",
  B: "#253f78",
  t: "#0a8a9e",
  p: "#7b4fa8",
  s: "#b9a68a",
  n: "#8a5a35",
  N: "#5e3a20",
  l: "#9fd3e0",
};

// ---------------------------------------------------------------- coin

const COIN = [
  "...kkkkkk...",
  "..kYyyyyYk..",
  ".kYywwyyyYk.",
  "kYywyyyyyyYk",
  "kYyyYyyYyyYk",
  "kYyyYyyYyyYk",
  "kYyyYyyYyyYk",
  "kYyyYyyYyyYk",
  "kYyyyYYyyyYk",
  ".kYyyyyyyYk.",
  "..kYYYYYYk..",
  "...kkkkkk...",
];

export function Coin({ size = 18, spin = false, title }: { size?: number; spin?: boolean; title?: string }) {
  return <Sprite rows={COIN} palette={P} size={size} title={title} className={spin ? "coin spin" : "coin"} />;
}

const HEART = [
  ".kk...kk.",
  "krrk.krrk",
  "krwrkrrrk",
  "krrrrrrrk",
  ".krrrrrk.",
  "..krrrk..",
  "...krk...",
  "....k....",
];
const HEART_EMPTY = [
  ".kk...kk.",
  "kssk.kssk",
  "ksssksssk",
  "ksssssssk",
  ".ksssssk.",
  "..ksssk..",
  "...ksk...",
  "....k....",
];

export function Heart({ size = 14, empty = false }: { size?: number; empty?: boolean }) {
  return <Sprite rows={empty ? HEART_EMPTY : HEART} palette={P} size={size} />;
}

// ---------------------------------------------------------------- badges

export const BADGES: Record<string, { label: string; rule: string; rows: string[] }> = {
  founding_neighbour: {
    label: "Founding neighbour",
    rule: "One of the first 50 players to join",
    rows: [
      ".....rr.....",
      "....rRRr....",
      "...rRrrRr...",
      "..rRrrrrRr..",
      ".rRrrrrrrRr.",
      "rRRRRRRRRRRr",
      ".kwwwwwwwwk.",
      ".kwllwwnnwk.",
      ".kwllwwnnwk.",
      ".kwwwwwnnwk.",
      ".kwwwwwnnwk.",
      ".kkkkkkkkkk.",
    ],
  },
  first_repay: {
    label: "First repay",
    rule: "Repaid a loan on time",
    rows: [
      "............",
      "..........kk",
      ".........kgk",
      "........kggk",
      ".kk....kggk.",
      "kggk..kggk..",
      "kgggkkggk...",
      ".kggggggk...",
      "..kggggk....",
      "...kggk.....",
      "....kk......",
      "............",
    ],
  },
  ten_on_time: {
    label: "Ten on time",
    rule: "Repaid 10 loans on time",
    rows: [
      ".....kk.....",
      "....kyyk....",
      "....kyyk....",
      "kkkkyyyykkkk",
      "kyyyywyyyyyk",
      ".kyyyyyyyyk.",
      "..kyyyyyyk..",
      "..kyyyyyyk..",
      ".kyyykkyyyk.",
      ".kyyk..kyyk.",
      "kyyk....kyyk",
      "kkk......kkk",
    ],
  },
  never_late: {
    label: "Never late",
    rule: "3+ on-time repays and never overdue",
    rows: [
      "...kkkkkk...",
      "..kwwwwwwk..",
      ".kwwwkwwwwk.",
      "kwwwwkwwwwwk",
      "kwwwwkwwwwwk",
      "kwwwwkkkkwwk",
      "kwwwwwwwwwwk",
      "kwwwwwwwwwwk",
      ".kwwwwwwwwk.",
      "..kwwwwwwk..",
      "...kkkkkk...",
      "............",
    ],
  },
  good_lender: {
    label: "Good lender",
    rule: "5 loans you made were repaid on time",
    rows: [
      "............",
      ".kkk....kkk.",
      "krrrk..krrrk",
      "krwrrkkrrrrk",
      "krrrrrrrrrrk",
      "krrrrrrrrrrk",
      ".krrrrrrrrk.",
      "..krrrrrrk..",
      "...krrrrk...",
      "....krrk....",
      ".....kk.....",
      "............",
    ],
  },
  trusted: {
    label: "Trusted",
    rule: "Reached 100 trust",
    rows: [
      "kkkkkkkkkkkk",
      "kbbbbbbbbbbk",
      "kbwwwwwwwwbk",
      "kbwbbyybbwbk",
      "kbwbyyyybwbk",
      "kbwbbyybbwbk",
      ".kbwbbbbwbk.",
      ".kbwbbbbwbk.",
      "..kbwbbwbk..",
      "...kbwwbk...",
      "....kbbk....",
      ".....kk.....",
    ],
  },
};

export function BadgeIcon({ id, size = 28 }: { id: string; size?: number }) {
  const b = BADGES[id];
  if (!b) return <Sprite rows={["kkk", "kyk", "kkk"]} palette={P} size={size} title={id} />;
  return <Sprite rows={b.rows} palette={P} size={size} title={`${b.label}: ${b.rule}`} />;
}

// ---------------------------------------------------------------- nav icons

export const NAV_ICONS: Record<string, string[]> = {
  store: [
    "rrwrrwrrwrrw",
    "rrwrrwrrwrrw",
    "RRRRRRRRRRRR",
    ".kkkkkkkkkk.",
    ".kyyyyyyyyk.",
    ".kkkkkkkkkk.",
    ".knnnnnnnnk.",
    ".kltltlnnnk.",
    ".kltltlnNnk.",
    ".kkkkklnnnk.",
    ".knnnnnnnnk.",
    "kkkkkkkkkkkk",
  ],
  listahan: [
    "..kkkkkkkkk.",
    ".kwwwwwwwwwk",
    "kkwrwwwwwwwk",
    ".kwrkkkkkwwk",
    "kkwrwwwwwwwk",
    ".kwrkkkkwwwk",
    "kkwrwwwwwwwk",
    ".kwrkkkkkkwk",
    "kkwrwwwwwwwk",
    ".kwrkkkwwwwk",
    ".kwwwwwwwwwk",
    "..kkkkkkkkk.",
  ],
  neighbours: [
    "...kkk......",
    "..knnnk.kkk.",
    "..kyyyk.kNNk",
    "..kyyyk.kyyk",
    "...kkk..kyyk",
    "..ktttk..kk.",
    ".ktttttkkrrk",
    ".ktttttkrrrk",
    ".ktttttkrrrk",
    ".ktttttkrrrk",
    ".kkkkkkkkkkk",
    "............",
  ],
  leaderboard: [
    "kkkkkkkkkkkk",
    "kyyyyyyyyyyk",
    "kyyyywyyyyyk",
    ".kyyyyyyyyk.",
    "..kyyyyyyk..",
    "...kyyyyk...",
    "....kyyk....",
    ".....kk.....",
    ".....kk.....",
    "...kYYYYk...",
    "..kkkkkkkk..",
    "............",
  ],
  economy: [
    "k...........",
    "k.........gg",
    "k........g..",
    "k.....rr.g..",
    "k....r..g...",
    "k...r...g...",
    "k.rr.....g..",
    "kr........g.",
    "k...........",
    "k..t..t..t..",
    "k..t..t..t..",
    "kkkkkkkkkkkk",
  ],
};

export function NavIcon({ id, size = 22 }: { id: string; size?: number }) {
  return <Sprite rows={NAV_ICONS[id] ?? NAV_ICONS.store} palette={P} size={size} />;
}

const NOTEBOOK = [
  "kkkkkkkkkkkkkk",
  "kRRRRRRRRRRRRk",
  "kRwwwwwwwwwwRk",
  "kRwkkkkkkkwwRk",
  "kRwwwwwwwwwwRk",
  "kRwkkkkkwwwwRk",
  "kRwwwwwwwwwwRk",
  "kRRRRRRRRRRRRk",
  "kRRRRRRRRRRRRk",
  "kkkkkkkkkkkkkk",
];

export function NotebookIcon({ size = 28 }: { size?: number }) {
  return <Sprite rows={NOTEBOOK} palette={P} size={size} />;
}
