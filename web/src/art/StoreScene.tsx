// The sari-sari store, drawn in SVG pixel art (all original art).
// Visitors at the window are neighbours with pending loan requests to you.
import { memo, useMemo } from "react";
import { avatarGrid } from "./Avatar";
import { PixelRects, sprite } from "./pixel";
import { shortName } from "../near/format";

export interface Visitor {
  name: string;
  label: string; // e.g. "10.00?"
}

interface Props {
  owner: string | null;
  visitors?: Visitor[];
  balanceCentavos?: string;
  bayadMuna?: boolean;
  closed?: boolean;
  /** 0..1 position in the (game) day; 0 = midnight. */
  dayFrac?: number;
  coinPops?: { id: number; text: string }[];
  /** "slice" fills wide stages (crops sky), "meet" shows everything (tall stages get more sky). */
  fit?: "meet" | "slice";
}

const W = 192;
const H = 136;

// Sky keyframes (stepped, for a pixel look)
const SKY: [number, string, string][] = [
  [0.0, "#1d2340", "#2e3560"],
  [0.2, "#3a3f6e", "#6b5a86"],
  [0.27, "#f4a76b", "#f7cf93"],
  [0.35, "#8fcde0", "#cfeef2"],
  [0.7, "#8fcde0", "#cfeef2"],
  [0.78, "#e98b6a", "#f5c48a"],
  [0.85, "#4b3f74", "#8a5a86"],
  [0.92, "#1d2340", "#2e3560"],
];

function skyAt(f: number) {
  let cur = SKY[0];
  for (const k of SKY) if (f >= k[0]) cur = k;
  return { top: cur[1], bottom: cur[2], night: f < 0.24 || f > 0.84 };
}

const SACHET_COLORS = [
  ["#7b4fa8", "#b89ad8"],
  ["#5e3a20", "#d0562c"],
  ["#3a5ea8", "#f2c14e"],
  ["#d8577e", "#fbe2ea"],
  ["#2c8a4b", "#e8f0d0"],
  ["#e8833a", "#fff1c1"],
];

const CAT = sprite(
  [
    "o.o.......",
    "ooo.......",
    "oko....oo.",
    "oooooooooo",
    ".oOooOooo.",
    ".o.o..o.o.",
  ],
  { o: "#e8833a", O: "#c8662a", k: "#2b1d16" },
);

const PALM_FROND = "#3f8f4d";

export function Jeepney() {
  // A colourful jeepney passing by on the road.
  return (
    <g className="jeepney" shapeRendering="crispEdges">
      <rect x="0" y="3" width="44" height="10" fill="#d9dde3" />
      <rect x="0" y="1" width="40" height="2" fill="#b5462f" />
      <rect x="2" y="0" width="34" height="1" fill="#f2c14e" />
      {[3, 9, 15, 21, 27].map((x) => (
        <rect key={x} x={x} y="4" width="4" height="4" fill="#3b4a5e" />
      ))}
      <rect x="33" y="4" width="6" height="4" fill="#9fd3e0" />
      <rect x="40" y="6" width="6" height="7" fill="#c9ced6" />
      <rect x="46" y="9" width="2" height="3" fill="#f2c14e" />
      <rect x="0" y="9" width="40" height="1" fill="#d0562c" />
      <rect x="0" y="10" width="40" height="1" fill="#3a5ea8" />
      <rect x="0" y="11" width="40" height="1" fill="#f2c14e" />
      <rect x="40" y="2" width="2" height="4" fill="#e8b33c" />
      <rect x="5" y="12" width="6" height="4" fill="#1d1d1d" />
      <rect x="7" y="13" width="2" height="2" fill="#8a8a8a" />
      <rect x="33" y="12" width="6" height="4" fill="#1d1d1d" />
      <rect x="35" y="13" width="2" height="2" fill="#8a8a8a" />
    </g>
  );
}

export const StoreScene = memo(function StoreScene({
  owner,
  visitors = [],
  balanceCentavos = "0",
  bayadMuna = false,
  closed = false,
  dayFrac = 0.5,
  coinPops = [],
  fit = "meet",
}: Props) {
  const sky = skyAt(dayFrac);
  const ownerGrid = useMemo(() => (owner ? avatarGrid(owner) : null), [owner]);
  const visitorGrids = useMemo(() => visitors.slice(0, 3).map((v) => avatarGrid(v.name)), [visitors]);
  const coins = Math.min(7, Math.ceil(Math.log2(Number(BigInt(balanceCentavos) / 100n) + 1)));
  const storeName = owner ? shortName(owner).slice(0, 16) : "";

  // Sun / moon arc
  const dayT = (dayFrac - 0.25) / 0.6; // 0..1 across daylight
  const sunX = 8 + Math.max(0, Math.min(1, dayT)) * (W - 24);
  const sunY = 30 - Math.sin(Math.max(0, Math.min(1, dayT)) * Math.PI) * 22;
  const nightT = ((dayFrac + 0.15) % 1) / 0.4;
  const moonX = 8 + Math.max(0, Math.min(1, nightT)) * (W - 24);

  // Roof rows (corrugated tin)
  const roofRows: JSX.Element[] = [];
  for (let y = 26; y < 46; y += 2) {
    const inset = Math.round(((46 - y) / 20) * 14);
    const x0 = 12 + inset;
    const x1 = W - 12 - inset;
    for (let x = x0; x < x1; x += 4) {
      const rusty = (x * 7 + y * 3) % 23 < 4;
      roofRows.push(
        <rect key={`r${x}-${y}`} x={x} y={y} width={2} height={2} fill={rusty ? "#8e4a2c" : "#a8604a"} />,
        <rect key={`s${x}-${y}`} x={x + 2} y={y} width={2} height={2} fill={rusty ? "#a65a3a" : "#c98466"} />,
      );
    }
  }

  return (
    <svg
      className="store-scene"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={owner ? `${owner}'s sari-sari store` : "A sari-sari store"}
      preserveAspectRatio={`xMidYMax ${fit}`}
    >
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky.top} />
          <stop offset="1" stopColor={sky.bottom} />
        </linearGradient>
      </defs>
      <g shapeRendering="crispEdges">
        {/* sky */}
        <rect width={W} height="112" fill="url(#sky)" />
        {sky.night
          ? [
              [14, 8],
              [40, 16],
              [70, 6],
              [102, 12],
              [130, 5],
              [160, 14],
              [182, 7],
              [24, 22],
              [150, 24],
            ].map(([x, y], i) => (
              <rect key={i} className={`twinkle t${i % 3}`} x={x} y={y} width="1" height="1" fill="#fff6d8" />
            ))
          : null}
        {/* sun or moon */}
        {!sky.night ? (
          <g>
            <rect x={sunX - 1} y={sunY - 4} width="10" height="12" fill="#ffd866" />
            <rect x={sunX - 3} y={sunY - 2} width="14" height="8" fill="#ffd866" />
            <rect x={sunX + 1} y={sunY - 2} width="4" height="2" fill="#fff3b8" />
          </g>
        ) : (
          <g>
            <rect x={moonX} y="8" width="8" height="8" fill="#f4f0dc" />
            <rect x={moonX - 1} y="9" width="10" height="6" fill="#f4f0dc" />
            <rect x={moonX + 3} y="8" width="6" height="6" fill={sky.top} />
          </g>
        )}
        {/* clouds */}
        <g className="cloud c1" opacity={sky.night ? 0.25 : 0.9}>
          <rect x="20" y="14" width="22" height="4" fill="#ffffff" />
          <rect x="26" y="10" width="10" height="4" fill="#ffffff" />
        </g>
        <g className="cloud c2" opacity={sky.night ? 0.2 : 0.8}>
          <rect x="120" y="20" width="18" height="3" fill="#ffffff" />
          <rect x="124" y="17" width="8" height="3" fill="#ffffff" />
        </g>
        {/* distant neighbourhood */}
        <rect x="0" y="70" width="18" height="42" fill={sky.night ? "#2c2a45" : "#c7b8d6"} />
        <rect x="174" y="62" width="18" height="50" fill={sky.night ? "#2c2a45" : "#bfc9d9"} />
        <rect x="178" y="70" width="4" height="4" fill={sky.night ? "#f7d27a" : "#e9eef5"} />
        <rect x="4" y="78" width="4" height="4" fill={sky.night ? "#f7d27a" : "#e9eef5"} />
        {/* palm tree */}
        <rect x="6" y="40" width="3" height="72" fill="#8a6a45" />
        {[46, 54, 62, 70, 78, 86, 94, 102].map((y) => (
          <rect key={y} x="6" y={y} width="3" height="1" fill="#6b5034" />
        ))}
        <g className="palm">
          <rect x="-4" y="38" width="12" height="3" fill={PALM_FROND} />
          <rect x="8" y="36" width="12" height="3" fill={PALM_FROND} />
          <rect x="-8" y="41" width="6" height="2" fill={PALM_FROND} />
          <rect x="18" y="39" width="6" height="2" fill={PALM_FROND} />
          <rect x="2" y="32" width="8" height="4" fill="#2b6a37" />
          <rect x="5" y="41" width="3" height="3" fill="#7a5a2a" />
          <rect x="8" y="41" width="3" height="3" fill="#7a5a2a" />
        </g>

        {/* roof */}
        <rect x="10" y="24" width={W - 20} height="2" fill="#6e3b26" />
        {roofRows}
        <rect x="10" y="46" width={W - 20} height="3" fill="#5a3020" />

        {/* house wall */}
        <rect x="18" y="49" width={W - 36} height="63" fill="#f3e2c0" />
        {[55, 61, 67, 73, 79, 85, 91, 97, 103, 109].map((y) => (
          <rect key={y} x="18" y={y} width={W - 36} height="1" fill="#e4cfa6" />
        ))}

        {/* sign */}
        <rect x="30" y="50" width="132" height="15" fill="#5a3020" />
        <rect x="31" y="51" width="130" height="13" fill={closed ? "#8a6a5a" : "#c8402f"} />
        {Array.from({ length: 16 }, (_, i) => (
          <rect
            key={i}
            className={closed ? "" : `bulb b${i % 2}`}
            x={33 + i * 8}
            y="51"
            width="2"
            height="1"
            fill={closed ? "#6a5a50" : "#ffe9a0"}
          />
        ))}
      </g>
      <text x="96" y="61.5" textAnchor="middle" className="scene-sign">
        SARI-SARI STORE
      </text>

      <g shapeRendering="crispEdges">
        {/* window */}
        <rect x="28" y="67" width="110" height="33" fill="#5a3020" />
        <rect x="30" y="68" width="106" height="30" fill={sky.night ? "#4a3424" : "#3b2a20"} />
        {sky.night && !closed ? <rect x="30" y="68" width="106" height="30" fill="#ffcf6b" opacity="0.18" /> : null}
        {/* lamp */}
        <rect x="82" y="68" width="1" height="3" fill="#2b1d16" />
        <rect x="81" y="71" width="3" height="2" fill={sky.night ? "#fff1a8" : "#e8e0c0"} />

        {/* shelves & goods */}
        <rect x="30" y="79" width="106" height="2" fill="#8a5a35" />
        <rect x="30" y="90" width="106" height="2" fill="#8a5a35" />
        {/* jars */}
        {[34, 44, 104, 114, 124].map((x, i) => (
          <g key={x}>
            <rect x={x} y="72" width="7" height="7" fill="#bfe3ea" />
            <rect x={x + 1} y="74" width="5" height="5" fill={["#e86a5a", "#f2c14e", "#7bc47f", "#d8577e", "#9b7ad1"][i]} />
            <rect x={x + 1} y="71" width="5" height="1" fill="#d0562c" />
            <rect x={x + 1} y="73" width="1" height="2" fill="#ffffff" />
          </g>
        ))}
        {/* soda bottles, chips, cans */}
        {[33, 36, 39].map((x) => (
          <g key={x}>
            <rect x={x} y="84" width="2" height="6" fill="#3d2a1a" />
            <rect x={x} y="83" width="2" height="1" fill="#d0402f" />
          </g>
        ))}
        {[44, 50].map((x, i) => (
          <g key={x}>
            <rect x={x} y="84" width="5" height="6" fill={i ? "#3a5ea8" : "#e8b33c"} />
            <rect x={x} y="86" width="5" height="1" fill="#ffffff" />
          </g>
        ))}
        {[106, 111, 116, 121, 126, 131].map((x, i) => (
          <g key={x}>
            <rect x={x} y="85" width="4" height="5" fill="#b5b9c0" />
            <rect x={x} y="86" width="4" height="2" fill={["#d0562c", "#2c8a4b", "#f2c14e"][i % 3]} />
          </g>
        ))}
      </g>

      {/* hanging sachet strips (sway) */}
      {[56, 62, 98].map((x, si) => (
        <g key={x} className={`sway s${si}`} style={{ transformOrigin: `${x + 2}px 68px` }} shapeRendering="crispEdges">
          <rect x={x + 2} y="68" width="1" height="2" fill="#2b1d16" />
          {Array.from({ length: 4 }, (_, i) => {
            const [a, b] = SACHET_COLORS[(si * 2 + i) % SACHET_COLORS.length];
            return (
              <g key={i}>
                <rect x={x} y={70 + i * 5} width="5" height="4" fill={a} />
                <rect x={x + 1} y={71 + i * 5} width="3" height="1" fill={b} />
              </g>
            );
          })}
        </g>
      ))}

      {/* the tindera / tindero (you) */}
      {ownerGrid && !closed ? <PixelRects grid={ownerGrid} x={74} y={80} /> : null}

      <g shapeRendering="crispEdges">
        {/* grill */}
        {Array.from({ length: 18 }, (_, i) => 31 + i * 6).map((x) =>
          x > 68 && x < 98 ? (
            <rect key={x} x={x} y="68" width="1" height="12" fill="#2f5a3a" />
          ) : (
            <rect key={x} x={x} y="68" width="1" height="30" fill="#2f5a3a" />
          ),
        )}
        <rect x="30" y="80" width="106" height="1" fill="#2f5a3a" />
        {/* shutters when the store is closed */}
        {closed ? (
          <g>
            <rect x="30" y="68" width="106" height="30" fill="#9a6a42" />
            {[71, 75, 79, 83, 87, 91, 95].map((y) => (
              <rect key={y} x="30" y={y} width="106" height="1" fill="#7a4a2a" />
            ))}
          </g>
        ) : null}
        {/* counter */}
        <rect x="26" y="96" width="114" height="5" fill="#8a5a35" />
        <rect x="26" y="96" width="114" height="1" fill="#b07a4a" />
        {/* listahan notebook on the counter */}
        {!closed ? (
          <g>
            <rect x="38" y="93" width="10" height="3" fill="#c8402f" />
            <rect x="39" y="93" width="8" height="1" fill="#fffaf0" />
          </g>
        ) : null}
        {/* coin stack */}
        {!closed
          ? Array.from({ length: coins }, (_, i) => (
              <g key={i}>
                <rect x={112 + (i % 2)} y={94 - i * 2} width="8" height="2" fill="#c8922a" />
                <rect x={113 + (i % 2)} y={94 - i * 2} width="6" height="1" fill="#f2c14e" />
              </g>
            ))
          : null}
        {/* name plaque */}
        <rect x="40" y="102" width="86" height="8" fill="#fffaf0" />
        <rect x="40" y="109" width="86" height="1" fill="#d8c7a0" />

        {/* door */}
        <rect x="146" y="67" width="22" height="45" fill="#5a3020" />
        <rect x="148" y="69" width="18" height="43" fill="#8a5a35" />
        <rect x="150" y="72" width="14" height="14" fill="#7a4a2a" />
        <rect x="150" y="90" width="14" height="18" fill="#7a4a2a" />
        <rect x="162" y="88" width="2" height="2" fill="#f2c14e" />
        {/* open / closed sign on the door */}
        <rect x="151" y="75" width="12" height="6" fill={closed ? "#6a5a50" : "#2c8a4b"} />
      </g>
      <text x="157" y="79.6" textAnchor="middle" className="scene-tiny" fill="#fffaf0">
        {closed ? "SARADO" : "BUKAS"}
      </text>
      <text x="83" y="108" textAnchor="middle" className="scene-plaque">
        {owner ? `Tindahan ni ${storeName}` : "Tindahan"}
      </text>
      {closed ? (
        <text x="83" y="86" textAnchor="middle" className="scene-closed">
          JOIN TO OPEN
        </text>
      ) : null}

      {bayadMuna ? (
        <g className="note-flutter" style={{ transformOrigin: "157px 92px" }}>
          <rect x="148" y="91" width="18" height="11" fill="#fffaf0" shapeRendering="crispEdges" />
          <rect x="148" y="91" width="18" height="1" fill="#d0402f" shapeRendering="crispEdges" />
          <text x="157" y="96" textAnchor="middle" className="scene-tiny" fill="#9e2a1f">
            BAYAD
          </text>
          <text x="157" y="100.5" textAnchor="middle" className="scene-tiny" fill="#9e2a1f">
            MUNA
          </text>
        </g>
      ) : null}

      <g shapeRendering="crispEdges">
        {/* sidewalk */}
        <rect x="0" y="112" width={W} height="8" fill="#cdbb9b" />
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x={i * 16 + 4} y="112" width="1" height="8" fill="#b7a483" />
        ))}
        {/* plants */}
        <rect x="21" y="106" width="7" height="6" fill="#b5562f" />
        <rect x="20" y="100" width="9" height="6" fill="#3f8f4d" />
        <rect x="22" y="98" width="5" height="2" fill="#2b6a37" />
        <rect x="170" y="106" width="7" height="6" fill="#b5562f" />
        <rect x="169" y="99" width="9" height="7" fill="#2c8a4b" />
        <rect x="172" y="97" width="2" height="2" fill="#e86a5a" />
        {/* road */}
        <rect x="0" y="120" width={W} height="16" fill="#5d5853" />
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x={i * 26 + 6} y="127" width="12" height="2" fill="#e8c35a" />
        ))}
      </g>

      <g transform="translate(0 116)">
        <Jeepney />
      </g>

      {/* the store cat */}
      <g className="cat">
        <PixelRects grid={CAT} x={178} y={106} />
      </g>

      {/* visitors waiting with requests */}
      {visitorGrids.map((grid, i) => {
        const x = [30, 58, 128][i];
        return (
          <g key={visitors[i].name} className={`visitor v${i}`}>
            <PixelRects grid={grid} x={x} y={92} />
            <rect x={x + 5} y="108" width="2" height="4" fill="#2b2b3a" shapeRendering="crispEdges" />
            <rect x={x + 9} y="108" width="2" height="4" fill="#2b2b3a" shapeRendering="crispEdges" />
            <g className="bubble">
              <rect x={x - 2} y="82" width="20" height="8" fill="#fffaf0" stroke="#2b1d16" strokeWidth="0.6" />
              <rect x={x + 6} y="90" width="2" height="2" fill="#fffaf0" shapeRendering="crispEdges" />
              <text x={x + 8} y="87.6" textAnchor="middle" className="scene-tiny" fill="#2b1d16">
                {visitors[i].label}
              </text>
            </g>
          </g>
        );
      })}

      {coinPops.map((p) => (
        <text key={p.id} x="116" y="88" textAnchor="middle" className="coin-pop">
          {p.text}
        </text>
      ))}
    </svg>
  );
});
