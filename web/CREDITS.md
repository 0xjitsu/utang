# Credits

## Art and sound

All art in the game is original, drawn in code for this project: the sari-sari store, houses,
villagers and avatars, the jeepney, cat, palm trees, lamps, volcano, coins, badges, icons and the
3x5 pixel font. The game uses **no third-party image or audio assets**.

All sound effects and the optional background loop are **generated at runtime** with ZzFX from
parameters written for this project. No recorded audio is included.

## Libraries

| What | Used for | Source | License |
|---|---|---|---|
| Phaser 4.2.1 | Street scene (lazy-loaded) | https://github.com/phaserjs/phaser | MIT |
| ZzFX 1.4.0 (Frank Force) | Generated sound effects | https://github.com/KilledByAPixel/ZzFX | MIT |
| React 18.3.1 | UI | https://github.com/facebook/react | MIT |
| NEAR Wallet Selector 10.1.4 | Wallet connection | https://github.com/near/wallet-selector | MIT / Apache-2.0 |
| @near-js/providers 2.5.1 | JSON-RPC view calls | https://github.com/near/near-api-js | MIT / Apache-2.0 |
| buffer 6.0.3 | Browser polyfill for NEAR packages | https://github.com/feross/buffer | MIT |

## Fonts (loaded from Google Fonts)

| Font | Source | License |
|---|---|---|
| Press Start 2P (CodeMan38) | https://fonts.google.com/specimen/Press+Start+2P | SIL Open Font License 1.1 |
| VT323 (Peter Hull) | https://fonts.google.com/specimen/VT323 | SIL Open Font License 1.1 |
| Patrick Hand (Patrick Wagesreiter) | https://fonts.google.com/specimen/Patrick+Hand | SIL Open Font License 1.1 |
| Atkinson Hyperlegible (Braille Institute) | https://fonts.google.com/specimen/Atkinson+Hyperlegible | SIL Open Font License 1.1 |

## Map data

The Mandaluyong city map (barangay boundaries, major roads, the Pasig and San Juan rivers and a few
public landmarks) is derived from **OpenStreetMap** data:

> © OpenStreetMap contributors (ODbL)

- Licence: Open Database License (ODbL) 1.0 — https://www.openstreetmap.org/copyright
- Files: `public/map/mandaluyong.json` (and `public/map/mandaluyong-preview.svg`), built by
  `scripts/build-map.mjs` from a single Overpass API query.
- The map is a **simplified derivative drawing used for gameplay**: shapes are projected,
  rescaled and simplified, so it is not accurate enough for navigation or any official purpose.
- Only administrative boundaries, major roads, waterways and a handful of public landmarks are
  used. No shops, businesses, buildings, addresses or personal data are extracted.
- The derived map data is made available under the same ODbL terms.
