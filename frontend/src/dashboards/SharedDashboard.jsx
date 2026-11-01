import { useCallback, useEffect, useState } from 'react'
import CreateUser from '../CreateUser.jsx'
import Devices from '../Devices.jsx'
import Files from '../Files.jsx'
import Shield from '../Shield.jsx'
import SoftwareRequests from '../SoftwareRequests.jsx'
import RequestSoftware from '../RequestSoftware.jsx'
import Profile from '../Profile.jsx'

export default function SharedDashboard({ user, api, requestedView }) {
    const [view, setView] = useState('overview')
    const [rows, setRows] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [selected, setSelected] = useState(null)
    const [reason, setReason] = useState('')
    const [saving, setSaving] = useState(false)
    const [userFilter, setUserFilter] = useState('pending')
    const [auditFilter, setAuditFilter] = useState('all')

    const canViewDevices = [
        'Administrator', 'IT Support', 'Employee',
    ].includes(user.role)

    const canViewAudit = [
        'Administrator', 'IT Security Officer',
    ].includes(user.role)

    const load = useCallback(async (nextView) => {
        setView(nextView)
        setError('')
        setMessage('')
        setSelected(null)
        setRows([])
        setLoading(true)

        try {
            if (nextView === 'users') {
                const data = await api('/users')
                setRows(data.users)
            } else if (nextView === 'audit') {
                const data = await api(`/audit-logs?category=${auditFilter}`)
                setRows(data.logs)
            } else if (nextView === 'overview') {
                await api('/dashboard')
            }
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [api, auditFilter])

    useEffect(() => {
        if (requestedView) {
            void load(requestedView)
        }
    }, [requestedView, load])

    async function changeStatus(row, status) {
        const labels = {
            suspended: 'Suspend',
            active: 'Reactivate',
            disabled: 'Disable',
        }

        const reason = window.prompt(
            `${labels[status]} ${row.user_id}: enter a reason.`
        )

        if (reason === null) return

        if (!reason.trim() || reason.length > 500) {
            setError('Enter a reason using 1–500 characters.')
            return
        }

        if (
            status === 'disabled' &&
            !window.confirm(
                `Disable ${row.user_id}? This page cannot reactivate a disabled account.`
            )
        ) {
            return
        }

        setSaving(true)
        setError('')
        setMessage('')

        try {
            const result = await api(`/users/${row.id}/status`, {
                body: { status, reason: reason.trim() },
            })

            setMessage(result.message)
            setSelected(null)

            const data = await api('/users')
            setRows(data.users)
        } catch (err) {
            setError(err.message)
        } finally {
            setSaving(false)
        }
    }
    async function decide(event) {
        event.preventDefault()
        setSaving(true)
        setError('')

        try {
            const result = await api(`/users/${selected.id}/decision`, {
                body: {
                    decision: selected.decision,
                    reason: reason.trim(),
                },
            })
            const data = await api('/users')
            setRows(data.users)
            setMessage(result.message)
            setSelected(null)
            setReason('')
        } catch (err) {
            setError(err.message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <>

            {error && (
                <p className="message error" role="alert">{error}</p>
            )}
            {message && (
                <p className="message success" role="status">{message}</p>
            )}
            {view === 'users' && (
                <nav className="tabs" aria-label="Filter user accounts">
                    {[
                        ['all', 'All users'],
                        ['pending', 'Pending'],

                    ].map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            className={userFilter === value ? 'chosen' : ''}
                            disabled={saving || loading}
                            onClick={() => {
                                setUserFilter(value)
                                setSelected(null)
                                setReason('')
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </nav>
            )}
            {view === 'audit' && canViewAudit && (
                <nav className="tabs" aria-label="Audit categories">
                    {[
                        ['all', 'All activity'],
                        ['security', 'Login & security'],
                        ['users', 'User management'],
                        ['files', 'Files & scans'],
                        ['software', 'Software permissions'],
                        ['profile', 'Profile updates'],
                    ].map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            className={auditFilter === value ? 'chosen' : ''}
                            aria-current={auditFilter === value ? 'page' : undefined}
                            disabled={loading}
                            onClick={() => setAuditFilter(value)}
                        >
                            {label}
                        </button>
                    ))}
                </nav>
            )}
            {loading ? (
                <p role="status">Loading workspace…</p>
            ) : view === 'profile' ? (
                <Profile api={api} />
            ) : view === 'software' ? (
                user.role === 'Administrator' ? (
                    <SoftwareRequests api={api} />
                ) : (
                    <RequestSoftware api={api} />
                )
            ) : view === 'files' ? (
                <Files api={api} user={user} />
            ) : view === 'create' && user.role === 'IT Support' ? (
                <CreateUser api={api} />
            ) : view === 'devices' && canViewDevices ? (
                <Devices api={api} user={user} />
            ) : view === 'overview' ? (
                <>
                    <div className="summary-grid">
                        <section className="panel">
                            <span className="step-label">ACCOUNT</span>
                            <h2 className="green">Active</h2>
                            <p>Your account is enabled.</p>
                        </section>

                        <section className="panel">
                            <span className="step-label">YOUR ROLE</span>
                            <h2>{user.role}</h2>
                            <p>Access follows your assigned role.</p>
                        </section>
                    </div>

                    <section className="panel next-panel">
                        <Shield />
                        <div>
                            <h2>Your account is ready.</h2>
                            <p>Use the available sections above to continue.</p>
                            <small>
                                No Microsoft Entra ID or Intune connection is configured.
                            </small>
                        </div>
                    </section>
                </>
            ) : (
                <section className="panel table-panel">
                    <div className="panel-heading">
                        <h2>
                            {view === 'users'
                                ? 'User accounts'
                                : 'Audit activity — latest 100 matching events'}
                        </h2>
                        <button
                            className="text-button"
                            disabled={loading || saving}
                            onClick={() => load(view)}
                        >
                            Refresh ↻
                        </button>
                    </div>

                    {view === 'users' ? (
                        <div className="table-scroll">

                            <table>
                                <caption className="sr-only">
                                    User accounts and approval actions
                                </caption>
                                <thead>
                                    <tr>
                                        <th>User</th>
                                        <th>Role</th>
                                        <th>Status</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows
                                        .filter(row =>
                                            userFilter === 'all' || row.account_status === 'pending'
                                        )
                                        .map(row => (
                                            <tr key={row.id}>
                                                <td>
                                                    <strong>{row.full_name}</strong>
                                                    <small>{row.user_id}</small>
                                                </td>
                                                <td>{row.role_name}</td>
                                                <td>
                                                    <span className={`badge ${row.account_status === 'active'
                                                        ? 'badge-active'
                                                        : ''
                                                        }`}>
                                                        {row.account_status}
                                                    </span>
                                                </td>
                                                <td>
                                                    {row.account_status === 'pending' ? (
                                                        <div className="row-actions">
                                                            <button
                                                                disabled={saving}
                                                                onClick={() => {
                                                                    setSelected({
                                                                        id: row.id,
                                                                        name: row.user_id,
                                                                        decision: 'approve',
                                                                    })
                                                                    setReason('')
                                                                }}
                                                            >
                                                                Approve
                                                            </button>
                                                            <button
                                                                disabled={saving}
                                                                onClick={() => {
                                                                    setSelected({
                                                                        id: row.id,
                                                                        name: row.user_id,
                                                                        decision: 'reject',
                                                                    })
                                                                    setReason('')
                                                                }}
                                                            >
                                                                Reject
                                                            </button>
                                                        </div>
                                                    ) : row.id !== user.id &&
                                                        row.role_name !== 'Administrator' &&
                                                        ['active', 'locked', 'suspended', 'disabled'].includes(row.account_status) ? (
                                                        <div className="row-actions">
                                                            {row.account_status === 'active' && (
                                                                <button
                                                                    type="button"
                                                                    disabled={saving}
                                                                    onClick={() => changeStatus(row, 'suspended')}
                                                                >
                                                                    Suspend
                                                                </button>
                                                            )}

                                                            {['suspended', 'disabled'].includes(row.account_status) && (
                                                                <button
                                                                    type="button"
                                                                    disabled={saving}
                                                                    onClick={() => changeStatus(row, 'active')}
                                                                >
                                                                    Reactivate
                                                                </button>
                                                            )}

                                                            {row.account_status === 'locked' && (
                                                                <button
                                                                    type="button"
                                                                    disabled={saving}
                                                                    onClick={() => changeStatus(row, 'suspended')}
                                                                >
                                                                    Suspend
                                                                </button>
                                                            )}

                                                            {row.account_status !== 'disabled' && (
                                                                <button
                                                                    type="button"
                                                                    disabled={saving}
                                                                    onClick={() => changeStatus(row, 'disabled')}
                                                                >
                                                                    Disable
                                                                </button>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="muted">—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="table-scroll audit-scroll">
                            <table>
                                <caption className="sr-only">
                                    Latest 100 audit events
                                </caption>
                                <thead>
                                    <tr>
                                        <th>Event</th>
                                        <th>Performed by</th>
                                        <th>Related user</th>
                                        <th>Time</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(row => (
                                        <tr key={row.id}>
                                            <td>{row.action.replaceAll('_', ' ')}</td>
                                            <td>
                                                {row.actor_user_id ? (
                                                    <>
                                                        <strong>{row.actor_name}</strong>
                                                        <small>{row.actor_user_id}</small>
                                                    </>
                                                ) : (
                                                    row.actor_id != null ? `User #${row.actor_id}` : '—'
                                                )}
                                            </td>

                                            <td>
                                                {row.target_user_id ? (
                                                    <>
                                                        <strong>{row.target_name}</strong>
                                                        <small>{row.target_user_id}</small>
                                                    </>
                                                ) : (
                                                    row.target_id != null ? `User #${row.target_id}` : '—'
                                                )}
                                            </td>
                                            <td>
                                                {new Date(row.created_at).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {!error && (
                        view === 'users'
                            ? !rows.some(row =>
                                userFilter === 'all' || row.account_status === 'pending'
                            )
                            : rows.length === 0
                    ) && (
                            <p className="empty">
                                {view === 'users' && userFilter === 'pending'
                                    ? 'No accounts awaiting approval.'
                                    : 'No records to display.'}
                            </p>
                        )}

                    {selected && (
                        <form className="decision-form" onSubmit={decide}>
                            <h3>
                                {selected.decision === 'approve' ? 'Approve' : 'Reject'}
                                {' '}{selected.name}
                            </h3>

                            <label htmlFor="reason">Reason for this decision</label>
                            <textarea
                                id="reason"
                                required
                                maxLength={500}
                                value={reason}
                                onChange={event => setReason(event.target.value)}
                                disabled={saving}
                            />

                            <p className="input-help">
                                {selected.decision === 'reject'
                                    ? 'Rejection disables this pending account.'
                                    : 'Approval allows this account to sign in and complete first-login requirements.'}
                                {' '}This decision is recorded in the audit log.
                            </p>

                            <div className="decision-buttons">
                                <button
                                    className="primary"
                                    disabled={saving || !reason.trim()}
                                >
                                    {saving ? 'Saving…' : 'Confirm decision'}
                                </button>
                                <button
                                    type="button"
                                    className="text-button"
                                    disabled={saving}
                                    onClick={() => setSelected(null)}
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    )}
                </section>
            )}
        </>
    )
} 