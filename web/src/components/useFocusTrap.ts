// Keeps keyboard focus inside an open dialog/drawer, closes on Escape, and returns focus to
// whatever opened it.
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    // content of a closed <details> isn't reachable (its <summary> is)
    const closed = el.closest("details:not([open])");
    if (closed && !(el.tagName === "SUMMARY" && el.parentElement === closed)) return false;
    const visible = typeof el.checkVisibility === "function" ? el.checkVisibility() : el.offsetParent !== null;
    return visible || el === document.activeElement;
  });
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, onEscape: () => void, refocusKey?: unknown) {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  // remember the opener once, on the first render (before focus moves inside; StrictMode-safe),
  // and restore focus to it on close (or to the street, if the street opened it)
  const openerRef = useRef<HTMLElement | null | undefined>(undefined);
  if (openerRef.current === undefined && typeof document !== "undefined") {
    const active = document.activeElement as HTMLElement | null;
    openerRef.current = active && active !== document.body ? active : null;
  }
  useEffect(() => {
    const opener = openerRef.current ?? null;
    return () => {
      const target =
        opener && document.contains(opener) ? opener : document.querySelector<HTMLElement>(".street-host canvas");
      // let React finish unmounting first, then restore — unless the trap is still mounted
      // (React StrictMode re-runs effects in development: cleanup + mount again)
      const root = ref.current;
      setTimeout(() => {
        if (root && document.contains(root)) return;
        target?.focus?.({ preventScroll: true });
      }, 0);
    };
  }, []);
  // if the focused control disappears (e.g. "Repay" after repaying), keep focus inside
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const a = document.activeElement as HTMLElement | null;
    if (a && root.contains(a)) return;
    const other = a?.closest?.('[role="dialog"]');
    if (other && other !== root) return; // another dialog (e.g. the quest reward) has focus
    if (a && a !== document.body) return;
    (focusables(root)[0] ?? root).focus({ preventScroll: true });
  });
  // focus inside whenever the content changes (open, or a dialog step change)
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (root.contains(document.activeElement) && document.activeElement !== root) return;
    const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(root)[0];
    (first ?? root).focus();
  }, [ref, refocusKey]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current;
      if (!root) return;
      if (e.key === "Escape") {
        e.preventDefault();
        escape.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables(root);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref]);
}
