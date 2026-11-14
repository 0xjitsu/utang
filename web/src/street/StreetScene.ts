// The barangay street: a side-view Phaser scene. Your sari-sari store is in the middle, every
// other player has a house along the street, and a villager per player wanders nearby.
// Data comes from the React game state (sync()), effects from the bus. Only loaded lazily.

import * as Phaser from "phaser";
import { bus } from "../game/bus";
import type { Loan, Profile, Rules } from "../near/types";
import { fmtUtang, shortName } from "../near/format";
import * as art from "./art";
import { pointerForStreet, streetKey, uiBlocksStreet } from "./inputGuard";

export interface StreetData {
  /** true on your own street (your store in the middle); false when visiting another barangay. */
  isHome?: boolean;
  /** The barangay this street is in (null before the player picks one). */
  barangay?: string | null;
  questArrow?: { kind: "house"; id: string } | { kind: "store" } | null;
  accountId: string | null;
  me: Profile | null;
  players: Profile[];
  myLoans: Loan[];
  rules: Rules | null;
  nowNs: bigint;
}

export interface StreetHooks {
  onVisit(accountId: string): void;
  onOpenStore(): void;
  /** Player used the jeepney stop. */
  onJeep?(): void;
}

export const VIEW_H = 150;
const GROUND = 106; // bottom of houses
const WALK_MIN = 110;
const WALK_MAX = 119;
const ROAD_Y = 121;
const SLOT = 72;
const MARGIN = 70;
const SPEED = 52; // logical px / s
const GUEST = "bisita.guest";

interface House {
  id: string;
  x: number; // left
  door: number; // door x (world)
  img: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  tag: Phaser.GameObjects.Image;
  sign?: Phaser.GameObjects.Image;
}

interface Villager {
  id: string;
  sprite: Phaser.GameObjects.Image;
  home: number;
  state: "home" | "visiting" | "returning";
  target: { x: number; y: number } | null;
  nextWander: number;
  slot: number;
  bubble?: Phaser.GameObjects.Image;
  bubbleText?: string;
  frameT: number;
  frame: 0 | 1;
}

const SKY: [number, number, number][] = [
  // [dayFrac, top, bottom]
  [0.0, 0x1d2340, 0x2e3560],
  [0.2, 0x3a3f6e, 0x6b5a86],
  [0.27, 0xf4a76b, 0xf7cf93],
  [0.35, 0x8fcde0, 0xcfeef2],
  [0.7, 0x8fcde0, 0xcfeef2],
  [0.78, 0xe98b6a, 0xf5c48a],
  [0.85, 0x4b3f74, 0x8a5a86],
  [0.92, 0x1d2340, 0x2e3560],
];

function isTouchDevice(): boolean {
  try {
    return !!window.matchMedia?.("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

function lerpColor(a: number, b: number, t: number) {
  const ar = a >> 16, ag = (a >> 8) & 255, ab = a & 255;
  const br = b >> 16, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

export class StreetScene extends Phaser.Scene {
  private data_!: StreetData;
  private hooks!: StreetHooks;
  private ready = false;
  private worldW = 400;
  private storeX = 0; // left of the store
  private storeImg?: Phaser.GameObjects.Image;
  private storeGlow?: Phaser.GameObjects.Image;
  private storeSign?: Phaser.GameObjects.Image;
  private storeKey = "";
  private houses = new Map<string, House>();
  private villagers = new Map<string, Villager>();
  private playerIdsKey = "";
  private player!: Phaser.GameObjects.Image;
  private playerName = "";
  private playerFrame: 0 | 1 = 0;
  private playerFrameT = 0;
  private target: { x: number; y: number } | null = null;
  private pendingVisit: string | null = null;
  private keys = new Set<string>();
  private engaged = false;
  private prompt?: Phaser.GameObjects.Image;
  private promptFor: string | null = null;
  private lastPointerTouch = false;
  private skyBands: Phaser.GameObjects.Rectangle[] = [];
  private stars: Phaser.GameObjects.Image[] = [];
  private sun!: Phaser.GameObjects.Rectangle;
  private moon!: Phaser.GameObjects.Rectangle;
  private night!: Phaser.GameObjects.Rectangle;
  private lampHalos: Phaser.GameObjects.Ellipse[] = [];
  private nightAmount = 0;
  private skyT = 0;
  private cat?: Phaser.GameObjects.Image;
  private skyline: Phaser.GameObjects.Image[] = [];
  private skylineGlow: Phaser.GameObjects.Image[] = [];
  private unsub: (() => void)[] = [];
  private stepT = 0;
  private viewH = VIEW_H;
  private arrowX: number | null = null;
  private edgeArrow?: Phaser.GameObjects.Image;
  /** Height of the foreground layer below the road (world px). */
  private below = 0;
  private fg: Phaser.GameObjects.GameObject[] = [];
  private clouds: Phaser.GameObjects.Image[] = [];
  private arrow?: Phaser.GameObjects.Image;
  private stopImg?: Phaser.GameObjects.Image;
  private streetKey = "";
  private arrowKey = "";

  constructor() {
    super("street");
  }

  init(cfg: { data: StreetData; hooks: StreetHooks }) {
    this.data_ = cfg.data;
    this.hooks = cfg.hooks;
  }

  // ------------------------------------------------------------------ textures

  private tex(key: string, make: () => HTMLCanvasElement): string {
    if (!this.textures.exists(key)) this.textures.addCanvas(key, make());
    return key;
  }

  private villagerTex(id: string, frame: 0 | 1) {
    return this.tex(`v:${id}:${frame}`, () => art.villager(id, frame));
  }

  // ------------------------------------------------------------------ lifecycle

  create() {
    const cam = this.cameras.main;
    this.viewH = Math.max(VIEW_H, Math.round(this.scale.height));
    this.below = Math.min(72, Math.round((this.viewH - VIEW_H) * 0.42));
    // Sky bands (fixed to camera)
    for (let i = 0; i < 14; i++) {
      const r = this.add.rectangle(0, 0, 4000, 10, 0x8fcde0).setOrigin(0, 0);
      r.setScrollFactor(0).setDepth(-100);
      this.skyBands.push(r);
    }
    for (let i = 0; i < 26; i++) {
      const s = this.add.image((i * 97) % 900, 6 + ((i * 37) % 50), this.tex("star", art.star)).setOrigin(0, 0);
      s.setScrollFactor(0.05).setDepth(-99);
      this.stars.push(s);
    }
    this.sun = this.add.rectangle(0, 0, 10, 10, 0xffd866).setScrollFactor(0).setDepth(-98);
    this.moon = this.add.rectangle(0, 0, 8, 8, 0xf4f0dc).setScrollFactor(0).setDepth(-98);

    for (let i = 0; i < 4; i++) {
      const c = this.add.image(i * 140 + 20, 10 + (i % 2) * 14, this.tex(`cloud${i % 2}`, () => art.cloud(i % 2 ? 22 : 30)));
      c.setScrollFactor(0.3).setDepth(-85).setAlpha(0.9);
      this.clouds.push(c);
      this.tweens.add({ targets: c, x: c.x + 120, duration: 40000 + i * 5000, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    }
    // Ground
    this.add.rectangle(0, GROUND, 6000, WALK_MAX - GROUND + 3, 0xcdbb9b).setOrigin(0, 0).setDepth(-20);
    this.add.rectangle(0, ROAD_Y, 6000, VIEW_H - ROAD_Y, 0x5d5853).setOrigin(0, 0).setDepth(-20);
    for (let x = 0; x < 6000; x += 26) this.add.rectangle(x + 6, ROAD_Y + 14, 12, 2, 0xe8c35a).setOrigin(0, 0).setDepth(-19);
    for (let x = 4; x < 6000; x += 16) this.add.rectangle(x, GROUND, 1, WALK_MAX - GROUND + 3, 0xb7a483).setOrigin(0, 0).setDepth(-19);

    this.night = this.add.rectangle(0, 0, 4000, 2000, 0x141838, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(500);

    // Player
    this.playerName = this.data_.accountId ?? GUEST;
    this.player = this.add.image(0, WALK_MAX - 2, this.villagerTex(this.playerName, 0)).setOrigin(0.5, 1);

    this.layout();
    this.player.x = this.isHome() ? this.storeX + art.STORE_W / 2 - 10 : this.stopDoor() + 14;
    cam.startFollow(this.player, true, 0.15, 0.15);
    cam.setRoundPixels(true);

    this.relayoutView();
    this.scale.on("resize", () => {
      this.relayoutView();
      this.layout();
    });
    this.spawnJeepney();
    this.setupInput();
    this.subscribeBus();
    this.ready = true;
    this.syncDynamic();
    this.updateSky(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());
  }

  private teardown() {
    this.unsub.forEach((f) => f());
    this.unsub = [];
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("pointerdown", this.onWindowPointer, true);
  }

  /** Called by React whenever game state changes. Cheap when little changed. */
  sync(data: StreetData) {
    this.data_ = data;
    if (!this.ready) return;
    const ids = this.neighbours()
      .map((p) => p.account_id)
      .join(",");
    const name = data.accountId ?? GUEST;
    const street = `${this.isHome()}|${data.barangay ?? ""}`;
    if (ids !== this.playerIdsKey || name !== this.playerName || street !== this.streetKey) {
      const moved = street !== this.streetKey;
      this.playerName = name;
      this.player.setTexture(this.villagerTex(name, 0));
      this.layout();
      if (moved) {
        // arriving by jeepney: step off at the stop (or in front of the store at home)
        this.target = null;
        this.pendingVisit = null;
        this.player.x = this.isHome() ? this.storeX + art.STORE_W / 2 - 10 : this.stopDoor() + 14;
        this.player.y = WALK_MAX - 2;
        this.cameras.main.centerOn(this.player.x, this.cameras.main.midPoint.y);
      }
    }
    this.syncDynamic();
  }

  // ------------------------------------------------------------------ layout

  private isHome(): boolean {
    return this.data_.isHome !== false;
  }

  private stopDoor() {
    return 30;
  }

  private neighbours(): Profile[] {
    return this.data_.players.filter((p) => p.account_id !== this.data_.accountId);
  }

  private layout() {
    for (const h of this.houses.values()) {
      h.img.destroy();
      h.glow.destroy();
      h.tag.destroy();
      h.sign?.destroy();
    }
    this.houses.clear();
    const list = this.neighbours();
    this.playerIdsKey = list.map((p) => p.account_id).join(",");
    this.streetKey = `${this.isHome()}|${this.data_.barangay ?? ""}`;
    // Jeepney stop at the left edge of every street
    this.stopImg?.destroy();
    this.stopImg = this.add.image(this.stopDoor(), GROUND + 2, this.tex("jeepstop", art.jeepStop)).setOrigin(0.5, 1).setDepth(2);
    this.stopImg.setInteractive({ useHandCursor: true });
    this.stopImg.on("pointerdown", (p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        if (!this.acceptPointer(p)) return;
      ev.stopPropagation();
      this.walkToAndVisit("jeep");
    });
    const left = list.filter((_, i) => i % 2 === 1).reverse();
    const right = list.filter((_, i) => i % 2 === 0);
    this.storeX = MARGIN + left.length * SLOT + 8;
    this.worldW = this.storeX + art.STORE_W + 8 + right.length * SLOT + MARGIN;
    const place = (p: Profile, x: number) => {
      const id = p.account_id;
      const img = this.add.image(x, GROUND, this.tex(`house:${id}`, () => art.house(id))).setOrigin(0, 1).setDepth(0);
      const glow = this.add.image(x, GROUND, this.tex(`hglow:${id}`, () => art.houseGlow(id))).setOrigin(0, 1).setDepth(510);
      glow.setAlpha(0);
      const short = shortName(id).slice(0, 13);
      const tag = this.add
        .image(x + art.HOUSE_W / 2, GROUND - art.HOUSE_H - 3, this.tex(`tag:${short}`, () => art.label(short, "#2b1d16", "#fff8e7")))
        .setDepth(600);
      img.setInteractive({ useHandCursor: true });
      img.on("pointerdown", (p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        if (!this.acceptPointer(p)) return;
        ev.stopPropagation();
        this.walkToAndVisit(id);
      });
      this.houses.set(id, { id, x, door: x + art.HOUSE_W / 2, img, glow, tag });
    };
    left.forEach((p, i) => place(p, MARGIN + i * SLOT));
    right.forEach((p, i) => place(p, this.storeX + art.STORE_W + 16 + i * SLOT));

    // Props: palms and lamps between houses
    this.children.list
      .filter((o) => o.getData && o.getData("prop"))
      .forEach((o) => o.destroy());
    this.lampHalos = [];
    const palmTex = this.tex("palm", art.palm);
    const lampTex = this.tex("lamp", art.lamp);
    for (let x = MARGIN - 50; x < this.worldW; x += SLOT * 3) {
      if (Math.abs(x - this.stopDoor()) < 28) x += 30; // keep the jeepney stop clear
      this.add.image(x, GROUND, palmTex).setOrigin(0.5, 1).setDepth(-5).setData("prop", 1);
    }
    for (let x = MARGIN - 8 + SLOT * 1.5; x < this.worldW - 20; x += SLOT * 2) {
      if (x > this.storeX - 12 && x < this.storeX + art.STORE_W + 12) continue;
      this.add.image(x, GROUND + 2, lampTex).setOrigin(0.5, 1).setDepth(-4).setData("prop", 1);
      const halo = this.add.ellipse(x + 3, GROUND - 40, 26, 18, 0xffe9a0, 0).setDepth(520).setData("prop", 1);
      this.lampHalos.push(halo);
    }

    // Store
    this.storeKey = "";
    this.storeImg?.destroy();
    this.storeGlow?.destroy();
    this.storeSign?.destroy();
    this.storeImg = undefined;
    this.renderStore();
    this.storeGlow = this.add
      .image(this.storeX, GROUND, this.tex("storeglow", art.storeGlow))
      .setOrigin(0, 1)
      .setDepth(510)
      .setAlpha(0);

    // Cat by the store
    if (!this.cat) {
      this.cat = this.add.image(0, WALK_MIN - 1, this.tex("cat0", () => art.cat(0))).setOrigin(0, 1);
      this.cat.setDepth(10 + WALK_MIN);
      let f: 0 | 1 = 0;
      this.time.addEvent({
        delay: 700,
        loop: true,
        callback: () => {
          f = f ? 0 : 1;
          this.cat?.setTexture(this.tex(`cat${f}`, () => art.cat(f)));
        },
      });
    }
    this.cat.x = this.storeX + art.STORE_W + 4;

    // Villagers: keep existing ones, add/remove as needed
    const want = new Set(list.map((p) => p.account_id));
    for (const [id, v] of this.villagers) {
      if (!want.has(id)) {
        v.sprite.destroy();
        v.bubble?.destroy();
        this.villagers.delete(id);
      }
    }
    for (const p of list) {
      const h = this.houses.get(p.account_id)!;
      let v = this.villagers.get(p.account_id);
      if (!v) {
        const sprite = this.add.image(h.door + 10, WALK_MIN + 2, this.villagerTex(p.account_id, 0)).setOrigin(0.5, 1);
        sprite.setInteractive({ useHandCursor: true });
        const id = p.account_id;
        sprite.on("pointerdown", (p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        if (!this.acceptPointer(p)) return;
          ev.stopPropagation();
          this.hooks.onVisit(id);
        });
        v = { id, sprite, home: h.door, state: "home", target: null, nextWander: 0, slot: -1, frameT: 0, frame: 0 };
        this.villagers.set(id, v);
      }
      v.home = h.door;
    }
    // The world is VIEW_H tall; any extra view height becomes sky above it.
    this.cameras.main.setBounds(0, VIEW_H + this.below - this.viewH, this.worldW, this.viewH);
    this.buildForeground();
    this.arrowKey = "#relayout";
    this.buildSkyline();
  }

  /** Distant Mandaluyong/Ortigas skyline with the MRT-3 viaduct, in slow parallax. Windows light up at night. */
  private buildSkyline() {
    this.skyline.forEach((o) => o.destroy());
    this.skylineGlow.forEach((o) => o.destroy());
    this.skyline = [];
    this.skylineGlow = [];
    const tex = this.tex("skyline", art.skyline);
    const glow = this.tex("skylineGlow", art.skylineGlow);
    const tileW = art.SKYLINE_W;
    const need = this.scale.width + this.worldW * 0.15 + tileW;
    for (let x = -tileW / 2; x < need; x += tileW) {
      this.skyline.push(this.add.image(x, GROUND + 1, tex).setOrigin(0, 1).setScrollFactor(0.15, 1).setDepth(-90));
      this.skylineGlow.push(this.add.image(x, GROUND + 1, glow).setOrigin(0, 1).setScrollFactor(0.15, 1).setDepth(-89).setAlpha(this.nightAmount));
    }
  }

  /** Sky bands, stars and clouds follow the view height (taller views get more sky for the HUD). */
  private relayoutView() {
    this.viewH = Math.max(VIEW_H, Math.round(this.scale.height));
    // Extra view height: some becomes a foreground layer below the road, the rest more sky.
    this.below = Math.min(72, Math.round((this.viewH - VIEW_H) * 0.42));
    this.buildForeground();
    this.cameras.main.setBounds(0, VIEW_H + this.below - this.viewH, this.worldW, this.viewH);
    const extra = this.skyExtra();
    const skyH = GROUND + extra;
    const n = this.skyBands.length;
    this.skyBands.forEach((r, i) => r.setPosition(0, Math.floor((i * skyH) / n)).setSize(4000, Math.ceil(skyH / n) + 1));
    this.stars.forEach((s, i) => s.setPosition((i * 97) % 900, 4 + ((i * 37) % Math.max(40, extra + 40))));
    this.clouds.forEach((c, i) => (c.y = 10 + (i % 2) * 14 - extra * 0.75));
    this.updateSky(true);
  }

  private skyExtra() {
    return Math.max(0, this.viewH - VIEW_H - this.below);
  }

  /** Below the road: curb with drain grates, the far sidewalk, a grass strip with benches and plants. */
  private buildForeground() {
    this.fg.forEach((o) => o.destroy());
    this.fg = [];
    const b = this.below;
    if (b <= 0) return;
    const W = Math.max(this.worldW, 2000);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.fg.push(o);
      return o;
    };
    const top = VIEW_H;
    add(this.add.rectangle(0, top, W, 3, 0x9a8f82).setOrigin(0, 0).setDepth(-18));
    add(this.add.rectangle(0, top + 3, W, Math.min(12, b - 3), 0xcdbb9b).setOrigin(0, 0).setDepth(-18));
    for (let x = 10; x < W; x += 16) add(this.add.rectangle(x, top + 3, 1, Math.min(12, b - 3), 0xb7a483).setOrigin(0, 0).setDepth(-17));
    for (let x = 40; x < W; x += 96) {
      add(this.add.rectangle(x, top, 10, 3, 0x4a4a52).setOrigin(0, 0).setDepth(-17));
      for (let i = 1; i < 10; i += 2) add(this.add.rectangle(x + i, top, 1, 3, 0x2b2b30).setOrigin(0, 0).setDepth(-16));
    }
    if (b > 15) {
      const gTop = top + 15;
      add(this.add.rectangle(0, gTop, W, b - 15, 0x7fb069).setOrigin(0, 0).setDepth(-18));
      add(this.add.rectangle(0, gTop, W, 2, 0x5e8f4a).setOrigin(0, 0).setDepth(-17));
      for (let x = 7; x < W; x += 23) {
        const y = gTop + 4 + ((x * 7) % Math.max(4, b - 22));
        const flower = [0xf2c14e, 0xe86a8a, 0xffffff, 0xd0402f][(x / 23) % 4 | 0];
        add(this.add.rectangle(x, y, 1, 2, 0x3f8f4d).setOrigin(0, 0).setDepth(-16));
        add(this.add.rectangle(x, y - 1, 1, 1, flower).setOrigin(0, 0).setDepth(-16));
      }
      const benchTex = this.tex("bench", art.bench);
      const plantTex = this.tex("pot", art.pottedPlant);
      for (let x = 70; x < W - 40; x += 150) {
        add(this.add.image(x, gTop + 13, benchTex).setOrigin(0.5, 1).setDepth(-15));
        add(this.add.image(x + 60, gTop + 12, plantTex).setOrigin(0.5, 1).setDepth(-15));
      }
    }
  }

  private renderStore() {
    const closed = !this.data_.me;
    const home = this.isHome();
    const b = this.data_.barangay ?? "";
    const key = home ? `store:${closed ? "closed" : "open"}:${this.data_.accountId ?? ""}` : `hall:${b}`;
    if (key === this.storeKey && this.storeImg) return;
    this.storeKey = key;
    const tex = home ? this.tex(key, () => art.store({ closed, owner: this.data_.accountId })) : this.tex(key, () => art.hall(b));
    if (!this.storeImg) {
      this.storeImg = this.add.image(this.storeX, GROUND, tex).setOrigin(0, 1).setDepth(1);
      this.storeImg.setInteractive({ useHandCursor: true });
      this.storeImg.on("pointerdown", (p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        if (!this.acceptPointer(p)) return;
        ev.stopPropagation();
        if (this.isHome()) this.walkToAndVisit("store");
      });
    } else this.storeImg.setTexture(tex).setPosition(this.storeX, GROUND);
  }

  /** Overdue signs, visitors, store open/closed, quest arrow. */
  private syncDynamic() {
    this.renderStore();
    this.syncArrow();
    const signTex = this.tex("bayad", art.bayadMunaSign);
    for (const p of this.data_.players) {
      const h = this.houses.get(p.account_id);
      if (!h) continue;
      if (p.has_overdue && !h.sign) {
        h.sign = this.add.image(h.x + 6, GROUND + 4, signTex).setOrigin(0.5, 1).setDepth(10 + GROUND);
        this.tweens.add({ targets: h.sign, angle: { from: -4, to: 4 }, duration: 1200, yoyo: true, repeat: -1, ease: "Sine.inOut" });
      } else if (!p.has_overdue && h.sign) {
        h.sign.destroy();
        h.sign = undefined;
      }
    }
    const meOverdue = !!this.data_.me?.has_overdue && this.isHome();
    if (meOverdue && !this.storeSign) {
      this.storeSign = this.add.image(this.storeX + art.STORE_W - 2, GROUND + 4, signTex).setOrigin(0.5, 1).setDepth(10 + GROUND);
      this.tweens.add({ targets: this.storeSign, angle: { from: -4, to: 4 }, duration: 1200, yoyo: true, repeat: -1 });
    } else if (!meOverdue && this.storeSign) {
      this.storeSign.destroy();
      this.storeSign = undefined;
    }

    // Visitors: neighbours with a pending request to me walk to my window.
    const me = this.data_.accountId;
    const requests = new Map<string, Loan>();
    if (this.isHome()) for (const l of this.data_.myLoans) {
      if (l.lender === me && l.status === "Requested" && !requests.has(l.borrower)) requests.set(l.borrower, l);
    }
    const used = new Set([...this.villagers.values()].filter((v) => v.state === "visiting").map((v) => v.slot));
    for (const v of this.villagers.values()) {
      const req = requests.get(v.id);
      if (req) {
        const text = `${fmtUtang(req.amount).replace(".00", "")}?`;
        if (v.state !== "visiting") {
          let slot = 0;
          while (used.has(slot)) slot++;
          used.add(slot);
          v.slot = slot;
          v.state = "visiting";
          v.target = { x: this.storeX + 18 + slot * 16, y: WALK_MIN + 1 + (slot % 2) * 3 };
        }
        if (v.bubbleText !== text) {
          v.bubble?.destroy();
          v.bubble = this.add.image(0, 0, this.tex(`bubble:${text}`, () => art.bubble(text))).setOrigin(0.5, 1).setDepth(700);
          v.bubble.setVisible(false);
          v.bubbleText = text;
        }
      } else if (v.state === "visiting") {
        v.state = "returning";
        v.slot = -1;
        v.target = { x: v.home + 10, y: WALK_MIN + 2 };
        v.bubble?.destroy();
        v.bubble = undefined;
        v.bubbleText = undefined;
      }
    }
  }

  /** When the quest target is off-screen, an arrow at the screen edge points the way. */
  private updateEdgeArrow() {
    const cam = this.cameras.main;
    let side: "left" | "right" | null = null;
    if (this.arrow && this.arrowX !== null) {
      if (this.arrowX < cam.scrollX + 6) side = "left";
      else if (this.arrowX > cam.scrollX + cam.width - 6) side = "right";
    }
    if (!side) {
      this.edgeArrow?.setVisible(false);
      return;
    }
    if (!this.edgeArrow) {
      this.edgeArrow = this.add.image(0, 0, this.tex("qarrow", art.questArrow)).setScrollFactor(0).setDepth(860);
    }
    const y = GROUND + this.skyExtra() - 40;
    const bob = Math.round(Math.sin(this.time.now / 200) * 2);
    this.edgeArrow
      .setVisible(true)
      .setAngle(side === "left" ? 90 : -90)
      .setPosition(side === "left" ? 9 + bob : cam.width - 9 - bob, y);
  }

  private syncArrow() {
    const a = this.data_.questArrow ?? null;
    const key = a ? (a.kind === "store" ? "store" : a.id) : "";
    if (key === this.arrowKey && (this.arrow || !key)) return;
    this.arrowKey = key;
    this.arrow?.destroy();
    this.arrow = undefined;
    this.arrowX = null;
    if (!a) return;
    const x = a.kind === "store" ? this.storeX + 30 : this.houses.get(a.id)?.door;
    if (x === undefined) return;
    const y = a.kind === "store" ? GROUND - art.STORE_H - 4 : GROUND - art.HOUSE_H - 16;
    this.arrow = this.add.image(x, y, this.tex("qarrow", art.questArrow)).setOrigin(0.5, 1).setDepth(850);
    this.arrowX = x;
    this.tweens.add({ targets: this.arrow, y: y - 4, duration: 420, yoyo: true, repeat: -1, ease: "Sine.inOut" });
  }

  // ------------------------------------------------------------------ input

  private setupInput() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("pointerdown", this.onWindowPointer, true);
    const canvas = this.game.canvas;
    if (canvas) {
      // Keyboard players can focus the street itself (Tab), then Enter/E visits.
      canvas.tabIndex = 0;
      canvas.setAttribute("role", "application");
      canvas.setAttribute("aria-label", "The street. Arrow keys or WASD to walk, E or Enter to visit.");
    }
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!this.acceptPointer(p)) return;
      this.engaged = true;
      const x = Phaser.Math.Clamp(p.worldX, 8, this.worldW - 8);
      const y = Phaser.Math.Clamp(p.worldY, WALK_MIN, WALK_MAX);
      if (this.promptFor && this.prompt?.getBounds().contains(p.worldX, p.worldY)) {
        this.visit(this.promptFor);
        return;
      }
      this.target = { x, y };
      this.pendingVisit = null;
    });
  }

  /** Taps on HTML over the street, or while any dialog is open, never reach the street. */
  private acceptPointer(p: Phaser.Input.Pointer): boolean {
    if (!pointerForStreet(p.downElement, this.game.canvas)) return false;
    this.lastPointerTouch = p.wasTouch;
    return true;
  }

  private onWindowPointer = (e: PointerEvent) => {
    const canvas = this.game.canvas;
    if (canvas && e.target !== canvas) this.engaged = false;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.ready) return;
    const action = streetKey(e.key, e.target, this.game.canvas);
    if (action === "move") {
      this.keys.add(e.key.toLowerCase());
      this.target = null;
      this.pendingVisit = null;
      this.lastPointerTouch = false;
      if ((this.engaged || e.target === this.game.canvas) && e.key.startsWith("Arrow")) e.preventDefault();
    } else if (action === "visit" && this.promptFor) {
      e.preventDefault();
      this.visit(this.promptFor);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private walkToAndVisit(id: string) {
    const door = id === "store" ? this.storeDoor() : id === "jeep" ? this.stopDoor() : this.houses.get(id)?.door;
    if (door === undefined) return;
    if (Math.abs(this.player.x - door) < 18) {
      this.visit(id);
      return;
    }
    this.target = { x: door, y: WALK_MIN + 3 };
    this.pendingVisit = id;
  }

  private visit(id: string) {
    if (uiBlocksStreet()) return;
    // the street is the opener: focus returns here when the dialog closes
    this.game.canvas?.focus({ preventScroll: true });
    this.target = null;
    this.pendingVisit = null;
    this.keys.clear();
    if (id === "store") this.hooks.onOpenStore();
    else if (id === "jeep") this.hooks.onJeep?.();
    else this.hooks.onVisit(id);
  }

  private storeDoor() {
    return this.storeX + art.STORE_W / 2;
  }

  // ------------------------------------------------------------------ update

  update(_time: number, deltaMs: number) {
    if (!this.ready) return;
    if (uiBlocksStreet()) {
      // a dialog/drawer/picker is open: the street pauses its controls
      this.keys.clear();
      this.target = null;
      this.pendingVisit = null;
    }
    const dt = Math.min(deltaMs, 50) / 1000;
    let dx = 0;
    let dy = 0;
    const k = this.keys;
    if (k.has("arrowleft") || k.has("a")) dx -= 1;
    if (k.has("arrowright") || k.has("d")) dx += 1;
    if (k.has("arrowup") || k.has("w")) dy -= 1;
    if (k.has("arrowdown") || k.has("s")) dy += 1;
    if (!dx && !dy && this.target) {
      const tx = this.target.x - this.player.x;
      const ty = this.target.y - this.player.y;
      const d = Math.hypot(tx, ty);
      if (d < 1.5) {
        this.target = null;
        if (this.pendingVisit) this.visit(this.pendingVisit);
      } else {
        dx = tx / d;
        dy = ty / d;
      }
    }
    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      const len = Math.hypot(dx, dy) || 1;
      this.player.x = Phaser.Math.Clamp(this.player.x + (dx / len) * SPEED * dt, 8, this.worldW - 8);
      this.player.y = Phaser.Math.Clamp(this.player.y + (dy / len) * SPEED * 0.6 * dt, WALK_MIN, WALK_MAX);
      if (dx) this.player.setFlipX(dx < 0);
      this.playerFrameT += dt;
      if (this.playerFrameT > 0.16) {
        this.playerFrameT = 0;
        this.playerFrame = this.playerFrame ? 0 : 1;
        this.player.setTexture(this.villagerTex(this.playerName, this.playerFrame));
        this.stepT++;
        if (this.stepT % 2 === 0) bus.emit("sfx", { name: "step" });
      }
    } else if (this.playerFrame) {
      this.playerFrame = 0;
      this.player.setTexture(this.villagerTex(this.playerName, 0));
    }
    this.player.setDepth(10 + this.player.y);

    this.updateVillagers(dt);
    this.updatePrompt();
    this.updateEdgeArrow();
    this.skyT += dt;
    if (this.skyT > 0.5) {
      this.skyT = 0;
      this.updateSky(false);
    }
  }

  private updateVillagers(dt: number) {
    const now = this.time.now;
    for (const v of this.villagers.values()) {
      if (v.state === "home" && !v.target && now > v.nextWander) {
        v.nextWander = now + 3000 + Math.random() * 6000;
        v.target = { x: v.home + (Math.random() * 40 - 20), y: WALK_MIN + Math.random() * (WALK_MAX - WALK_MIN - 4) };
      }
      let moving = false;
      if (v.target) {
        const tx = v.target.x - v.sprite.x;
        const ty = v.target.y - v.sprite.y;
        const d = Math.hypot(tx, ty);
        const speed = v.state === "home" ? 14 : 38;
        if (d < 1.2) {
          v.target = null;
          if (v.state === "returning") v.state = "home";
        } else {
          v.sprite.x += (tx / d) * speed * dt;
          v.sprite.y += (ty / d) * speed * 0.6 * dt;
          if (Math.abs(tx) > 0.5) v.sprite.setFlipX(tx < 0);
          moving = true;
        }
      }
      if (moving) {
        v.frameT += dt;
        if (v.frameT > 0.2) {
          v.frameT = 0;
          v.frame = v.frame ? 0 : 1;
          v.sprite.setTexture(this.villagerTex(v.id, v.frame));
        }
      } else if (v.frame) {
        v.frame = 0;
        v.sprite.setTexture(this.villagerTex(v.id, 0));
      }
      v.sprite.setDepth(10 + v.sprite.y);
      if (v.bubble) {
        const arrived = v.state === "visiting" && !v.target;
        v.bubble.setVisible(arrived);
        v.bubble.setPosition(Math.round(v.sprite.x), Math.round(v.sprite.y - 25 + (arrived ? Math.round(Math.sin(now / 300)) : 0)));
      }
    }
  }

  private updatePrompt() {
    let best: string | null = null;
    let bestD = 16;
    const near = (id: string, door: number) => {
      const d = Math.abs(this.player.x - door);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    };
    if (this.isHome()) near("store", this.storeDoor());
    near("jeep", this.stopDoor());
    for (const h of this.houses.values()) near(h.id, h.door);
    if (best !== this.promptFor) {
      this.prompt?.destroy();
      this.prompt = undefined;
      this.promptFor = best;
      if (best) {
        const verb = best === "store" ? "OPEN STORE" : best === "jeep" ? "RIDE JEEP" : "VISIT";
        const key = this.lastPointerTouch || isTouchDevice() ? "TAP" : "E";
        const text = `${key}: ${verb}`;
        this.prompt = this.add.image(0, 0, this.tex(`prompt:${text}`, () => art.label(text, "#2b1d16", "#f2c14e"))).setDepth(800);
        this.prompt.setInteractive({ useHandCursor: true });
      }
    }
    if (this.prompt) {
      const x =
        best === "store" ? this.storeDoor() : best === "jeep" ? this.stopDoor() : this.houses.get(this.promptFor!)?.door ?? this.player.x;
      const y = best === "store" ? GROUND - art.STORE_H - 6 : best === "jeep" ? GROUND - 52 : GROUND - art.HOUSE_H - 14;
      const half = this.prompt.width / 2 + 2;
      const px = Phaser.Math.Clamp(x, half, this.worldW - half);
      this.prompt.setPosition(Math.round(px), Math.round(y + Math.sin(this.time.now / 250)));
    }
  }

  // ------------------------------------------------------------------ sky

  private dayFrac(): number {
    const r = this.data_.rules;
    if (r?.demo_time) {
      const d = BigInt(r.day_ns);
      return Number(this.data_.nowNs % d) / Number(d);
    }
    const t = new Date();
    return (t.getHours() * 60 + t.getMinutes() + t.getSeconds() / 60) / 1440;
  }

  private updateSky(_force: boolean) {
    const f = this.dayFrac();
    let i = 0;
    for (let k = 0; k < SKY.length; k++) if (f >= SKY[k][0]) i = k;
    const a = SKY[i];
    const b = SKY[(i + 1) % SKY.length];
    const span = ((b[0] - a[0] + 1) % 1) || 1;
    const t = Math.min(1, ((f - a[0] + 1) % 1) / span);
    // Demo time (1 day = 1 minute): a gentle dusk/dawn tint instead of a full night every minute.
    const soft = this.data_.rules?.demo_time ? 0.8 : 0;
    const top = lerpColor(lerpColor(a[1], b[1], t), 0x8fcde0, soft);
    const bottom = lerpColor(lerpColor(a[2], b[2], t), 0xcfeef2, soft);
    const n = this.skyBands.length;
    this.skyBands.forEach((r, k) => r.setFillStyle(lerpColor(top, bottom, k / (n - 1))));
    const night = f < 0.23 || f > 0.86 ? 1 : f < 0.3 ? (0.3 - f) / 0.07 : f > 0.78 ? (f - 0.78) / 0.08 : 0;
    // demo time: only a gentle dusk tint, never near-night
    this.nightAmount = Math.max(0, Math.min(1, night)) * (soft ? 0.18 : 1);
    const w = this.scale.width;
    const dayT = Math.max(0, Math.min(1, (f - 0.25) / 0.6));
    const extra = this.skyExtra();
    this.sun.setPosition(10 + dayT * (w - 20), extra + 34 - Math.sin(dayT * Math.PI) * (24 + extra * 0.6)).setVisible(this.nightAmount < 0.8);
    const nightT = ((f + 0.15) % 1) / 0.4;
    this.moon.setPosition(10 + Math.min(1, nightT) * (w - 20), 14 + extra * 0.4).setVisible(this.nightAmount > 0.3);
    this.night.setFillStyle(0x141838, this.nightAmount * 0.45);
    for (const s of this.stars) s.setAlpha(this.nightAmount * (0.5 + Math.random() * 0.5));
    for (const h of this.houses.values()) h.glow.setAlpha(this.nightAmount * 0.75);
    this.storeGlow?.setAlpha(this.data_.me && this.isHome() ? this.nightAmount * 0.45 : 0);
    for (const h of this.lampHalos) h.setFillStyle(0xffe9a0, this.nightAmount * 0.35);
    for (const g of this.skylineGlow) g.setAlpha(Math.min(1, this.nightAmount * 1.6));

  }

  // ------------------------------------------------------------------ ambient

  private spawnJeepney() {
    const tex = this.tex("jeep", art.jeepney);
    const go = (ltr: boolean) => {
      const jeep = this.add.image(ltr ? -60 : this.worldW + 60, ROAD_Y + 17, tex).setOrigin(0.5, 1).setDepth(5 + ROAD_Y);
      jeep.setFlipX(!ltr);
      const dist = this.worldW + 120;
      this.tweens.add({
        targets: jeep,
        x: ltr ? this.worldW + 60 : -60,
        duration: (dist / 70) * 1000,
        onComplete: () => {
          jeep.destroy();
          this.time.delayedCall(6000 + Math.random() * 9000, () => go(!ltr));
        },
      });
      this.tweens.add({ targets: jeep, y: jeep.y - 1, duration: 180, yoyo: true, repeat: -1 });
    };
    this.time.delayedCall(1500, () => go(true));
  }

  // ------------------------------------------------------------------ effects (driven by the bus)

  private subscribeBus() {
    const counter = () => ({ x: this.storeX + 40, y: GROUND - 12 });
    this.unsub.push(
      bus.on("loan:repaid", ({ counted, loan }) => {
        const c = counter();
        if (counted) {
          this.coinBurst(c.x, c.y, 10);
          this.sparkles(c.x, c.y - 10, 8);
          this.floatText(this.player.x, this.player.y - 28, loan.borrower === this.data_.accountId ? "+10 TRUST" : "+5 TRUST", "#2b6a37");
        } else {
          this.floatText(this.player.x, this.player.y - 28, "PAID", "#5e4636");
        }
      }),
      bus.on("loan:approved", ({ loan }) => {
        const c = counter();
        const v = this.villagers.get(loan.borrower);
        this.coinBurst(c.x, c.y, 8, v ? { x: v.sprite.x, y: v.sprite.y - 12 } : undefined);
      }),
      bus.on("coins:received", () => {
        this.coinBurst(this.player.x, this.player.y - 22, 4);
      }),
      bus.on("level:up", ({ level }) => {
        this.confetti(this.player.x, this.player.y - 20);
        this.floatText(this.player.x, this.player.y - 44, `LEVEL ${level}!`, "#9e2a1f", 700);
      }),
      bus.on("badge:earned", () => {
        this.confetti(this.player.x, this.player.y - 20);
        this.floatText(this.player.x, this.player.y - 46, "NEW BADGE!", "#253f78", 900);
      }),
      bus.on("loan:overdue", ({ loan }) => {
        const h = this.houses.get(loan.borrower);
        const x = h ? h.door : this.storeX + art.STORE_W - 2;
        this.floatText(x, GROUND - 30, "UH-OH", "#9e2a1f");
      }),
      bus.on("visitor:arrived", ({ loan }) => {
        const v = this.villagers.get(loan.borrower);
        if (v) this.floatText(v.sprite.x, v.sprite.y - 30, "!", "#9e2a1f");
      }),
    );
  }

  private coinBurst(x: number, y: number, n: number, to?: { x: number; y: number }) {
    const tex = this.tex("coin", art.coin);
    for (let i = 0; i < n; i++) {
      const c = this.add.image(x, y, tex).setDepth(900);
      const tx = to ? to.x + (Math.random() * 10 - 5) : x + (Math.random() * 60 - 30);
      const peak = y - 16 - Math.random() * 22;
      this.tweens.add({
        targets: c,
        x: tx,
        duration: 650 + Math.random() * 200,
        delay: i * 40,
      });
      this.tweens.add({
        targets: c,
        y: peak,
        duration: 280,
        delay: i * 40,
        ease: "Quad.out",
        onComplete: () =>
          this.tweens.add({
            targets: c,
            y: to ? to.y : y + 14,
            alpha: 0,
            duration: 420,
            ease: "Quad.in",
            onComplete: () => c.destroy(),
          }),
      });
    }
  }

  private sparkles(x: number, y: number, n: number) {
    const tex = this.tex("sparkle", art.sparkle);
    for (let i = 0; i < n; i++) {
      const s = this.add.image(x + Math.random() * 50 - 25, y + Math.random() * 24 - 12, tex).setDepth(900).setScale(0.2);
      this.tweens.add({ targets: s, scale: 1, alpha: 0, angle: 90, duration: 600, delay: i * 70, onComplete: () => s.destroy() });
    }
  }

  private confetti(x: number, y: number) {
    const colors = ["#d0402f", "#f2c14e", "#0a8a9e", "#7b4fa8", "#3f8f4d", "#e86a8a"];
    for (let i = 0; i < 36; i++) {
      const col = colors[i % colors.length];
      const p = this.add.image(x, y, this.tex(`conf:${col}`, () => art.confetti(col))).setDepth(900);
      const ang = Math.random() * Math.PI * 2;
      const r = 20 + Math.random() * 30;
      this.tweens.add({
        targets: p,
        x: x + Math.cos(ang) * r,
        y: y + Math.sin(ang) * r * 0.6 + 20,
        angle: 360,
        alpha: 0,
        duration: 1100 + Math.random() * 500,
        ease: "Quad.out",
        onComplete: () => p.destroy(),
      });
    }
  }

  private floatText(x: number, y: number, text: string, color: string, delay = 0) {
    const t = this.add.image(Math.round(x), Math.round(y), this.tex(`ft:${text}:${color}`, () => art.label(text, color, "#fffaf0"))).setDepth(950);
    t.setAlpha(delay ? 0 : 1);
    if (delay) this.tweens.add({ targets: t, alpha: 1, duration: 120, delay });
    this.tweens.add({ targets: t, y: y - 16, alpha: 0, duration: 1400, delay: delay + 500, ease: "Quad.out", onComplete: () => t.destroy() });
  }

  // ------------------------------------------------------------------ debug / external

  /** Positions in page (CSS) pixels, for tests and for overlays. */
  debugState() {
    const cam = this.cameras.main;
    const rect = this.game.canvas.getBoundingClientRect();
    const zx = rect.width / this.scale.width;
    const zy = rect.height / this.scale.height;
    const toPage = (x: number, y: number) => ({ x: rect.left + (x - cam.scrollX) * zx, y: rect.top + (y - cam.scrollY) * zy });
    return {
      player: { x: this.player.x, y: this.player.y, page: toPage(this.player.x, this.player.y - 10) },
      store: { door: this.storeDoor(), page: toPage(this.storeDoor(), GROUND - 30) },
      jeep: { door: this.stopDoor(), page: toPage(this.stopDoor(), GROUND - 20) },
      isHome: this.isHome(),
      barangay: this.data_.barangay ?? null,
      houses: [...this.houses.values()].map((h) => ({ id: h.id, door: h.door, page: toPage(h.door, GROUND - 30) })),
      visitors: [...this.villagers.values()].filter((v) => v.state === "visiting").map((v) => v.id),
      overdueSigns: [...this.houses.values()].filter((h) => h.sign).map((h) => h.id),
      prompt: this.promptFor,
      worldW: this.worldW,
    };
  }

  /** Walk to a neighbour's door (or "store") and visit; for overlays and tests. */
  goTo(id: string) {
    this.walkToAndVisit(id);
  }
}
