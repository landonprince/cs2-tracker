import { useState } from 'react'

export default function SettingsPage({ steamId, onBack, onClearAlerts }) {
  const [notifPermission, setNotifPermission] = useState(() => Notification.permission)
  const [cleared, setCleared] = useState({})

  function flash(key) {
    setCleared(prev => ({ ...prev, [key]: true }))
    setTimeout(() => setCleared(prev => ({ ...prev, [key]: false })), 1800)
  }

  function clearHistory() {
    localStorage.removeItem(`csassets-history-${steamId}`)
    flash('history')
  }

  function clearSnapshots() {
    localStorage.removeItem(`csassets-item-prices-${steamId}`)
    flash('snapshots')
  }

  function clearAlerts() {
    onClearAlerts()
    flash('alerts')
  }

  function clearAll() {
    localStorage.removeItem(`csassets-history-${steamId}`)
    localStorage.removeItem(`csassets-item-prices-${steamId}`)
    onClearAlerts()
    flash('all')
  }

  async function requestNotifications() {
    const result = await Notification.requestPermission()
    setNotifPermission(result)
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back-btn" onClick={onBack}>
          <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Profile
        </button>
        <h2 className="settings-title">Settings</h2>
      </div>

      {/* ── Notifications ── */}
      <div className="settings-section">
        <h3 className="profile-section-title">Notifications</h3>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Price Alert Notifications</span>
              <span className="settings-row-desc">Browser notifications when an alert triggers</span>
            </div>
            {notifPermission === 'granted' ? (
              <span className="settings-status-badge enabled">Enabled</span>
            ) : notifPermission === 'denied' ? (
              <span className="settings-status-badge denied">Blocked by browser</span>
            ) : (
              <button className="btn-outline settings-action-btn" onClick={requestNotifications}>
                Enable
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Data management ── */}
      <div className="settings-section">
        <h3 className="profile-section-title">Data Management</h3>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Portfolio History</span>
              <span className="settings-row-desc">Daily value chart data on the dashboard</span>
            </div>
            <button className="btn-outline settings-action-btn settings-danger-btn" onClick={clearHistory}>
              {cleared.history ? '✓ Cleared' : 'Clear'}
            </button>
          </div>
          <div className="settings-row-divider" />
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Price Change Data</span>
              <span className="settings-row-desc">Yesterday's prices used for % change badges</span>
            </div>
            <button className="btn-outline settings-action-btn settings-danger-btn" onClick={clearSnapshots}>
              {cleared.snapshots ? '✓ Cleared' : 'Clear'}
            </button>
          </div>
          <div className="settings-row-divider" />
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Price Alerts</span>
              <span className="settings-row-desc">All configured alert rules</span>
            </div>
            <button className="btn-outline settings-action-btn settings-danger-btn" onClick={clearAlerts}>
              {cleared.alerts ? '✓ Cleared' : 'Clear'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Danger zone ── */}
      <div className="settings-section">
        <h3 className="profile-section-title">Danger Zone</h3>
        <div className="settings-card settings-danger-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Clear All Local Data</span>
              <span className="settings-row-desc">Removes all cached history, snapshots, and alerts</span>
            </div>
            <button className="btn-outline settings-action-btn settings-danger-btn settings-danger-btn--strong" onClick={clearAll}>
              {cleared.all ? '✓ Cleared' : 'Clear All'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
