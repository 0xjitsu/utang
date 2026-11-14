// Small dependency-free SVG line chart in the pixel theme: stepped lines, one y-axis,
// legend with values at the hovered day, crosshair + tooltip, and a table view.
import { useMemo, useRef, useState } from "react";

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

interface Props {
  title: string;
  subtitle?: string;
  days: number[];
  series: Series[];
  format: (v: number) => string;
  /** Force the y-range to include this max (e.g. 100% for an index). */
  yMax?: number;
  markers?: { day: number; label: string }[];
}

const W = 340;
const H = 190;
const M = { l: 46, r: 6, t: 10, b: 22 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

export function LineChart({ title, subtitle, days, series, format, yMax, markers = [] }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const n = days.length;
  const max = useMemo(() => {
    const m = Math.max(0, ...series.flatMap((s) => s.values.filter((v) => Number.isFinite(v))));
    return niceMax(Math.max(m, yMax ?? 0));
  }, [series, yMax]);
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;
  const x = (i: number) => M.l + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  const y = (v: number) => M.t + ih - (Math.max(0, v) / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const dayTicks = days.filter((d, i) => i === 0 || i === n - 1 || d % 15 === 0);

  const paths = series.map((s) => {
    let d = "";
    s.values.forEach((v, i) => {
      const px = x(i);
      const py = y(v);
      if (i === 0) d += `M${px.toFixed(1)},${py.toFixed(1)}`;
      else d += `H${px.toFixed(1)}V${py.toFixed(1)}`;
    });
    return d;
  });

  const idx = hover ?? n - 1;

  const onMove = (clientX: number) => {
    const el = wrap.current;
    if (!el || n === 0) return;
    const r = el.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((px - M.l) / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <figure className="chart">
      <figcaption>
        <strong>{title}</strong>
        {subtitle ? <span className="muted small"> {subtitle}</span> : null}
      </figcaption>
      {series.length > 1 ? (
        <ul className="legend">
          {series.map((s) => (
            <li key={s.key}>
              <span className={`swatch${s.dashed ? " swatch-dashed" : ""}`} style={{ background: s.color }} />
              {s.label}: <b>{n ? format(s.values[idx]) : "–"}</b>
            </li>
          ))}
          <li className="muted">day {days[idx] ?? "–"}</li>
        </ul>
      ) : (
        <div className="legend single">
          <b>{n ? format(series[0].values[idx]) : "–"}</b> <span className="muted">on day {days[idx] ?? "–"}</span>
        </div>
      )}
      <div
        className="chart-svg-wrap"
        ref={wrap}
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={M.l - 4} y={y(t) + 3} textAnchor="end" className="axis">
                {format(t)}
              </text>
            </g>
          ))}
          {dayTicks.map((d) => {
            const i = days.indexOf(d);
            return (
              <text key={d} x={x(i)} y={H - 6} textAnchor="middle" className="axis">
                {d}
              </text>
            );
          })}
          {markers.map((m) => {
            const i = days.indexOf(m.day);
            if (i < 0) return null;
            return (
              <g key={m.label}>
                <line x1={x(i)} x2={x(i)} y1={M.t} y2={M.t + ih} className="marker" />
                <text x={Math.min(x(i) + 3, W - 70)} y={M.t + 9} className="axis marker-label">
                  {m.label}
                </text>
              </g>
            );
          })}
          {paths.map((d, i) => (
            <path
              key={series[i].key}
              d={d}
              fill="none"
              stroke={series[i].color}
              strokeWidth={2}
              strokeDasharray={series[i].dashed ? "4 3" : undefined}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="miter"
              shapeRendering="crispEdges"
            />
          ))}
          {hover !== null ? (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ih} className="crosshair" />
              {series.map((s) => (
                <rect
                  key={s.key}
                  x={x(hover) - 3}
                  y={y(s.values[hover]) - 3}
                  width={6}
                  height={6}
                  fill={s.color}
                  stroke="#fff8e7"
                  strokeWidth={1.5}
                />
              ))}
            </g>
          ) : null}
        </svg>
      </div>
      <details className="chart-table">
        <summary>Table</summary>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              {series.map((s) => (
                <th key={s.key}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) =>
              i % 5 === 4 || i === 0 ? (
                <tr key={d}>
                  <td>{d}</td>
                  {series.map((s) => (
                    <td key={s.key}>{format(s.values[i])}</td>
                  ))}
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
