// When should the street (Phaser) react to input? Only when the player is actually playing it:
// no dialog, drawer, picker, reward, start screen or ride is open, the pointer went down on the
// canvas itself, and keys aren't meant for a focused button, link or field.

export const BLOCKING_UI =
  ".rpg-backdrop, .drawer-backdrop, .picker-overlay, .reward-backdrop, .start-screen, .ride, .confirm-backdrop";

export function uiBlocksStreet(doc: Document | undefined = globalThis.document): boolean {
  return !!doc?.querySelector(BLOCKING_UI);
}

/** A pointer event belongs to the street only if it started on the game canvas and no UI is open. */
export function pointerForStreet(downElement: unknown, canvas: unknown, doc?: Document): boolean {
  return !!canvas && downElement === canvas && !uiBlocksStreet(doc);
}

const INTERACTIVE = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "SUMMARY", "OPTION"]);

/** Is keyboard focus on something that should get this key instead of the street? */
export function focusIsOnUi(target: EventTarget | null, canvas: unknown): boolean {
  const el = target as HTMLElement | null;
  if (!el || el === canvas) return false;
  if (el.isContentEditable) return true;
  if (INTERACTIVE.has(el.tagName)) return true;
  return !!el.closest?.("button, a, input, select, textarea, [role='dialog'], [role='radio'], [role='tab']");
}

export type StreetKeyAction = "move" | "visit" | null;

/**
 * What a key press means for the street. "e" visits (unless focus is on UI); Enter/Space only
 * visit when the canvas itself has focus. Arrow/WASD keys move unless typing or a UI is open.
 */
export function streetKey(
  key: string,
  target: EventTarget | null,
  canvas: unknown,
  doc?: Document,
): StreetKeyAction {
  if (uiBlocksStreet(doc)) return null;
  const k = key.toLowerCase();
  const onUi = focusIsOnUi(target, canvas);
  const typing = !!(target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");
  if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k)) return typing ? null : "move";
  if (["a", "d", "w", "s"].includes(k)) return onUi ? null : "move";
  if (k === "e") return onUi ? null : "visit";
  if ((k === "enter" || k === " ") && target === canvas) return "visit";
  return null;
}
