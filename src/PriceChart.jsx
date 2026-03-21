import { useState, useEffect, useCallback } from 'react'

const STEAM_IMAGE_BASE = 'https://community.akamai.steamstatic.com/economy/image/'

// ── Steam helpers ─────────────────────────────────────────────
function parseLineData(html) {
  const match = html.match(/var line1\s*=\s*(\[[\s\S]*?\]);/)
  if (!match) return null
  try { return JSON.parse(match[1]) } catch { return null }
}

function filterLastMonth(data) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  return data.filter(([dateStr]) => {
    const cleaned = dateStr.replace(/ \d+: \+0$/, '')
    return new Date(cleaned).getTime() >= cutoff
  })
}

function formatSteamDate(dateStr) {
  const d = new Date(dateStr.replace(/ \d+: \+0$/, ''))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── CSFloat helpers ───────────────────────────────────────────
function aggregateCSFloatByDay(sales) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
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

function computeCSFloatStats(sales) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
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

  return { lastPrice, median, soldToday }
}

function formatISODate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Shared SVG chart ──────────────────────────────────────────
function PriceLineChart({ data, color, gradId, formatDateFn }) {
  const [tooltip, setTooltip] = useState(null)

  const W = 580
  const H = 200
  const PAD = { top: 16, right: 16, bottom: 36, left: 56 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom

  const prices = data.map(d => parseFloat(d[1]))
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)
  const range = maxP - minP || 1

  const toX = i => PAD.left + (i / (data.length - 1)) * cW
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
    const svgX = ((e.clientX - rect.left) / rect.width) * W
    const idx = Math.round(((svgX - PAD.left) / cW) * (data.length - 1))
    setTooltip(points[Math.max(0, Math.min(data.length - 1, idx))])
  }, [points, data.length, cW])

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
export default function PriceModal({ item, onClose }) {
  const [steamData, setSteamData] = useState(null)
  const [csfloatData, setCSFloatData] = useState(null)
  const [currentPrice, setCurrentPrice] = useState(null)
  const [csfloatStats, setCSFloatStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [csfloatError, setCSFloatError] = useState(null)

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
      setSteamData(filtered)

      if (Array.isArray(csfloatSales) && csfloatSales.length > 0) {
        const stats = computeCSFloatStats(csfloatSales)
        if (stats) setCSFloatStats(stats)
        const aggregated = aggregateCSFloatByDay(csfloatSales)
        if (aggregated.length >= 2) setCSFloatData(aggregated)
        else setCSFloatError('Not enough CSFloat sales in the past 30 days')
      } else {
        setCSFloatError('No CSFloat sales data available for this item')
      }
    }).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [item.market_hash_name])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="modal-header">
          <img src={`${STEAM_IMAGE_BASE}${item.icon_url}`} alt={item.name} className="modal-icon" />
          <div className="modal-title">
            <h2>{item.market_hash_name || item.name}</h2>
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

          {steamData && (
            <>
              <div className="chart-header">
                <p className="chart-label">Steam Community Market — 30-Day Price (USD)</p>
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
            </>
          )}

          {steamData && (
            <>
              <div className="chart-header chart-header-second">
                <p className="chart-label">CSFloat Marketplace — 30-Day Price (USD)</p>
                {csfloatStats && (
                  <div className="modal-prices">
                    <span className="price-main">${csfloatStats.lastPrice.toFixed(2)}</span>
                    <span className="price-sub">median ${csfloatStats.median.toFixed(2)}</span>
                    <span className="price-vol">{csfloatStats.soldToday.toLocaleString()} sold today</span>
                  </div>
                )}
              </div>
              {csfloatData
                ? <PriceLineChart
                    data={csfloatData}
                    color="#0078D0"
                    gradId="csfloatGrad"
                    formatDateFn={formatISODate}
                  />
                : <p className="chart-unavailable">{csfloatError}</p>
              }
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
            View on Steam Market ↗
          </a>
        </div>
      </div>
    </div>
  )
}
