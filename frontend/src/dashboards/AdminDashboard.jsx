import { useEffect, useState } from 'react'
import SharedDashboard from './SharedDashboard.jsx'

export default function AdminDashboard({ user, api, requestedView, onNavigate, }) {
  if (requestedView && requestedView !== 'overview') {
    return (
      <SharedDashboard
        user={user}
        api={api}
        requestedView={requestedView}
      />
    )
  }

  return <AdminOverview api={api} onNavigate={onNavigate} />
}

function AdminOverview({ api, onNavigate }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function loadSummary() {
      setLoading(true)
      setError('')

      try {
        const data = await api('/dashboard/admin-summary')

        if (!cancelled) {
          setSummary(data.summary)
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadSummary()

    return () => {
      cancelled = true
    }
  }, [api, reload])

  const cards = [
    ['Total users', summary?.total_users, 'All system accounts'],
    ['Pending accounts', summary?.pending_accounts, 'Awaiting your decision'],
    ['Total devices', summary?.total_devices, 'Registered organisation devices'],
    ['Pending file requests', summary?.pending_file_requests, 'Awaiting your decision'],
  ]

  return (
    <section style={{ marginTop: 28 }}>
      <div className="panel-heading" style={{ padding: '0 0 18px' }}>
        <h2>Administration overview</h2>

        <button
          type="button"
          className="text-button"
          disabled={loading}
          onClick={() => setReload(value => value + 1)}
        >
          Refresh ↻
        </button>
      </div>

      {loading ? (
        <p className="empty" role="status">
          Loading dashboard…
        </p>
      ) : error ? (
        <p className="message error" role="alert">
          {error} Use Refresh to try again.
        </p>
      ) : summary ? (
        <div className="summary-grid" style={{ marginTop: 20 }}>
          {cards.map(([title, value, description]) => (
            <section className="panel" key={title}>
              <span className="step-label">{title}</span>

              <h2 style={{ fontSize: 36, color: '#174854' }}>
                {value}
              </h2>

              <p>{description}</p>
            </section>
          ))}
        </div>
      ) : null}

      <section className="panel" style={{ marginTop: 24 }}>
        <h2>Quick actions</h2>
        <p>Open a workspace section to manage your organisation.</p>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            marginTop: 18,
          }}
        >
          {[
            ['users', 'User management'],
            ['files', 'Manage files'],
            ['devices', 'Device inventory'],
            ['audit', 'Audit activity'],
          ].map(([page, label]) => (
            <button
              key={page}
              type="button"
              className="primary"
              style={{ width: 'auto', marginTop: 0 }}
              onClick={() => onNavigate(page)}
            >
              {label}
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>
    </section>
  )
}