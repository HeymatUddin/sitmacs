import { useEffect, useState } from 'react'

export default function AdminFileRequests({ api }) {
    const [requests, setRequests] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [reload, setReload] = useState(0)
    const [selected, setSelected] = useState(null)
    const [reviewNote, setReviewNote] = useState('')
    const [saving, setSaving] = useState(false)
    const [decisionError, setDecisionError] = useState('')
    const [message, setMessage] = useState('')
    const [availableFiles, setAvailableFiles] = useState([])
    const [selectedFileId, setSelectedFileId] = useState('')

    useEffect(() => {
        let cancelled = false

        async function loadRequests() {
            setLoading(true)
            setError('')

            try {
                const data = await api('/files/requests')

                if (!cancelled) {
                    setRequests(data.requests)
                }
            } catch (err) {
                if (!cancelled) setError(err.message)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        loadRequests()
        return () => { cancelled = true }
    }, [api, reload])

    async function rejectRequest(event) {
        event.preventDefault()
        setDecisionError('')
        setMessage('')

        if (!selected || !reviewNote.trim()) {
            setDecisionError('Enter a rejection reason.')
            return
        }

        setSaving(true)

        try {
            const result = await api(
                `/files/requests/${selected.id}/reject`,
                { body: { review_note: reviewNote.trim() } }
            )

            setSelected(null)
            setReviewNote('')
            setMessage(result.message)
            setReload(value => value + 1)
        } catch (err) {
            setDecisionError(err.message)
        } finally {
            setSaving(false)
        }
    }
    async function startApproval(request) {
        setDecisionError('')
        setMessage('')
        setSelected(null)
        setSelectedFileId('')
        setReviewNote('')
        setSaving(true)

        try {
            const data = await api('/files/available-for-approval')
            setAvailableFiles(data.files)
            setSelected({ ...request, decision: 'approve' })
        } catch (err) {
            setDecisionError(err.message)
        } finally {
            setSaving(false)
        }
    }
    async function approveRequest(event) {
        event.preventDefault()
        setDecisionError('')
        setMessage('')

        const fileId = Number(selectedFileId)

        if (
            !selected ||
            selected.decision !== 'approve' ||
            !Number.isSafeInteger(fileId) ||
            fileId < 1 ||
            !reviewNote.trim()
        ) {
            setDecisionError('Select a file and enter an approval note.')
            return
        }

        setSaving(true)

        try {
            const result = await api(
                `/files/requests/${selected.id}/approve`,
                {
                    body: {
                        file_id: fileId,
                        review_note: reviewNote.trim(),
                    },
                }
            )

            setSelected(null)
            setSelectedFileId('')
            setReviewNote('')
            setMessage(result.message)
            setReload(value => value + 1)
        } catch (err) {
            setDecisionError(err.message)
        } finally {
            setSaving(false)
        }
    }
    return (
        <section
            className="panel table-panel"
            style={{ marginTop: 24 }}
        >
            <div className="panel-heading">
                <h2>File/data requests</h2>
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
                <p className="message error" role="alert">{error}</p>
            ) : requests.length === 0 ? (
                <p className="empty">No requests yet.</p>
            ) : (
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>Requested by</th>
                                <th>File/data needed</th>
                                <th>Reason</th>
                                <th>Status</th>
                                <th>Action</th>
                            </tr>
                        </thead>

                        <tbody>
                            {requests.map(request => (
                                <tr key={request.id}>
                                    <td>
                                        {request.requester_name}
                                        <small>{request.requester_user_id}</small>
                                    </td>
                                    <td>{request.request_details}</td>
                                    <td>{request.reason}</td>
                                    <td>{request.status}</td>
                                    <td>
                                        {request.status === 'pending' ? (
                                            <div className="row-actions">
                                                <button
                                                    type="button"
                                                    disabled={saving || loading}
                                                    onClick={() => startApproval(request)}
                                                >
                                                    Approve
                                                </button>

                                                <button
                                                    type="button"
                                                    disabled={saving || loading}
                                                    onClick={() => {
                                                        setSelected({ ...request, decision: 'reject' })
                                                        setReviewNote('')
                                                        setSelectedFileId('')
                                                        setDecisionError('')
                                                        setMessage('')
                                                    }}
                                                >
                                                    Reject
                                                </button>
                                            </div>
                                        ) : (
                                            '—'
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {message && (
                <p className="message success" role="status">{message}</p>
            )}

            {decisionError && (
                <p className="message error" role="alert">{decisionError}</p>
            )}

            {selected && (
                <form
                    className="decision-form"
                    onSubmit={
                        selected.decision === 'approve'
                            ? approveRequest
                            : rejectRequest
                    }
                >
                    <h3>
                        {selected.decision === 'approve' ? 'Approve' : 'Reject'}
                        {' '}request: {selected.request_details}
                    </h3>

                    {selected.decision === 'approve' && (
                        <>
                            <label htmlFor="approval-file">File to provide</label>

                            <select
                                id="approval-file"
                                value={selectedFileId}
                                onChange={event => setSelectedFileId(event.target.value)}
                                disabled={saving || availableFiles.length === 0}
                                required
                            >
                                <option value="">Select a file</option>

                                {availableFiles.map(file => (
                                    <option key={file.id} value={file.id}>
                                        {file.original_name} (ID: {file.id})
                                    </option>
                                ))}
                            </select>

                            {availableFiles.length === 0 && (
                                <p className="input-help">
                                    No eligible files. A file must be approved and pass
                                    malware scanning before it can be provided.
                                </p>
                            )}
                        </>
                    )}

                    <label htmlFor="file-review-note">
                        {selected.decision === 'approve'
                            ? 'Approval note'
                            : 'Reason for rejection'}
                    </label>

                    <textarea
                        id="file-review-note"
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
                                (selected.decision === 'approve' && !selectedFileId)
                            }
                        >
                            {saving
                                ? 'Saving…'
                                : selected.decision === 'approve'
                                    ? 'Confirm approval'
                                    : 'Confirm rejection'}
                        </button>

                        <button
                            type="button"
                            className="text-button"
                            disabled={saving}
                            onClick={() => {
                                setSelected(null)
                                setSelectedFileId('')
                                setReviewNote('')
                                setDecisionError('')
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            )}
        </section>
    )
}