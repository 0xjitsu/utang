// Builds public/map/mandaluyong.json (+ a preview SVG) from OpenStreetMap data.
//
// Usage:  node scripts/build-map.mjs            # uses the cached Overpass response if present
//         node scripts/build-map.mjs --refresh  # re-downloads from the Overpass API
//
// Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
// Only administrative boundaries, major roads, rivers and a few public landmarks are fetched.
// No shops, businesses, buildings, addresses or people are extracted.
//
// Node >= 18 (built-in fetch). No dependencies.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(here, ".cache");
const CACHE_FILE = join(CACHE_DIR, "overpass-mandaluyong.json");
const OUT_DIR = resolve(here, "../public/map");
const OUT_JSON = join(OUT_DIR, "mandaluyong.json");
const OUT_SVG = join(OUT_DIR, "mandaluyong-preview.svg");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "utang-game-map-builder/1.0 (hackathon game; one-off build script)";
const MAX_REQUESTS = 3;

// Canvas: the longer side is CANVAS units, with PAD units of margin on every side.
const CANVAS = 1000;
const PAD = 16;
// Douglas–Peucker tolerances in canvas units (1 unit ≈ 5–6 m on the ground).
const TOL_BOUNDARY = 0.6;
const TOL_ROAD = 1.2;
const TOL_RIVER = 1.2;

// Generous box around Mandaluyong (south, west, north, east) used for rivers.
const BBOX = [14.55, 121.0, 14.615, 121.075];

const EXPECTED = [
  "Addition Hills", "Bagong Silang", "Barangka Drive", "Barangka Ibaba", "Barangka Ilaya",
  "Barangka Itaas", "Buayang Bato", "Burol", "Daang Bakal", "Hagdang Bato Itaas",
  "Hagdang Bato Libis", "Harapin ang Bukas", "Highway Hills", "Hulo", "Mabini-J. Rizal",
  "Malamig", "Mauway", "Namayan", "New Zañiga", "Old Zañiga", "Pag-asa", "Plainview",
  "Pleasant Hills", "Poblacion", "San Jose", "Vergara", "Wack-Wack Greenhills",
];

// Public landmarks we are willing to show (names only). Everything else is ignored.
const MALL_NAMES = "Megamall|Shangri-La|Robinsons Forum|Starmall|The Podium";

const bb = BBOX.join(",");
const QUERY = `[out:json][timeout:180];
rel["boundary"="administrative"]["admin_level"="6"]["name"~"Mandaluyong"](${bb})->.cityRel;
.cityRel out geom;
.cityRel map_to_area->.city;
rel(area.city)["boundary"="administrative"]["admin_level"="10"];
out geom;
way(area.city)["highway"~"^(motorway|trunk|primary|secondary)$"];
out geom;
(
  way["waterway"="river"]["name"~"Pasig|San Juan"](${bb});
  rel["waterway"="river"]["name"~"Pasig|San Juan"](${bb});
);
out geom(${bb});
(
  nwr(area.city)["amenity"="townhall"]["name"~"City Hall",i];
  nwr(area.city)["railway"="station"]["name"];
  nwr(area.city)["shop"="mall"]["name"~"${MALL_NAMES}",i];
  nwr(area.city)["leisure"="golf_course"]["name"];
);
out center tags;`;

// ---------------------------------------------------------------------------------------------
// Fetch (with cache)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOverpass() {
  let wait = 15000;
  for (let attempt = 1; attempt <= MAX_REQUESTS; attempt++) {
    console.log(`Overpass request ${attempt}/${MAX_REQUESTS}…`);
    let res;
    try {
      res = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "data=" + encodeURIComponent(QUERY),
      });
    } catch (err) {
      if (attempt === MAX_REQUESTS) throw err;
      console.warn(`  network error: ${err.message}; retrying in ${wait / 1000}s`);
      await sleep(wait);
      wait *= 2;
      continue;
    }
    if (res.ok) return await res.text();
    if ((res.status === 429 || res.status === 504 || res.status === 502) && attempt < MAX_REQUESTS) {
      const ra = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(ra) && ra > 0 ? ra * 1000 : wait;
      console.warn(`  HTTP ${res.status}; backing off ${delay / 1000}s`);
      await sleep(delay);
      wait *= 2;
      continue;
    }
    throw new Error(`Overpass HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  throw new Error("Overpass: out of retries");
}

async function loadData() {
  const refresh = process.argv.includes("--refresh");
  if (!refresh && existsSync(CACHE_FILE)) {
    console.log(`Using cached Overpass response (${CACHE_FILE}); pass --refresh to re-download.`);
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  }
  const text = await fetchOverpass();
  const data = JSON.parse(text); // validate before caching
  if (data.remark) console.warn(`Overpass remark: ${data.remark}`);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, ".gitignore"), "*\n");
  writeFileSync(CACHE_FILE, JSON.stringify({ query: QUERY, fetched_at: new Date().toISOString(), ...data }));
  return data;
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers

const fail = (msg) => {
  console.error(`\nBUILD FAILED: ${msg}`);
  process.exit(1);
};

const R = 6378137;
const mercX = (lon) => (R * lon * Math.PI) / 180;
const mercY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

const keyOf = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
const samePt = (a, b) => a[0] === b[0] && a[1] === b[1];

function sqSegDist(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}

// Douglas–Peucker for an open polyline; endpoints always kept.
function simplifyLine(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const sq = tol * tol;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [f, l] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = f + 1; i < l; i++) {
      const d = sqSegDist(pts[i], pts[f], pts[l]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > sq) { keep[idx] = 1; stack.push([f, idx], [idx, l]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Simplify a closed way (first === last): split at the point farthest from the start.
function simplifyClosed(pts, tol) {
  let far = 0, best = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > best) { best = d; far = i; }
  }
  const a = simplifyLine(pts.slice(0, far + 1), tol);
  const b = simplifyLine(pts.slice(far), tol);
  return a.concat(b.slice(1));
}

function signedArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
}

function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Signed distance from point to polygon outline (positive inside). polygon = [outer, ...holes]
function pointToPolygonDist(x, y, polygon) {
  let inside = false, minSq = Infinity;
  for (const ring of polygon) {
    for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
      const a = ring[i], b = ring[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      minSq = Math.min(minSq, sqSegDist([x, y], a, b));
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(minSq);
}

// Pole of inaccessibility (port of mapbox/polylabel, ISC licence, idea only).
function polylabel(polygon, precision = 0.5) {
  const outer = polygon[0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of outer) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const w = maxX - minX, h = maxY - minY;
  const cellSize = Math.min(w, h);
  if (cellSize === 0) return [minX, minY];
  const mk = (x, y, hs) => {
    const d = pointToPolygonDist(x, y, polygon);
    return { x, y, h: hs, d, max: d + hs * Math.SQRT2 };
  };
  const queue = [];
  const push = (c) => { queue.push(c); };
  const pop = () => {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[bi].max) bi = i;
    return queue.splice(bi, 1)[0];
  };
  for (let x = minX; x < maxX; x += cellSize) for (let y = minY; y < maxY; y += cellSize) push(mk(x + cellSize / 2, y + cellSize / 2, cellSize / 2));
  // Seed with area centroid and bbox centre.
  let best = (() => {
    let area = 0, cx = 0, cy = 0;
    for (let i = 0, len = outer.length, j = len - 1; i < len; j = i++) {
      const a = outer[i], b = outer[j], f = a[0] * b[1] - b[0] * a[1];
      cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f; area += f * 3;
    }
    return area === 0 ? mk(outer[0][0], outer[0][1], 0) : mk(cx / area, cy / area, 0);
  })();
  const bboxCell = mk(minX + w / 2, minY + h / 2, 0);
  if (bboxCell.d > best.d) best = bboxCell;
  while (queue.length) {
    const c = pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const hs = c.h / 2;
    push(mk(c.x - hs, c.y - hs, hs)); push(mk(c.x + hs, c.y - hs, hs));
    push(mk(c.x - hs, c.y + hs, hs)); push(mk(c.x + hs, c.y + hs, hs));
  }
  return [best.x, best.y, best.d];
}

const r1 = (v) => Math.round(v * 10) / 10;
const roundPts = (pts) => {
  const out = [];
  for (const p of pts) {
    const q = [r1(p[0]), r1(p[1])];
    if (!out.length || !samePt(out[out.length - 1], q)) out.push(q);
  }
  return out;
};

const slug = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------------------------------------------------------------------------------------------
// Ring assembly from relation members

// Returns { rings: [[{wayId, reversed}]], repairs: [string] } joining outer ways end to end.
function assembleRings(members, label) {
  const repairs = [];
  const ways = members
    .filter((m) => m.type === "way" && (m.role === "outer" || m.role === "") && m.geometry?.length >= 2)
    .map((m) => ({ id: m.ref, g: m.geometry, used: false }));
  const inners = members.filter((m) => m.type === "way" && m.role === "inner").length;
  if (inners) repairs.push(`${inners} inner way(s) ignored (holes dropped)`);
  const missing = members.filter((m) => m.type === "way" && !(m.geometry?.length >= 2)).length;
  if (missing) repairs.push(`${missing} member way(s) without geometry skipped`);

  const start = (w, rev) => keyOf(rev ? w.g[w.g.length - 1] : w.g[0]);
  const end = (w, rev) => keyOf(rev ? w.g[0] : w.g[w.g.length - 1]);
  const rings = [];
  for (const seed of ways) {
    if (seed.used) continue;
    seed.used = true;
    const seq = [{ w: seed, rev: false }];
    const first = start(seed, false);
    let tail = end(seed, false);
    let guard = 0;
    while (tail !== first && guard++ < 10000) {
      let next = null;
      for (const w of ways) {
        if (w.used) continue;
        if (start(w, false) === tail) { next = { w, rev: false }; break; }
        if (end(w, false) === tail) { next = { w, rev: true }; break; }
      }
      if (!next) {
        // Gap: snap to nearest unused way endpoint within ~11 m.
        const [tlat, tlon] = tail.split(",").map(Number);
        let bestD = 1e-4, cand = null;
        for (const w of ways) {
          if (w.used) continue;
          for (const rev of [false, true]) {
            const p = rev ? w.g[w.g.length - 1] : w.g[0];
            const d = Math.hypot(p.lat - tlat, p.lon - tlon);
            if (d < bestD) { bestD = d; cand = { w, rev }; }
          }
        }
        const [flat, flon] = first.split(",").map(Number);
        const dFirst = Math.hypot(flat - tlat, flon - tlon);
        if (cand && bestD < dFirst) {
          repairs.push(`snapped gap of ${(bestD * 111000).toFixed(1)} m to way ${cand.w.id}`);
          next = cand;
        } else {
          repairs.push(`closed open ring by joining ends ${(dFirst * 111000).toFixed(1)} m apart`);
          break;
        }
      }
      next.w.used = true;
      seq.push(next);
      tail = end(next.w, next.rev);
    }
    rings.push(seq.map(({ w, rev }) => ({ wayId: w.id, rev, g: w.g })));
  }
  if (!rings.length) fail(`${label}: no outer ways`);
  return { rings, repairs };
}

// Chains open polylines (arrays of {lat,lon}) end to end; returns arrays of {lat,lon}.
function chainLines(lines) {
  const items = lines.map((g) => ({ g, used: false }));
  const out = [];
  for (const seed of items) {
    if (seed.used) continue;
    seed.used = true;
    let chain = seed.g.slice();
    let grew = true;
    while (grew) {
      grew = false;
      for (const it of items) {
        if (it.used) continue;
        const a = keyOf(chain[0]), b = keyOf(chain[chain.length - 1]);
        const s = keyOf(it.g[0]), e = keyOf(it.g[it.g.length - 1]);
        if (s === b) chain = chain.concat(it.g.slice(1));
        else if (e === b) chain = chain.concat(it.g.slice(0, -1).reverse());
        else if (e === a) chain = it.g.slice(0, -1).concat(chain);
        else if (s === a) chain = it.g.slice(1).reverse().concat(chain);
        else continue;
        it.used = true;
        grew = true;
      }
    }
    out.push(chain);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const data = await loadData();
  const els = data.elements ?? [];
  console.log(`Overpass returned ${els.length} elements.`);

  // --- classify
  const cityRel = els.find((e) => e.type === "relation" && e.tags?.admin_level === "6" && /Mandaluyong/.test(e.tags?.name ?? ""));
  if (!cityRel) fail("Mandaluyong admin_level=6 relation not found");
  const brgyRels = els.filter((e) => e.type === "relation" && e.tags?.boundary === "administrative" && e.tags?.admin_level === "10");
  const roadWays = els.filter((e) => e.type === "way" && /^(motorway|trunk|primary|secondary)$/.test(e.tags?.highway ?? "") && e.geometry);
  const riverEls = els.filter((e) => e.tags?.waterway === "river");
  const poiEls = els.filter((e) => e.tags && !e.tags.boundary && !e.tags.highway && !e.tags.waterway && (e.center || e.lat != null));

  // --- city ring (full resolution, lon/lat) for spatial filtering
  const cityAsm = assembleRings(cityRel.members, "city");
  const ringLonLat = (ring) => ring.flatMap(({ g, rev }, i) => {
    const pts = (rev ? g.slice().reverse() : g).map((p) => [p.lon, p.lat]);
    return i === 0 ? pts : pts.slice(1);
  });
  const cityRingsLL = cityAsm.rings.map(ringLonLat);
  const inCityLL = (lon, lat) => cityRingsLL.some((r) => pointInRing([lon, lat], r));

  // --- projection fitted to the city bbox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of cityRingsLL) for (const [lon, lat] of r) {
    const x = mercX(lon), y = mercY(lat);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const spanX = maxX - minX, spanY = maxY - minY;
  const scale = (CANVAS - 2 * PAD) / Math.max(spanX, spanY);
  const W = Math.round(spanX * scale + 2 * PAD), H = Math.round(spanY * scale + 2 * PAD);
  const proj = (lon, lat) => [PAD + (mercX(lon) - minX) * scale, PAD + (maxY - mercY(lat)) * scale];
  const projG = (g) => g.map((p) => proj(p.lon, p.lat));
  const metresPerUnit = 1 / scale / (1 / Math.cos(((cityRingsLL[0][0][1]) * Math.PI) / 180));
  console.log(`Canvas ${W}×${H}; 1 unit ≈ ${metresPerUnit.toFixed(1)} m`);

  // --- shared per-way simplification so neighbouring barangays keep identical borders
  const wayCache = new Map();
  const simplifiedWay = (wayId, g) => {
    if (!wayCache.has(wayId)) {
      const pts = projG(g);
      const closed = samePt(pts[0], pts[pts.length - 1]) && pts.length > 3;
      let s = closed ? simplifyClosed(pts, TOL_BOUNDARY) : simplifyLine(pts, TOL_BOUNDARY);
      wayCache.set(wayId, roundPts(s));
    }
    return wayCache.get(wayId);
  };
  const buildRing = (ring) => {
    let pts = [];
    for (const { wayId, rev, g } of ring) {
      let s = simplifiedWay(wayId, g);
      if (rev) s = s.slice().reverse();
      if (pts.length && samePt(pts[pts.length - 1], s[0])) s = s.slice(1);
      pts = pts.concat(s);
    }
    if (!samePt(pts[0], pts[pts.length - 1])) pts.push(pts[0].slice());
    return pts;
  };

  const city = cityAsm.rings.map(buildRing).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];

  // --- barangays
  const repairsLog = [];
  if (cityAsm.repairs.length) repairsLog.push(`City: ${cityAsm.repairs.join("; ")}`);
  const barangays = [];
  const dropped = [];
  const lat0 = cityRingsLL[0][0][1];
  const mPerDegLat = 111320, mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  for (const rel of brgyRels) {
    const name = rel.tags.name ?? `relation ${rel.id}`;
    const asm = assembleRings(rel.members, name);
    const ringsLL = asm.rings.map(ringLonLat);
    // Spatial filter: interior point of the largest ring must be inside the city.
    const biggestLL = ringsLL.slice().sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
    const scaledBig = biggestLL.map(([lon, lat]) => [lon * mPerDegLon, lat * mPerDegLat]);
    const [px, py] = polylabel([scaledBig], 1);
    if (!inCityLL(px / mPerDegLon, py / mPerDegLat)) { dropped.push(name); continue; }

    let polygons = asm.rings.map(buildRing);
    const tiny = polygons.filter((p) => p.length < 4 || Math.abs(signedArea(p)) < 1);
    if (tiny.length) asm.repairs.push(`dropped ${tiny.length} degenerate ring(s) after simplification`);
    polygons = polygons.filter((p) => p.length >= 4 && Math.abs(signedArea(p)) >= 1);
    // Normalise winding: clockwise on screen (positive signed area with y down).
    polygons = polygons.map((p) => (signedArea(p) < 0 ? p.slice().reverse() : p));
    polygons.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
    const area = polygons.reduce((s, p) => s + Math.abs(signedArea(p)), 0);
    const areaKm2 = ringsLL.reduce((s, r) => s + Math.abs(signedArea(r.map(([lon, lat]) => [lon * mPerDegLon, lat * mPerDegLat]))), 0) / 1e6;
    const [lx, ly] = polylabel([polygons[0]], 0.5);
    if (asm.repairs.length) repairsLog.push(`${name}: ${asm.repairs.join("; ")}`);
    barangays.push({
      name,
      id: slug(name),
      osm_relation: rel.id,
      polygons,
      label: [r1(lx), r1(ly)],
      area: Math.round(area),
      area_km2: Math.round(areaKm2 * 1000) / 1000,
    });
  }
  barangays.sort((a, b) => a.name.localeCompare(b.name, "en"));

  // --- roads: merge by (kind, name), simplify, clip to canvas
  const inCanvas = ([x, y]) => x >= 0 && y >= 0 && x <= W && y <= H;
  const clipLine = (pts) => {
    const parts = [];
    let cur = [];
    for (const p of pts) {
      if (inCanvas(p)) cur.push(p);
      else { if (cur.length >= 2) parts.push(cur); cur = []; }
    }
    if (cur.length >= 2) parts.push(cur);
    return parts;
  };
  const groups = new Map();
  for (const w of roadWays) {
    const kind = w.tags.highway;
    const name = w.tags.name ?? "";
    const k = `${kind}|${name}`;
    if (!groups.has(k)) groups.set(k, { kind, name, lines: [] });
    groups.get(k).lines.push(w.geometry);
  }
  const KIND_ORDER = { motorway: 0, trunk: 1, primary: 2, secondary: 3 };
  const roads = [];
  for (const { kind, name, lines } of groups.values()) {
    for (const chain of chainLines(lines)) {
      for (const part of clipLine(projG(chain))) {
        const pts = roundPts(simplifyLine(part, TOL_ROAD));
        if (pts.length >= 2) roads.push({ name, kind, points: pts });
      }
    }
  }
  roads.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));

  // --- rivers: prefer relation member geometry, fall back to named ways
  const riverLines = new Map();
  for (const e of riverEls) {
    const name = e.tags.name;
    if (!/Pasig|San Juan/.test(name ?? "")) continue;
    if (!riverLines.has(name)) riverLines.set(name, { ways: new Map() });
    const bucket = riverLines.get(name).ways;
    if (e.type === "relation") {
      for (const m of e.members ?? []) if (m.type === "way" && m.geometry?.length >= 2 && m.role !== "spring") bucket.set(m.ref, m.geometry.filter(Boolean));
    } else if (e.geometry) bucket.set(e.id, e.geometry);
  }
  const rivers = [];
  for (const [name, { ways }] of riverLines) {
    const lines = [...ways.values()].filter((g) => g.length >= 2 && g.every((p) => p && p.lat != null));
    for (const chain of chainLines(lines)) {
      for (const part of clipLine(projG(chain))) {
        const pts = roundPts(simplifyLine(part, TOL_RIVER));
        if (pts.length >= 2) rivers.push({ name, points: pts });
      }
    }
  }

  // --- landmarks
  const landmarks = [];
  const seen = new Set();
  for (const e of poiEls) {
    const t = e.tags;
    const name = t["name:en"] ?? t.name;
    if (!name) continue;
    const kind = t.amenity === "townhall" ? "city_hall"
      : t.railway === "station" ? "train_station"
      : t.shop === "mall" ? "mall"
      : t.leisure === "golf_course" ? "golf_course" : null;
    if (!kind) continue;
    const lat = e.center?.lat ?? e.lat, lon = e.center?.lon ?? e.lon;
    const key = `${kind}|${name.toLowerCase().replace(/\s+station$/, "")}`;
    if (seen.has(key)) continue;
    const pt = proj(lon, lat);
    if (!inCanvas(pt)) continue;
    // Same kind within ~100 m (e.g. "Shangri-La Plaza" vs "Shangri-La Plaza Mall"): keep the shorter name.
    const dup = landmarks.find((l) => l.kind === kind && Math.hypot(l.point[0] - pt[0], l.point[1] - pt[1]) < 20);
    if (dup) {
      if (name.length < dup.name.length) dup.name = name;
      continue;
    }
    seen.add(key);
    landmarks.push({ name, kind, point: [r1(pt[0]), r1(pt[1])] });
  }
  landmarks.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  // --- validation
  const errors = [];
  const names = barangays.map((b) => b.name);
  if (barangays.length !== 27) errors.push(`expected 27 barangays, got ${barangays.length}`);
  for (const n of EXPECTED) if (!names.includes(n)) errors.push(`missing barangay "${n}"`);
  for (const n of names) if (!EXPECTED.includes(n)) errors.push(`unexpected barangay "${n}"`);
  if (new Set(barangays.map((b) => b.id)).size !== barangays.length) errors.push("duplicate barangay ids");
  const checkRing = (r, what) => {
    if (!Array.isArray(r) || r.length < 4) errors.push(`${what}: ring has < 4 points`);
    else if (!samePt(r[0], r[r.length - 1])) errors.push(`${what}: ring not closed`);
    else if (Math.abs(signedArea(r)) <= 0) errors.push(`${what}: ring has zero area`);
    for (const p of r ?? []) if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) { errors.push(`${what}: non-finite coordinate`); break; }
  };
  checkRing(city, "city");
  for (const b of barangays) {
    if (!b.polygons.length) errors.push(`${b.name}: no polygons`);
    b.polygons.forEach((p, i) => checkRing(p, `${b.name} polygon ${i}`));
    if (b.polygons.length && !pointInRing(b.label, b.polygons[0])) errors.push(`${b.name}: label point outside polygon`);
    if (b.polygons.length && pointToPolygonDist(b.label[0], b.label[1], [b.polygons[0]]) <= 0) errors.push(`${b.name}: label on boundary`);
  }
  const areaSum = barangays.reduce((s, b) => s + b.area, 0);
  const cityArea = Math.abs(signedArea(city));
  const coverage = areaSum / cityArea;
  if (coverage < 0.95 || coverage > 1.05) errors.push(`barangay area sum is ${(coverage * 100).toFixed(1)}% of the city area`);
  if (!roads.length) errors.push("no roads");
  if (!rivers.length) errors.push("no rivers");
  if (errors.length) fail("\n  - " + errors.join("\n  - "));

  // --- write JSON
  const out = {
    name: "Mandaluyong",
    attribution: "© OpenStreetMap contributors (ODbL)",
    source: "https://www.openstreetmap.org/copyright",
    generated_at: new Date().toISOString(),
    width: W,
    height: H,
    city,
    barangays,
    roads,
    rivers,
    landmarks,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const json = JSON.stringify(out);
  writeFileSync(OUT_JSON, json);
  writeFileSync(OUT_SVG, renderSvg(out));

  // --- report
  console.log(`\nBarangays (${barangays.length}); dropped neighbours outside city: ${dropped.length ? dropped.join(", ") : "none"}`);
  for (const b of barangays) {
    const n = b.polygons.reduce((s, p) => s + p.length, 0);
    console.log(`  ${b.name.padEnd(22)} ${String(n).padStart(4)} pts  ${b.polygons.length} ring(s)  ${b.area_km2.toFixed(3)} km²  label ${b.label}`);
  }
  console.log(`City outline: ${city.length} pts; barangays cover ${(coverage * 100).toFixed(2)}% of city area`);
  console.log(`Roads: ${roads.length} polylines, ${roads.reduce((s, r) => s + r.points.length, 0)} pts`);
  console.log(`Rivers: ${rivers.map((r) => `${r.name} (${r.points.length} pts)`).join(", ")}`);
  console.log(`Landmarks: ${landmarks.map((l) => `${l.name} [${l.kind}]`).join(", ") || "none"}`);
  console.log(repairsLog.length ? `Geometry repairs:\n  ${repairsLog.join("\n  ")}` : "Geometry repairs: none needed");
  console.log(`\nWrote ${OUT_JSON} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB)`);
  console.log(`Wrote ${OUT_SVG}`);
}

// ---------------------------------------------------------------------------------------------
// Preview SVG

function renderSvg(m) {
  const palette = ["#f9c5a0", "#f6dd9a", "#f4b6b0", "#e9cfa3", "#fbe3c0", "#f2c08f", "#efd6b8", "#f7a99a", "#eadb92", "#f5cdd0"];
  // Greedy colouring so neighbours (sharing any vertex) get different colours.
  const vkeys = m.barangays.map((b) => new Set(b.polygons.flat().map((p) => p.join(","))));
  const colour = [];
  m.barangays.forEach((b, i) => {
    const used = new Set();
    for (let j = 0; j < i; j++) {
      for (const k of vkeys[i]) if (vkeys[j].has(k)) { used.add(colour[j]); break; }
    }
    colour[i] = palette.findIndex((_, c) => !used.has(c));
    if (colour[i] < 0) colour[i] = i % palette.length;
  });
  const path = (pts) => "M" + pts.map((p) => `${p[0]} ${p[1]}`).join("L");
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const roadW = { motorway: 5, trunk: 4.5, primary: 3, secondary: 2 };
  const roadC = { motorway: "#c0392b", trunk: "#d35400", primary: "#8e5a2a", secondary: "#9a8a78" };
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.width} ${m.height}" width="${m.width}" height="${m.height}" font-family="Helvetica, Arial, sans-serif">`);
  parts.push(`<rect width="${m.width}" height="${m.height}" fill="#fdf6e8"/>`);
  m.barangays.forEach((b, i) => {
    parts.push(`<path d="${b.polygons.map(path).join("")}Z" fill="${palette[colour[i]]}" stroke="#3b2a1a" stroke-width="1.5" stroke-linejoin="round"/>`);
  });
  for (const r of m.rivers) parts.push(`<path d="${path(r.points)}" fill="none" stroke="#4a90c2" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`);
  for (const r of m.roads.slice().reverse()) parts.push(`<path d="${path(r.points)}" fill="none" stroke="${roadC[r.kind]}" stroke-width="${roadW[r.kind]}" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>`);
  parts.push(`<path d="${path(m.city)}Z" fill="none" stroke="#1f140b" stroke-width="3.5" stroke-linejoin="round"/>`);
  for (const l of m.landmarks) {
    parts.push(`<circle cx="${l.point[0]}" cy="${l.point[1]}" r="4" fill="#2c3e50" stroke="#fff" stroke-width="1.5"/>`);
    parts.push(`<text x="${l.point[0] + 6}" y="${l.point[1] + 3}" font-size="9" fill="#2c3e50" stroke="#fff" stroke-width="2.5" paint-order="stroke">${esc(l.name)}</text>`);
  }
  for (const b of m.barangays) {
    parts.push(`<text x="${b.label[0]}" y="${b.label[1]}" font-size="12" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#2a1a0c" stroke="#fffaf0" stroke-width="3" paint-order="stroke">${esc(b.name)}</text>`);
  }
  const seenRoad = new Set();
  for (const r of m.roads) {
    if (!r.name || seenRoad.has(r.name) || r.points.length < 2 || r.kind === "secondary") continue;
    seenRoad.add(r.name);
    const p = r.points[Math.floor(r.points.length / 2)];
    parts.push(`<text x="${p[0]}" y="${p[1] - 5}" font-size="9" font-style="italic" fill="${roadC[r.kind]}" stroke="#fff" stroke-width="2" paint-order="stroke">${esc(r.name)}</text>`);
  }
  for (const r of m.rivers) {
    const p = r.points[Math.floor(r.points.length / 2)];
    parts.push(`<text x="${p[0]}" y="${p[1] + 14}" font-size="10" font-style="italic" fill="#1f5f8b" stroke="#fff" stroke-width="2" paint-order="stroke">${esc(r.name)}</text>`);
  }
  parts.push(`<text x="${m.width - 6}" y="${m.height - 6}" font-size="10" text-anchor="end" fill="#555">${esc(m.attribution)}</text>`);
  parts.push(`</svg>`);
  return parts.join("\n") + "\n";
}

main().catch((err) => fail(err.stack ?? String(err)));
