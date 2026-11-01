import { useEffect, useState } from 'react'

export default function SoftwareRequests({ api }) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  const [filter, setFilter] = useState('pending')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      try {
        const data = await api('/software')
        if (!cancelled) setRequests(data.requests)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [api, reload])

  async function decide(request, decision) {
    const note = window.prompt(
      `${decision === 'approve' ? 'Approve' : 'Reject'} permission for ${
        request.software_name
      }: enter a review note.`
    )

    if (note === null) return

    setError('')
    setMessage('')

    if (!note.trim() || note.length > 1000) {
      setError('Enter a review note using 1–1000 characters.')
      return
    }

    setSaving(true)

    try {
      const result = await api(`/software/${request.id}/decision`, {
        body: { decision, review_note: note.trim() },
      })
      setMessage(result.message)
      setReload(value => value + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const visible = requests.filter(
    request => filter === 'all' || request.status === 'pending'
  )

  return (
    <>
      <nav className="tabs" aria-label="Software permission filters">
        {[
          ['pending', 'Pending'],
          ['all', 'All requests'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={filter === value ? 'chosen' : ''}
            disabled={saving}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && <p className="message error" role="alert">{error}</p>}
      {message && (
        <p className="message success" role="status">{message}</p>
      )}

      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>Software installation permissions</h2>
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
        ) : error ? (
          <p className="empty">Use Refresh to try again.</p>
        ) : visible.length === 0 ? (
          <p className="empty">No requests to display.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Requested by</th>
                  <th>Software</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Review note</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(request => (
                  <tr key={request.id}>
                    <td>
                      <strong>{request.requester_name}</strong>
                      <small>{request.requester_user_id}</small>
                    </td>
                    <td>
                      {request.software_name}
                      <small>{request.software_version || 'Version not specified'}</small>
                    </td>
                    <td style={{ whiteSpace: 'normal', minWidth: 200 }}>
                      {request.reason}
                    </td>
                    <td>
                      <span className="badge">{request.status}</span>
                    </td>
                    <td style={{ whiteSpace: 'normal', minWidth: 180 }}>
                      {request.review_note || '—'}
                    </td>
                    <td>
                      {request.status === 'pending' ? (
                        <div className="row-actions">
                          <button
                            type="button"
                            disabled={saving || loading}
                            onClick={() => decide(request, 'approve')}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={saving || loading}
                            onClick={() => decide(request, 'reject')}
                          >
                            Reject
                          </button>
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}