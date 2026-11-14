import { useState } from "react";
import { Coin } from "../art/icons";
import { unlockAudio } from "../audio/sound";

const KEY = "utang-started";

function alreadyStarted() {
  try {
    return globalThis.sessionStorage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** "Tap to open the store": a first-gesture screen that also unlocks audio. Once per session. */
export function StartScreen() {
  const [open, setOpen] = useState(() => !alreadyStarted());
  const touch = (() => {
    try {
      return !!window.matchMedia?.("(pointer: coarse)").matches;
    } catch {
      return false;
    }
  })();
  if (!open) return null;
  const start = () => {
    void unlockAudio();
    try {
      globalThis.sessionStorage?.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };
  return (
    <div className="start-screen" onClick={start} role="dialog" aria-label="Start">
      <div className="start-card">
        <Coin size={56} spin />
        <h1 className="logo">$UTANG</h1>
        <p className="start-pitch">Lend to neighbours, repay on time, become the most trusted tindahan on the street.</p>
        <button className="btn" onClick={start} autoFocus>
          {touch ? "Tap" : "Click"} to open the store
        </button>
        <p className="muted small">Sound on. You can mute it any time with the speaker button.</p>
      </div>
    </div>
  );
}
