// Judge demo deep link: ?judge=1 skips the start card and lands in Preview
// already signed in as ikaw.testnet, living in Hulo, on the walkable street.

import { setViewPref } from "../street/viewPref";
import { DEFAULT_PLAYER } from "../near/mock/world";
import type { Backend } from "../near";

const SESSION_KEY = "utang-started";

export function isJudgeDemo(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("judge") === "1";
  } catch {
    return false;
  }
}

export function markSessionStarted() {
  try {
    globalThis.sessionStorage?.setItem(SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Sync join so the first painted frame is already on the Hulo street. */
export function setupJudgePreview(backend: Backend) {
  if (backend.mode !== "preview" || !backend.preview) return;
  markSessionStarted();
  setViewPref("street");
  try {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.replace(/^#\/?/, "");
      if (hash && hash !== "store") {
        /* leave a judge who linked to a specific screen */
      } else if (window.location.hash !== "#store") {
        window.location.hash = "store";
      }
    }
  } catch {
    /* ignore */
  }
  const id = DEFAULT_PLAYER;
  backend.preview.setAccount(id);
  const world = backend.preview.world;
  const c = world.contract;
  const now = world.now();
  if (!c.profile(id, now)) {
    c.storageDeposit(id, id, BigInt(c.rules.join_deposit), now);
  }
  const me = c.profile(id, now);
  if (me && me.barangay !== "Hulo") {
    c.setBarangay(id, "Hulo", now);
  }
  world.save();
  world.notify();
}
