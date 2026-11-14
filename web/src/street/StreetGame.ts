// Lazily loaded entry: creates the Phaser game for the street. Imported with `import()` only.
import * as Phaser from "phaser";
import { StreetScene, VIEW_H, type StreetData, type StreetHooks } from "./StreetScene";

export interface StreetHandle {
  update(data: StreetData): void;
  resize(cssWidth: number, cssHeight: number): void;
  destroy(): void;
  debug(): ReturnType<StreetScene["debugState"]> | null;
  goTo(id: string): void;
}

/** Integer zoom so pixels stay crisp; the view is at least VIEW_H logical px tall. */
export function sizeFor(cssWidth: number, cssHeight: number) {
  // Zoom fits the width (roughly 320–500 logical px of street on desktop, ~200 on a phone); the extra
  // height is filled by the scene (more sky + a foreground layer), never by page background.
  let zoom = Math.max(2, Math.min(4, Math.floor(cssWidth / 400)));
  if (cssHeight / zoom < VIEW_H) zoom = Math.max(1, Math.floor(cssHeight / VIEW_H)) || 1;
  return { zoom, width: Math.max(120, Math.ceil(cssWidth / zoom)), height: Math.max(VIEW_H, Math.ceil(cssHeight / zoom)) };
}

export function createStreetGame(parent: HTMLElement, data: StreetData, hooks: StreetHooks): Promise<StreetHandle> {
  return new Promise((resolve, reject) => {
    const { zoom, width, height } = sizeFor(parent.clientWidth || 360, parent.clientHeight || 300);
    const scene = new StreetScene();
    let game: Phaser.Game;
    try {
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent,
        width,
        height,
        zoom,
        pixelArt: true,
        backgroundColor: "#8fcde0",
        banner: false,
        audio: { noAudio: true },
        // windowEvents: false — Phaser must not treat clicks on HTML (buttons, dialogs) as street taps.
        input: { keyboard: false, gamepad: false, windowEvents: false },
        scale: { mode: Phaser.Scale.NONE },
        scene: [],
        callbacks: {
          postBoot: (g) => {
            try {
              g.scene.add("street", scene, true, { data, hooks });
            } catch (e) {
              reject(e);
            }
          },
        },
      });
    } catch (e) {
      reject(e);
      return;
    }
    const handle: StreetHandle = {
      update: (d) => scene.sync(d),
      resize(cssWidth, cssHeight) {
        const s = sizeFor(cssWidth, cssHeight);
        if (game.scale.zoom !== s.zoom) game.scale.setZoom(s.zoom);
        if (game.scale.width !== s.width || game.scale.height !== s.height) game.scale.resize(s.width, s.height);
      },
      destroy: () => game.destroy(true),
      debug: () => (scene.sys?.isActive() ? scene.debugState() : null),
      goTo: (id) => scene.goTo(id),
    };
    let tries = 0;
    const wait = () => {
      if (scene.sys?.isActive?.()) resolve(handle);
      else if (++tries > 200) reject(new Error("street scene did not start"));
      else setTimeout(wait, 25);
    };
    wait();
  });
}
