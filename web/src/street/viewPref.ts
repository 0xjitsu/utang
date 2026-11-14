// "Street" (Phaser) vs "Simple" (SVG) view preference, shared by the hero and the menu drawer.
const KEY = "utang-hero-view";
type View = "street" | "simple";
const listeners = new Set<(v: View) => void>();

function prefersReducedMotion(): boolean {
  try {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function getViewPref(): View {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    if (v === "street" || v === "simple") return v;
  } catch {
    /* ignore */
  }
  return prefersReducedMotion() ? "simple" : "street";
}

export function setViewPref(v: View) {
  try {
    globalThis.localStorage?.setItem(KEY, v);
  } catch {
    /* ignore */
  }
  listeners.forEach((f) => f(v));
}

export function onViewPref(fn: (v: View) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reducedMotion() {
  return prefersReducedMotion();
}
