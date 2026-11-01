import { useEffect, useState } from 'react'

export default function Profile({ api }) {
    const [profile, setProfile] = useState(null)
    const [name, setName] = useState('')
    const [phone, setPhone] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [reload, setReload] = useState(0)

    useEffect(() => {
        let cancelled = false

        async function load() {
            setLoading(true)
            setError('')

            try {
                const data = await api('/auth/profile')

                if (!cancelled) {
                    setProfile(data.profile)
                    setName(data.profile.full_name)
                    setPhone(data.profile.phone || '')
                }
            } catch (err) {
                if (!cancelled) setError(err.message)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void load()

        return () => {
            cancelled = true
        }
    }, [api, reload])

    async function save(event) {
        event.preventDefault()
        setError('')
        setMessage('')

        setSaving(true)

        try {
            const result = await api('/auth/profile', {
                body: {
                    phone: phone.trim(),
                },
            })
            setPhone(phone.trim())
            setMessage(result.message)
        } catch (err) {
            setError(err.message)
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return <p role="status">Loading profile…</p>
    }

    if (!profile) {
        return (
            <section className="panel">
                <p className="message error" role="alert">
                    {error || 'Could not load your profile.'}
                </p>
                <button
                    type="button"
                    onClick={() => setReload(value => value + 1)}
                >
                    Try again
                </button>
            </section>
        )
    }

    return (
        <section className="panel setup-panel">
            <h2>My profile</h2>
            <p>View your account details and update your phone number.</p>

            {error && (
                <p className="message error" role="alert">{error}</p>
            )}

            {message && (
                <p className="message success" role="status">{message}</p>
            )}

            <form onSubmit={save}>
                <label htmlFor="profile-user-id">User ID</label>
                <input
                    id="profile-user-id"
                    value={profile.user_id}
                    readOnly
                />

                <label htmlFor="profile-name">Full name</label>
                <input
                    id="profile-name"
                    value={name}
                    readOnly
                />
                <input
                    id="profile-email"
                    type="email"
                    value={profile.email}
                    readOnly
                />

                <label htmlFor="profile-phone">Phone (optional)</label>
                <input
                    id="profile-phone"
                    type="tel"
                    value={phone}
                    onChange={event => setPhone(event.target.value)}
                    maxLength={30}
                    autoComplete="tel"
                    placeholder="For example, +61 412 345 678"
                    disabled={saving}
                />

                <label htmlFor="profile-role">Role</label>
                <input
                    id="profile-role"
                    value={profile.role}
                    readOnly
                />

                <label htmlFor="profile-status">Account status</label>
                <input
                    id="profile-status"
                    value={profile.account_status}
                    readOnly
                />

                <button
                    className="primary"
                    type="submit"
                    disabled={saving}
                >
                    {saving ? 'Saving…' : 'Save changes'}
                </button>
            </form>
        </section>
    )
}