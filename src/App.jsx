import { useState, useEffect, useMemo, useRef } from 'react'
import './App.css'
import PriceModal from './PriceChart'
import ProfilePage from './ProfilePage'
import Dashboard from './Dashboard'
import {
  STEAM_IMAGE_BASE, RARITY_COLORS, RARITY_ORDER, RARITY_LABELS,
  WEAR_ORDER, WEAR_LABELS, TYPE_ORDER, getRarity, getWear, getItemType, stripWear,
} from './constants'

function parseLineData(html) {
  const match = html.match(/var line1\s*=\s*(\[[\s\S]*?\]);/)
  if (!match) return null
  try { return JSON.parse(match[1]) } catch { return null }
}

function filterAndAggregateWeek(data) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const byDay = {}
  for (const [dateStr, price] of data) {
    const cleaned = dateStr.replace(/ \d+: \+0$/, '')
    if (new Date(cleaned).getTime() < cutoff) continue
    const day = cleaned.slice(0, 6) // e.g. "Jun 01"
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(price)
  }
  return Object.values(byDay).map(prices => prices.reduce((s, p) => s + p, 0) / prices.length)
}

function Sparkline({ data }) {
  if (!data || data.length < 2) return null
  const prices = data
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)
  const range = maxP - minP || 1
  const W = 100, H = 36, pad = 3
  const pts = prices.map((p, i) => ({
    x: (i / (prices.length - 1)) * W,
    y: H - pad - ((p - minP) / range) * (H - pad * 2),
  }))
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = `${linePath} L${pts.at(-1).x},${H} L${pts[0].x},${H}Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="card-sparkline" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#spark-grad)" />
      <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function parsePrice(str) {
  if (!str) return null
  const n = parseFloat(str.replace(/[^0-9.]/g, ''))
  return isNaN(n) ? null : n
}

// Fetch in small batches to avoid rate limits
async function fetchInBatches(names, fetchFn, batchSize = 5, delayMs = 300) {
  const results = {}
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize)
    await Promise.allSettled(batch.map(async name => {
      results[name] = await fetchFn(name)
    }))
    if (i + batchSize < names.length) await new Promise(r => setTimeout(r, delayMs))
  }
  return results
}

function priceSnapshotKey(steamId) { return `csassets-item-prices-${steamId}` }

function loadPriceSnapshots(steamId) {
  try { return JSON.parse(localStorage.getItem(priceSnapshotKey(steamId))) || { prev: null, curr: null } }
  catch { return { prev: null, curr: null } }
}

function savePriceSnapshot(steamId, steam, csfloat) {
  const today = new Date().toISOString().slice(0, 10)
  const data = loadPriceSnapshots(steamId)
  if (data.curr?.date !== today) {
    data.prev = data.curr
    data.curr = { date: today, steam, csfloat }
    localStorage.setItem(priceSnapshotKey(steamId), JSON.stringify(data))
  }
  return data.prev
}

function DualRangeSlider({ lo, hi, min, max, onChange }) {
  const pct = v => max > min ? ((v - min) / (max - min)) * 100 : 0
  const loPct = pct(lo)
  const hiPct = pct(hi)
  return (
    <div className="dual-range">
      <div className="dual-range-track">
        <div className="dual-range-fill" style={{ left: `${loPct}%`, width: `${Math.max(0, hiPct - loPct)}%` }} />
      </div>
      <input type="range" className="dual-range-input" min={min} max={max} step={1}
        value={lo} style={{ zIndex: lo > max - 1 ? 5 : 3 }}
        onChange={e => onChange([Math.min(parseFloat(e.target.value), hi - 1), hi])} />
      <input type="range" className="dual-range-input" min={min} max={max} step={1}
        value={hi} style={{ zIndex: 4 }}
        onChange={e => onChange([lo, Math.max(parseFloat(e.target.value), lo + 1)])} />
    </div>
  )
}

export default function App() {
  const [steamId, setSteamId]           = useState(null)
  const [items, setItems]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  const [view, setView]                 = useState('dashboard')
  const [sortBy, setSortBy]             = useState('default')
  const [filterRarity, setFilterRarity] = useState('all')
  const [filterType, setFilterType]     = useState('all')
  const [filterWear, setFilterWear]     = useState('all')
  const [searchQuery, setSearchQuery]   = useState('')
  const [profile, setProfile]           = useState(null)
  const [steamPrices, setSteamPrices]   = useState({})
  const [csfloatPrices, setCsfloatPrices] = useState({})
  const [pricesLoading, setPricesLoading] = useState(false)
  const [prevSteamPrices, setPrevSteamPrices]     = useState({})
  const [prevCsfloatPrices, setPrevCsfloatPrices] = useState({})
  const [sliderBounds] = useState([0, 1000])
  const [priceRange, setPriceRange] = useState([0, 1000])
  const [minInput, setMinInput] = useState('')
  const [maxInput, setMaxInput] = useState('')

  // Keep text inputs in sync when slider moves
  useEffect(() => {
    setMinInput(priceRange[0] <= sliderBounds[0] ? '' : String(priceRange[0]))
    setMaxInput(priceRange[1] >= sliderBounds[1] ? '' : String(priceRange[1]))
  }, [priceRange, sliderBounds])
  const [sparklines, setSparklines] = useState({})
  const pricesFetched      = useRef({ steam: false, csfloat: false })
  const sparklinesFetched  = useRef(false)
  const loadingCountRef    = useRef(0)


  useEffect(() => {
    fetch('/api/session')
      .then(r => r.json())
      .then(({ steamId }) => {
        if (steamId) fetchInventory(steamId)
        else setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('auth') === 'failed') {
      setError('Steam login failed — please try again.')
      window.history.replaceState({}, '', '/')
    }
  }, [])

  // Fetch profile once when authenticated
  useEffect(() => {
    if (!steamId) return
    fetch('/api/profile').then(r => r.json()).then(setProfile).catch(() => {})
  }, [steamId])

  // Load previous day's item prices for % change display
  useEffect(() => {
    if (!steamId) return
    const saved = loadPriceSnapshots(steamId)
    if (saved.prev) {
      setPrevSteamPrices(saved.prev.steam || {})
      setPrevCsfloatPrices(saved.prev.csfloat || {})
    }
  }, [steamId])

  // Fetch sparkline data for all items after prices load
  useEffect(() => {
    if (pricesLoading || Object.keys(steamPrices).length === 0 || sparklinesFetched.current) return
    sparklinesFetched.current = true
    const uniqueNames = [...new Set(items.map(i => i.market_hash_name).filter(Boolean))]
    const timer = setTimeout(() => {
      fetchInBatches(uniqueNames, async name => {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 2000))
          try {
            const r = await fetch(`/steam-market/listings/730/${encodeURIComponent(name)}`)
            if (r.status === 429) continue
            const html = await r.text()
            const raw = parseLineData(html)
            if (!raw || raw.length < 2) return null
            const daily = filterAndAggregateWeek(raw)
            return daily.length >= 2 ? daily : null
          } catch { return null }
        }
        return null
      }, 3, 1000).then(setSparklines)
    }, 2000)
    return () => clearTimeout(timer)
  }, [pricesLoading, steamPrices, items])

  // Save item price snapshot once prices finish loading
  const priceSavedRef = useRef(false)
  useEffect(() => {
    if (pricesLoading || priceSavedRef.current || !steamId ||
        Object.keys(steamPrices).length === 0 || Object.keys(csfloatPrices).length === 0) return
    priceSavedRef.current = true
    savePriceSnapshot(steamId, steamPrices, csfloatPrices)
  }, [pricesLoading, steamId, steamPrices, csfloatPrices])


  async function fetchInventory(id) {
    setLoading(true)
    setError(null)
    try {
      const allAssets = []
      const descMap = {}
      let lastAssetId = null

      while (true) {
        const qs = lastAssetId ? `?start_assetid=${lastAssetId}` : ''
        const res = await fetch(`/api/inventory${qs}`)
        if (res.status === 401) { setSteamId(null); setLoading(false); return }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Steam returned ${res.status}`)
        }
        const data = await res.json()

        if (!data.assets || !data.descriptions) {
          if (allAssets.length === 0) throw new Error('Inventory is empty or set to Private on Steam')
          break
        }

        for (const desc of data.descriptions) {
          descMap[`${desc.classid}_${desc.instanceid}`] = desc
        }
        allAssets.push(...data.assets)

        if (!data.more_items) break
        lastAssetId = data.last_assetid
      }

      const merged = allAssets
        .map(asset => ({
          ...descMap[`${asset.classid}_${asset.instanceid}`],
          assetid: asset.assetid,
        }))
        .filter(item => item.marketable === 1)

      setItems(merged)
      setSteamId(id)
      loadSteamPrices(merged)
      loadCsfloatPrices(merged)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function startLoading() {
    loadingCountRef.current++
    setPricesLoading(true)
  }
  function finishLoading() {
    loadingCountRef.current--
    if (loadingCountRef.current === 0) setPricesLoading(false)
  }

  async function loadSteamPrices(itemList) {
    if (pricesFetched.current.steam) return
    pricesFetched.current.steam = true
    startLoading()
    const uniqueNames = [...new Set(itemList.map(i => i.market_hash_name).filter(Boolean))]
    const results = await fetchInBatches(uniqueNames, async name => {
      try {
        const r = await fetch(`/steam-market/priceoverview/?currency=1&appid=730&market_hash_name=${encodeURIComponent(name)}`)
        const d = await r.json()
        return parsePrice(d.lowest_price)
      } catch { return null }
    })
    setSteamPrices(results)
    finishLoading()
  }

  async function loadCsfloatPrices(itemList) {
    if (pricesFetched.current.csfloat) return
    pricesFetched.current.csfloat = true
    startLoading()
    const uniqueNames = [...new Set(itemList.map(i => i.market_hash_name).filter(Boolean))]
    const results = await fetchInBatches(uniqueNames, async name => {
      try {
        const r = await fetch(`/csfloat/history/${encodeURIComponent(name)}/sales`)
        if (!r.ok) return null
        const sales = await r.json()
        if (!Array.isArray(sales) || sales.length === 0) return null
        const sorted = [...sales].sort((a, b) => new Date(b.sold_at) - new Date(a.sold_at))
        return sorted[0].price / 100
      } catch { return null }
    })
    setCsfloatPrices(results)
    finishLoading()
  }

  function handleSortChange(value) {
    setSortBy(value)
    if (value.startsWith('steam-price') && !pricesFetched.current.steam) loadSteamPrices(items)
    if (value.startsWith('csfloat-price') && !pricesFetched.current.csfloat) loadCsfloatPrices(items)
  }

  function handleLogout() {
    fetch('/auth/logout', { method: 'POST' })
      .then(() => { setSteamId(null); setItems([]) })
  }

  const displayedItems = useMemo(() => {
    let result = [...items]

    if (searchQuery.trim())
      result = result.filter(item =>
        (item.market_hash_name || item.name).toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    if (filterType !== 'all')
      result = result.filter(item => getItemType(item) === filterType)
    if (filterRarity !== 'all')
      result = result.filter(item => getRarity(item) === filterRarity)
    if (filterWear !== 'all')
      result = result.filter(item => getWear(item) === filterWear)

    const steamPricesLoaded = Object.keys(steamPrices).length > 0
    const atMaxHi = priceRange[1] >= sliderBounds[1]
    if (steamPricesLoaded && (priceRange[0] > sliderBounds[0] || !atMaxHi)) {
      result = result.filter(item => {
        const price = steamPrices[item.market_hash_name]
        if (price == null) return true
        return price >= priceRange[0] && (atMaxHi || price <= priceRange[1])
      })
    }

    if (sortBy === 'name-asc')
      result.sort((a, b) => (a.market_hash_name || a.name).localeCompare(b.market_hash_name || b.name))
    else if (sortBy === 'name-desc')
      result.sort((a, b) => (b.market_hash_name || b.name).localeCompare(a.market_hash_name || a.name))
    else if (sortBy === 'rarity-asc')
      result.sort((a, b) => {
        const ia = RARITY_ORDER.indexOf(getRarity(a)), ib = RARITY_ORDER.indexOf(getRarity(b))
        return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib)
      })
    else if (sortBy === 'rarity-desc')
      result.sort((a, b) => {
        const ia = RARITY_ORDER.indexOf(getRarity(a)), ib = RARITY_ORDER.indexOf(getRarity(b))
        return (ib === -1 ? Infinity : ib) - (ia === -1 ? Infinity : ia)
      })
    else if (sortBy === 'wear-asc')
      result.sort((a, b) => {
        const ia = WEAR_ORDER.indexOf(getWear(a)), ib = WEAR_ORDER.indexOf(getWear(b))
        return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib)
      })
    else if (sortBy === 'wear-desc')
      result.sort((a, b) => {
        const ia = WEAR_ORDER.indexOf(getWear(a)), ib = WEAR_ORDER.indexOf(getWear(b))
        return (ib === -1 ? Infinity : ib) - (ia === -1 ? Infinity : ia)
      })
    else if (sortBy === 'steam-price-desc')
      result.sort((a, b) => {
        const pa = steamPrices[a.market_hash_name], pb = steamPrices[b.market_hash_name]
        if (pa == null && pb == null) return 0
        if (pa == null) return 1
        if (pb == null) return -1
        return pb - pa
      })
    else if (sortBy === 'steam-price-asc')
      result.sort((a, b) => {
        const pa = steamPrices[a.market_hash_name], pb = steamPrices[b.market_hash_name]
        if (pa == null && pb == null) return 0
        if (pa == null) return 1
        if (pb == null) return -1
        return pa - pb
      })
    else if (sortBy === 'csfloat-price-desc')
      result.sort((a, b) => {
        const pa = csfloatPrices[a.market_hash_name], pb = csfloatPrices[b.market_hash_name]
        if (pa == null && pb == null) return 0
        if (pa == null) return 1
        if (pb == null) return -1
        return pb - pa
      })
    else if (sortBy === 'csfloat-price-asc')
      result.sort((a, b) => {
        const pa = csfloatPrices[a.market_hash_name], pb = csfloatPrices[b.market_hash_name]
        if (pa == null && pb == null) return 0
        if (pa == null) return 1
        if (pb == null) return -1
        return pa - pb
      })

    return result
  }, [items, sortBy, searchQuery, filterType, filterRarity, filterWear, steamPrices, csfloatPrices, priceRange, sliderBounds])

  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" />
        <p>{steamId ? 'Loading inventory…' : 'Checking session…'}</p>
      </div>
    )
  }

  if (steamId) {
    return (
      <div className="inventory-page">
        <header className="inv-header">
          <h1 style={{fontWeight:700, cursor:'pointer'}} onClick={() => setView('dashboard')}>CS<span style={{color:'var(--accent)'}}>Assets</span></h1>
          <div className="inv-header-right">
            <nav className="inv-nav">
              <button className={`nav-tab ${view === 'dashboard' ? 'active' : ''}`} onClick={() => setView('dashboard')}>Dashboard</button>
              <button className={`nav-tab ${view === 'inventory' ? 'active' : ''}`} onClick={() => setView('inventory')}>Portfolio</button>
            </nav>
            <button className={`nav-avatar-btn ${view === 'profile' ? 'active' : ''}`} onClick={() => setView('profile')}>
              {profile?.avatar
                ? <img src={profile.avatar} alt="profile" />
                : <div className="nav-avatar-placeholder" />}
            </button>
          </div>
        </header>

        {view === 'dashboard' && (
          <Dashboard
            items={items}
            steamPrices={steamPrices}
            csfloatPrices={csfloatPrices}
            steamId={steamId}
            profile={profile}
            onNavigate={setView}
          />
        )}

        {view === 'profile' && (
          <ProfilePage
            items={items}
            steamPrices={steamPrices}
            csfloatPrices={csfloatPrices}
            steamId={steamId}
            profile={profile}
            onLogout={handleLogout}
          />
        )}

        {view === 'inventory' && (<>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            className="search-input"
            type="text"
            placeholder="Search items…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')}>✕</button>
          )}
        </div>
        <div className="inv-controls">
          <div className="control-row">
            <span className="control-label">Sort</span>
            <div className="sort-select-wrap">
              <svg className="sort-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <select className="inv-select" value={sortBy} onChange={e => handleSortChange(e.target.value)}>
                <option value="default">Default</option>
                <option value="rarity-asc">Rarity: High → Low</option>
                <option value="rarity-desc">Rarity: Low → High</option>
                <option value="steam-price-desc">Steam Price: High → Low</option>
                <option value="steam-price-asc">Steam Price: Low → High</option>
                <option value="csfloat-price-desc">CSFloat Price: High → Low</option>
                <option value="csfloat-price-asc">CSFloat Price: Low → High</option>
              </select>
              <svg className="select-chevron" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            {pricesLoading && <span className="prices-loading">Fetching prices…</span>}
            <span className="item-count">{displayedItems.length} / {items.length} items</span>
          </div>

          <div className="control-row">
            <span className="control-label">Type</span>
            <div className="filter-pills">
              <button
                className={`filter-pill ${filterType === 'all' ? 'active' : ''}`}
                onClick={() => setFilterType('all')}
              >All</button>
              {TYPE_ORDER.map(t => (
                <button
                  key={t}
                  className={`filter-pill ${filterType === t ? 'active' : ''}`}
                  onClick={() => setFilterType(t)}
                >{t}</button>
              ))}
            </div>
          </div>

          <div className="control-row">
            <span className="control-label">Rarity</span>
            <div className="filter-pills">
              <button
                className={`filter-pill ${filterRarity === 'all' ? 'active' : ''}`}
                onClick={() => setFilterRarity('all')}
              >All</button>
              {RARITY_ORDER.map(r => (
                <button
                  key={r}
                  className={`filter-pill rarity-pill ${filterRarity === r ? 'active' : ''}`}
                  style={{ '--pill-color': RARITY_COLORS[r] }}
                  onClick={() => setFilterRarity(r)}
                >
                  <span className="pill-dot" />
                  {RARITY_LABELS[r]}
                </button>
              ))}
            </div>
          </div>

          <div className="control-row">
            <span className="control-label">Wear</span>
            <div className="filter-pills">
              <button
                className={`filter-pill ${filterWear === 'all' ? 'active' : ''}`}
                onClick={() => setFilterWear('all')}
              >All</button>
              {WEAR_ORDER.map(w => (
                <button
                  key={w}
                  className={`filter-pill ${filterWear === w ? 'active' : ''}`}
                  onClick={() => setFilterWear(w)}
                >
                  <span className="wear-abbr">{WEAR_LABELS[w]}</span>
                  <span className="wear-full">{w}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="control-row">
            <span className="control-label">Price</span>
            {Object.keys(steamPrices).length > 0 ? (
              <div className="price-filter-wrap">
                <input
                  className="price-range-input"
                  type="number"
                  step="any"
                  placeholder="0"
                  value={minInput}
                  onChange={e => setMinInput(e.target.value)}
                  onBlur={() => {
                    if (minInput === '') { setPriceRange([sliderBounds[0], priceRange[1]]); return }
                    const v = parseFloat(minInput)
                    if (!isNaN(v)) setPriceRange([Math.max(sliderBounds[0], Math.min(v, priceRange[1] - 0.01)), priceRange[1]])
                    else setMinInput(priceRange[0] <= sliderBounds[0] ? '' : String(priceRange[0]))
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                />
                <DualRangeSlider
                  lo={priceRange[0]} hi={priceRange[1]}
                  min={sliderBounds[0]} max={sliderBounds[1]}
                  onChange={setPriceRange}
                />
                <input
                  className="price-range-input"
                  type="number"
                  step="any"
                  placeholder="∞"
                  value={maxInput}
                  onChange={e => setMaxInput(e.target.value)}
                  onBlur={() => {
                    if (maxInput === '') { setPriceRange([priceRange[0], sliderBounds[1]]); return }
                    const v = parseFloat(maxInput)
                    if (!isNaN(v)) setPriceRange([priceRange[0], Math.max(priceRange[0] + 0.01, Math.min(v, sliderBounds[1]))])
                    else setMaxInput(priceRange[1] >= sliderBounds[1] ? '' : String(priceRange[1]))
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                />
                {(priceRange[0] > sliderBounds[0] || priceRange[1] < sliderBounds[1]) && (
                  <button className="filter-pill" onClick={() => setPriceRange(sliderBounds)}>Reset</button>
                )}
              </div>
            ) : (
              <span className="prices-loading">Loading…</span>
            )}
          </div>
        </div>

        {displayedItems.length === 0 ? (
          <p className="empty">No items match the current filters.</p>
        ) : (
          <div className="inventory-grid">
            {displayedItems.map(item => {
              const rarity = getRarity(item)
              const color = RARITY_COLORS[rarity] ?? '#6b6375'
              const wear = item.tags?.find(t => t.category === 'Exterior')
              return (
                <div
                  key={item.assetid}
                  className="item-card marketable"
                  style={{ '--rarity': color }}
                  onClick={() => setSelectedItem(item)}
                  title="Click to view price history"
                >
                  <div className="item-img-wrap">
                    <img
                      src={`${STEAM_IMAGE_BASE}${item.icon_url}`}
                      alt={item.name}
                      loading="lazy"
                    />
                  </div>
                  <div className="item-info">
                    <span className="item-name">{stripWear(item.market_hash_name || item.name)}</span>
                    {wear && <span className="item-wear">{wear.localized_tag_name}</span>}
                    {(() => {
                      const sp = steamPrices[item.market_hash_name] ?? null
                      const cp = csfloatPrices[item.market_hash_name] ?? null
                      const prevSp = prevSteamPrices[item.market_hash_name] ?? null
                      const prevCp = prevCsfloatPrices[item.market_hash_name] ?? null
                      const steamPct = sp != null && prevSp != null && prevSp !== 0 ? ((sp - prevSp) / prevSp) * 100 : null
                      const csfloatPct = cp != null && prevCp != null && prevCp !== 0 ? ((cp - prevCp) / prevCp) * 100 : null
                      return (
                        <div className="item-prices">
                          <span className="item-price-tag">
                            <svg className="item-price-logo" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z"/>
                            </svg>
                            {sp != null ? `$${sp.toFixed(2)}` : <span className="item-price-na">—</span>}
                            {steamPct != null && (
                              <span className={`item-price-pct ${steamPct >= 0 ? 'pct-up' : 'pct-down'}`}>
                                {steamPct >= 0 ? '+' : ''}{steamPct.toFixed(1)}%
                              </span>
                            )}
                          </span>
                          <span className="item-price-tag">
                            <img className="item-price-logo" src="https://csfloat.com/favicon.ico" alt="CSFloat" />
                            {cp != null ? `$${cp.toFixed(2)}` : <span className="item-price-na">—</span>}
                            {csfloatPct != null && (
                              <span className={`item-price-pct ${csfloatPct >= 0 ? 'pct-up' : 'pct-down'}`}>
                                {csfloatPct >= 0 ? '+' : ''}{csfloatPct.toFixed(1)}%
                              </span>
                            )}
                          </span>
                        </div>
                      )
                    })()}
                  </div>
                  <Sparkline data={sparklines[item.market_hash_name]} />
                </div>
              )
            })}
          </div>
        )}

        {selectedItem && (
          <PriceModal item={selectedItem} onClose={() => setSelectedItem(null)} />
        )}
        </>)}
      </div>
    )
  }

  return (
    <div className="center-screen landing">
      <div className="landing-badge">CS2 Item Portfolio</div>
      <h1 className="landing-title">CS<span className="landing-accent">Assets</span></h1>
      <p className="landing-sub">Live market data for every item in your inventory.</p>

      <a href="/auth/steam" className="steam-login-btn">
        <svg className="steam-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
          <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z"/>
        </svg>
        Sign in through Steam
      </a>

      {error && <p className="error">{error}</p>}

      <p className="hint">Inventory must be set to <strong>Public</strong> on Steam</p>
    </div>
  )
}
