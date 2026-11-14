// A short jeepney ride between barangays (skipped with reduced motion): a pixel skyline with the
// MRT viaduct along EDSA scrolls past, and the destination's barangay hall pulls in at the end.
import { memo, useEffect } from "react";
import { Jeepney } from "../art/StoreScene";
import { seeded } from "../art/pixel";
import { bus } from "../game/bus";
import { reducedMotion } from "../street/viewPref";

const W = 480;
const H = 120;

/** One tile of skyline (repeats seamlessly). */
const Skyline = memo(function Skyline() {
  const r = seeded("mandaluyong-skyline");
  const blocks: JSX.Element[] = [];
  let x = 0;
  let i = 0;
  while (x < W) {
    const w = 26 + Math.floor(r() * 30);
    const tall = r() < 0.3;
    const h = tall ? 70 + Math.floor(r() * 30) : 28 + Math.floor(r() * 30);
    const color = ["#9aa7c0", "#b3a6c9", "#c7b8d6", "#a8b8c8", "#d6c3a8"][i % 5];
    const y = 96 - h;
    blocks.push(<rect key={`b${i}`} x={x} y={y} width={w - 2} height={h} fill={color} />);
    for (let wy = y + 5; wy < 90; wy += 8)
      for (let wx = x + 4; wx < x + w - 6; wx += 7)
        if (r() < 0.75) blocks.push(<rect key={`w${i}-${wx}-${wy}`} x={wx} y={wy} width={3} height={4} fill={r() < 0.25 ? "#ffe9a0" : "#e9eef5"} />);
    if (tall && r() < 0.6) blocks.push(<rect key={`a${i}`} x={x + w / 2 - 1} y={y - 8} width={2} height={8} fill="#6b6b74" />);
    x += w;
    i++;
  }
  return (
    <svg className="ride-skyline-tile" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden>
      {blocks}
      {/* MRT-3 viaduct along EDSA */}
      <rect x={0} y={60} width={W} height={7} fill="#8a8f99" />
      <rect x={0} y={67} width={W} height={2} fill="#6b6f78" />
      {Array.from({ length: 8 }, (_, k) => (
        <rect key={k} x={k * 60 + 20} y={69} width={8} height={27} fill="#7d828c" />
      ))}
      <rect x={0} y={96} width={W} height={24} fill="#b7a483" />
    </svg>
  );
});

function Hall({ name }: { name: string }) {
  return (
    <svg className="ride-hall" viewBox="0 0 120 90" shapeRendering="crispEdges" aria-hidden>
      <rect x={58} y={0} width={2} height={18} fill="#4a4a52" />
      <rect x={60} y={1} width={14} height={4} fill="#3a5ea8" />
      <rect x={60} y={5} width={14} height={4} fill="#d0402f" />
      <rect x={60} y={1} width={4} height={8} fill="#fffaf0" />
      <rect x={4} y={18} width={112} height={4} fill="#253f78" />
      <rect x={8} y={22} width={104} height={68} fill="#e9e1cf" />
      <rect x={14} y={27} width={92} height={13} fill="#253f78" />
      <text x={60} y={36.5} textAnchor="middle" fontSize="7" fontFamily="'Press Start 2P', monospace" fill="#fffaf0">
        {name.length > 14 ? name.slice(0, 13) + "…" : name}
      </text>
      {[16, 34, 76, 94].map((x) => (
        <rect key={x} x={x} y={48} width={12} height={12} fill="#3b4a5e" />
      ))}
      <rect x={50} y={52} width={20} height={38} fill="#8a5a35" />
    </svg>
  );
}

export function JeepneyRide({ to, onDone }: { to: string; onDone: () => void }) {
  useEffect(() => {
    const quick = reducedMotion();
    if (!quick) bus.emit("sfx", { name: "jeep" });
    const t = setTimeout(onDone, quick ? 250 : 2100);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="ride" role="status" aria-live="polite">
      <div className="ride-skyline" aria-hidden>
        <Skyline />
        <Skyline />
      </div>
      <Hall name={to} />
      <div className="ride-road" aria-hidden>
        <div className="ride-dashes" />
      </div>
      <svg className="ride-jeep" viewBox="0 0 50 18" aria-hidden shapeRendering="crispEdges">
        <Jeepney />
      </svg>
      <p className="ride-text">
        Biyahe papuntang <b>{to}</b>…
      </p>
    </div>
  );
}
