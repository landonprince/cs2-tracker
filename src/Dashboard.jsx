import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  STEAM_IMAGE_BASE, RARITY_COLORS, RARITY_ORDER, RARITY_LABELS,
  getRarity, stripWear, getItemType, TYPE_ORDER,
} from './constants'

function historyKey(steamId) { return `csassets-history-${steamId}` }

function loadHistory(steamId) {
  try { return JSON.parse(localStorage.getItem(historyKey(steamId)) || '[]') } catch { return [] }
}

function saveSnapshot(steamId, steam, csfloat) {
  const history = loadHistory(steamId)
  const date = new Date().toISOString().slice(0, 10)
  const idx = history.findIndex(s => s.date === date)
  const entry = { date, steam, csfloat }
  if (idx >= 0) history[idx] = entry
  else history.push(entry)
  history.sort((a, b) => a.date.localeCompare(b.date))
  const trimmed = history.slice(-90)
  localStorage.setItem(historyKey(steamId), JSON.stringify(trimmed))
  return trimmed
}

const STEAM_COLOR   = 'var(--accent)'
const CSFLOAT_COLOR = '#f59e0b'

const W = 560, H = 160
const PAD = { top: 12, right: 12, bottom: 26, left: 62 }
const cW = W - PAD.left - PAD.right
const cH = H - PAD.top - PAD.bottom

// ── Dual line chart ─────────────────────────────────────────────
function DualValueLineChart({ steamData, csfloatData }) {
  const [tooltip, setTooltip] = useState(null)

  // Shared y scale across both series
  const allValues = [...steamData.map(d => d.value), ...csfloatData.map(d => d.value)]
  const minV = Math.min(...allValues)
  const maxV = Math.max(...allValues)
  const range = maxV - minV || 1

  const toX = useCallback(i => PAD.left + (i / Math.max(steamData.length - 1, 1)) * cW, [steamData.length])
  const toY = useCallback(v => PAD.top + cH - ((v - minV) / range) * cH, [minV, range])

  const steamPts = useMemo(() => steamData.map((d, i) => ({
    x: toX(i),
    y: toY(d.value),
    steam: d.value,
    csfloat: csfloatData[i]?.value ?? null,
    date: new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  })), [steamData, csfloatData, toX, toY])

  const makeLine = pts => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const makeArea = (pts, linePath) =>
    `${linePath} L${pts.at(-1).x},${PAD.top + cH} L${pts[0].x},${PAD.top + cH}Z`

  const csfloatPts = csfloatData.map((d, i) => ({ x: toX(i), y: toY(d.value) }))

  const steamLine    = makeLine(steamPts)
  const csfloatLine  = makeLine(csfloatPts)
  const steamArea    = makeArea(steamPts, steamLine)
  const csfloatArea  = makeArea(csfloatPts, csfloatLine)

  const yTicks = [0, 1, 2, 3].map(i => ({ val: minV + (range * i) / 3, y: toY(minV + (range * i) / 3) }))
  const xIdxs  = steamData.length <= 5
    ? steamData.map((_, i) => i)
    : [0, Math.floor(steamData.length * 0.25), Math.floor(steamData.length * 0.5), Math.floor(steamData.length * 0.75), steamData.length - 1]
  const xTicks = [...new Set(xIdxs)].map(i => ({ label: steamPts[i].date, x: toX(i) }))

  const handleMouseMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * W
    const idx = Math.max(0, Math.min(steamData.length - 1, Math.round(((svgX - PAD.left) / cW) * (steamData.length - 1))))
    setTooltip(steamPts[idx])
  }, [steamPts, steamData.length])

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="price-svg"
        onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>
        <defs>
          <linearGradient id="dualSteamGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={STEAM_COLOR} stopOpacity="0.18" />
            <stop offset="100%" stopColor={STEAM_COLOR} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="dualCsfloatGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CSFLOAT_COLOR} stopOpacity="0.18" />
            <stop offset="100%" stopColor={CSFLOAT_COLOR} stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map(({ y }, i) => (
          <line key={i} x1={PAD.left} y1={y} x2={PAD.left + cW} y2={y}
            stroke="var(--border)" strokeDasharray="3 4" strokeWidth="1" />
        ))}

        <path d={csfloatArea} fill="url(#dualCsfloatGrad)" />
        <path d={csfloatLine} fill="none" stroke={CSFLOAT_COLOR} strokeWidth="2" strokeLinejoin="round" />
        <path d={steamArea} fill="url(#dualSteamGrad)" />
        <path d={steamLine} fill="none" stroke={STEAM_COLOR} strokeWidth="2" strokeLinejoin="round" />

        {yTicks.map(({ val, y }, i) => (
          <text key={i} x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill="var(--text)">
            ${val.toFixed(2)}
          </text>
        ))}
        {xTicks.map(({ label, x }, i) => (
          <text key={i} x={x} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--text)">
            {label}
          </text>
        ))}

        {tooltip && (
          <>
            <line x1={tooltip.x} y1={PAD.top} x2={tooltip.x} y2={PAD.top + cH}
              stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" opacity="0.8" />
            <circle cx={tooltip.x} cy={tooltip.y} r="4"
              fill={STEAM_COLOR} stroke="var(--bg)" strokeWidth="2" />
            {tooltip.csfloat != null && (
              <circle cx={tooltip.x} cy={toY(tooltip.csfloat)} r="4"
                fill={CSFLOAT_COLOR} stroke="var(--bg)" strokeWidth="2" />
            )}
          </>
        )}
      </svg>

      <div className={`chart-tooltip ${tooltip ? 'visible' : ''}`}>
        {tooltip && (
          <>
            <span className="tt-date">{tooltip.date}</span>
            <span className="tt-price" style={{ color: STEAM_COLOR }}>${tooltip.steam.toFixed(2)}</span>
            {tooltip.csfloat != null && (
              <span className="tt-price" style={{ color: CSFLOAT_COLOR }}>${tooltip.csfloat.toFixed(2)}</span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Dashboard ──────────────────────────────────────────────────
export default function Dashboard({ items, steamPrices, csfloatPrices, steamId, profile, onNavigate }) {
  const [history, setHistory]   = useState(() => loadHistory(steamId))
  const snapshotSaved           = useRef(false)

  const pricesLoaded  = Object.keys(steamPrices).length > 0
  const totalSteam    = items.reduce((s, i) => s + (steamPrices[i.market_hash_name]   ?? 0), 0)
  const totalCsfloat  = items.reduce((s, i) => s + (csfloatPrices[i.market_hash_name] ?? 0), 0)

  // Save snapshot once prices are loaded
  useEffect(() => {
    if (!pricesLoaded || snapshotSaved.current || totalSteam === 0) return
    snapshotSaved.current = true
    const updated = saveSnapshot(steamId, totalSteam, totalCsfloat)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(updated)
  }, [pricesLoaded, totalSteam, totalCsfloat, steamId])

  const topItems = [...items]
    .filter(i => steamPrices[i.market_hash_name] != null)
    .sort((a, b) => steamPrices[b.market_hash_name] - steamPrices[a.market_hash_name])
    .slice(0, 5)

  const rarityCounts = {}
  for (const item of items) {
    const r = getRarity(item)
    if (r) rarityCounts[r] = (rarityCounts[r] ?? 0) + 1
  }

  const steamHistory   = history.map(h => ({ date: h.date, value: h.steam }))
  const csfloatHistory = history.map(h => ({ date: h.date, value: h.csfloat }))

  // Performance metrics from history
  const prevEntry   = history.length >= 2 ? history[history.length - 2] : null
  const firstEntry  = history.length >= 1 ? history[0] : null
  const allTimeSteamHigh = history.length > 0 ? Math.max(...history.map(h => h.steam)) : null

  const change24h     = pricesLoaded && prevEntry ? totalSteam - prevEntry.steam : null
  const change24hPct  = change24h != null && prevEntry.steam > 0 ? (change24h / prevEntry.steam) * 100 : null
  const totalReturn   = pricesLoaded && firstEntry && firstEntry.steam > 0
    ? ((totalSteam - firstEntry.steam) / firstEntry.steam) * 100 : null
  const avgItemValue  = pricesLoaded && items.length > 0 ? totalSteam / items.length : null

  // Value by category
  const categoryValues = {}
  for (const item of items) {
    const type  = getItemType(item)
    const price = steamPrices[item.market_hash_name] ?? 0
    if (type) categoryValues[type] = (categoryValues[type] ?? 0) + price
  }
  const maxCatValue = Math.max(...Object.values(categoryValues), 1)
  const sortedCategories = TYPE_ORDER.filter(t => categoryValues[t] > 0)

  return (
    <div className="dashboard">

      {/* ── Greeting ── */}
      <div className="dash-greeting">
        {profile?.avatar && <img src={profile.avatar} alt="avatar" className="dash-avatar" />}
        <div>
          <h2 className="dash-welcome">
            Welcome back{profile?.name ? `, ${profile.name}` : ''}
          </h2>
          <p className="dash-sub">Here's a snapshot of your CS2 portfolio.</p>
        </div>
      </div>

      {/* ── Key stats ── */}
      <div className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-label">Total Items</span>
          <span className="dash-stat-value">{items.length.toLocaleString()}</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-label">Steam Value</span>
          <span className="dash-stat-value">
            {pricesLoaded ? `$${totalSteam.toFixed(2)}` : <span className="dash-stat-loading">Loading…</span>}
          </span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-label">CSFloat Value</span>
          <span className="dash-stat-value">
            {pricesLoaded ? `$${totalCsfloat.toFixed(2)}` : <span className="dash-stat-loading">Loading…</span>}
          </span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-label">Unique Skins</span>
          <span className="dash-stat-value">
            {new Set(items.map(i => i.market_hash_name)).size.toLocaleString()}
          </span>
        </div>
      </div>

      {/* ── Performance stats ── */}
      <div className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-label">24h Change</span>
          <span className={`dash-stat-value dash-stat-perf ${change24h == null ? '' : change24h >= 0 ? 'perf-up' : 'perf-down'}`}>
            {change24h == null
              ? <span className="dash-stat-loading">—</span>
              : <>
                  {change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}
                  <span className="dash-stat-pct">{change24hPct >= 0 ? '+' : ''}{change24hPct.toFixed(1)}%</span>
                </>
            }
          </span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-label">All-Time High</span>
          <span className="dash-stat-value">
            {pricesLoaded && allTimeSteamHigh != null
              ? `$${allTimeSteamHigh.toFixed(2)}`
              : <span className="dash-stat-loading">Loading…</span>}
          </span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-label">Total Return</span>
          <span className={`dash-stat-value dash-stat-perf ${totalReturn == null ? '' : totalReturn >= 0 ? 'perf-up' : 'perf-down'}`}>
            {totalReturn == null
              ? <span className="dash-stat-loading">—</span>
              : <>{totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(1)}%</>
            }
          </span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-label">Avg Item Value</span>
          <span className="dash-stat-value">
            {avgItemValue != null
              ? `$${avgItemValue.toFixed(2)}`
              : <span className="dash-stat-loading">Loading…</span>}
          </span>
        </div>
      </div>

      {/* ── Value chart ── */}
      <div className="dash-section">
        <div className="dash-section-header">
          <h3 className="dash-section-title">Portfolio Value</h3>
          {pricesLoaded && steamHistory.length > 0 && (
            <div className="dash-chart-legend">
              <span className="dash-legend-item">
                <span className="dash-legend-dot" style={{ background: 'var(--accent)' }} />
                Steam <strong>${totalSteam.toFixed(2)}</strong>
              </span>
              <span className="dash-legend-item">
                <span className="dash-legend-dot" style={{ background: '#f59e0b' }} />
                CSFloat <strong>${totalCsfloat.toFixed(2)}</strong>
              </span>
            </div>
          )}
        </div>
        {steamHistory.length >= 2 ? (
          <DualValueLineChart steamData={steamHistory} csfloatData={csfloatHistory} />
        ) : (
          <p className="dash-chart-empty">
            {pricesLoaded
              ? 'Come back tomorrow — your first data point has been saved.'
              : 'Loading prices…'}
          </p>
        )}
      </div>

      {/* ── Value by Category ── */}
      {pricesLoaded && sortedCategories.length > 0 && (
        <div className="dash-section">
          <div className="dash-section-header">
            <h3 className="dash-section-title">Value by Category</h3>
          </div>
          <div className="dash-cat-list">
            {sortedCategories.map(type => (
              <div className="dash-cat-row" key={type}>
                <span className="dash-cat-label">{type}</span>
                <div className="dash-cat-track">
                  <div
                    className="dash-cat-fill"
                    style={{ width: `${(categoryValues[type] / maxCatValue) * 100}%` }}
                  />
                </div>
                <span className="dash-cat-value">${categoryValues[type].toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dash-columns">
        {/* ── Top items ── */}
        <div className="dash-section">
          <div className="dash-section-header">
            <h3 className="dash-section-title">Top Items by Value</h3>
            <button className="dash-section-link" onClick={() => onNavigate('inventory')}>
              View all →
            </button>
          </div>
          {pricesLoaded ? (
            <div className="dash-top-items">
              {topItems.map((item, idx) => {
                const rarity = getRarity(item)
                const color  = RARITY_COLORS[rarity] ?? '#6b6375'
                const price  = steamPrices[item.market_hash_name]
                return (
                  <div className="dash-top-item" key={item.assetid} style={{ '--rarity': color }}>
                    <span className="dash-top-rank">#{idx + 1}</span>
                    <img
                      src={`${STEAM_IMAGE_BASE}${item.icon_url}`}
                      alt={item.name}
                      className="dash-top-img"
                    />
                    <span className="dash-top-name">{stripWear(item.market_hash_name || item.name)}</span>
                    <span className="dash-top-price">${price.toFixed(2)}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="dash-loading-msg">Loading prices…</p>
          )}
        </div>

        {/* ── Rarity breakdown ── */}
        <div className="dash-section">
          <div className="dash-section-header">
            <h3 className="dash-section-title">Rarity Breakdown</h3>
          </div>
          <div className="dash-rarity">
            {RARITY_ORDER.filter(r => rarityCounts[r]).map(r => (
              <div className="dash-rarity-row" key={r}>
                <span className="dash-rarity-label" style={{ color: RARITY_COLORS[r] }}>
                  {RARITY_LABELS[r]}
                </span>
                <div className="dash-rarity-track">
                  <div
                    className="dash-rarity-fill"
                    style={{ width: `${(rarityCounts[r] / items.length) * 100}%`, background: RARITY_COLORS[r] }}
                  />
                </div>
                <span className="dash-rarity-count">{rarityCounts[r]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  )
}
