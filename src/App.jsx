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

function parseSteamId(input) {
  const trimmed = input.trim()
  if (/^\d{17}$/.test(trimmed)) return trimmed
  const match = trimmed.match(/steamcommunity\.com\/profiles\/(\d{17})/)
  if (match) return match[1]
  return null
}

function getRarity(item) {
  return item.tags?.find(t => t.category === 'Rarity')?.internal_name ?? null
}

export default function App() {
  const [profileInput, setProfileInput] = useState('')
  const [steamId, setSteamId] = useState(null)

  useEffect(() => {
    const devId = import.meta.env.VITE_DEV_STEAM_ID
    if (devId) fetchInventory(devId)
  }, [])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)

  async function fetchInventory(id) {
    setLoading(true)
    setError(null)
    try {
      const allAssets = []
      const descMap = {}
      let lastAssetId = null

      // Steam caps count at 2000; paginate with start_assetid for larger inventories
      while (true) {
        const url = lastAssetId
          ? `/steam-inventory/${id}/730/2?l=english&count=2000&start_assetid=${lastAssetId}`
          : `/steam-inventory/${id}/730/2?l=english&count=2000`

        const res = await fetch(url)
        if (!res.ok) throw new Error(`Steam returned ${res.status} — check that your inventory is set to Public in Steam privacy settings`)
        const data = await res.json()

        if (!data.assets || !data.descriptions) {
          if (allAssets.length === 0) throw new Error('Inventory is empty or set to private on Steam')
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

  function handleSubmit(e) {
    e.preventDefault()
    const id = parseSteamId(profileInput)
    if (!id) {
      setError(
        'Enter a Steam64 ID (17 digits) or a profile URL like steamcommunity.com/profiles/76561198...\n' +
        'Custom URLs (steamcommunity.com/id/...) are not supported — use your numeric profile URL.'
      )
      return
    }
    fetchInventory(id)
  }

  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" />
        <p>Loading inventory…</p>
      </div>
    )
  }

  if (steamId) {
    return (
      <div className="inventory-page">
        <header className="inv-header">
          <h1>CS2 Inventory</h1>
          <div className="inv-meta">
            <span className="item-count">{items.length} items</span>
            <button className="btn-outline" onClick={() => { setSteamId(null); setItems([]) }}>
              Change Profile
            </button>
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
                    {item.tags?.find(t => t.category === 'Exterior') && (
                      <span className="item-wear">
                        {item.tags.find(t => t.category === 'Exterior').localized_tag_name}
                      </span>
                    )}
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
      <h1>CS2 Skin Tracker</h1>
      <p className="subtitle">Enter your Steam profile to view your CS2 inventory</p>

      <form className="profile-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={profileInput}
          onChange={e => { setProfileInput(e.target.value); setError(null) }}
          placeholder="Steam64 ID or steamcommunity.com/profiles/..."
          autoFocus
        />
        <button type="submit" className="btn-primary">Load Inventory</button>
      </form>

      {error && <p className="error">{error}</p>}

      <p className="hint">Your Steam inventory must be set to <strong>Public</strong></p>
    </div>
  )
}
