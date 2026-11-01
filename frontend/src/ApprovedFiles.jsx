import { useEffect, useState } from 'react'

export default function ApprovedFiles({ api }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [downloadingId, setDownloadingId] = useState(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function loadFiles() {
      setLoading(true)
      setError('')

      try {
        const data = await api('/files/approved')
        if (!cancelled) setFiles(data.files)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadFiles()

    return () => {
      cancelled = true
    }
  }, [api, reload])

  async function downloadFile(file) {
    setDownloadError('')
    setDownloadingId(file.id)

    try {
      const blob = await api(`/files/${file.id}/download`, {
        responseType: 'blob',
      })

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')

      try {
        link.href = url
        link.download = file.original_name
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

  return (
    <section
      className="panel table-panel"
      style={{ marginBottom: 24 }}
    >
      <div className="panel-heading">
        <h2>Approved files</h2>

        <button
          type="button"
          className="text-button"
          disabled={loading || downloadingId !== null}
          onClick={() => {
            setDownloadError('')
            setReload(value => value + 1)
          }}
        >
          Refresh ↻
        </button>
      </div>

      {downloadError && (
        <p className="message error" role="alert">
          {downloadError}
        </p>
      )}

      {loading ? (
        <p className="empty" role="status">
          Loading files…
        </p>
      ) : error ? (
        <p className="message error" role="alert">
          {error}
        </p>
      ) : files.length === 0 ? (
        <p className="empty">
          No approved files available to you yet.
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <caption className="sr-only">
              Approved files available for download
            </caption>

            <thead>
              <tr>
                <th>File name</th>
                <th>Size</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {files.map(file => (
                <tr key={file.id}>
                  <td>{file.original_name}</td>
                  <td>
                    {file.size_bytes < 1024
                      ? `${file.size_bytes} bytes`
                      : `${(file.size_bytes / 1024).toFixed(1)} KB`}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="text-button"
                      disabled={downloadingId !== null}
                      onClick={() => downloadFile(file)}
                    >
                      {downloadingId === file.id
                        ? 'Downloading…'
                        : 'Download'}
                    </button>
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