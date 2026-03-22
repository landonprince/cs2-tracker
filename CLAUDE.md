# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server → http://localhost:5173
npm run server   # Express backend → http://localhost:3001
npm run build    # Production build
npm run lint     # ESLint
```

Both `dev` and `server` must be running simultaneously during development.

## Architecture

**Two-process setup**: The Vite dev server proxies API, auth, and third-party requests through `vite.config.js` to avoid CORS issues:
- `/api`, `/auth` → Express on port 3001
- `/steam-market` → `steamcommunity.com/market` (price history HTML)
- `/csfloat` → `csfloat.com/api/v1` (sales history)

**Authentication**: Steam OpenID flow handled entirely in `server.js`. On success, the Steam ID is stored in an express-session cookie. The frontend checks `/api/session` on load.

**State management**: All inventory state lives in `App.jsx` — items, prices, filters, sort, view, profile. `Dashboard.jsx` and `ProfilePage.jsx` receive data as props (no internal fetches).

**Pricing**: Prices are fetched client-side in batches (`fetchInBatches` in `App.jsx`) after inventory loads:
- Steam prices: parsed from the market listing page HTML (`var line1 = [...]`)
- CSFloat prices: from `/csfloat/history/{name}/sales`, aggregated by day

**History / snapshots** (localStorage):
- `csassets-history-{steamId}`: daily portfolio totals `{date, steam, csfloat}[]`, kept 90 days. Written by `Dashboard.jsx`.
- `csassets-item-prices-{steamId}`: per-item daily snapshot `{prev, curr}` for % change badges. Written by `App.jsx`.

**Shared constants** (`src/constants.js`): All rarity/wear/type enums, ordering arrays, color maps, and tag-parsing helpers (`getRarity`, `getWear`, `getItemType`, `stripWear`). Import from here — never redefine inline.

**Item type mapping**: Steam inventory tags use `category === 'Type'` with values like `Rifle`, `Container`, etc. `getItemType()` normalizes these to the `TYPE_ORDER` categories (e.g., Rifle/Pistol/SMG → `'Weapon'`, Container → `'Case'`).

**PriceChart.jsx**: Modal component that fetches and renders per-item 30-day price history. Self-contained; uses its own local `STEAM_IMAGE_BASE` copy.

**CSS**: `index.css` defines CSS custom properties (`--accent`, `--bg`, `--border`, etc.). `App.css` contains all component styles. Rarity tinting uses `color-mix(in srgb, var(--rarity) %, ...)` with `--rarity` set inline per card.
