// Copies ../sim/output/*.json into public/sim/ so the Economy screen can load /sim/<scenario>.json.
// Usage: npm run sync-sim
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../sim/output");
const dest = resolve(here, "../public/sim");

if (!existsSync(src)) {
  console.error(`No simulation output at ${src}. Run the simulation first (cd sim && python3 simulate.py).`);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
const files = readdirSync(src).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.error(`No .json files in ${src}.`);
  process.exit(1);
}
for (const f of files) {
  copyFileSync(join(src, f), join(dest, f));
  console.log(`copied ${f}`);
}
console.log(`Synced ${files.length} file(s) into public/sim/.`);
