import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "./art/Avatar";
import { Coin, NavIcon } from "./art/icons";
import { Sprite } from "./art/pixel";
import { getSoundSettings, onSoundSettings, setSoundSettings, unlockAudio } from "./audio/sound";
import { Drawer } from "./components/Drawer";
import { GameDialog, type DialogTarget } from "./components/GameDialog";
import { QuestProvider, QuestReward } from "./components/Quest";
import { StartScreen } from "./components/StartScreen";
import { Toasts } from "./components/ui";
import { useGame } from "./game/GameProvider";
import { bus, type Screen } from "./game/bus";
import { fmtUtang, shortName } from "./near/format";
import { DEFAULT_PLAYER } from "./near/mock/world";
import { Economy } from "./screens/Economy";
import { GameScreen } from "./screens/GameScreen";
import { Leaderboard } from "./screens/Leaderboard";
import { Listahan } from "./screens/Listahan";
import { Neighbours } from "./screens/Neighbours";
import { BarangayPicker, MapScreen } from "./map/MapScreen";
import { JeepneyRide } from "./map/JeepneyRide";
import { useVisiting } from "./game/location";
import { useQuest } from "./components/Quest";

const SCREENS: { id: Screen; label: string; short?: string }[] = [
  { id: "store", label: "Store" },
  { id: "map", label: "Map" },
  { id: "listahan", label: "Listahan" },
  { id: "neighbours", label: "Neighbours", short: "People" },
  { id: "leaderboard", label: "Leaders" },
  { id: "economy", label: "Economy" },
];

function screenFromHash(): Screen {
  const h = (typeof window !== "undefined" ? window.location.hash : "").replace(/^#\/?/, "");
  return (SCREENS.find((s) => s.id === h)?.id ?? "store") as Screen;
}

export function App() {
  return (
    <QuestProvider>
      <Shell />
    </QuestProvider>
  );
}

const SPEAKER = ["....k...", "...kk...", "kkkwk.w.", "kwwwk..w", "kwwwk..w", "kkkwk.w.", "...kk...", "....k..."];
const SPEAKER_OFF = ["....k...", "...kk...", "kkkwkr.r", "kwwwk.r.", "kwwwk.r.", "kkkwkr.r", "...kk...", "....k..."];

function MuteButton() {
  const [s, setS] = useState(getSoundSettings);
  useEffect(() => onSoundSettings(setS), []);
  return (
    <button
      className="icon-btn"
      aria-label={s.muted ? "Unmute sound" : "Mute sound"}
      aria-pressed={s.muted}
      onClick={() => {
        void unlockAudio();
        setSoundSettings({ muted: !s.muted });
      }}
    >
      <Sprite rows={s.muted ? SPEAKER_OFF : SPEAKER} palette={{ k: "#2b1d16", w: "#fff8e7", r: "#d0402f" }} size={18} />
    </button>
  );
}

function Shell() {
  const g = useGame();
  const [screen, setScreen] = useState<Screen>(screenFromHash);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [drawer, setDrawer] = useState<{ pick: boolean } | null>(null);
  /** Barangay street being visited (null = your own street); shared with the quest. */
  const [visiting, setVisiting] = useVisiting();
  const [ride, setRide] = useState<{ to: string | null } | null>(null);
  const [picker, setPicker] = useState(false);

  const go = useCallback((s: Screen) => {
    if (window.location.hash !== `#${s}`) window.location.hash = s;
    setScreen(s);
    setDialog(null);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    bus.emit("screen:changed", { screen });
  }, [screen]);

  useEffect(() => {
    const onHash = () => setScreen(screenFromHash());
    window.addEventListener("hashchange", onHash);
    const offs = [
      bus.on("open:screen", ({ screen }) => go(screen)),
      bus.on("open:profile", ({ accountId }) => setDialog({ who: accountId })),
      bus.on("open:ask", ({ lender }) => setDialog({ who: lender, step: "ask" })),
      bus.on("open:store", ({ view }) => setDialog({ who: "store", step: view ?? "main" })),
      bus.on("open:picker", () => setPicker(true)),
      bus.on("travel", ({ barangay }) => setRide({ to: barangay })),
    ];
    return () => {
      window.removeEventListener("hashchange", onHash);
      offs.forEach((f) => f());
    };
  }, [go]);

  // After joining, ask where the tindahan is (if the contract has barangays).
  useEffect(
    () =>
      bus.on("player:joined", () => {
        if (g.rules?.barangays?.length) setPicker(true);
      }),
    [g.rules],
  );
  // Your own street changes if you move: stop "visiting" it.
  useEffect(() => {
    if (visiting && visiting === g.me?.barangay) setVisiting(null);
  }, [visiting, g.me?.barangay]);

  const rideRef = useRef(ride);
  rideRef.current = ride;
  const finishRide = useCallback(() => {
    const r = rideRef.current;
    setRide(null);
    if (r) setVisiting(r.to && r.to !== g.me?.barangay ? r.to : null);
    go("store");
  }, [g.me?.barangay, go, setVisiting]);

  const quest = useQuest();
  const closeDialog = useCallback(() => setDialog(null), []);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const incoming = g.myLoans.filter((l) => l.lender === g.accountId && l.status === "Requested").length;

  if (g.status === "booting") {
    return (
      <div className="boot">
        <Coin size={48} spin />
        <p>Opening the store…</p>
      </div>
    );
  }
  if (g.status === "error") {
    return (
      <div className="boot">
        <p className="warn-text">Couldn't start: {g.bootError}</p>
      </div>
    );
  }

  return (
    <div className={`app app-${screen === "map" ? "store" : screen}${dialog || drawer || picker ? " has-dialog" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={() => go("store")} aria-label="$UTANG home">
          <Coin size={22} spin />
          <span className="logo">$UTANG</span>
        </button>
        {g.busy ? <span className="busy-dot" aria-live="polite">{g.busy}</span> : null}
        <div className="topbar-right">
          {g.me && screen !== "store" ? (
            <span className="coin-chip" aria-label={`${fmtUtang(g.me.balance)} UTANG`}>
              <Coin size={14} />
              {fmtUtang(g.me.balance)}
            </span>
          ) : null}
          <MuteButton />
          {g.accountId ? (
            <button className="acct-chip" onClick={() => setDrawer({ pick: false })} aria-label={`Account ${g.accountId}, open menu`}>
              <Avatar name={g.accountId} size={24} />
              <span className="acct">{shortName(g.accountId)}</span>
            </button>
          ) : null}
          <button className="icon-btn menu-btn" onClick={() => setDrawer({ pick: false })} aria-label="Open menu">
            ≡
          </button>
        </div>
      </header>
      {g.loadError ? <div className="load-error">Can't reach the contract right now: {g.loadError}</div> : null}

      <nav className="nav" aria-label="Game menu">
        {SCREENS.map((s) => (
          <button key={s.id} className={`nav-btn${screen === s.id ? " nav-on" : ""}`} onClick={() => go(s.id)} aria-current={screen === s.id}>
            <NavIcon id={s.id} size={22} />
            {s.short ? (
              <>
                <span className="nav-long">{s.label}</span>
                <span className="nav-short" aria-hidden>
                  {s.short}
                </span>
              </>
            ) : (
              <span>{s.label}</span>
            )}
            {s.id === "store" && incoming > 0 ? <span className="nav-dot">{incoming}</span> : null}
          </button>
        ))}
      </nav>

      <main className={screen === "store" || screen === "map" ? "main main-stage" : "main"}>
        {screen === "store" ? (
          <GameScreen
            visiting={visiting}
            onGoHome={() => setRide({ to: null })}
            onPreviewSignIn={() => g.actions.previewSignInAs(DEFAULT_PLAYER)}
          />
        ) : null}
        {screen === "map" ? <MapScreen onRide={(b) => setRide({ to: b })} /> : null}
        {screen === "listahan" ? <Listahan /> : null}
        {screen === "neighbours" ? <Neighbours /> : null}
        {screen === "leaderboard" ? <Leaderboard /> : null}
        {screen === "economy" ? <Economy /> : null}
      </main>

      {dialog ? <GameDialog target={dialog} onTarget={setDialog} onClose={closeDialog} /> : null}
      <Drawer open={!!drawer} pickAccount={!!drawer?.pick} onClose={closeDrawer} />
      {picker ? (
        <BarangayPicker
          onClose={() => setPicker(false)}
          tip={quest.view.target && quest.view.targetBarangay ? { name: shortName(quest.view.target), barangay: quest.view.targetBarangay } : null}
        />
      ) : null}
      {ride ? <JeepneyRide to={ride.to ?? g.me?.barangay ?? "home"} onDone={finishRide} /> : null}
      <QuestReward />
      <Toasts />
      <StartScreen />
    </div>
  );
}
