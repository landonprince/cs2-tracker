import {
  STEAM_IMAGE_BASE, RARITY_COLORS, RARITY_ORDER, RARITY_LABELS,
  stripWear, countByRarity,
} from './constants'

export default function ProfilePage({ items, steamPrices, csfloatPrices, steamId, profile, onLogout, onSettings }) {

  const steamValues  = items.map(i => steamPrices[i.market_hash_name]).filter(v => v != null)
  const csfloatValues = items.map(i => csfloatPrices[i.market_hash_name]).filter(v => v != null)
  const totalSteam   = steamValues.reduce((s, v) => s + v, 0)
  const totalCsfloat = csfloatValues.reduce((s, v) => s + v, 0)

  const mostValuable = items.reduce((best, item) => {
    const price = steamPrices[item.market_hash_name]
    if (price == null) return best
    return (!best || price > steamPrices[best.market_hash_name]) ? item : best
  }, null)

  const rarityCounts = countByRarity(items)

  const pricesLoaded = Object.keys(steamPrices).length > 0

  return (
    <div className="profile-page">
      {/* ── Hero ── */}
      <div className="profile-hero">
        {profile?.avatar
          ? <img src={profile.avatar} alt="avatar" className="profile-avatar" />
          : <div className="profile-avatar-placeholder" />
        }
        <div className="profile-hero-info">
          <h2 className="profile-name">{profile?.name ?? '—'}</h2>
          <span className="profile-steamid">Steam ID: {steamId}</span>
          <div className="profile-hero-actions">
            <a
              href={`https://steamcommunity.com/profiles/${steamId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline profile-link"
            >
              View Steam Profile ↗
            </a>
            <button className="btn-outline" onClick={onSettings}>Settings</button>
            <button className="btn-outline" onClick={onLogout}>Sign Out</button>
          </div>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="profile-stats">
        <div className="stat-card">
          <span className="stat-label">Total Items</span>
          <span className="stat-value">{items.length.toLocaleString()}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Steam Value</span>
          <span className="stat-value">
            {pricesLoaded ? `$${totalSteam.toFixed(2)}` : <span className="stat-loading">Loading…</span>}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">CSFloat Value</span>
          <span className="stat-value">
            {pricesLoaded ? `$${totalCsfloat.toFixed(2)}` : <span className="stat-loading">Loading…</span>}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Most Valuable</span>
          {mostValuable ? (
            <>
              <span className="stat-value">${steamPrices[mostValuable.market_hash_name].toFixed(2)}</span>
              <span className="stat-sub">
                {stripWear(mostValuable.market_hash_name)}
              </span>
            </>
          ) : (
            <span className="stat-value"><span className="stat-loading">Loading…</span></span>
          )}
        </div>
      </div>

      {/* ── Rarity breakdown ── */}
      <div className="profile-section">
        <h3 className="profile-section-title">Rarity Breakdown</h3>
        <div className="rarity-breakdown">
          {RARITY_ORDER.filter(r => rarityCounts[r]).map(r => (
            <div className="rarity-row" key={r}>
              <span className="rarity-row-label" style={{ color: RARITY_COLORS[r] }}>{RARITY_LABELS[r]}</span>
              <div className="rarity-bar-track">
                <div
                  className="rarity-bar-fill"
                  style={{
                    width: `${(rarityCounts[r] / items.length) * 100}%`,
                    background: RARITY_COLORS[r],
                  }}
                />
              </div>
              <span className="rarity-row-count">{rarityCounts[r]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Most valuable items ── */}
      {pricesLoaded && (
        <div className="profile-section">
          <h3 className="profile-section-title">Top Items by Steam Price</h3>
          <div className="top-items">
            {[...items]
              .filter(i => steamPrices[i.market_hash_name] != null)
              .sort((a, b) => steamPrices[b.market_hash_name] - steamPrices[a.market_hash_name])
              .slice(0, 5)
              .map(item => (
                <div className="top-item" key={item.assetid}>
                  <img
                    src={`${STEAM_IMAGE_BASE}${item.icon_url}`}
                    alt={item.name}
                    className="top-item-img"
                  />
                  <span className="top-item-name">
                    {stripWear(item.market_hash_name)}
                  </span>
                  <span className="top-item-price">${steamPrices[item.market_hash_name].toFixed(2)}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
