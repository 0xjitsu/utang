// "≡" menu drawer: mode details, preview time controls, account, sound, view, quest.
import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "./useFocusTrap";
import { Avatar } from "../art/Avatar";
import { getSoundSettings, onSoundSettings, setSoundSettings, unlockAudio } from "../audio/sound";
import { useGame } from "../game/GameProvider";
import { CONTRACT_ID, NETWORK } from "../near/config";
import { isValidAccountId } from "../near/format";
import { DEFAULT_PLAYER, NPCS } from "../near/mock/world";
import { getViewPref, onViewPref, setViewPref } from "../street/viewPref";
import { useQuest } from "./Quest";
import { bus } from "../game/bus";
import { Button } from "./ui";

export function Drawer({ open, onClose, pickAccount }: { open: boolean; onClose: () => void; pickAccount: boolean }) {
  const g = useGame();
  const { restart } = useQuest();
  const [sound, setSound] = useState(getSoundSettings);
  const [view, setView] = useState(getViewPref);
  const [name, setName] = useState(DEFAULT_PLAYER);
  useEffect(() => onSoundSettings(setSound), []);
  useEffect(() => onViewPref(setView), []);
  if (!open) return null;
  return <DrawerBody onClose={onClose} pickAccount={pickAccount} g={g} restart={restart} sound={sound} view={view} name={name} setName={setName} />;
}

function DrawerBody({
  onClose,
  pickAccount,
  g,
  restart,
  sound,
  view,
  name,
  setName,
}: {
  onClose: () => void;
  pickAccount: boolean;
  g: ReturnType<typeof useGame>;
  restart: () => void;
  sound: ReturnType<typeof getSoundSettings>;
  view: ReturnType<typeof getViewPref>;
  name: string;
  setName: (v: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useFocusTrap(ref, onClose);
  const day = g.rules && g.originNs ? Number((g.now - g.originNs) / BigInt(g.rules.day_ns)) + 1 : null;
  const valid = isValidAccountId(name.trim());
  const pick = (id: string) => {
    g.actions.previewSignInAs(id);
    onClose();
  };

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Menu" ref={ref} tabIndex={-1}>
        <header className="drawer-head">
          <h2>Menu</h2>
          <button className="icon-btn icon-close" onClick={onClose} aria-label="Close menu">
            ✕
          </button>
        </header>

        <section className="drawer-sec">
          <div className="tag-row">
            {g.mode === "preview" ? <span className="tag tag-preview">PREVIEW DATA</span> : <span className="tag">{NETWORK}</span>}
            {g.rules?.demo_time ? <span className="tag tag-demo">DEMO TIME: 1 day = 1 minute</span> : null}
            {day !== null ? <span className="tag tag-day">Day {day}</span> : null}
          </div>
          <p className="drawer-text">
            {g.mode === "preview"
              ? "An in-browser neighbourhood with computer neighbours. Nothing here is on-chain."
              : `Live on NEAR ${NETWORK}: ${CONTRACT_ID}.`}
          </p>
          {g.mode === "preview" ? (
            <div className="btn-row">
              <Button kind="secondary" onClick={() => g.actions.previewSkipDays(1)}>
                Skip 1 day ⏩
              </Button>
              {confirmReset ? null : (
                <Button kind="ghost" onClick={() => setConfirmReset(true)}>
                  Reset…
                </Button>
              )}
            </div>
          ) : null}
          {g.mode === "preview" && confirmReset ? (
            <div className="confirm-box" role="alertdialog" aria-label="Reset the preview?">
              <p className="drawer-text">
                Reset the whole preview neighbourhood? Your pretend account, loans and quest progress start over.
              </p>
              <div className="btn-row">
                <Button
                  kind="danger"
                  onClick={() => {
                    g.actions.previewReset();
                    setConfirmReset(false);
                    onClose();
                  }}
                >
                  Yes, reset
                </Button>
                <Button kind="secondary" onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="drawer-sec">
          <h3>Account</h3>
          {g.accountId ? (
            <div className="drawer-acct">
              <Avatar name={g.accountId} size={32} />
              <span className="acct">{g.accountId}</span>
            </div>
          ) : (
            <p className="drawer-text">Not playing yet.</p>
          )}
          {g.mode === "preview" ? (
            <div className={pickAccount ? "pick pick-focus" : "pick"}>
              <form
                className="btn-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (valid) pick(name.trim());
                }}
              >
                <input className="input" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} aria-label="Account name" />
                <Button type="submit" disabled={!valid}>
                  Play as {name.trim() || "…"}
                </Button>
              </form>
              <p className="drawer-text small">Or step into a neighbour's store:</p>
              <div className="picker-grid">
                {NPCS.map((n) => (
                  <button key={n.id} className="picker-item" onClick={() => pick(n.id)}>
                    <Avatar name={n.id} size={28} />
                    <span className="acct small">{n.id}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : g.accountId ? (
            <Button kind="secondary" onClick={() => g.actions.signOut().then(onClose)}>
              Sign out
            </Button>
          ) : (
            <Button onClick={() => g.actions.signIn()}>Connect NEAR wallet</Button>
          )}
        </section>

        {g.me && g.rules?.barangays?.length ? (
          <section className="drawer-sec">
            <h3>Barangay</h3>
            <p className="drawer-text">
              {g.me.barangay ? `Your tindahan is in Brgy. ${g.me.barangay}.` : "You haven't chosen a barangay yet."} Only the barangay name is
              stored, never an address.
            </p>
            <Button
              kind="secondary"
              onClick={() => {
                onClose();
                bus.emit("open:picker", {});
              }}
            >
              {g.me.barangay ? "Move to another barangay" : "Choose your barangay"}
            </Button>
          </section>
        ) : null}

        <section className="drawer-sec">
          <h3>Sound</h3>
          <label className="drawer-line">
            <input
              type="checkbox"
              checked={!sound.muted}
              onChange={(e) => {
                void unlockAudio();
                setSoundSettings({ muted: !e.target.checked });
              }}
            />
            Sound effects
          </label>
          <label className="drawer-line">
            Volume
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(sound.volume * 100)}
              onChange={(e) => setSoundSettings({ volume: Number(e.target.value) / 100, muted: false })}
              aria-label="Volume"
            />
          </label>
          <label className="drawer-line">
            <input
              type="checkbox"
              checked={sound.music}
              onChange={(e) => {
                void unlockAudio();
                setSoundSettings({ music: e.target.checked });
              }}
            />
            Background music (quiet)
          </label>
        </section>

        <section className="drawer-sec">
          <h3>View</h3>
          <div className="seg" role="radiogroup" aria-label="Store view">
            <button role="radio" aria-checked={view === "street"} className={view === "street" ? "seg-on" : ""} onClick={() => setViewPref("street")}>
              Street
            </button>
            <button role="radio" aria-checked={view === "simple"} className={view === "simple" ? "seg-on" : ""} onClick={() => setViewPref("simple")}>
              Simple
            </button>
          </div>
          <Button
            kind="ghost"
            onClick={() => {
              restart();
              onClose();
            }}
          >
            Restart the quest guide
          </Button>
        </section>
      </aside>
    </div>
  );
}
