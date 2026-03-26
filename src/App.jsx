import { useState, useEffect, useMemo, useRef } from 'react'
import './App.css'
import PriceModal from './PriceChart'
import ProfilePage from './ProfilePage'
import SettingsPage from './SettingsPage'
import Dashboard from './Dashboard'
import {
  STEAM_IMAGE_BASE, RARITY_COLORS, RARITY_ORDER, RARITY_LABELS,
  WEAR_ORDER, WEAR_LABELS, TYPE_ORDER, getRarity, getWear, getItemType, stripWear,
  parseLineData,
} from './constants'

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
async function fetchInBatches(names, fetchFn, batchSize = 5, delayMs = 300, startDelayMs = 0) {
  const results = {}
  if (startDelayMs > 0) await new Promise(r => setTimeout(r, startDelayMs))
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize)
    await Promise.allSettled(batch.map(async name => {
      results[name] = await fetchFn(name)
    }))
    if (i + batchSize < names.length) await new Promise(r => setTimeout(r, delayMs))
  }
  return results
}

function alertsKey(steamId) { return `csassets-alerts-${steamId}` }
function loadAlerts(steamId) {
  try { return JSON.parse(localStorage.getItem(alertsKey(steamId))) || [] }
  catch { return [] }
}
function saveAlerts(steamId, alerts) {
  localStorage.setItem(alertsKey(steamId), JSON.stringify(alerts))
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
    const steamClean = Object.fromEntries(Object.entries(steam).filter(([, v]) => v != null))
    const csfloatClean = Object.fromEntries(Object.entries(csfloat).filter(([, v]) => v != null))
    data.curr = { date: today, steam: steamClean, csfloat: csfloatClean }
    localStorage.setItem(priceSnapshotKey(steamId), JSON.stringify(data))
  }
  return data.prev
}

function CardAlertModal({ item, onClose, onAddAlert }) {
  const [alertPrice, setAlertPrice] = useState('')
  const [alertDirection, setAlertDirection] = useState('below')
  const [alertAdded, setAlertAdded] = useState(false)

  return (
    <div className="alert-modal-overlay" onClick={onClose}>
      <div className="alert-modal" onClick={e => e.stopPropagation()}>
        <div className="alert-modal-header">
          <span className="alert-modal-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            Set Price Alert
          </span>
          <button className="alerts-panel-close" onClick={onClose}>✕</button>
        </div>
        <div className="alert-modal-item">
          <span>{stripWear(item.market_hash_name || item.name)}</span>
          {getWear(item) && <span className="item-wear">{getWear(item)}</span>}
        </div>
        <div className="alert-modal-form">
          <span className="alert-modal-label">Notify me when price goes</span>
          <select className="alert-direction-select" value={alertDirection} onChange={e => setAlertDirection(e.target.value)}>
            <option value="below">Below</option>
            <option value="above">Above</option>
          </select>
          <input
            className="alert-price-input"
            type="number"
            step="0.01"
            min="0"
            placeholder="$ Target price"
            value={alertPrice}
            autoFocus
            onChange={e => { setAlertPrice(e.target.value); setAlertAdded(false) }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const price = parseFloat(alertPrice)
                if (!isNaN(price) && price > 0) {
                  onAddAlert(item.market_hash_name, price, alertDirection)
                  setAlertAdded(true)
                  setTimeout(onClose, 800)
                }
              }
            }}
          />
        </div>
        <button
          className="alert-add-btn alert-modal-submit"
          disabled={!alertPrice || isNaN(parseFloat(alertPrice)) || parseFloat(alertPrice) <= 0}
          onClick={() => {
            const price = parseFloat(alertPrice)
            if (!isNaN(price) && price > 0) {
              onAddAlert(item.market_hash_name, price, alertDirection)
              setAlertAdded(true)
              setTimeout(onClose, 800)
            }
          }}
        >
          {alertAdded ? '✓ Alert Added' : 'Add Alert'}
        </button>
      </div>
    </div>
  )
}

let logoIdCounter = 0
function Logo() {
  const [maskId] = useState(() => `logo-mask-${++logoIdCounter}`)
  return (
    <>
      <svg width="26" height="28" viewBox="0 0 26 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <mask id={maskId}>
            <rect width="26" height="28" fill="white"/>
            <polyline points="-4,21 8.5,12 13.5,15 30,6" stroke="black" strokeWidth="3.25" strokeLinecap="butt" strokeLinejoin="miter"/>
          </mask>
        </defs>
        <path d="M13 1.5 L24 5.5 L24 15 C24 21 19 25.5 13 27 C7 25.5 2 21 2 15 L2 5.5 Z" fill="var(--accent)" mask={`url(#${maskId})`}/>
      </svg>
      <h1 style={{fontWeight:700, margin:0}}>CS<span style={{color:'var(--accent)'}}>Assets</span></h1>
    </>
  )
}

function LandingVisual() {
  return (
    <div className="landing-visual-wrap">
      <span className="lv-sparkle"               style={{top: '6%',    left: '-16%'}} />
      <span className="lv-sparkle lv-sparkle--sm" style={{top: '28%',  right: '-12%'}} />
      <span className="lv-sparkle lv-sparkle--lg" style={{bottom: '24%', left: '-20%'}} />
      <span className="lv-sparkle lv-sparkle--sm" style={{top: '-6%',  right: '-10%'}} />
      <span className="lv-sparkle"               style={{bottom: '6%',  right: '-14%'}} />
      <div className="landing-visual">
        <div className="lv-chart-card">
          <div className="lv-chart-header">
            <span className="lv-chart-label">Portfolio Value</span>
            <span className="lv-badge-up">+18.3%</span>
          </div>
          <div className="lv-chart-value">$2,847<span className="lv-chart-cents">.32</span></div>
          <svg viewBox="0 0 280 80" className="lv-svg" preserveAspectRatio="none">
            <defs>
              <linearGradient id="lv-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28"/>
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
              </linearGradient>
            </defs>
            <path className="lv-area" d="M0,68 L30,60 L55,65 L80,52 L110,56 L135,43 L158,48 L180,37 L205,42 L228,28 L252,32 L280,18 L280,80 L0,80 Z"/>
            <path className="lv-line" d="M0,68 L30,60 L55,65 L80,52 L110,56 L135,43 L158,48 L180,37 L205,42 L228,28 L252,32 L280,18"/>
          </svg>
        </div>
        <div className="lv-items">
          <div className="lv-item-card" style={{'--rarity': '#d32ce6'}}>
            <div className="lv-item-img-wrap">
              <img className="lv-item-img" src="https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiFO0POlPPNSMuWRDGKC_uJ_t-l9AXCxxEh14zjTztivci2ePQZ2W8NzTecD4BKwloLiYeqxtAOIj9gUyyngznQeF7I6QE8" alt="AK-47 | Vulcan" />
            </div>
            <div className="lv-item-info">
              <span className="lv-item-name">AK-47 | Vulcan</span>
              <span className="lv-item-wear">Minimal Wear</span>
            </div>
            <div className="lv-item-prices">
              <span className="lv-item-price">$419.62</span>
              <span className="lv-badge-up">+28.7%</span>
            </div>
          </div>
          <div className="lv-item-card" style={{'--rarity': '#d32ce6'}}>
            <div className="lv-item-img-wrap">
              <img className="lv-item-img" src="https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL2kpnj9h1Y-s2pZKtuK8-WF2KTzuBiseJ9cCW6khUz_T-GyNavdCqRawN1CMFwTOcO5hO7loXiY-zmsQKPi44QzHj22ikcvy11o7FVfFOBmfY" alt="Glock-18 | Vogue" />
            </div>
            <div className="lv-item-info">
              <span className="lv-item-name">Glock-18 | Vogue</span>
              <span className="lv-item-wear">Factory New</span>
            </div>
            <div className="lv-item-prices">
              <span className="lv-item-price">$18.65</span>
              <span className="lv-badge-up">+27.9%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
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
  const [view, setView]                 = useState('landing')
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
  const [alerts, setAlerts]         = useState([])
  const [showAlerts, setShowAlerts] = useState(false)
  const [alertItem, setAlertItem]   = useState(null)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Load alerts when authenticated
  useEffect(() => {
    if (!steamId) return
    setAlerts(loadAlerts(steamId))
  }, [steamId])

  // Check alerts whenever steam prices update
  useEffect(() => {
    if (Object.keys(steamPrices).length === 0) return
    setAlerts(prev => {
      if (prev.length === 0) return prev
      let anyTriggered = false
      const updated = prev.map(alert => {
        if (alert.triggered) return alert
        const price = steamPrices[alert.market_hash_name]
        if (price == null) return alert
        const hit = alert.direction === 'above' ? price >= alert.targetPrice : price <= alert.targetPrice
        if (!hit) return alert
        anyTriggered = true
        if (Notification.permission === 'granted') {
          new Notification('CSAssets Price Alert', {
            body: `${stripWear(alert.market_hash_name)} is now $${price.toFixed(2)} (target: ${alert.direction === 'above' ? '≥' : '≤'} $${alert.targetPrice.toFixed(2)})`,
          })
        }
        return { ...alert, triggered: true, triggeredPrice: price, triggeredAt: new Date().toISOString() }
      })
      if (anyTriggered) {
        saveAlerts(steamId, updated)
        return updated
      }
      return prev
    })
  }, [steamPrices, steamId])

  // Fetch sparkline data for all items after prices load
  useEffect(() => {
    if (pricesLoading || Object.keys(steamPrices).length === 0 || sparklinesFetched.current) return
    sparklinesFetched.current = true
    const uniqueNames = [...new Set(items.map(i => i.market_hash_name).filter(Boolean))]
    fetchInBatches(uniqueNames, async name => {
      try {
        const r = await fetch(`/steam-market/listings/730/${encodeURIComponent(name)}`)
        if (!r.ok) return null
        const html = await r.text()
        const raw = parseLineData(html)
        if (!raw || raw.length < 2) return null
        const daily = filterAndAggregateWeek(raw)
        return daily.length >= 2 ? daily : null
      } catch { return null }
    }, 5, 400, 500).then(setSparklines)
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
    pricesFetched.current = { steam: false, csfloat: false }
    sparklinesFetched.current = false
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
      setView('dashboard')
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

  function addAlert(market_hash_name, targetPrice, direction) {
    if (Notification.permission === 'default') Notification.requestPermission()
    const newAlert = {
      id: `${Date.now()}-${Math.random()}`,
      market_hash_name,
      targetPrice,
      direction,
      triggered: false,
      createdAt: new Date().toISOString(),
    }
    const updated = [...alerts, newAlert]
    setAlerts(updated)
    saveAlerts(steamId, updated)
  }

  function removeAlert(id) {
    const updated = alerts.filter(a => a.id !== id)
    setAlerts(updated)
    saveAlerts(steamId, updated)
  }

  function refreshPrices() {
    pricesFetched.current = { steam: false, csfloat: false }
    sparklinesFetched.current = false
    setSteamPrices({})
    setCsfloatPrices({})
    setSparklines({})
    loadSteamPrices(items)
    loadCsfloatPrices(items)
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

    const orderBy = (arr, getter) => (a, b) => {
      const ia = arr.indexOf(getter(a)), ib = arr.indexOf(getter(b))
      return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib)
    }
    const byPrice = (prices, dir) => (a, b) => {
      const pa = prices[a.market_hash_name], pb = prices[b.market_hash_name]
      if (pa == null && pb == null) return 0
      if (pa == null) return 1
      if (pb == null) return -1
      return dir === 'desc' ? pb - pa : pa - pb
    }
    const pctChange = (item) => {
      const sp = steamPrices[item.market_hash_name], ps = prevSteamPrices[item.market_hash_name]
      return sp != null && ps != null && ps !== 0 ? (sp - ps) / ps : null
    }
    const byPct = (dir) => (a, b) => {
      const pctA = pctChange(a), pctB = pctChange(b)
      if (pctA == null && pctB == null) return 0
      if (pctA == null) return 1
      if (pctB == null) return -1
      return dir === 'desc' ? pctB - pctA : pctA - pctB
    }

    const comparators = {
      'name-asc':           (a, b) => (a.market_hash_name || a.name).localeCompare(b.market_hash_name || b.name),
      'name-desc':          (a, b) => (b.market_hash_name || b.name).localeCompare(a.market_hash_name || a.name),
      'rarity-asc':         orderBy(RARITY_ORDER, getRarity),
      'rarity-desc':        (a, b) => -orderBy(RARITY_ORDER, getRarity)(a, b),
      'wear-asc':           orderBy(WEAR_ORDER, getWear),
      'wear-desc':          (a, b) => -orderBy(WEAR_ORDER, getWear)(a, b),
      'steam-price-desc':   byPrice(steamPrices, 'desc'),
      'steam-price-asc':    byPrice(steamPrices, 'asc'),
      'csfloat-price-desc': byPrice(csfloatPrices, 'desc'),
      'csfloat-price-asc':  byPrice(csfloatPrices, 'asc'),
      'pct-desc':           byPct('desc'),
      'pct-asc':            byPct('asc'),
    }

    const comparator = comparators[sortBy]
    if (comparator) result.sort(comparator)

    return result
  }, [items, sortBy, searchQuery, filterType, filterRarity, filterWear, steamPrices, csfloatPrices, prevSteamPrices, priceRange, sliderBounds])

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
          <div style={{display:'flex', alignItems:'center', gap:'6px', cursor:'pointer'}} onClick={() => setView('landing')}>
            <Logo />
          </div>
          <div className="inv-header-right">
            <nav className="inv-nav">
              <button className={`nav-tab ${view === 'dashboard' ? 'active' : ''}`} onClick={() => setView('dashboard')}>Dashboard</button>
              <button className={`nav-tab ${view === 'inventory' ? 'active' : ''}`} onClick={() => setView('inventory')}>Portfolio</button>
            </nav>
            <button className="dash-refresh-btn" onClick={refreshPrices} title="Refresh price data">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <path d="M23 4v6h-6M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              Refresh
            </button>
            <button className={`nav-bell-btn ${showAlerts ? 'active' : ''}`} onClick={() => setShowAlerts(v => !v)} title="Price Alerts">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              {alerts.some(a => a.triggered && !a.seen)
                ? <span className="nav-bell-badge triggered" />
                : alerts.filter(a => !a.triggered).length > 0
                  ? <span className="nav-bell-badge">{alerts.filter(a => !a.triggered).length}</span>
                  : null}
            </button>
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
            onSettings={() => setView('settings')}
          />
        )}

        {view === 'settings' && (
          <SettingsPage
            steamId={steamId}
            onBack={() => setView('profile')}
            onClearAlerts={() => { setAlerts([]); saveAlerts(steamId, []) }}
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
                <option value="pct-desc">% Change: High → Low</option>
                <option value="pct-asc">% Change: Low → High</option>
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
                    {(() => {
                      const action = item.actions?.[0]?.link
                      if (!action) return null
                      const href = action.replace('%owner_steamid%', steamId).replace('%assetid%', item.assetid)
                      return (
                        <a
                          className="card-inspect-btn"
                          href={href}
                          title="Inspect in Game"
                          onClick={e => e.stopPropagation()}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                            <circle cx="10" cy="10" r="6"/>
                            <line x1="10" y1="7" x2="10" y2="13"/>
                            <line x1="7" y1="10" x2="13" y2="10"/>
                            <line x1="14.5" y1="14.5" x2="20" y2="20"/>
                          </svg>
                        </a>
                      )
                    })()}
                    <button
                      className={item.actions?.[0]?.link ? 'card-inspect-btn card-alert-btn' : 'card-alert-btn-solo'}
                      title="Set Price Alert"
                      onClick={e => { e.stopPropagation(); setAlertItem(item) }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                      </svg>
                    </button>
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
          <PriceModal item={selectedItem} onClose={() => setSelectedItem(null)} onOpenAlert={setAlertItem} />
        )}
        {alertItem && (
          <CardAlertModal item={alertItem} onClose={() => setAlertItem(null)} onAddAlert={addAlert} />
        )}

        {showAlerts && (
          <div className="alerts-overlay" onClick={() => setShowAlerts(false)}>
            <div className="alerts-panel" onClick={e => e.stopPropagation()}>
              <div className="alerts-panel-header">
                <h3 className="alerts-panel-title">Price Alerts</h3>
                <button className="alerts-panel-close" onClick={() => setShowAlerts(false)}>✕</button>
              </div>
              {alerts.length === 0 ? (
                <p className="alerts-empty">No alerts set. Open an item and use the alert form to add one.</p>
              ) : (
                <div className="alerts-list">
                  {alerts.map(alert => (
                    <div key={alert.id} className={`alert-item ${alert.triggered ? 'alert-triggered' : ''}`}>
                      <div className="alert-item-info">
                        <span className="alert-item-name">{stripWear(alert.market_hash_name)}</span>
                        <span className="alert-item-target">
                          {alert.direction === 'above' ? '≥' : '≤'} ${alert.targetPrice.toFixed(2)}
                          {alert.triggered && <span className="alert-item-hit"> · hit ${alert.triggeredPrice.toFixed(2)}</span>}
                        </span>
                      </div>
                      <button className="alert-item-delete" onClick={() => removeAlert(alert.id)} title="Remove alert">✕</button>
                    </div>
                  ))}
                </div>
              )}
              {Notification.permission !== 'granted' && (
                <button className="alerts-notif-btn" onClick={() => Notification.requestPermission()}>
                  Enable Browser Notifications
                </button>
              )}
            </div>
          </div>
        )}
        </>)}

        {view === 'landing' && <div className="center-screen landing">
          <div className="landing-content">
            <h1 className="landing-headline">Track Your CS2<br/>Portfolio for Free</h1>
            <p className="landing-sub">CSAssets provides unparalled analytics that provide actionable insights. Stay ahead of the curve with real-time market intelligence.</p>
            <div className="landing-cta">
              <button className="landing-btn-primary" onClick={() => setView('dashboard')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                </svg>
                Dashboard
              </button>
              <button className="landing-btn-secondary" onClick={() => setView('inventory')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                </svg>
                Portfolio
              </button>
            </div>
          </div>
          <LandingVisual />
        </div>}
      </div>
    )
  }

  return (
    <div className="inventory-page">
      <header className="inv-header">
        <div style={{display:'flex', alignItems:'center', gap:'6px', cursor:'pointer'}} onClick={() => setView('landing')}>
          <Logo />
        </div>
        <div className="inv-header-right">
          <nav className="inv-nav">
            <button className={`nav-tab ${view === 'dashboard' ? 'active' : ''}`} onClick={() => setView('dashboard')}>Dashboard</button>
            <button className={`nav-tab ${view === 'inventory' ? 'active' : ''}`} onClick={() => setView('inventory')}>Portfolio</button>
          </nav>
          <a href="/auth/steam" className="steam-login-btn steam-login-btn--nav">
            <svg className="steam-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
              <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z"/>
            </svg>
            Sign in
          </a>
        </div>
      </header>

      {(view === 'dashboard' || view === 'inventory') && (
        <div className="locked-view">
          <div className="locked-view-content">
            <svg className="locked-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <h3 className="locked-title">Sign in to view your {view === 'dashboard' ? 'Dashboard' : 'Portfolio'}</h3>
            <p className="locked-sub">Connect your Steam account to track your CS2 inventory value.</p>
            <a href="/auth/steam" className="steam-login-btn">
              <svg className="steam-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z"/>
              </svg>
              Sign in through Steam
            </a>
          </div>
          <div className="locked-cards-bg">
            {Array.from({length: 12}).map((_, i) => (
              <div key={i} className="locked-card-placeholder" />
            ))}
          </div>
        </div>
      )}

      {view === 'landing' && <div className="center-screen landing">
      <div className="landing-content">
        <h1 className="landing-headline">Track Your CS2<br/>Portfolio for Free</h1>
        <p className="landing-sub">Live Steam market prices, CSFloat data, price alerts, and 90-day portfolio history — for every item in your inventory.</p>
        <div className="landing-cta">
          <button className="landing-btn-primary" onClick={() => setView('dashboard')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
            Dashboard
          </button>
          <button className="landing-btn-secondary" onClick={() => setView('inventory')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
            Portfolio
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <LandingVisual />
    </div>}
    </div>
  )
}
