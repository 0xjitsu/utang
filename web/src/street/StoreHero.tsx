// The game stage background: the walkable Phaser street, or the SVG store ("Simple view").
// Falls back to the SVG automatically when WebGL/Canvas is unavailable, Phaser fails to load,
// or the player prefers reduced motion (unless they explicitly chose the street in the menu).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { externalApi, useGame } from "../game/GameProvider";
import { bus } from "../game/bus";
import { useQuest } from "../components/Quest";
import type { StreetHandle } from "./StreetGame";
import type { StreetData } from "./StreetScene";
import type { Profile } from "../near/types";
import { getViewPref, onViewPref } from "./viewPref";

/** Can this browser run the street at all? */
export function streetSupported(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (/jsdom/i.test(navigator.userAgent)) return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("2d"));
  } catch {
    return false;
  }
}

export interface StreetView {
  players: Profile[];
  barangay: string | null;
  isHome: boolean;
}

export function StoreHero({ simple, street: streetView }: { simple: ReactNode; street: StreetView }) {
  const [pref, setPref] = useState(getViewPref);
  const [failed, setFailed] = useState(false);
  const [supported] = useState(streetSupported);
  useEffect(
    () =>
      onViewPref((v) => {
        setPref(v);
        if (v === "street") setFailed(false);
      }),
    [],
  );
  const street = pref === "street" && supported && !failed;
  return (
    <div className="hero-fill">
      {street ? <StreetCanvas fallback={simple} view={streetView} onFail={() => setFailed(true)} /> : simple}
      {failed ? <span className="hero-note">Street view isn't available here, so this is the simple store.</span> : null}
    </div>
  );
}

function StreetCanvas({ fallback, view: streetView, onFail }: { fallback: ReactNode; view: StreetView; onFail: () => void }) {
  const g = useGame();
  const { view } = useQuest();
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<StreetHandle | null>(null);
  const [ready, setReady] = useState(false);

  const data: StreetData = {
    accountId: g.accountId,
    me: g.me,
    players: streetView.players,
    barangay: streetView.barangay,
    isHome: streetView.isHome,
    myLoans: g.myLoans,
    rules: g.rules,
    nowNs: g.now,
    questArrow: view.arrow,
  };
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    let disposed = false;
    const el = host.current;
    if (!el) return;
    import("./StreetGame")
      .then(({ createStreetGame }) =>
        createStreetGame(el, dataRef.current, {
          onVisit: (accountId) => bus.emit("open:profile", { accountId }),
          onOpenStore: () => bus.emit("open:store", {}),
          onJeep: () => bus.emit("open:screen", { screen: "map" }),
        }),
      )
      .then((h) => {
        if (disposed) {
          h.destroy();
          return;
        }
        handle.current = h;
        (externalApi as any).street = h;
        h.update(dataRef.current);
        setReady(true);
      })
      .catch((e) => {
        console.info("[street] falling back to the simple store:", e?.message ?? e);
        if (!disposed) onFail();
      });
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => handle.current?.resize(el.clientWidth, el.clientHeight)) : null;
    ro?.observe(el);
    return () => {
      disposed = true;
      ro?.disconnect();
      handle.current?.destroy();
      handle.current = null;
      (externalApi as any).street = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handle.current?.update(data);
  });

  return (
    <div className={`street-wrap${ready ? " street-ready" : ""}`}>
      <div className="street-host" ref={host} />
      {!ready ? (
        <div className="street-placeholder">
          {fallback}
          <div className="street-loading" role="status">
            Unfolding the street…
          </div>
        </div>
      ) : null}
    </div>
  );
}
