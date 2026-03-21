import express from 'express'
import session from 'express-session'

const app = express()
const PORT = 3001

app.use(express.json())
app.use(session({
  secret: process.env.SESSION_SECRET || 'cs2-tracker-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, sameSite: 'lax', httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
}))

// ── Steam OpenID ───────────────────────────────────────────────
const STEAM_OPENID = 'https://steamcommunity.com/openid/login'
const RETURN_URL   = 'http://localhost:5173/auth/steam/return'
const REALM        = 'http://localhost:5173'

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
      return res.redirect('http://localhost:5173?auth=failed')
    }
    const params = new URLSearchParams({ ...req.query, 'openid.mode': 'check_authentication' })
    const r = await fetch(STEAM_OPENID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    const text = await r.text()
    if (!text.includes('is_valid:true')) return res.redirect('http://localhost:5173?auth=failed')
    const match = req.query['openid.claimed_id']?.match(/(\d{17})$/)
    if (!match) return res.redirect('http://localhost:5173?auth=failed')
    req.session.steamId = match[1]
    res.redirect('http://localhost:5173')
  } catch {
    res.redirect('http://localhost:5173?auth=failed')
  }
})

app.get('/api/session', (req, res) => {
  res.json({ steamId: req.session.steamId ?? null })
})

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }))
})

// ── Inventory ──────────────────────────────────────────────────
app.get('/api/inventory', async (req, res) => {
  if (!req.session.steamId) return res.status(401).json({ error: 'Not authenticated' })
  const qs = new URLSearchParams({ l: 'english', count: '2000' })
  if (req.query.start_assetid) qs.set('start_assetid', req.query.start_assetid)
  try {
    const r = await fetch(`https://steamcommunity.com/inventory/${req.session.steamId}/730/2?${qs}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://steamcommunity.com/',
        'Accept': 'application/json',
      },
    })
    if (!r.ok) return res.status(r.status).json({ error: `Steam returned ${r.status}` })
    res.json(await r.json())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.listen(PORT, () => console.log(`[server] http://localhost:${PORT}`))
