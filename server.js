import express from 'express'
import session from 'express-session'
import cron from 'node-cron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve } from 'path'

const app = express()
const PORT         = process.env.PORT || 3001
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
const IS_PROD      = process.env.NODE_ENV === 'production'

// ── Snapshot storage ───────────────────────────────────────────
const DATA_DIR = resolve('./data')
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR)

const STEAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://steamcommunity.com/',
  'Accept': 'application/json',
}

function snapshotPath(steamId)  { return resolve(DATA_DIR, `snapshot-${steamId}.json`) }
function trackedUsersPath()     { return resolve(DATA_DIR, 'tracked-users.json') }

function loadSnapshot(steamId) {
  try { return JSON.parse(readFileSync(snapshotPath(steamId), 'utf8')) }
  catch { return { prev: null, curr: null } }
}

function writeSnapshot(steamId, data) {
  writeFileSync(snapshotPath(steamId), JSON.stringify(data))
}

function loadTrackedUsers() {
  try { return JSON.parse(readFileSync(trackedUsersPath(), 'utf8')) }
  catch { return [] }
}

function addTrackedUser(steamId) {
  const users = loadTrackedUsers()
  if (!users.includes(steamId)) {
    users.push(steamId)
    writeFileSync(trackedUsersPath(), JSON.stringify(users))
  }
}

async function fetchFullInventory(steamId) {
  const items = [], descs = {}
  let cursor = null
  do {
    const qs = new URLSearchParams({ l: 'english', count: '2000' })
    if (cursor) qs.set('start_assetid', cursor)
    const r = await fetch(`https://steamcommunity.com/inventory/${steamId}/730/2?${qs}`, { headers: STEAM_HEADERS })
    if (!r.ok) break
    const data = await r.json()
    for (const d of (data.descriptions || [])) descs[`${d.classid}_${d.instanceid}`] = d
    items.push(...(data.assets || []).map(a => ({ ...a, ...(descs[`${a.classid}_${a.instanceid}`] || {}) })))
    cursor = data.more_items ? data.last_assetid : null
    if (cursor) await new Promise(r => setTimeout(r, 1000))
  } while (cursor)
  return items
}

function parsePrice(str) {
  if (!str) return null
  const n = parseFloat(str.replace(/[^0-9.]/g, ''))
  return isNaN(n) ? null : n
}

async function fetchSteamPrices(items) {
  const names = [...new Set(items.map(i => i.market_hash_name).filter(Boolean))]
  const prices = {}
  for (let i = 0; i < names.length; i += 5) {
    const batch = names.slice(i, i + 5)
    await Promise.all(batch.map(async name => {
      try {
        const r = await fetch(
          `https://steamcommunity.com/market/priceoverview/?currency=1&appid=730&market_hash_name=${encodeURIComponent(name)}`,
          { headers: STEAM_HEADERS }
        )
        if (r.ok) {
          const d = await r.json()
          const p = parsePrice(d.lowest_price)
          if (p != null) prices[name] = p
        }
      } catch {}
    }))
    if (i + 5 < names.length) await new Promise(r => setTimeout(r, 400))
  }
  return prices
}

async function runDailySnapshot(steamId) {
  console.log(`[cron] Running snapshot for ${steamId}`)
  try {
    const items  = await fetchFullInventory(steamId)
    const steam  = await fetchSteamPrices(items)
    const today  = new Date().toISOString().slice(0, 10)
    const stored = loadSnapshot(steamId)
    const prev   = stored.curr?.date !== today ? stored.curr : stored.prev
    writeSnapshot(steamId, { prev, curr: { date: today, steam } })
    console.log(`[cron] Snapshot saved for ${steamId} (${Object.keys(steam).length} items)`)
  } catch (e) {
    console.error(`[cron] Failed for ${steamId}:`, e.message)
  }
}

// Run daily at 2:00 AM
cron.schedule('0 2 * * *', () => {
  for (const steamId of loadTrackedUsers()) runDailySnapshot(steamId)
})

if (IS_PROD) {
  app.set('trust proxy', 1)
  app.use(express.static(resolve('./dist')))
}

app.use(express.json())
app.use(session({
  secret: process.env.SESSION_SECRET || 'cs2-tracker-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: IS_PROD, sameSite: 'lax', httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
}))

// ── Steam market proxy (replaces Vite dev proxy in production) ──
app.get('/steam-market/*splat', async (req, res) => {
  const path = req.params.splat
  const qs   = new URLSearchParams(req.query).toString()
  const url  = `https://steamcommunity.com/market/${path}${qs ? '?' + qs : ''}`
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://steamcommunity.com/',
        'Origin': 'https://steamcommunity.com',
        'Accept': 'text/html,*/*',
      },
    })
    const body = await r.text()
    res.status(r.status).set('content-type', r.headers.get('content-type') || 'text/plain').send(body)
  } catch (e) {
    res.status(502).send(e.message)
  }
})

// ── CSFloat proxy (replaces Vite dev proxy in production) ───────
app.get('/csfloat/*splat', async (req, res) => {
  const path = req.params.splat
  const qs   = new URLSearchParams(req.query).toString()
  const url  = `https://csfloat.com/api/v1/${path}${qs ? '?' + qs : ''}`
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://csfloat.com/',
        'Origin': 'https://csfloat.com',
        'Accept': 'application/json',
      },
    })
    const body = await r.text()
    res.status(r.status).set('content-type', r.headers.get('content-type') || 'application/json').send(body)
  } catch (e) {
    res.status(502).send(e.message)
  }
})

// ── Steam OpenID ───────────────────────────────────────────────
const STEAM_OPENID = 'https://steamcommunity.com/openid/login'
const RETURN_URL   = `${FRONTEND_URL}/auth/steam/return`
const REALM        = FRONTEND_URL

app.get('/auth/steam', (req, res) => {
  const params = new URLSearchParams({
    'openid.ns':         'http://specs.openid.net/auth/2.0',
    'openid.mode':       'checkid_setup',
    'openid.return_to':  RETURN_URL,
    'openid.realm':      REALM,
    'openid.identity':   'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  })
  res.redirect(`${STEAM_OPENID}?${params}`)
})

app.get('/auth/steam/return', async (req, res) => {
  try {
    if (req.query['openid.mode'] !== 'id_res') {
      return res.redirect(`${FRONTEND_URL}?auth=failed`)
    }
    const params = new URLSearchParams({ ...req.query, 'openid.mode': 'check_authentication' })
    const r = await fetch(STEAM_OPENID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    const text = await r.text()
    if (!text.includes('is_valid:true')) return res.redirect(`${FRONTEND_URL}?auth=failed`)
    const match = req.query['openid.claimed_id']?.match(/(\d{17})$/)
    if (!match) return res.redirect(`${FRONTEND_URL}?auth=failed`)
    req.session.steamId = match[1]
    addTrackedUser(match[1])
    res.redirect(FRONTEND_URL)
  } catch {
    res.redirect(`${FRONTEND_URL}?auth=failed`)
  }
})

app.get('/api/session', (req, res) => {
  res.json({ steamId: req.session.steamId ?? null })
})

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }))
})

// ── Profile ────────────────────────────────────────────────────
app.get('/api/profile', async (req, res) => {
  if (!req.session.steamId) return res.status(401).json({ error: 'Not authenticated' })
  try {
    const r = await fetch(`https://steamcommunity.com/profiles/${req.session.steamId}?xml=1`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/xml,application/xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    const xml = await r.text()
    const name   = xml.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/)?.[1] ?? null
    const avatar = xml.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/)?.[1] ?? null
    res.json({ name, avatar, steamId: req.session.steamId })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Inventory ──────────────────────────────────────────────────
app.get('/api/inventory', async (req, res) => {
  if (!req.session.steamId) return res.status(401).json({ error: 'Not authenticated' })
  const qs = new URLSearchParams({ l: 'english', count: '2000' })
  if (req.query.start_assetid) qs.set('start_assetid', req.query.start_assetid)
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://steamcommunity.com/',
    'Accept': 'application/json',
  }
  try {
    let r
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) {
        const base = Math.min(1000 * 2 ** attempt, 16000)
        const jitter = Math.random() * base * 0.5
        await new Promise(resolve => setTimeout(resolve, base + jitter))
      }
      r = await fetch(`https://steamcommunity.com/inventory/${req.session.steamId}/730/2?${qs}`, { headers })
      if (r.status !== 429) break
    }
    if (r.status === 429) return res.status(429).json({ error: 'Steam is rate-limiting requests — please wait a moment and try again.' })
    if (r.status === 403) return res.status(403).json({ error: 'Inventory is set to Private on Steam.' })
    if (!r.ok) return res.status(r.status).json({ error: `Steam returned ${r.status}` })
    res.json(await r.json())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Price snapshot ─────────────────────────────────────────────
app.get('/api/price-snapshot', (req, res) => {
  if (!req.session.steamId) return res.status(401).json({ error: 'Not authenticated' })
  res.json(loadSnapshot(req.session.steamId))
})

app.post('/api/price-snapshot/refresh', async (req, res) => {
  if (!req.session.steamId) return res.status(401).json({ error: 'Not authenticated' })
  res.json({ ok: true })
  runDailySnapshot(req.session.steamId)
})

// SPA fallback — must be last
if (IS_PROD) {
  app.get('/{*splat}', (req, res) => res.sendFile(resolve('./dist/index.html')))
}

app.listen(PORT, () => console.log(`[server] http://localhost:${PORT}`))
