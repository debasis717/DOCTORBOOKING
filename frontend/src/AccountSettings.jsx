import { useState } from 'react'

export default function AccountSettings({ auth, onSave }) {
  const [name, setName] = useState(auth.user.name)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')

    try {
      const session = await onSave({
        name,
        currentPassword,
        newPassword,
      })
      setName(session.user.name)
      setCurrentPassword('')
      setNewPassword('')
      setMessage('Your account details have been updated.')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="account-settings">
      <div>
        <p className="eyebrow">ACCOUNT SECURITY</p>
        <h2>Profile and password</h2>
        <p className="account-settings-description">Update your display name or set a new password. Changing your password requires your current password.</p>
      </div>
      <form className="account-settings-form" onSubmit={submit}>
        <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} autoComplete="name" required /></label>
        <label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
        <label>New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={72} autoComplete="new-password" /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {message && <p className="account-settings-success" role="status">{message}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save account details'}</button>
      </form>
    </section>
  )
}
