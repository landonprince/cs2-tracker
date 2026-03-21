import { useState, useEffect, useMemo, useRef } from 'react'
import './App.css'
import PriceModal from './PriceChart'

const STEAM_IMAGE_BASE = 'https://community.akamai.steamstatic.com/economy/image/'

const RARITY_COLORS = {
  Rarity_Common:      '#b0c3d9',
  Rarity_Uncommon:    '#5e98d9',
  Rarity_Rare:        '#4b69ff',
  Rarity_Mythical:    '#8847ff',
  Rarity_Legendary:   '#d32ce6',
  Rarity_Ancient:     '#eb4b4b',
  Rarity_Contraband:  '#e4ae39',
}

const RARITY_ORDER = [
  'Rarity_Contraband', 'Rarity_Ancient', 'Rarity_Legendary',
  'Rarity_Mythical', 'Rarity_Rare', 'Rarity_Uncommon', 'Rarity_Common',
]

const WEAR_ORDER = [
  'Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred',
]

const RARITY_LABELS = {
  Rarity_Contraband: 'Contraband',
  Rarity_Ancient:    'Covert',
  Rarity_Legendary:  'Classified',
  Rarity_Mythical:   'Restricted',
  Rarity_Rare:       'Mil-Spec',
  Rarity_Uncommon:   'Industrial',
  Rarity_Common:     'Consumer',
}

const WEAR_LABELS = {
  'Factory New':   'FN',
  'Minimal Wear':  'MW',
  'Field-Tested':  'FT',
  'Well-Worn':     'WW',
  'Battle-Scarred':'BS',
}

function getRarity(item) {
  const internal = item.tags?.find(t => t.category === 'Rarity')?.internal_name ?? null
  return internal?.replace(/_(Weapon|Character|Equipment)$/, '') ?? null
}

function getWear(item) {
  return item.tags?.find(t => t.category === 'Exterior')?.localized_tag_name ?? null
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

function DualRangeSlider({ lo, hi, min, max, onChange }) {
  const pct = v => max > min ? ((v - min) / (max - min)) * 100 : 0
  const loPct = pct(lo)
  const hiPct = pct(hi)
  return (
    <div className="dual-range">
      <div className="dual-range-track">
        <div className="dual-range-fill" style={{ left: `${loPct}%`, width: `${Math.max(0, hiPct - loPct)}%` }} />
      </div>
      <input type="range" className="dual-range-input" min={min} max={max} step={0.5}
        value={lo} style={{ zIndex: lo > max - 1 ? 5 : 3 }}
        onChange={e => onChange([Math.min(parseFloat(e.target.value), hi - 0.5), hi])} />
      <input type="range" className="dual-range-input" min={min} max={max} step={0.5}
        value={hi} style={{ zIndex: 4 }}
        onChange={e => onChange([lo, Math.max(parseFloat(e.target.value), lo + 0.5)])} />
    </div>
  )
}

export default function App() {
  const [steamId, setSteamId]           = useState(null)
  const [items, setItems]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  const [sortBy, setSortBy]             = useState('default')
  const [filterRarity, setFilterRarity] = useState('all')
  const [filterWear, setFilterWear]     = useState('all')
  const [steamPrices, setSteamPrices]   = useState({})
  const [csfloatPrices, setCsfloatPrices] = useState({})
  const [pricesLoading, setPricesLoading] = useState(false)
  const [sliderBounds, setSliderBounds] = useState([0, 500])
  const [priceRange, setPriceRange]     = useState([0, 500])
  const pricesFetched  = useRef({ steam: false, csfloat: false })
  const sliderInitRef  = useRef(false)

  // Initialise slider bounds once Steam prices first load
  useEffect(() => {
    const prices = Object.values(steamPrices).filter(p => p != null && p > 0)
    if (prices.length === 0 || sliderInitRef.current) return
    sliderInitRef.current = true
    const hi = Math.ceil(Math.max(...prices))
    setSliderBounds([0, hi])
    setPriceRange([0, hi])
  }, [steamPrices])

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

  async function loadSteamPrices(itemList) {
    if (pricesFetched.current.steam) return
    pricesFetched.current.steam = true
    setPricesLoading(true)
    const uniqueNames = [...new Set(itemList.map(i => i.market_hash_name).filter(Boolean))]
    const results = await fetchInBatches(uniqueNames, async name => {
      try {
        const r = await fetch(`/steam-market/priceoverview/?currency=1&appid=730&market_hash_name=${encodeURIComponent(name)}`)
        const d = await r.json()
        return parsePrice(d.lowest_price)
      } catch { return null }
    })
    setSteamPrices(results)
    setPricesLoading(false)
  }

  async function loadCsfloatPrices(itemList) {
    if (pricesFetched.current.csfloat) return
    pricesFetched.current.csfloat = true
    setPricesLoading(true)
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
    setPricesLoading(false)
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

    if (filterRarity !== 'all')
      result = result.filter(item => getRarity(item) === filterRarity)
    if (filterWear !== 'all')
      result = result.filter(item => getWear(item) === filterWear)

    const steamPricesLoaded = Object.keys(steamPrices).length > 0
    if (steamPricesLoaded && (priceRange[0] > sliderBounds[0] || priceRange[1] < sliderBounds[1])) {
      result = result.filter(item => {
        const price = steamPrices[item.market_hash_name]
        if (price == null) return true
        return price >= priceRange[0] && price <= priceRange[1]
      })
    }

    if (sortBy === 'name-asc')
      result.sort((a, b) => (a.market_hash_name || a.name).localeCompare(b.market_hash_name || b.name))
    else if (sortBy === 'name-desc')
      result.sort((a, b) => (b.market_hash_name || b.name).localeCompare(a.market_hash_name || a.name))
    else if (sortBy === 'rarity-asc')
      result.sort((a, b) => RARITY_ORDER.indexOf(getRarity(a)) - RARITY_ORDER.indexOf(getRarity(b)))
    else if (sortBy === 'rarity-desc')
      result.sort((a, b) => RARITY_ORDER.indexOf(getRarity(b)) - RARITY_ORDER.indexOf(getRarity(a)))
    else if (sortBy === 'wear-asc')
      result.sort((a, b) => WEAR_ORDER.indexOf(getWear(a)) - WEAR_ORDER.indexOf(getWear(b)))
    else if (sortBy === 'wear-desc')
      result.sort((a, b) => WEAR_ORDER.indexOf(getWear(b)) - WEAR_ORDER.indexOf(getWear(a)))
    else if (sortBy === 'steam-price-desc')
      result.sort((a, b) => (steamPrices[b.market_hash_name] ?? -1) - (steamPrices[a.market_hash_name] ?? -1))
    else if (sortBy === 'steam-price-asc')
      result.sort((a, b) => (steamPrices[a.market_hash_name] ?? Infinity) - (steamPrices[b.market_hash_name] ?? Infinity))
    else if (sortBy === 'csfloat-price-desc')
      result.sort((a, b) => (csfloatPrices[b.market_hash_name] ?? -1) - (csfloatPrices[a.market_hash_name] ?? -1))
    else if (sortBy === 'csfloat-price-asc')
      result.sort((a, b) => (csfloatPrices[a.market_hash_name] ?? Infinity) - (csfloatPrices[b.market_hash_name] ?? Infinity))

    return result
  }, [items, sortBy, filterRarity, filterWear, steamPrices, csfloatPrices, priceRange, sliderBounds])

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
          <h1 style={{fontWeight:700}}>CS<span style={{color:'var(--accent)'}}>Assets</span></h1>
          <div className="inv-meta">
            <span className="item-count">{displayedItems.length} / {items.length} items</span>
            <button className="btn-outline" onClick={handleLogout}>Sign Out</button>
          </div>
        </header>

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
                <span className="price-range-val">${priceRange[0].toFixed(2)}</span>
                <DualRangeSlider
                  lo={priceRange[0]} hi={priceRange[1]}
                  min={sliderBounds[0]} max={sliderBounds[1]}
                  onChange={setPriceRange}
                />
                <span className="price-range-val">${priceRange[1].toFixed(2)}</span>
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
                    <span className="item-name">{(item.market_hash_name || item.name).replace(/ \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/, '')}</span>
                    {wear && <span className="item-wear">{wear.localized_tag_name}</span>}
                    <div className="item-prices">
                      <span className="item-price-tag">
                        <svg className="item-price-logo" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z"/>
                        </svg>
                        {steamPrices[item.market_hash_name] != null
                          ? `$${steamPrices[item.market_hash_name].toFixed(2)}`
                          : <span className="item-price-na">—</span>}
                      </span>
                      <span className="item-price-tag">
                        <img className="item-price-logo" src="https://csfloat.com/favicon.ico" alt="CSFloat" />
                        {csfloatPrices[item.market_hash_name] != null
                          ? `$${csfloatPrices[item.market_hash_name].toFixed(2)}`
                          : <span className="item-price-na">—</span>}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {selectedItem && (
          <PriceModal item={selectedItem} onClose={() => setSelectedItem(null)} />
        )}
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
