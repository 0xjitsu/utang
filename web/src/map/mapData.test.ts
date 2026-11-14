import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BARANGAYS } from "../near/mock/contract";
import { barangayAt, pointInPolygon, TINY_KM2, type CityMap } from "./mapData";

const map: CityMap = JSON.parse(readFileSync(new URL("../../public/map/mandaluyong.json", import.meta.url), "utf8"));

describe("map data", () => {
  it("has exactly the contract's 27 barangays (exact UTF-8 names)", () => {
    expect(map.barangays.map((b) => b.name).sort()).toEqual([...BARANGAYS].sort());
    expect(map.attribution).toMatch(/OpenStreetMap/);
  });

  it("point-in-polygon basics", () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(pointInPolygon([5, 5], sq)).toBe(true);
    expect(pointInPolygon([15, 5], sq)).toBe(false);
  });

  it("each barangay's label point maps back to that barangay", () => {
    for (const b of map.barangays) expect(barangayAt(map, b.label, 0)).toBe(b.name);
  });

  it("tiny barangays get an enlarged tap target; outside the city is nothing", () => {
    const tiny = map.barangays.filter((b) => b.area_km2 < TINY_KM2).map((b) => b.name).sort();
    expect(tiny).toEqual(["Burol", "Harapin ang Bukas"]);
    for (const name of tiny) {
      const b = map.barangays.find((x) => x.name === name)!;
      // a point just outside the drawn shape, but within a finger-sized radius of its label
      let outside: [number, number] | null = null;
      for (let r = 10; r <= 34 && !outside; r += 2)
        for (let a = 0; a < 360 && !outside; a += 15) {
          const p: [number, number] = [b.label[0] + r * Math.cos((a * Math.PI) / 180), b.label[1] + r * Math.sin((a * Math.PI) / 180)];
          const others = map.barangays.filter((o) => o.area_km2 < TINY_KM2 && o.name !== name);
          const closestIsOwn = others.every((o) => Math.hypot(p[0] - o.label[0], p[1] - o.label[1]) > r);
          if (closestIsOwn && !b.polygons.some((poly) => pointInPolygon(p, poly))) outside = p;
        }
      expect(outside).not.toBeNull();
      expect(barangayAt(map, outside!, 40)).toBe(name);
      expect(barangayAt(map, outside!, 0)).not.toBe(name);
    }
    expect(barangayAt(map, [2, 2])).toBeNull();
    expect(barangayAt(map, [map.width - 2, map.height - 2])).toBeNull();
  });
});
