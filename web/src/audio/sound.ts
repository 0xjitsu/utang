// Generated sound effects with ZzFX (MIT). ZzFX creates an AudioContext when imported, so it is
// only imported after the first user gesture (browsers block audio before that anyway).
// Settings (muted, volume, music) are remembered in localStorage.

import { bus } from "../game/bus";

type ZzfxModule = typeof import("zzfx");
type Params = (number | undefined)[];

export type SfxName =
  | "click"
  | "step"
  | "doorbell"
  | "page"
  | "coin"
  | "coins"
  | "kaching"
  | "sparkle"
  | "jingle"
  | "fanfare"
  | "uhoh"
  | "error"
  | "open"
  | "close"
  | "blip"
  | "jeep";

// zzfx(volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide, deltaSlide,
//      pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter)
const P = {
  click: [0.35, 0, 900, 0, 0.005, 0.03, 1, 1.5],
  step: [0.12, 0.2, 140, 0, 0.004, 0.03, 4, 1, 0, 0, 0, 0, 0, 3],
  ding: [0.5, 0, 1046, 0.005, 0.06, 0.6, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
  dong: [0.5, 0, 784, 0.005, 0.08, 0.8, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
  page: [0.35, 0.1, 1800, 0.02, 0.05, 0.12, 4, 0, -6, 0, 0, 0, 0, 4],
  coin: [0.45, 0, 1675, 0, 0.03, 0.2, 1, 1.8, 0, 0, 837, 0.06],
  cha: [0.35, 0.1, 2400, 0, 0.02, 0.12, 4, 1, 0, 0, 0, 0, 0, 6],
  ching: [0.45, 0, 2093, 0, 0.04, 0.35, 1, 1.5, 0, 0, 1046, 0.05],
  sparkle: [0.22, 0, 2600, 0, 0.02, 0.18, 0, 1, 0, 0, 600, 0.04],
  note: [0.3, 0, 523, 0.01, 0.06, 0.18, 1, 1],
  uh: [0.35, 0, 392, 0.02, 0.08, 0.15, 1, 1, -2],
  oh: [0.35, 0, 294, 0.02, 0.1, 0.25, 1, 1, -3],
  error: [0.3, 0, 140, 0, 0.05, 0.1, 2, 1, -5],
  open: [0.22, 0, 520, 0.01, 0.03, 0.08, 1, 1, 6],
  close: [0.2, 0, 620, 0.01, 0.03, 0.08, 1, 1, -6],
  blip: [0.05, 0.1, 700, 0, 0.004, 0.015, 1, 1],
} satisfies Record<string, Params>;

export interface SoundSettings {
  muted: boolean;
  volume: number; // 0..1
  music: boolean;
}

const KEY = "utang-sound";
const DEFAULTS: SoundSettings = { muted: false, volume: 0.6, music: false };

function load(): SoundSettings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

let settings = load();
let zz: ZzfxModule | null = null;
let loading: Promise<void> | null = null;
let unlocked = false;
const listeners = new Set<(s: SoundSettings) => void>();

export function getSoundSettings(): SoundSettings {
  return settings;
}

export function onSoundSettings(fn: (s: SoundSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSoundSettings(patch: Partial<SoundSettings>) {
  settings = { ...settings, ...patch };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  applyVolume();
  if (settings.music && !settings.muted) startMusic();
  else stopMusic();
  listeners.forEach((f) => f(settings));
}

function applyVolume() {
  if (zz) zz.ZZFX.volume = 0.5 * settings.volume;
}

/** Call from a user gesture. Loads ZzFX and resumes the audio context. */
export function unlockAudio(): Promise<void> {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return Promise.resolve();
  unlocked = true;
  if (!loading) {
    loading = import("zzfx")
      .then((m) => {
        zz = m;
        applyVolume();
        void m.ZZFX.audioContext.resume?.();
        if (settings.music && !settings.muted) startMusic();
      })
      .catch(() => {
        zz = null;
      });
  } else if (zz) void zz.ZZFX.audioContext.resume?.();
  return (loading ?? Promise.resolve()).then(() => {
    playStartSting();
  });
}

let stingPlayed = false;

/** Short welcome arpeggio on the first successful unlock. Skipped if muted. */
function playStartSting() {
  if (stingPlayed || !zz || settings.muted) return;
  stingPlayed = true;
  play("jingle");
}

export function isAudioUnlocked() {
  return unlocked;
}

function raw(params: Params, volumeScale = 1, pitch = 1) {
  if (!zz || settings.muted || settings.volume <= 0) return;
  const p = [...params];
  p[0] = (p[0] ?? 1) * volumeScale;
  if (pitch !== 1) p[2] = (p[2] ?? 220) * pitch;
  try {
    zz.zzfx(...p);
  } catch {
    /* audio is optional */
  }
}

function later(ms: number, fn: () => void) {
  setTimeout(fn, ms);
}

let lastStep = 0;
let lastBlip = 0;

export function play(name: SfxName | string) {
  if (!zz || settings.muted) return;
  switch (name) {
    case "click":
      return raw(P.click);
    case "step": {
      const t = performance.now();
      if (t - lastStep < 120) return;
      lastStep = t;
      return raw(P.step, 1, 0.9 + Math.random() * 0.2);
    }
    case "doorbell":
      raw(P.ding);
      return later(260, () => raw(P.dong));
    case "page":
      return raw(P.page);
    case "coin":
      return raw(P.coin);
    case "coins":
      for (let i = 0; i < 6; i++) later(i * 70, () => raw(P.coin, 0.7, 0.85 + Math.random() * 0.4));
      return;
    case "kaching":
      raw(P.cha);
      later(80, () => raw(P.ching));
      for (let i = 0; i < 4; i++) later(220 + i * 90, () => raw(P.sparkle, 0.8, 1 + i * 0.12));
      return;
    case "sparkle":
      return raw(P.sparkle);
    case "jingle":
      [523, 659, 784, 1046].forEach((f, i) => later(i * 110, () => raw(P.note, 1, f / 523)));
      return;
    case "fanfare":
      [392, 523, 659, 784].forEach((f, i) => later(i * 120, () => raw(P.note, 1.1, f / 523)));
      later(500, () => raw([0.35, 0, 1046, 0.01, 0.25, 0.4, 1, 1], 1));
      later(500, () => raw([0.25, 0, 784, 0.01, 0.25, 0.4, 1, 1], 1));
      return;
    case "uhoh":
      raw(P.uh);
      return later(200, () => raw(P.oh));
    case "error":
      return raw(P.error);
    case "jeep":
      // beep-beep, then a little engine rumble
      raw([0.35, 0, 523, 0.01, 0.08, 0.05, 2, 1]);
      later(160, () => raw([0.35, 0, 523, 0.01, 0.12, 0.08, 2, 1]));
      for (let i = 0; i < 6; i++) later(320 + i * 140, () => raw([0.18, 0.2, 70, 0.02, 0.08, 0.06, 2, 1, 0, 0, 0, 0, 0, 0.6]));
      return;
    case "open":
      return raw(P.open);
    case "close":
      return raw(P.close);
    case "blip": {
      const t = performance.now();
      if (t - lastBlip < 55) return;
      lastBlip = t;
      return raw(P.blip, 1, 0.9 + Math.random() * 0.25);
    }
  }
}

// ------------------------------------------------------------------ calm generated chiptune loop

const MELODY = [
  // C major pentatonic, gentle; 0 = rest. One eighth note per step.
  523, 0, 659, 0, 784, 659, 587, 0, 523, 0, 440, 0, 392, 0, 0, 0,
  440, 0, 523, 0, 587, 523, 440, 0, 392, 0, 440, 523, 587, 0, 0, 0,
];
const BASS = [131, 0, 0, 0, 196, 0, 0, 0, 110, 0, 0, 0, 165, 0, 0, 0];
let musicTimer: ReturnType<typeof setInterval> | null = null;
let musicStep = 0;

function startMusic() {
  if (musicTimer || !zz) return;
  musicTimer = setInterval(() => {
    const m = MELODY[musicStep % MELODY.length];
    const b = BASS[musicStep % BASS.length];
    if (m) raw([0.09, 0, m, 0.02, 0.08, 0.25, 0, 1], 1);
    if (b) raw([0.1, 0, b, 0.02, 0.2, 0.4, 1, 1], 1);
    musicStep++;
  }, 300);
}

function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
}

// ------------------------------------------------------------------ wiring

let installed = false;

/** Maps game events to sounds and adds a soft click to buttons. Idempotent. */
export function installSound() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Browsers only grant audio unlock on a real user gesture. pointerdown/touchstart are requested
  // for the earliest tap; click/touchend/keydown are kept because they reliably carry user activation.
  const gestureEvents = ["pointerdown", "touchstart", "keydown", "click", "touchend"] as const;
  const gesture = () => {
    void unlockAudio().then(() => {
      if (!zz) return;
      for (const ev of gestureEvents) window.removeEventListener(ev, gesture, true);
    });
  };
  for (const ev of gestureEvents) window.addEventListener(ev, gesture, { capture: true });
  document.addEventListener(
    "click",
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.(".btn, .nav-btn, .tab, .chip, .link-btn, .modal-x, .choice, .icon-btn, .hud-btn");
      if (el && !(el as HTMLButtonElement).disabled) play("click");
    },
    true,
  );
  bus.on("sfx", ({ name }) => play(name));
  bus.on("visitor:arrived", () => play("doorbell"));
  bus.on("screen:changed", ({ screen }) => screen === "listahan" && play("page"));
  bus.on("loan:approved", () => play("coins"));
  bus.on("loan:repaid", ({ counted, late }) => play(counted ? "kaching" : late ? "coin" : "coin"));
  bus.on("coins:received", () => play("coin"));
  bus.on("level:up", () => play("jingle"));
  bus.on("badge:earned", () => later(400, () => play("fanfare")));
  bus.on("loan:overdue", () => play("uhoh"));
  bus.on("bayad:muna", () => play("uhoh"));
  bus.on("tx:error", () => play("error"));
}
