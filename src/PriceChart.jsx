import { useState, useEffect, useCallback } from 'react'
import { STEAM_IMAGE_BASE, stripWear, getWear, parseLineData, formatSteamDate } from './constants'

// ── Steam helpers ─────────────────────────────────────────────

function filterLastMonth(data) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  return data.filter(([dateStr]) => {
    const cleaned = dateStr.replace(/ \d+: \+0$/, '')
    return new Date(cleaned).getTime() >= cutoff
  })
}

function filterLastWeek(data) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  return data.filter(([dateStr]) => {
    const cleaned = dateStr.replace(/ \d+: \+0$/, '')
    return new Date(cleaned).getTime() >= cutoff
  })
}

// ── CSFloat helpers ───────────────────────────────────────────
function aggregateCSFloatByDay(sales, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const byDay = {}
  for (const sale of sales) {
    if (new Date(sale.sold_at).getTime() < cutoff) continue
    const day = sale.sold_at.slice(0, 10)
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(sale.price / 100)
  }
  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, prices]) => [
      day,
      prices.reduce((s, p) => s + p, 0) / prices.length,
      prices.length,
    ])
}

function computeCSFloatStats(sales, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const recent = sales.filter(s => new Date(s.sold_at).getTime() >= cutoff)
  if (recent.length === 0) return null

  const today = new Date().toISOString().slice(0, 10)
  const soldToday = sales.filter(s => s.sold_at.slice(0, 10) === today).length

  const sorted = [...recent].sort((a, b) => new Date(b.sold_at) - new Date(a.sold_at))
  const lastPrice = sorted[0].price / 100

  const prices = recent.map(s => s.price / 100).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  const median = prices.length % 2 === 0
    ? (prices[mid - 1] + prices[mid]) / 2
    : prices[mid]

  const high = prices[prices.length - 1]
  const low = prices[0]

  // unique days with sales
  const days30 = new Set(recent.map(s => s.sold_at.slice(0, 10))).size
  const avgDailyVol = days30 > 0 ? (recent.length / days30).toFixed(1) : null

  // % change: oldest to newest sale in the window
  const chronological = [...recent].sort((a, b) => new Date(a.sold_at) - new Date(b.sold_at))
  const firstPrice = chronological[0].price / 100
  const changePct = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : null

  return { lastPrice, median, soldToday, count: recent.length, high, low, avgDailyVol, changePct }
}

function computeSteamStats(data) {
  if (!data || data.length < 2) return null
  const prices = data.map(d => parseFloat(d[1]))
  const vols = data.map(d => parseFloat(d[2]) || 0)
  const high = Math.max(...prices)
  const low = Math.min(...prices)
  const first = prices[0]
  const last = prices[prices.length - 1]
  const changePct = first > 0 ? ((last - first) / first) * 100 : null
  const totalVol = vols.reduce((s, v) => s + v, 0)
  const avgDailyVol = data.length > 0 ? (totalVol / data.length).toFixed(0) : null
  return { high, low, changePct, avgDailyVol }
}

function formatISODate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Shared SVG chart ──────────────────────────────────────────
const CHART_W = 580
const CHART_H = 200
const CHART_PAD = { top: 16, right: 16, bottom: 36, left: 56 }
const CHART_CW = CHART_W - CHART_PAD.left - CHART_PAD.right
const CHART_CH = CHART_H - CHART_PAD.top - CHART_PAD.bottom

function PriceLineChart({ data, color, gradId, formatDateFn }) {
  const [tooltip, setTooltip] = useState(null)

  const W = CHART_W
  const H = CHART_H
  const PAD = CHART_PAD
  const cW = CHART_CW
  const cH = CHART_CH

  const prices = data.map(d => parseFloat(d[1]))
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)
  const range = maxP - minP || 1

  const toX = i => PAD.left + (i / Math.max(data.length - 1, 1)) * cW
  const toY = p => PAD.top + cH - ((p - minP) / range) * cH

  const points = data.map((d, i) => ({
    x: toX(i),
    y: toY(parseFloat(d[1])),
    price: parseFloat(d[1]),
    date: formatDateFn(d[0]),
    vol: d[2],
  }))

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = `${linePath} L${points.at(-1).x},${PAD.top + cH} L${points[0].x},${PAD.top + cH}Z`

  const yTicks = [0, 1, 2, 3].map(i => {
    const val = minP + (range * i) / 3
    return { val, y: toY(val) }
  })

  const xIdxs = [0, Math.floor(data.length * 0.25), Math.floor(data.length * 0.5), Math.floor(data.length * 0.75), data.length - 1]
  const xTicks = [...new Set(xIdxs)].map(i => ({ label: formatDateFn(data[i][0]), x: toX(i) }))

  const handleMouseMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * CHART_W
    const idx = Math.round(((svgX - CHART_PAD.left) / CHART_CW) * (data.length - 1))
    setTooltip(points[Math.max(0, Math.min(data.length - 1, idx))])
  }, [points, data.length])

  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="price-svg"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map(({ y }, i) => (
          <line key={i} x1={PAD.left} y1={y} x2={PAD.left + cW} y2={y}
            stroke="var(--border)" strokeDasharray="3 4" strokeWidth="1" />
        ))}

        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />

        {yTicks.map(({ val, y }, i) => (
          <text key={i} x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize="11" fill="var(--text)">
            ${val.toFixed(2)}
          </text>
        ))}

        {xTicks.map(({ label, x }, i) => (
          <text key={i} x={x} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--text)">
            {label}
          </text>
        ))}

        {tooltip && (
          <>
            <line x1={tooltip.x} y1={PAD.top} x2={tooltip.x} y2={PAD.top + cH}
              stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            <circle cx={tooltip.x} cy={tooltip.y} r="4"
              fill={color} stroke="var(--bg)" strokeWidth="2" />
          </>
        )}
      </svg>

      <div className={`chart-tooltip ${tooltip ? 'visible' : ''}`}>
        {tooltip && (
          <>
            <span className="tt-date">{tooltip.date}</span>
            <span className="tt-price" style={{ color }}>${tooltip.price.toFixed(2)}</span>
            <span className="tt-vol">{Number(tooltip.vol).toLocaleString()} sold</span>
          </>
        )}
      </div>
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────
export default function PriceModal({ item, onClose, onOpenAlert }) {
  const [rawSteamData, setRawSteamData] = useState(null)
  const [steamWindow, setSteamWindow] = useState('30d')
  const [rawCsfloatSales, setRawCsfloatSales] = useState(null)
  const [currentPrice, setCurrentPrice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [csfloatError, setCsfloatError] = useState(null)

  const steamData    = rawSteamData
    ? (steamWindow === '7d' ? filterLastWeek(rawSteamData) : filterLastMonth(rawSteamData))
    : null
  const steamStats   = computeSteamStats(steamData)
  const csfloatData  = rawCsfloatSales ? aggregateCSFloatByDay(rawCsfloatSales) : null
  const csfloatStats = rawCsfloatSales ? computeCSFloatStats(rawCsfloatSales) : null

  useEffect(() => {
    const name = encodeURIComponent(item.market_hash_name)

    Promise.all([
      fetch(`/steam-market/priceoverview/?currency=1&appid=730&market_hash_name=${name}`)
        .then(r => r.json()).catch(() => null),
      fetch(`/steam-market/listings/730/${name}`)
        .then(r => r.text()),
      fetch(`/csfloat/history/${name}/sales`)
        .then(r => r.ok ? r.json() : Promise.reject(r.status)).catch(() => null),
    ]).then(([priceData, html, csfloatSales]) => {
      if (priceData?.success) setCurrentPrice(priceData)

      const raw = parseLineData(html)
      if (!raw || raw.length === 0) throw new Error('No price history available for this item')
      const filtered = filterLastMonth(raw)
      if (filtered.length < 2) throw new Error('Not enough data for the past 30 days')
      setRawSteamData(raw)

      if (Array.isArray(csfloatSales) && csfloatSales.length > 0) {
        setRawCsfloatSales(csfloatSales)
      } else {
        setCsfloatError('No CSFloat sales data available for this item')
      }
    }).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [item.market_hash_name])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="modal-header">
          <img src={`${STEAM_IMAGE_BASE}${item.icon_url}`} alt={item.name} className="modal-icon" />
          <div className="modal-title">
            <div className="modal-title-row">
              <h2>{stripWear(item.market_hash_name || item.name)}</h2>
              {onOpenAlert && (
                <button className="modal-alert-btn" onClick={() => onOpenAlert(item)} title="Set Price Alert">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                  Set Alert
                </button>
              )}
            </div>
            {getWear(item) && <span className="item-wear">{getWear(item)}</span>}
          </div>
        </div>

        <div className="modal-body">
          {loading && (
            <div className="chart-loading">
              <div className="spinner" />
              <span>Loading price history…</span>
            </div>
          )}
          {error && <p className="error modal-error">{error}</p>}

          {rawSteamData && (
            <>
              <div className="chart-header">
                <p className="chart-label">
                  <svg className="chart-label-logo" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z"/>
                  </svg>
                  Steam Community Market <span className="chart-label-currency">USD</span>
                </p>
                {currentPrice && (
                  <div className="modal-prices">
                    <span className="price-main">{currentPrice.lowest_price}</span>
                    <span className="price-sub">median {currentPrice.median_price}</span>
                    <span className="price-vol">{Number(currentPrice.volume).toLocaleString()} sold today</span>
                  </div>
                )}
              </div>
              <PriceLineChart
                data={steamData}
                color="var(--accent)"
                gradId="steamGrad"
                formatDateFn={formatSteamDate}
              />
              <div className="chart-window-btns">
                {['7d', '30d'].map(w => (
                  <button
                    key={w}
                    className={`chart-window-btn ${steamWindow === w ? 'active' : ''}`}
                    onClick={() => setSteamWindow(w)}
                  >{w.toUpperCase()}</button>
                ))}
              </div>
              {steamStats && (
                <div className="item-stats-row">
                  <div className="item-stat">
                    <span className="item-stat-label">Change</span>
                    <span className={`item-stat-value ${steamStats.changePct == null ? '' : steamStats.changePct >= 0 ? 'stat-up' : 'stat-down'}`}>
                      {steamStats.changePct == null ? '—' : `${steamStats.changePct >= 0 ? '+' : ''}${steamStats.changePct.toFixed(1)}%`}
                    </span>
                  </div>
                  <div className="item-stat">
                    <span className="item-stat-label">High</span>
                    <span className="item-stat-value">${steamStats.high.toFixed(2)}</span>
                  </div>
                  <div className="item-stat">
                    <span className="item-stat-label">Low</span>
                    <span className="item-stat-value">${steamStats.low.toFixed(2)}</span>
                  </div>
                  <div className="item-stat">
                    <span className="item-stat-label">Avg Daily Vol</span>
                    <span className="item-stat-value">{steamStats.avgDailyVol ?? '—'}</span>
                  </div>
                </div>
              )}
            </>
          )}

          {rawSteamData && (
            <>
              <div className="chart-header chart-header-second">
                <p className="chart-label">
                  <img className="chart-label-logo" src="https://csfloat.com/favicon.ico" alt="CSFloat" />
                  CSFloat Market <span className="chart-label-currency">USD</span>
                </p>
                {csfloatStats && (
                  <div className="modal-prices">
                    <span className="price-main">${csfloatStats.lastPrice.toFixed(2)}</span>
                    <span className="price-sub">median ${csfloatStats.median.toFixed(2)}</span>
                    <span className="price-vol">{csfloatStats.soldToday.toLocaleString()} sold today</span>
                  </div>
                )}
              </div>
              {csfloatData && csfloatData.length >= 2
                ? <PriceLineChart
                    data={csfloatData}
                    color="#0078D0"
                    gradId="csfloatGrad"
                    formatDateFn={formatISODate}
                  />
                : <p className="chart-unavailable">{csfloatError ?? 'Not enough recent CSFloat sales'}</p>
              }
              {csfloatStats && (
                <div className="item-stats-row">
                  <div className="item-stat">
                    <span className="item-stat-label">Change</span>
                    <span className={`item-stat-value ${csfloatStats.changePct == null ? '' : csfloatStats.changePct >= 0 ? 'stat-up' : 'stat-down'}`}>
                      {csfloatStats.changePct == null ? '—' : `${csfloatStats.changePct >= 0 ? '+' : ''}${csfloatStats.changePct.toFixed(1)}%`}
                    </span>
                  </div>
                  <div className="item-stat">
                    <span className="item-stat-label">High</span>
                    <span className="item-stat-value">${csfloatStats.high.toFixed(2)}</span>
                  </div>
                  <div className="item-stat">
                    <span className="item-stat-label">Low</span>
                    <span className="item-stat-value">${csfloatStats.low.toFixed(2)}</span>
                  </div>
                  <div className="item-stat">
                    <span className="item-stat-label">Avg Daily Vol</span>
                    <span className="item-stat-value">{csfloatStats.avgDailyVol ?? '—'}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <a
            href={`https://steamcommunity.com/market/listings/730/${encodeURIComponent(item.market_hash_name)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline"
          >
            <svg className="btn-logo" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z"/>
            </svg>
            View on Steam Market ↗
          </a>
          <a
            href={`https://csfloat.com/search?market_hash_name=${encodeURIComponent(item.market_hash_name)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline"
          >
            <img className="btn-logo" src="https://csfloat.com/favicon.ico" alt="" />
            View on CSFloat Market ↗
          </a>
        </div>

      </div>
    </div>

    </>
  )
}
