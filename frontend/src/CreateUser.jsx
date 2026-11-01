import { useState } from 'react'
import './CreateUser.css'

const emptyAccount = { full_name: '', email: '', role_name: 'Employee' }
const roles = ['Employee', 'IT Support', 'IT Security Officer']

export default function CreateUser({ api }) {
  const [account, setAccount] = useState({ ...emptyAccount })
  const [created, setCreated] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [visible, setVisible] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')

  function update(event) {
    const { name, value } = event.target
    setAccount(previous => ({ ...previous, [name]: value }))
  }
  async function submit(event) {
    event.preventDefault(); setError(''); setCopyMessage('')
    const body = { ...account, full_name: account.full_name.trim(), email: account.email.trim().toLowerCase() }
    if (!body.full_name || body.full_name.length > 150 || !roles.includes(body.role_name)) {
      setError('Enter a full name and select an available role.'); return
    }
    setBusy(true)
    try {
      const data = await api('/users', { body })
      setCreated({ user_id: data.user_id, role: body.role_name, temporary_password: data.temporary_password })
      setAccount({ ...emptyAccount }); setVisible(false)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  async function copyPassword() {
    try { await navigator.clipboard.writeText(created.temporary_password); setCopyMessage('Copied. Keep the password private.') }
    catch { setCopyMessage('Copy is unavailable. Use Show to read and save the password privately.') }
  }
  if (created) return <section className="panel setup-panel create-user-form">
    <span className="step-label">ACCOUNT CREATED · PENDING APPROVAL</span>
    <h2>{created.user_id} is awaiting approval.</h2>
    <p>The Administrator must approve this {created.role} account before it can sign in.</p>
    <label htmlFor="temporary-password">Temporary password</label>
    <div className="password-field"><input id="temporary-password" type={visible ? 'text' : 'password'} value={created.temporary_password} readOnly autoComplete="off" spellCheck={false}/><button type="button" aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? 'Hide' : 'Show'}</button></div>
    <button type="button" className="text-button" onClick={copyPassword}>Copy temporary password</button>
    {copyMessage && <p role="status">{copyMessage}</p>}
    <p className="credential-help">Save this password privately before leaving this screen. It cannot be retrieved later. After approval, verify the user’s identity and deliver it privately. No email has been sent.</p>
    <button className="primary" onClick={() => { setCreated(null); setVisible(false); setCopyMessage('') }}>Create another account<span aria-hidden="true">→</span></button>
  </section>

  return <section className="panel setup-panel create-user-form">
    <span className="step-label">IT SUPPORT · ACCOUNT PROVISIONING</span>
    <h2>Create a user account.</h2>
    <p className="muted">Enter the account details. A temporary password will be generated and Administrator approval will be required.</p>
    {error && <p className="message error" role="alert">{error}</p>}
    <form onSubmit={submit}>
      <p className="input-help">A User ID will be generated automatically when you create the account.</p>
      <label htmlFor="create-name">Full name</label><input id="create-name" name="full_name" value={account.full_name} onChange={update} required maxLength={150} autoComplete="off" disabled={busy}/>
      <label htmlFor="create-email">Organisation email</label><input id="create-email" name="email" type="email" value={account.email} onChange={update} required maxLength={255} autoComplete="off" disabled={busy}/>
      <label htmlFor="create-role">Role</label><select id="create-role" name="role_name" value={account.role_name} onChange={update} disabled={busy}>{roles.map(role => <option key={role} value={role}>{role}</option>)}</select>
      <small className="input-help">Only assign the role needed for this person’s duties.</small>
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create pending account'}<span aria-hidden="true">→</span></button>
    </form>
  </section>
}
