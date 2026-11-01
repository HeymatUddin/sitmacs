import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import AdminDashboard from './dashboards/AdminDashboard.jsx'
import EmployeeDashboard from './dashboards/EmployeeDashboard.jsx'
import SupportDashboard from './dashboards/SupportDashboard.jsx'
import SecurityDashboard from './dashboards/SecurityDashboard.jsx'
import WorkspaceNav from './WorkspaceNav.jsx'

const API = import.meta.env.VITE_API_URL || '/api'
const ROLES = [
  'Administrator',
  'Employee',
  'IT Support',
  'IT Security Officer',
]

async function request(
  path,
  { token, body, method = body ? 'POST' : 'GET', responseType = 'json' } = {}
) {
  const isFormData = body instanceof FormData
  let response

  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(body && !isFormData
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body
        ? { body: isFormData ? body : JSON.stringify(body) }
        : {}),
      signal: AbortSignal.timeout(
        path.endsWith('/scan') ? 75000 : 15000
      ),
    })
  } catch {
    throw new Error(
      'Cannot connect to the service. Please try again or contact IT Support.'
    )
  }
  if (response.ok && responseType === 'blob') {
    return response.blob()
  }
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(
      data.message || 'The request could not be completed.'
    )
    error.status = response.status
    throw error
  }

  return data
}

function Shield({ small = false }) {
  return (
    <span
      className={`shield ${small ? 'shield-small' : ''}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="m16 3 10 4v8c0 7-10 14-10 14S6 22 6 15V7l10-4Z"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="m11 15 3 3 7-7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

export default function App() {
  const [token, setToken] = useState('')
  const [user, setUser] = useState(null)
  const [expiresAt, setExpiresAt] = useState(0)
  const [notice, setNotice] = useState('')
  const [view, setView] = useState('overview')
  const lastActivity = useRef(0)

  const endSession = useCallback((message = '') => {
    setToken('')
    setView('overview')
    setUser(null)
    setExpiresAt(0)
    setNotice(message)
  }, [])

  useEffect(() => {
    if (!token) return

    const activity = () => {
      lastActivity.current = Date.now()
    }

    window.addEventListener('pointerdown', activity)
    window.addEventListener('keydown', activity)

    let cancelled = false
    let checking = false
    let lastCheck = Date.now()

    const timer = window.setInterval(async () => {
      const now = Date.now()

      if (
        now >= expiresAt ||
        now - lastActivity.current >= 15 * 60 * 1000
      ) {
        endSession('Your session expired. Please sign in again.')
        void request('/auth/logout', {
          token,
          method: 'POST',
        }).catch(() => { })
        return
      }

      if (
        !checking &&
        now - lastCheck >= 60000 &&
        lastActivity.current > lastCheck
      ) {
        checking = true
        lastCheck = now

        try {
          const data = await request('/auth/me', { token })
          if (!cancelled) setUser(data.user)
        } catch (error) {
          if (!cancelled && error.status === 401) {
            endSession('Your session ended. Please sign in again.')
          }
        } finally {
          checking = false
        }
      }
    }, 10000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
    }
  }, [token, expiresAt, endSession])

  async function signedIn(data) {
    if (!data.token || !ROLES.includes(data.user?.role)) {
      throw new Error('Unexpected login response.')
    }

    lastActivity.current = Date.now()
    setNotice('')
    setUser(data.user)
    setExpiresAt(Date.now() + data.expires_in * 1000)
    setToken(data.token)
  }

  async function logout() {
    try {
      await request('/auth/logout', { token, method: 'POST' })
    } finally {
      endSession('You have signed out.')
    }
  }

  const api = useCallback(async (path, options = {}) => {
    lastActivity.current = Date.now()

    try {
      return await request(path, { ...options, token })
    } catch (error) {
      if (error.status === 401) {
        endSession('Please sign in again to continue.')
      }
      throw error
    }
  }, [token, endSession])

  if (!token || !user) {
    return <Login notice={notice} onLogin={signedIn} />
  }

  const onboarding =
    user.requirements.password_change ||
    user.requirements.profile_completion

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <Shield small />
          <span>SITMACS<small>IT MANAGEMENT</small></span>
        </div>

        <div className="sidebar-label">WORKSPACE</div>
        <WorkspaceNav
          user={user}
          view={view}
          onNavigate={setView}
          onboarding={onboarding}
        />

        <div className="sidebar-bottom">
          <span className="status-dot" /> Signed in
          <small>{user.role}</small>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <span>Secure IT Management & Access Control</span>
          <button
            className="text-button"
            onClick={() => void logout().catch(() => { })}
          >
            Sign out ↗
          </button>
        </header>

        <main className="content">
          <div className="eyebrow">YOUR WORKSPACE</div>
          <h1>
            {onboarding
              ? 'Let’s finish your account setup.'
              : `Welcome, ${user.full_name.split(' ')[0]}.`}
          </h1>
          <p className="muted">
            Signed in as <strong>{user.user_id}</strong> · {user.role}
          </p>

          {user.requirements.password_change ? (
            <PasswordChange
              api={api}
              onChanged={() => endSession(
                'Password changed successfully. Sign in with your new password.'
              )}
            />
          ) : user.requirements.profile_completion ? (
            <EmployeeProfile api={api} onComplete={setUser} />
          ) : (
            user.role === 'Administrator' ? (
              <AdminDashboard
                key={user.id}
                user={user}
                api={api}
                requestedView={view}
                onNavigate={setView}
              />
            ) : user.role === 'Employee' ? (
              <EmployeeDashboard
                key={user.id}
                user={user}
                api={api}
                requestedView={view}
              />
            ) : user.role === 'IT Support' ? (
              <SupportDashboard
                key={user.id}
                user={user}
                api={api}
                requestedView={view}
              />
            ) : user.role === 'IT Security Officer' ? (
              <SecurityDashboard
                key={user.id}
                user={user}
                api={api}
                requestedView={view}
              />
            ) : (
              <p role="alert">Your account role is not supported.</p>
            )
          )}
        </main>
      </div>
    </div>
  )
}

function Login({ notice, onLogin }) {
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')

    try {
      const data = await request('/auth/login', {
        body: { user_id: userId.trim(), password },
      })
      setPassword('')
      await onLogin(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-layout">
      <section className="login-story">
        <div className="brand">
          <Shield small />
          <span>SITMACS<small>IT MANAGEMENT</small></span>
        </div>

        <div className="story-copy">
          <div className="eyebrow light">ONE CONNECTED WORKSPACE</div>
          <h1>
            Your people.<br />
            Your resources.<br />
            <span>Under control.</span>
          </h1>
          <p>
            A central place to manage organisational access
            and everyday IT operations.
          </p>
          <div className="story-rule" />
          <span className="story-caption">
            Secure IT Management and Access Control Solution
          </span>
        </div>

        <div className="story-footer">
          AUTHORISED PERSONNEL ONLY
          <span>01 / ACCESS</span>
        </div>
      </section>

      <section className="login-form-area">
        <div className="login-card">
          <span className="section-tag">
            <span className="status-dot" /> ORGANISATION PORTAL
          </span>
          <h2>Welcome back.</h2>
          <p className="muted">
            Sign in with your organisation account.
          </p>

          {notice && (
            <p className="message success" role="status">{notice}</p>
          )}
          {error && (
            <p className="message error" role="alert">{error}</p>
          )}

          <form onSubmit={submit}>
            <label htmlFor="user-id">User ID</label>
            <input
              id="user-id"
              autoComplete="username"
              value={userId}
              onChange={event => setUserId(event.target.value)}
              maxLength={50}
              placeholder="Enter your User ID"
              required
              disabled={busy}
            />

            <label htmlFor="password">Password</label>
            <div className="password-field">
              <input
                id="password"
                type={visible ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                required
                disabled={busy}
                placeholder="Enter your password"
              />
              <button
                type="button"
                aria-label={visible ? 'Hide password' : 'Show password'}
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                {visible ? 'Hide' : 'Show'}
              </button>
            </div>

            <button className="primary" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
              <span aria-hidden="true">→</span>
            </button>
          </form>

          <p className="help-text">
            Need an account or help signing in?<br />
            Contact your organisation’s IT Support.
          </p>
        </div>

        <footer className="form-footer">
          SITMACS
          <span>Controlled access. Clear accountability.</span>
        </footer>
      </section>
    </main>
  )
}

function PasswordChange({ api, onChanged }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')

    if (next !== confirmation) {
      setError('New passwords do not match.')
      return
    }

    if (
      next.length < 12 ||
      new TextEncoder().encode(next).length > 72
    ) {
      setError('Use at least 12 characters and at most 72 UTF-8 bytes.')
      return
    }

    setBusy(true)

    try {
      await api('/auth/change-password', {
        body: {
          current_password: current,
          new_password: next,
        },
      })
      setCurrent('')
      setNext('')
      setConfirmation('')
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel setup-panel">
      <span className="step-label">
        FIRST SIGN-IN · PASSWORD CHANGE
      </span>
      <h2>Make your password your own.</h2>
      <p className="muted">
        Replace your temporary password before accessing your workspace.
      </p>

      {error && (
        <p className="message error" role="alert">{error}</p>
      )}

      <form onSubmit={submit}>
        <label htmlFor="current">Current temporary password</label>
        <input
          id="current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={event => setCurrent(event.target.value)}
          required
          disabled={busy}
        />

        <label htmlFor="new">New password</label>
        <input
          id="new"
          type="password"
          autoComplete="new-password"
          minLength={12}
          value={next}
          onChange={event => setNext(event.target.value)}
          required
          disabled={busy}
        />
        <small className="input-help">
          At least 12 characters. Use a password you have not used here before.
        </small>

        <label htmlFor="confirm">Confirm new password</label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          minLength={12}
          value={confirmation}
          onChange={event => setConfirmation(event.target.value)}
          required
          disabled={busy}
        />

        <button className="primary" disabled={busy}>
          {busy ? 'Updating…' : 'Change password & sign in again'}
          <span aria-hidden="true">→</span>
        </button>
      </form>
    </section>
  )
}

function EmployeeProfile({ api, onComplete }) {
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      try {
        const data = await api('/profile')
        if (!cancelled) setProfile(data.profile)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [api, reload])

  async function submit(event) {
    event.preventDefault()
    setError('')

    const name = profile.full_name.trim()
    const phone = profile.contact_phone.trim().replace(/[ ()-]/g, '')

    if (!name || name.length > 150) {
      setError('Enter your full name using 1–150 characters.')
      return
    }

    if (!/^\+?[0-9]{7,15}$/.test(phone)) {
      setError(
        'Enter a contact phone number with 7–15 digits and an optional leading +.'
      )
      return
    }

    setSaving(true)

    try {
      const data = await api('/profile', {
        body: { full_name: name, contact_phone: phone },
      })
      onComplete(data.user)
    } catch (err) {
      if (err.status === 409) {
        try {
          const data = await api('/auth/me')
          if (!data.user.requirements.profile_completion) {
            onComplete(data.user)
            return
          }
        } catch {
          // Keep the original error if refreshing fails.
        }
      }
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel setup-panel">
      <span className="step-label">FIRST SIGN-IN · YOUR PROFILE</span>
      <h2>A few details, then you’re ready.</h2>
      <p className="muted">
        Check your name and add a contact phone number
        to complete your account setup.
      </p>

      {error && (
        <p className="message error" role="alert">{error}</p>
      )}

      {loading ? (
        <p role="status">Loading your profile…</p>
      ) : !profile ? (
        <button
          className="primary"
          onClick={() => setReload(value => value + 1)}
        >
          Try again
        </button>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="profile-id">User ID (read only)</label>
          <input id="profile-id" value={profile.user_id} readOnly />

          <label htmlFor="profile-email">
            Organisation email (read only)
          </label>
          <input
            id="profile-email"
            type="email"
            value={profile.email}
            readOnly
          />

          <label htmlFor="profile-name">Full name</label>
          <input
            id="profile-name"
            autoComplete="name"
            required
            maxLength={150}
            value={profile.full_name}
            disabled={saving}
            onChange={event => setProfile({
              ...profile,
              full_name: event.target.value,
            })}
          />

          <label htmlFor="profile-phone">Contact phone</label>
          <input
            id="profile-phone"
            type="tel"
            autoComplete="tel"
            required
            maxLength={40}
            placeholder="Include country code, for example +61…"
            value={profile.contact_phone}
            disabled={saving}
            onChange={event => setProfile({
              ...profile,
              contact_phone: event.target.value,
            })}
          />

          <small className="input-help">
            Use 7–15 digits. A leading +, spaces,
            brackets and hyphens are accepted.
          </small>

          <button className="primary" type="submit" disabled={saving}>
            {saving ? 'Saving your profile…' : 'Save profile & open dashboard'}
            <span aria-hidden="true">→</span>
          </button>
        </form>
      )}
    </section>
  )
}
