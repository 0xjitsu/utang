// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { focusIsOnUi, pointerForStreet, streetKey, uiBlocksStreet } from "./inputGuard";

let canvas: HTMLCanvasElement;
beforeEach(() => {
  document.body.innerHTML = "";
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
});
const add = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  document.body.appendChild(d);
  return d.firstElementChild as HTMLElement;
};

describe("street input guard", () => {
  it("pointer only counts when it went down on the canvas and no UI is open", () => {
    expect(pointerForStreet(canvas, canvas)).toBe(true);
    const btn = add("<button>Play the preview</button>");
    expect(pointerForStreet(btn, canvas)).toBe(false); // tap on an HTML button over the street
    add('<div class="rpg-backdrop"></div>');
    expect(uiBlocksStreet()).toBe(true);
    expect(pointerForStreet(canvas, canvas)).toBe(false); // a dialog is open
  });

  it("each overlay blocks the street", () => {
    for (const cls of ["drawer-backdrop", "picker-overlay", "reward-backdrop", "start-screen", "ride", "confirm-backdrop"]) {
      document.body.innerHTML = "";
      add(`<div class="${cls}"></div>`);
      expect(uiBlocksStreet()).toBe(true);
    }
  });

  it("Enter on a focused button is the button's, not the street's", () => {
    const btn = add("<button>Menu item</button>");
    expect(focusIsOnUi(btn, canvas)).toBe(true);
    expect(streetKey("Enter", btn, canvas)).toBeNull();
    expect(streetKey("e", btn, canvas)).toBeNull();
    expect(streetKey("Enter", document.body, canvas)).toBeNull(); // Enter only on the canvas
    expect(streetKey("Enter", canvas, canvas)).toBe("visit");
    expect(streetKey("e", document.body, canvas)).toBe("visit");
  });

  it("typing in a field never moves or visits", () => {
    const input = add("<input />");
    expect(streetKey("w", input, canvas)).toBeNull();
    expect(streetKey("e", input, canvas)).toBeNull();
    expect(streetKey("ArrowLeft", input, canvas)).toBeNull();
    expect(streetKey("ArrowLeft", document.body, canvas)).toBe("move");
  });

  it("nothing reaches the street while a dialog is open", () => {
    add('<div class="rpg-backdrop"></div>');
    expect(streetKey("e", document.body, canvas)).toBeNull();
    expect(streetKey("ArrowLeft", document.body, canvas)).toBeNull();
  });
});
