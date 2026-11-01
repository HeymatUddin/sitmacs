import { useEffect, useState } from 'react'

export default function FileRequests({ api, mode = 'request' }) {
  const [details, setDetails] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [reload, setReload] = useState(0)
  const [downloadingId, setDownloadingId] = useState(null)
  const [downloadError, setDownloadError] = useState('')

  useEffect(() => {
    if (mode !== 'history') return
    let cancelled = false
    async function loadRequests() {
      setLoading(true)
      setListError('')
      try {
        const data = await api('/files/requests')
        if (!cancelled) setRequests(data.requests)
      } catch (err) {
        if (!cancelled) setListError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadRequests()
    return () => { cancelled = true }
  }, [api, mode, reload])

  async function downloadFile(request) {
    setDownloadError('')
    setDownloadingId(request.id)
    try {
      const blob = await api(`/files/${request.fulfilled_file_id}/download`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      try {
        link.href = url
        link.download = request.fulfilled_file_name
        document.body.appendChild(link)
        link.click()
      } finally {
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
    } catch (err) {
      setDownloadError(err.message)
    } finally {
      setDownloadingId(null)
    }
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    if (!details.trim() || !reason.trim()) {
      setError('Describe the file/data you need and why you need it.')
      return
    }
    setSaving(true)
    try {
      const result = await api('/files/requests', {
        body: { request_details: details.trim(), reason: reason.trim() },
      })
      setDetails('')
      setReason('')
      setMessage(`${result.message}. View its status in My requests.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (mode === 'history') {
    return (
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>My requests</h2>
          <button type="button" className="text-button"
            disabled={loading || downloadingId !== null}
            onClick={() => { setDownloadError(''); setReload(value => value + 1) }}>
            Refresh ↻
          </button>
        </div>
        {downloadError && <p className="message error" role="alert">{downloadError}</p>}
        {loading ? (
          <p className="empty" role="status">Loading requests…</p>
        ) : listError ? (
          <p className="message error" role="alert">{listError} Use Refresh to try again.</p>
        ) : requests.length === 0 ? (
          <p className="empty">No requests yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr>
                <th>Requested file/data</th><th>Status</th>
                <th>Admin response</th><th>Provided file</th><th>Action</th>
              </tr></thead>
              <tbody>
                {requests.map(request => (
                  <tr key={request.id}>
                    <td style={{ whiteSpace: 'normal', minWidth: 200 }}>{request.request_details}</td>
                    <td><span className={`badge ${request.status === 'approved' ? 'badge-active' : ''}`}>
                      {request.status}
                    </span></td>
                    <td style={{ whiteSpace: 'normal', minWidth: 200 }}>{request.review_note || '—'}</td>
                    <td>{request.fulfilled_file_name || '—'}</td>
                    <td>
                      {request.status === 'approved' && request.fulfilled_file_id && Number(request.can_download) === 1 ? (
                        <button type="button" className="text-button"
                          disabled={downloadingId !== null}
                          onClick={() => downloadFile(request)}>
                          {downloadingId === request.id ? 'Downloading…' : 'Download'}
                        </button>
                      ) : request.status === 'approved' ? (
                        <span className="muted">File unavailable for download</span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="panel setup-panel">
      <h2>Request a file</h2>
      <p className="muted">Describe what you need. The Administrator will review your request.</p>
      {error && <p className="message error" role="alert">{error}</p>}
      {message && <p className="message success" role="status">{message}</p>}
      <form onSubmit={submit}>
        <label htmlFor="file-request-details">File name or required data</label>
        <textarea id="file-request-details" value={details}
          onChange={event => setDetails(event.target.value)}
          maxLength={1000} rows={3} required disabled={saving} />
        <label htmlFor="file-request-reason">Why do you need it?</label>
        <textarea id="file-request-reason" value={reason}
          onChange={event => setReason(event.target.value)}
          maxLength={1000} rows={3} required disabled={saving} />
        <button className="primary" type="submit" disabled={saving}>
          {saving ? 'Submitting…' : 'Submit request'}
        </button>
      </form>
    </section>
  )
}
