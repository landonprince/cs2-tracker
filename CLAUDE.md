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
- `csassets-alerts-{steamId}`: price alert rules `{name, direction, price}[]`. Read/written by `App.jsx`.

**Shared constants** (`src/constants.js`): All rarity/wear/type enums, ordering arrays, color maps, and tag-parsing helpers (`getRarity`, `getWear`, `getItemType`, `stripWear`). Import from here — never redefine inline.

**Item type mapping**: Steam inventory tags use `category === 'Type'` with values like `Rifle`, `Container`, etc. `getItemType()` normalizes these to the `TYPE_ORDER` categories (e.g., Rifle/Pistol/SMG → `'Weapon'`, Container → `'Case'`).

**Navigation**: Single-page app with `view` state in `App.jsx` — values are `'dashboard'`, `'inventory'`, `'profile'`, `'settings'`. No router; views are conditionally rendered. `SettingsPage.jsx` is reached via the Profile page and handles notification permissions and localStorage data management (clear history/snapshots/alerts).

**Inventory pagination**: `fetchInventory` in `App.jsx` loops through Steam's inventory API using `start_assetid` cursor until all pages are fetched. Items and descriptions are merged client-side.

**Sparklines**: Per-item 7-day SVG mini-charts on inventory cards. Fetched in batches (5 at a time, 400ms gap, 500ms start delay) from `/steam-market/listings/730/{name}` after prices finish loading. Uses `parseLineData` from `constants.js` to extract `var line1` from the HTML, then `filterAndAggregateWeek` (defined in `App.jsx`) to downsample to daily averages. The `Sparkline` component is also defined inline in `App.jsx`.

**Price alerts**: Stored per-item rules checked on every Steam price update in `App.jsx`. Triggers browser `Notification` API when price crosses the threshold. Triggered alerts are marked and preserved (not removed) so the user can see what fired.

**Server scraping**: `server.js` uses no Steam API key. Profile data comes from `steamcommunity.com/profiles/{id}?xml=1` (XML scraping). Inventory comes from `steamcommunity.com/inventory/{id}/730/2`. Rate limit errors (429) on sparkline fetches are retried once after 2 s. The Vite proxy (`vite.config.js`) injects browser-like `User-Agent`, `Referer`, and `Origin` headers on proxied Steam/CSFloat requests to avoid bot detection.

**PriceChart.jsx**: Modal component that fetches and renders per-item 30-day price history. Self-contained; uses its own local `STEAM_IMAGE_BASE` copy.

**CSS**: `index.css` defines CSS custom properties (`--accent`, `--bg`, `--border`, etc.). `App.css` contains all component styles. Rarity tinting uses `color-mix(in srgb, var(--rarity) %, ...)` with `--rarity` set inline per card.
