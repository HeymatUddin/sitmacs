import { useEffect, useState } from 'react'

export default function RequestSoftware({ api, onSubmitted }) {
  const [tab, setTab] = useState('request')
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (tab !== 'history') return

    let cancelled = false

    async function loadRequests() {
      setLoading(true)
      setLoadError('')

      try {
        const data = await api('/software')
        if (!cancelled) setRequests(data.requests)
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadRequests()

    return () => {
      cancelled = true
    }
  }, [api, tab, reload])

  async function submit(event) {
    event.preventDefault()
    setError('')
    setMessage('')

    if (!name.trim() || !reason.trim()) {
      setError('Enter the software name and reason.')
      return
    }

    setSaving(true)

    try {
      const result = await api('/software', {
        body: {
          software_name: name.trim(),
          software_version: version.trim(),
          reason: reason.trim(),
        },
      })

      setName('')
      setVersion('')
      setReason('')
      setMessage(result.message)
      setReload(value => value + 1)
      setTab('history')
      onSubmitted?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <nav className="tabs" aria-label="Software permission sections">
        {[
          ['request', 'Request permission'],
          ['history', 'My requests'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={tab === value ? 'chosen' : ''}
            aria-current={tab === value ? 'page' : undefined}
            disabled={saving}
            onClick={() => {
              setTab(value)
              setError('')
              setMessage('')
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && (
        <p className="message error" role="alert">{error}</p>
      )}

      {message && (
        <p className="message success" role="status">{message}</p>
      )}

      {tab === 'request' ? (
        <section className="panel setup-panel">
          <h2>Request software permission</h2>
          <p>Ask for approval before installing software.</p>

          <form onSubmit={submit}>
            <label htmlFor="software-name">Software name</label>
            <input
              id="software-name"
              value={name}
              onChange={event => setName(event.target.value)}
              maxLength={150}
              placeholder="For example, Visual Studio Code"
              required
              disabled={saving}
            />

            <label htmlFor="software-version">Version (optional)</label>
            <input
              id="software-version"
              value={version}
              onChange={event => setVersion(event.target.value)}
              maxLength={100}
              disabled={saving}
            />

            <label htmlFor="software-reason">Why do you need it?</label>
            <input
              id="software-reason"
              value={reason}
              onChange={event => setReason(event.target.value)}
              maxLength={1000}
              placeholder="Explain your work requirement"
              required
              disabled={saving}
            />

            <button className="primary" type="submit" disabled={saving}>
              {saving ? 'Submitting…' : 'Request permission'}
            </button>
          </form>
        </section>
      ) : (
        <section className="panel table-panel">
          <div className="panel-heading">
            <h2>My software permission requests</h2>
            <button
              type="button"
              className="text-button"
              disabled={loading || saving}
              onClick={() => setReload(value => value + 1)}
            >
              Refresh ↻
            </button>
          </div>

          {loading ? (
            <p className="empty" role="status">Loading requests…</p>
          ) : loadError ? (
            <p className="message error" role="alert">
              {loadError} Use Refresh to try again.
            </p>
          ) : requests.length === 0 ? (
            <p className="empty">You have not requested permission yet.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Software</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Administrator note</th>
                    <th>Requested at</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map(request => (
                    <tr key={request.id}>
                      <td>
                        <strong>{request.software_name}</strong>
                        <small>
                          {request.software_version || 'Version not specified'}
                        </small>
                      </td>
                      <td style={{ whiteSpace: 'normal', minWidth: 200 }}>
                        {request.reason}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            request.status === 'approved' ? 'badge-active' : ''
                          }`}
                        >
                          {request.status}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'normal', minWidth: 200 }}>
                        {request.review_note || 'Awaiting review'}
                      </td>
                      <td>
                        {new Date(request.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  )
}