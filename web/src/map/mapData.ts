// Mandaluyong map data (public/map/mandaluyong.json, © OpenStreetMap contributors, ODbL) and
// the geometry used for tapping barangays.

export type Pt = [number, number];

export interface BarangayShape {
  name: string;
  id: string;
  polygons: Pt[][];
  label: Pt;
  area: number;
  area_km2: number;
  osm_relation?: number;
}

export interface CityMap {
  name?: string;
  attribution: string;
  width: number;
  height: number;
  city: Pt[];
  barangays: BarangayShape[];
  roads: { name: string; kind: string; points: Pt[] }[];
  rivers: { name: string; points: Pt[] }[];
  landmarks: { name: string; kind: string; point: Pt }[];
}

/** Barangays this small (km²) get an enlarged circular tap target around their label. */
export const TINY_KM2 = 0.06;

let cache: Promise<CityMap> | null = null;

export function loadCityMap(): Promise<CityMap> {
  if (!cache) {
    const base = (import.meta as any).env?.BASE_URL ?? "/";
    cache = fetch(`${base}map/mandaluyong.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`map ${r.status}`))))
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}

/** Ray-casting point-in-polygon. */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Which barangay is at map point `p`? Tiny barangays win within `tinyRadius` (map units) of
 * their label, so they stay tappable on a phone; otherwise exact polygon containment.
 */
export function barangayAt(map: Pick<CityMap, "barangays">, p: Pt, tinyRadius = 14): string | null {
  let bestTiny: { name: string; d: number } | null = null;
  for (const b of map.barangays) {
    if (b.area_km2 >= TINY_KM2) continue;
    const d = Math.hypot(p[0] - b.label[0], p[1] - b.label[1]);
    if (d <= tinyRadius && (!bestTiny || d < bestTiny.d)) bestTiny = { name: b.name, d };
  }
  if (bestTiny) return bestTiny.name;
  for (const b of map.barangays) if (b.polygons.some((poly) => pointInPolygon(p, poly))) return b.name;
  return null;
}

export function pathD(poly: Pt[]): string {
  return poly.map((pt, i) => `${i ? "L" : "M"}${pt[0]},${pt[1]}`).join("") + "Z";
}

export function lineD(points: Pt[]): string {
  return points.map((pt, i) => `${i ? "L" : "M"}${pt[0]},${pt[1]}`).join("");
}

/** Sequential tint for player counts (one hue, light → dark). */
export function tintFor(count: number): string {
  if (count <= 0) return "#efe3c6";
  if (count === 1) return "#a9dcbf";
  if (count <= 3) return "#6fbf95";
  if (count <= 6) return "#3f9a6c";
  return "#22724c";
}

/** Bounding box of a barangay's polygons. */
export function bboxOf(b: BarangayShape): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of b.polygons)
    for (const [x, y] of poly) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
