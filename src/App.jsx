import { useState, useEffect } from 'react'
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

function getRarity(item) {
  const internal = item.tags?.find(t => t.category === 'Rarity')?.internal_name ?? null
  return internal?.replace(/_(Weapon|Character|Equipment)$/, '') ?? null
}

export default function App() {
  const [steamId, setSteamId]           = useState(null)
  const [items, setItems]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)

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
        if (!res.ok) throw new Error(`Steam returned ${res.status} — make sure your inventory is Public`)
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

      const merged = allAssets.map(asset => ({
        ...descMap[`${asset.classid}_${asset.instanceid}`],
        assetid: asset.assetid,
      }))

      setItems(merged)
      setSteamId(id)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleLogout() {
    fetch('/auth/logout', { method: 'POST' })
      .then(() => { setSteamId(null); setItems([]) })
  }

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
          <h1>CS<span style={{color:'var(--accent)'}}>Assets</span></h1>
          <div className="inv-meta">
            <span className="item-count">{items.length} items</span>
            <button className="btn-outline" onClick={handleLogout}>Sign Out</button>
          </div>
        </header>

        {items.length === 0 ? (
          <p className="empty">No CS2 items found in this inventory.</p>
        ) : (
          <div className="inventory-grid">
            {items.map(item => {
              const rarity = getRarity(item)
              const color = RARITY_COLORS[rarity] ?? '#6b6375'
              const marketable = item.marketable === 1
              const wear = item.tags?.find(t => t.category === 'Exterior')
              return (
                <div
                  key={item.assetid}
                  className={`item-card${marketable ? ' marketable' : ''}`}
                  style={{ '--rarity': color }}
                  onClick={marketable ? () => setSelectedItem(item) : undefined}
                  title={marketable ? 'Click to view price history' : undefined}
                >
                  <div className="item-img-wrap">
                    <img
                      src={`${STEAM_IMAGE_BASE}${item.icon_url}`}
                      alt={item.name}
                      loading="lazy"
                    />
                  </div>
                  <div className="item-info">
                    <span className="item-name">{item.market_hash_name || item.name}</span>
                    {wear && <span className="item-wear">{wear.localized_tag_name}</span>}
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
      <div className="landing-badge">CS2 Inventory Tracker</div>
      <h1 className="landing-title">CS<span className="landing-accent">Assets</span></h1>
      <p className="landing-sub">Track your CS2 inventory value and market prices in one place.</p>

      <a href="/auth/steam" className="steam-login-btn">
        <img
          src="https://community.cloudflare.steamstatic.com/public/images/signinthroughsteam/sits_01.png"
          alt="Sign in through Steam"
        />
      </a>

      {error && <p className="error">{error}</p>}

      <p className="hint">Inventory must be set to <strong>Public</strong> on Steam</p>

      <div className="landing-features">
        <div className="landing-feature">
          <span className="feature-icon">📦</span>
          <span>Full inventory overview</span>
        </div>
        <div className="landing-feature">
          <span className="feature-icon">📈</span>
          <span>30-day price charts</span>
        </div>
        <div className="landing-feature">
          <span className="feature-icon">🔁</span>
          <span>Steam &amp; CSFloat data</span>
        </div>
      </div>
    </div>
  )
}
