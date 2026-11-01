import { useEffect, useRef, useState } from 'react'
import FileRequests from './FileRequests.jsx'
import AdminFileRequests from './AdminFileRequests.jsx'
import ApprovedFiles from './ApprovedFiles.jsx'

export default function Files({ api, user }) {
  const [files, setFiles] = useState([])
  const [activeTab, setActiveTab] = useState('files')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  const [reviewFile, setReviewFile] = useState(null)
  const [reviewDecision, setReviewDecision] = useState('approve')
  const [reviewNote, setReviewNote] = useState('')

  const fileInput = useRef(null)
  const isAdmin = user.role === 'Administrator'

  useEffect(() => {
    let cancelled = false

    async function loadUploads() {
      setLoading(true)
      setLoadError('')

      try {
        const data = await api('/files/uploads')
        if (!cancelled) setFiles(data.files)
      } catch (error) {
        if (!cancelled) setLoadError(error.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadUploads()

    return () => {
      cancelled = true
    }
  }, [api, reload])

  async function uploadFile(event) {
    event.preventDefault()
    setUploadError('')
    setMessage('')

    const file = fileInput.current?.files[0]

    if (!file || file.size === 0) {
      setUploadError('Select a non-empty file.')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('File must not exceed 5 MB.')
      return
    }

    const body = new FormData()
    body.append('file', file)
    setSaving(true)

    try {
      const result = await api('/files', { body })
      fileInput.current.value = ''
      setMessage(result.message)
      setReload(value => value + 1)
    } catch (error) {
      setUploadError(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function sendForScan(file) {
    const confirmed = window.confirm(
      `Send "${file.original_name}" to VirusTotal?\n\n` +
      'Its contents may be shared with the security community. ' +
      'Only submit non-confidential test files. ' +
      'Do not submit personal information, passwords or organisation secrets.'
    )

    if (!confirmed) return

    setUploadError('')
    setMessage('')
    setSaving(true)

    try {
      const result = await api(`/files/${file.id}/scan`, {
        body: {
          confirm_public_submission: true,
        },
      })

      setMessage(result.message)
    } catch (error) {
      setUploadError(error.message)
    } finally {
      setReload(value => value + 1)
      setSaving(false)
    }
  }

  async function checkScanResult(file) {
    setUploadError('')
    setMessage('')
    setSaving(true)

    try {
      const result = await api(`/files/${file.id}/scan-result`, {
        method: 'POST',
      })

      setMessage(result.message)
    } catch (error) {
      setUploadError(error.message)
    } finally {
      setReload(value => value + 1)
      setSaving(false)
    }
  }

  function openReview(file) {
    setReviewFile(file)
    setReviewDecision(
      file.scan_status === 'clean' ? 'approve' : 'reject'
    )
    setReviewNote('')
    setUploadError('')
    setMessage('')
  }

  function closeReview() {
    setReviewFile(null)
    setReviewNote('')
    setUploadError('')
  }

  async function submitFileDecision(event) {
    event.preventDefault()
    setUploadError('')
    setMessage('')

    if (!reviewFile || !reviewNote.trim()) {
      setUploadError('Enter a review note.')
      return
    }

    if (
      reviewDecision === 'approve' &&
      reviewFile.scan_status !== 'clean'
    ) {
      setUploadError('File must pass malware scanning before approval.')
      return
    }

    setSaving(true)

    try {
      const result = await api(`/files/${reviewFile.id}/decision`, {
        body: {
          decision: reviewDecision,
          review_note: reviewNote.trim(),
        },
      })

      setReviewFile(null)
      setReviewNote('')
      setMessage(result.message)
      setReload(value => value + 1)
    } catch (error) {
      setUploadError(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {(
        <nav className="tabs" aria-label="File sections">
          {(isAdmin ? [
            ['files', 'Files'],
            ['requests', 'File requests'],
            ['uploads', 'File upload requests'],
            ['upload', 'Upload file'],
          ] : [
            ['files', 'Files'],
            ['request', 'Request a file'],
            ['requests', 'My requests'],
            ['uploads', 'My uploads'],
            ['upload', 'Upload file'],
          ]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={activeTab === id ? 'chosen' : ''}
              aria-current={activeTab === id ? 'page' : undefined}
              disabled={saving}
              onClick={() => {
                setActiveTab(id)
                setReviewFile(null)
                setUploadError('')
                setMessage('')
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {activeTab === 'files' && (
        <ApprovedFiles api={api} key={`approved-${reload}`} />
      )}

      {uploadError && (
        <p className="message error" role="alert">
          {uploadError}
        </p>
      )}

      {message && (
        <p className="message success" role="status">
          {message}
        </p>
      )}

      {isAdmin && activeTab === 'uploads' && reviewFile && (
        <section
          className="panel setup-panel"
          style={{ marginBottom: 24 }}
        >
          <h2>Review: {reviewFile.original_name}</h2>

          <form onSubmit={submitFileDecision}>
            <label htmlFor="file-review-decision">Decision</label>
            <select
              id="file-review-decision"
              value={reviewDecision}
              onChange={event => setReviewDecision(event.target.value)}
              disabled={saving}
            >
              <option
                value="approve"
                disabled={reviewFile.scan_status !== 'clean'}
              >
                Approve
              </option>
              <option value="reject">Reject</option>
            </select>

            {reviewFile.scan_status !== 'clean' && (
              <p className="input-help">
                Approval requires a completed, passing malware scan.
              </p>
            )}

            <label htmlFor="upload-review-note">Review note</label>
            <textarea
              id="upload-review-note"
              value={reviewNote}
              onChange={event => setReviewNote(event.target.value)}
              maxLength={1000}
              rows={3}
              required
              disabled={saving}
            />

            <div className="decision-buttons">
              <button
                type="submit"
                className="primary"
                disabled={
                  saving ||
                  !reviewNote.trim() ||
                  (reviewDecision === 'approve' &&
                    reviewFile.scan_status !== 'clean')
                }
              >
                {saving ? 'Saving…' : 'Confirm decision'}
              </button>

              <button
                type="button"
                className="text-button"
                disabled={saving}
                onClick={closeReview}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section
        className="panel setup-panel"
        style={{
          display: activeTab === 'upload' ? undefined : 'none',
        }}
      >
        <h2>Upload file</h2>
        <p className="muted">
          Maximum 5 MB. Downloads remain blocked while review
          and malware scanning are pending.
        </p>

        <form onSubmit={uploadFile}>
          <label htmlFor="upload-file">Choose file</label>
          <input
            id="upload-file"
            type="file"
            ref={fileInput}
            disabled={saving}
            required
          />

          <button
            type="submit"
            className="primary"
            disabled={saving}
          >
            {saving ? 'Please wait…' : 'Upload file'}
          </button>
        </form>
      </section>

      <section
        className="panel table-panel"
        style={{
          marginTop: 24,
          display: activeTab === 'uploads' ? undefined : 'none',
        }}
      >
        <div className="panel-heading">
          <h2>{isAdmin ? 'All uploads' : 'My uploads'}</h2>
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
          <p className="empty" role="status">
            Loading uploads…
          </p>
        ) : loadError ? (
          <p className="message error" role="alert">
            {loadError}
          </p>
        ) : files.length === 0 ? (
          <p className="empty">No uploads yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <caption className="sr-only">
                Uploaded files and review status
              </caption>

              <thead>
                <tr>
                  <th>File name</th>
                  <th>Uploaded by</th>
                  <th>Size</th>
                  <th>Approval</th>
                  <th>Scan</th>
                  {isAdmin && <th>Scan action</th>}
                  {isAdmin && <th>Review</th>}
                </tr>
              </thead>

              <tbody>
                {files.map(file => (
                  <tr key={file.id}>
                    <td>{file.original_name}</td>
                    <td>{file.uploader_user_id}</td>
                    <td>
                      {file.size_bytes < 1024
                        ? `${file.size_bytes} bytes`
                        : `${(file.size_bytes / 1024).toFixed(1)} KB`}
                    </td>
                    <td>{file.approval_status}</td>
                    <td>{file.scan_status}</td>

                    {isAdmin && (
                      <td>
                        {!file.scan_engine &&
                          file.scan_status === 'pending' ? (
                          <button
                            type="button"
                            className="text-button"
                            disabled={saving || loading}
                            onClick={() => sendForScan(file)}
                          >
                            Send for scan
                          </button>
                        ) : file.scan_submitted &&
                          ['pending', 'error'].includes(
                            file.scan_status
                          ) ? (
                          <button
                            type="button"
                            className="text-button"
                            disabled={saving || loading}
                            onClick={() => checkScanResult(file)}
                          >
                            Check result
                          </button>
                        ) : file.scan_status === 'error' ? (
                          'Submission needs review'
                        ) : file.scan_status === 'pending' ? (
                          'Submission started; refresh later'
                        ) : (
                          '—'
                        )}
                      </td>
                    )}

                    {isAdmin && (
                      <td>
                        {file.approval_status === 'pending' ? (
                          <button
                            type="button"
                            className="text-button"
                            disabled={saving || loading}
                            onClick={() => openReview(file)}
                          >
                            Review
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isAdmin && activeTab === 'requests' && (
        <AdminFileRequests api={api} />
      )}

      {!isAdmin && activeTab === 'request' && (
        <FileRequests key="request-form" api={api} mode="request" />
      )}

      {!isAdmin && activeTab === 'requests' && (
        <FileRequests key="request-history" api={api} mode="history" />
      )}
    </>
  )
}