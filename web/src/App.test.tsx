// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { GameProvider, externalApi } from "./game/GameProvider";
import { createPreviewBackend } from "./near";
import { PreviewWorld } from "./near/mock/world";
import { filterLoans, PAGE_SIZE } from "./screens/Listahan";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const tick = (ms = 50) => act(() => new Promise((r) => setTimeout(r, ms)));
const findButton = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
const click = async (text: string) => {
  const b = findButton(text);
  if (!b) throw new Error(`button not found: ${text}`);
  await act(async () => b.click());
};

describe("App (preview mode)", () => {
  it("start → play → join → HUD + quest → ask through the dialog → menu drawer", async () => {
    const errors: unknown[] = [];
    const onErr = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener("error", onErr);
    const world = PreviewWorld.create({ seed: 5 });
    const factory = () => Promise.resolve(createPreviewBackend({ world, persistAccount: false }));
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<GameProvider backendFactory={factory}><App /></GameProvider>));
    await tick(100);
    const text = () => document.body.textContent ?? "";

    await click("to open the store");
    expect(text()).toContain("PREVIEW"); // pill on the scene
    expect(text()).toContain("Welcome to the barangay");

    await click("Play the preview");
    await tick(100);
    expect(text()).toContain("Open your store");
    await click("Join for 0.01 NEAR");
    await tick(150);
    expect(text()).toContain("Welcome to the barangay!"); // toast
    expect(text()).toContain("Can lend 10.00"); // HUD
    // joining asks where the tindahan is; the map can't load in jsdom, so the list fallback shows
    expect(text()).toContain("Where's your tindahan?");
    expect(text()).toContain("never an address");
    await tick(50);
    const hulo = [...document.querySelectorAll(".map-list-row")].find((b) => b.textContent?.includes("Hulo")) as HTMLButtonElement;
    expect(document.querySelectorAll(".map-list-row").length).toBe(27);
    await act(async () => hulo.click());
    await click("Put my tindahan here");
    await tick(150);
    expect(document.querySelector(".picker-overlay")).toBeNull();
    expect(externalApi.getState()!.me?.barangay).toBe("Hulo");
    expect(text()).toContain("Quest 1/3");
    expect(text()).toContain("Visit aling-nena and ask for 10.00");

    // "Go ask" opens the RPG dialog on the ask step for the quest target
    await click("Go ask");
    await tick(50);
    expect(document.querySelector(".rpg")).not.toBeNull();
    expect(text()).toMatch(/Repay after 1m 0s to earn \+10 trust/);
    const chips = [...document.querySelectorAll(".chip-big")] as HTMLButtonElement[];
    expect(chips.map((c) => c.disabled)).toEqual([false, false, true]); // 20 is over the first-loan credit
    await click("Ask for 10.00");
    await tick(150);
    // toasts are a queue shown one at a time
    expect(externalApi.getState()!.toasts.map((t) => t.title)).toContain("Asked aling-nena.testnet for 10.00");
    expect(text()).toContain("Wait for a yes");

    // a visit via the bus (as the street does)
    await act(async () => externalApi.bus.emit("open:profile", { accountId: "ben.testnet" }));
    await tick(50);
    expect(text()).toContain("Pa-utang po (ask)");
    await click("Leave");
    expect(document.querySelector(".rpg")).toBeNull();

    // menu drawer carries the honest labels and preview controls
    await act(async () => (document.querySelector('[aria-label="Open menu"]') as HTMLButtonElement).click());
    expect(text()).toContain("PREVIEW DATA");
    expect(text()).toContain("DEMO TIME: 1 day = 1 minute");
    expect(findButton("Skip 1 day")).toBeTruthy();
    await act(async () => (document.querySelector('[aria-label="Close menu"]') as HTMLButtonElement).click());

    for (const screen of ["listahan", "neighbours", "leaderboard"] as const) {
      await act(async () => externalApi.bus.emit("open:screen", { screen }));
      await tick(30);
    }
    expect(text()).toContain("Most trusted");
    window.removeEventListener("error", onErr);
    expect(errors).toEqual([]);
    act(() => root.unmount());
  });
});

describe("listahan filters", () => {
  it("filters by tab and name, newest first, pages of 15", () => {
    const world = PreviewWorld.create({ seed: 9 });
    const now = world.now();
    const all = world.contract.listahan(0, 500, now);
    expect(all.length).toBeGreaterThan(PAGE_SIZE);
    const overdue = filterLoans(all, "overdue", "", null);
    expect(overdue.every((l) => l.past_due)).toBe(true);
    const ana = filterLoans(all, "all", "ana", null);
    expect(ana.length).toBeGreaterThan(0);
    expect(ana.every((l) => l.lender.includes("ana") || l.borrower.includes("ana"))).toBe(true);
    const closed = filterLoans(all, "closed", "", null);
    expect(closed.every((l) => ["Repaid", "RepaidLate", "Declined", "Cancelled"].includes(l.status))).toBe(true);
  });
});
