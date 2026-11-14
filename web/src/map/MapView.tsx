// Pixel-styled SVG map of Mandaluyong (data © OpenStreetMap contributors, ODbL).
// Pan with a finger/mouse, pinch or wheel to zoom, tap a barangay to select it.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { avatarGrid } from "../art/Avatar";
import { PixelRects } from "../art/pixel";
import { barangayAt, bboxOf, lineD, pathD, TINY_KM2, tintFor, type CityMap, type Pt } from "./mapData";

interface Props {
  /** Barangay to draw attention to (quest tip): always labelled, pulsing outline. */
  highlight?: string | null;
  /** Zoom to this barangay when `n` changes (e.g. picked from the list). */
  focus?: { name: string; n: number } | null;
  map: CityMap;
  counts: Record<string, number>;
  home: string | null;
  selected: string | null;
  avatarId: string | null;
  onSelect(name: string | null): void;
}

interface VB {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ROAD_STYLE: Record<string, { w: number; color: string; inner?: string }> = {
  motorway: { w: 5, color: "#6b6b74", inner: "#f2c14e" },
  trunk: { w: 5, color: "#6b6b74", inner: "#f2c14e" },
  primary: { w: 3, color: "#8a7a6a" },
  secondary: { w: 2, color: "#a8987f" },
};

export function MapView({ map, counts, home, selected, avatarId, onSelect, highlight = null, focus = null }: Props) {
  // Extra room below the city so the bottom bar (hints, chip, legend) never covers the south (Hulo).
  const full = useMemo<VB>(() => ({ x: -10, y: -10, w: map.width + 20, h: map.height + 150 }), [map]);
  const [vb, setVb] = useState<VB>(full);
  const svg = useRef<SVGSVGElement>(null);
  const [px, setPx] = useState({ w: 360, h: 300 });

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const measure = () => setPx({ w: el.clientWidth || 360, h: el.clientHeight || 300 });
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // map units per CSS pixel (preserveAspectRatio = meet)
  const k = Math.max(vb.w / px.w, vb.h / px.h);

  // Portrait phones: open zoomed on the city's core so the map fills the height (pan for the rest).
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) return;
    if (px.h > px.w * 1.2) {
      const bar = 150; // bottom bar (hint/chip/legend) in CSS px
      const s = (px.h - bar) / (map.height + 20); // CSS px per map unit if the city fills the height
      const w = Math.min(full.w, Math.max(map.width * 0.62, px.w / s));
      const h = (w * px.h) / px.w;
      setVb({ x: 470 - w / 2, y: -10, w, h });
    } else setVb(full);
  }, [px.w, px.h, full, map]);

  useEffect(() => {
    if (!focus) return;
    const b = map.barangays.find((x) => x.name === focus.name);
    if (!b) return;
    moved.current = true;
    const bb = bboxOf(b);
    const w = Math.max(180, bb.w * 2.4);
    const h = Math.max(150, bb.h * 2.4, (w * px.h) / px.w);
    setVb({ x: bb.x + bb.w / 2 - w / 2, y: bb.y + bb.h / 2 - h * 0.42, w, h });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);

  const toMap = useCallback((clientX: number, clientY: number): Pt | null => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }, []);

  const zoomAt = useCallback(
    (factor: number, center: Pt | null) => {
      moved.current = true;
      setVb((v) => {
        const w = Math.min(full.w * 1.2, Math.max(120, v.w * factor));
        const f = w / v.w;
        const h = v.h * f;
        const c = center ?? [v.x + v.w / 2, v.y + v.h / 2];
        return clampVB({ x: c[0] - (c[0] - v.x) * f, y: c[1] - (c[1] - v.y) * f, w, h }, map);
      });
    },
    [full, map],
  );

  // pointer handling: drag = pan, two fingers = pinch, small movement = tap
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: 0, pinch: false, lastDist: 0 });
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 1) gesture.current = { moved: 0, pinch: false, lastDist: 0 };
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      gesture.current.pinch = true;
      gesture.current.lastDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = ptrs.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    ptrs.current.set(e.pointerId, cur);
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.lastDist > 0) zoomAt(gesture.current.lastDist / d, toMap((a.x + b.x) / 2, (a.y + b.y) / 2));
      gesture.current.lastDist = d;
      gesture.current.moved += 10;
      return;
    }
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    gesture.current.moved += Math.abs(dx) + Math.abs(dy);
    if (gesture.current.moved > 6) {
      moved.current = true;
      setVb((v) => clampVB({ ...v, x: v.x - dx * k, y: v.y - dy * k }, map));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const wasTap = ptrs.current.size === 1 && !gesture.current.pinch && gesture.current.moved <= 6;
    ptrs.current.delete(e.pointerId);
    if (!wasTap) return;
    const p = toMap(e.clientX, e.clientY);
    if (p) onSelect(barangayAt(map, p, 22 * k));
  };
  const onWheel = (e: React.WheelEvent) => {
    zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, toMap(e.clientX, e.clientY));
  };

  const homeShape = home ? map.barangays.find((b) => b.name === home) : null;

  return (
    <div className="mapview">
      <svg
        ref={svg}
        className="map-svg"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMin meet"
        role="img"
        aria-label="Map of Mandaluyong's 27 barangays"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => ptrs.current.delete(e.pointerId)}
        onWheel={onWheel}
      >
        <rect x={-500} y={-500} width={map.width + 1000} height={map.height + 1000} fill="#d9c7a0" />
        <path d={pathD(map.city)} fill="#efe3c6" stroke="#2b1d16" strokeWidth={4} vectorEffect="non-scaling-stroke" />
        <Shapes map={map} counts={counts} home={home} selected={selected} />
        {highlight
          ? map.barangays
              .find((b) => b.name === highlight)
              ?.polygons.map((poly, i) => (
                <path key={`hl${i}`} className="map-highlight" d={pathD(poly)} fill="none" stroke="#f2c14e" strokeWidth={5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
              ))
          : null}
        {map.rivers.map((r) => (
          <g key={r.name}>
            <path d={lineD(r.points)} fill="none" stroke="#3f8fb5" strokeWidth={7} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <path d={lineD(r.points)} fill="none" stroke="#8fd0e8" strokeWidth={3} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {map.roads.map((r, i) => {
          const st = ROAD_STYLE[r.kind] ?? ROAD_STYLE.secondary;
          return (
            <g key={i}>
              <path d={lineD(r.points)} fill="none" stroke={st.color} strokeWidth={st.w} strokeLinecap="square" vectorEffect="non-scaling-stroke" />
              {st.inner ? (
                <path d={lineD(r.points)} fill="none" stroke={st.inner} strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
              ) : null}
            </g>
          );
        })}
        {homeShape
          ? homeShape.polygons.map((poly, i) => (
              <path key={i} d={pathD(poly)} fill="none" stroke="#d0402f" strokeWidth={4} vectorEffect="non-scaling-stroke" />
            ))
          : null}
        {map.barangays
          .filter((b) => b.area_km2 < TINY_KM2)
          .map((b) => (
            <circle
              key={b.id}
              cx={b.label[0]}
              cy={b.label[1]}
              r={9 * k}
              fill="none"
              stroke={selected === b.name ? "#d0402f" : "#2b1d16"}
              strokeWidth={selected === b.name ? 2.5 : 1.5}
              strokeDasharray="3 2"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        {map.landmarks.map((l) => (
          <g key={l.name} transform={`translate(${l.point[0]} ${l.point[1]}) scale(${k})`}>
            <title>{l.name}</title>
            <Landmark kind={l.kind} />
          </g>
        ))}
        <Labels map={map} k={k} home={home} selected={selected} highlight={highlight} small={px.w < 600} />
        {homeShape && avatarId ? (
          <g transform={`translate(${homeShape.label[0]} ${homeShape.label[1]}) scale(${k * 1.5})`}>
            <rect x={-10} y={-30} width={20} height={20} fill="#fff8e7" stroke="#2b1d16" strokeWidth={1.2} />
            <path d="M-4 -10 L0 -4 L4 -10 Z" fill="#2b1d16" />
            <PixelRects grid={avatarGrid(avatarId)} x={-8} y={-28} />
          </g>
        ) : null}
      </svg>
      <div className="map-zoom">
        <button className="icon-btn map-btn" aria-label="Zoom in" onClick={() => zoomAt(1 / 1.4, null)}>
          +
        </button>
        <button className="icon-btn map-btn" aria-label="Zoom out" onClick={() => zoomAt(1.4, null)}>
          −
        </button>
        <button className="icon-btn map-btn" aria-label="Show the whole city" onClick={() => setVb(full)}>
          ⟲
        </button>
      </div>
      <a className="map-attrib" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap contributors
      </a>
    </div>
  );
}

function clampVB(v: VB, map: CityMap): VB {
  const pad = 80;
  return {
    ...v,
    x: Math.min(map.width + pad - v.w * 0.3, Math.max(-pad - v.w * 0.7, v.x)),
    y: Math.min(map.height + pad - v.h * 0.3, Math.max(-pad - v.h * 0.7, v.y)),
  };
}

const Shapes = memo(function Shapes({ map, counts, home, selected }: { map: CityMap; counts: Record<string, number>; home: string | null; selected: string | null }) {
  return (
    <g>
      {map.barangays.map((b) => (
        <g key={b.id} data-barangay={b.name}>
          {b.polygons.map((poly, i) => (
            <path
              key={i}
              d={pathD(poly)}
              fill={selected === b.name ? "#f6d77b" : tintFor(counts[b.name] ?? 0)}
              stroke={b.name === selected ? "#d0402f" : "#5e4636"}
              strokeWidth={b.name === selected ? 3.5 : b.name === home ? 2.5 : 1.2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          ))}
        </g>
      ))}
    </g>
  );
});

function Labels({
  map,
  k,
  home,
  selected,
  highlight,
  small,
}: {
  map: CityMap;
  k: number;
  home: string | null;
  selected: string | null;
  highlight: string | null;
  small: boolean;
}) {
  const size = (small ? 11 : 12) * k;
  return (
    <g className="map-labels" style={{ fontSize: size }}>
      {map.barangays.map((b) => {
        const pxArea = b.area / (k * k);
        const show = b.name === selected || b.name === home || b.name === highlight || pxArea > (small ? 1300 : 2600);
        if (!show) return null;
        const tiny = b.area_km2 < TINY_KM2;
        return (
          <text
            key={b.id}
            x={b.label[0]}
            y={b.label[1] + (tiny ? 22 * k : 4 * k)}
            textAnchor="middle"
            strokeWidth={3 * k}
            className={b.name === selected ? "map-label map-label-on" : "map-label"}
          >
            {b.name}
          </text>
        );
      })}
    </g>
  );
}

/** 12x12 pixel landmark icons, centred on the point. */
function Landmark({ kind }: { kind: string }) {
  const k = "#2b1d16";
  const box = <rect x={-7} y={-7} width={14} height={14} fill="#fff8e7" stroke={k} strokeWidth={1.2} />;
  switch (kind) {
    case "mall":
      return (
        <g shapeRendering="crispEdges">
          {box}
          <rect x={-4} y={-2} width={8} height={7} fill="#d8577e" />
          <rect x={-2} y={-5} width={1} height={3} fill={k} />
          <rect x={1} y={-5} width={1} height={3} fill={k} />
          <rect x={-2} y={-5} width={4} height={1} fill={k} />
        </g>
      );
    case "train_station":
      return (
        <g shapeRendering="crispEdges">
          {box}
          <rect x={-4} y={-5} width={8} height={8} fill="#3a5ea8" />
          <rect x={-3} y={-4} width={6} height={3} fill="#9fd3e0" />
          <rect x={-3} y={3} width={2} height={2} fill={k} />
          <rect x={1} y={3} width={2} height={2} fill={k} />
        </g>
      );
    case "city_hall":
      return (
        <g shapeRendering="crispEdges">
          {box}
          <rect x={-5} y={-4} width={10} height={2} fill="#c8402f" />
          {[-4, -1, 2].map((x) => (
            <rect key={x} x={x} y={-2} width={2} height={6} fill="#e9e1cf" stroke={k} strokeWidth={0.4} />
          ))}
          <rect x={-5} y={4} width={10} height={1} fill={k} />
        </g>
      );
    case "golf_course":
      return (
        <g shapeRendering="crispEdges">
          {box}
          <rect x={-1} y={-5} width={1} height={10} fill={k} />
          <rect x={0} y={-5} width={4} height={3} fill="#d0402f" />
          <rect x={-4} y={4} width={8} height={1} fill="#3f8f4d" />
        </g>
      );
    default:
      return (
        <g>
          {box}
          <circle r={2} fill={k} />
        </g>
      );
  }
}
