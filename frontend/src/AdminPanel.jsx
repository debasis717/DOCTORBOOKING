import { useEffect, useState } from 'react'
import './AdminPanel.css'
import ReportPanel from './ReportPanel.jsx'

const emptyDashboard = { stats: null, users: [], doctors: [], appointments: [] }

async function readResponse(response, fallbackMessage) {
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || fallbackMessage)
  return result
}

function AdminLogin({ auth, onLogin }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submitLogin = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const details = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...details, role: 'admin' }),
      })
      onLogin(await readResponse(response, 'Could not sign in.'))
    } catch (loginError) {
      setError(loginError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <a className="brand" href="/"><span className="brand-mark">+</span><span>DocBook</span></a>
        <a className="admin-back-link" href="/">Back to booking</a>
      </header>
      <main className="admin-login-main">
        <section className="admin-login-card">
          <p className="eyebrow">RESTRICTED ACCESS</p>
          <h1>Administrator sign in</h1>
          <p className="admin-muted">This area is only for authorized DocBook administrators.</p>
          {auth && auth.user?.role !== 'admin' && <p className="auth-error" role="alert">Your current account does not have administrator access. Sign in with an admin account.</p>}
          <form className="account-form" onSubmit={submitLogin}>
            <label>Email<input name="email" type="email" autoComplete="username" required /></label>
            <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="confirm-button" type="submit" disabled={busy}>{busy ? 'Please wait...' : 'Sign in to admin'}</button>
          </form>
        </section>
      </main>
    </div>
  )
}

function AdminDashboard({ auth, onLogout }) {
  const [dashboard, setDashboard] = useState(emptyDashboard)
  const [activeSection, setActiveSection] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    const loadDashboard = async () => {
      setLoading(true)
      setLoadError('')
      try {
        const response = await fetch('/api/admin/dashboard', {
          headers: { Authorization: `Bearer ${auth.token}` },
        })
        const result = await readResponse(response, 'Could not load the admin dashboard.')
        if (active) setDashboard(result)
      } catch (error) {
        if (active) setLoadError(error.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    loadDashboard()
    return () => { active = false }
  }, [auth.token, reloadKey])

  const performAction = async (id, url, method, body) => {
    setBusyId(id)
    setActionError('')
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      await readResponse(response, 'Could not complete the admin action.')
      setActionError('')
      setReloadKey((key) => key + 1)
    } catch (error) {
      setActionError(error.message)
    } finally {
      setBusyId('')
    }
  }

  const deleteUser = async (user) => {
    if (!window.confirm(`Delete ${user.name}'s account and related records?`)) return
    await performAction(user._id, `/api/admin/users/${user._id}`, 'DELETE', null)
  }

  const updateAppointment = async (appointment, action) => {
    await performAction(
      appointment._id,
      `/api/admin/appointments/${appointment._id}`,
      'PATCH',
      { action },
    )
  }

  const menu = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users' },
    { id: 'doctors', label: 'Doctors' },
    { id: 'appointments', label: 'Appointments' },
    { id: 'reports', label: 'Generate Report' },
  ]

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <a className="brand" href="/"><span className="brand-mark">+</span><span>DocBook</span></a>
        <div className="admin-account"><span>{auth.user.name}</span><button type="button" onClick={onLogout}>Log out</button></div>
      </header>
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <p className="eyebrow">ADMINISTRATION</p>
          <nav aria-label="Admin sections">
            {menu.map((item) => (
              <button
                className={activeSection === item.id ? 'active' : ''}
                type="button"
                key={item.id}
                onClick={() => setActiveSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <p className="admin-sidebar-note">Private management area</p>
        </aside>
        <main className="admin-content">
          <div className="admin-page-heading">
            <div><p className="eyebrow">DOCBOOK CONTROL CENTER</p><h1>{menu.find((item) => item.id === activeSection)?.label}</h1></div>
            <button className="admin-refresh" type="button" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>Refresh</button>
          </div>
          {loadError && <p className="auth-error admin-alert" role="alert">{loadError}</p>}
          {actionError && <p className="auth-error admin-alert" role="alert">{actionError}</p>}
          {loading && !dashboard.stats ? <p className="admin-muted">Loading dashboard...</p> : <>
            {activeSection === 'overview' && <section className="admin-stats" aria-label="Platform statistics">
              <article><span>Patients</span><strong>{dashboard.stats?.users ?? 0}</strong></article>
              <article><span>Doctors</span><strong>{dashboard.stats?.doctors ?? 0}</strong></article>
              <article><span>Appointments</span><strong>{dashboard.stats?.appointments ?? 0}</strong></article>
              <article><span>Pending appointments</span><strong>{dashboard.stats?.pendingAppointments ?? 0}</strong></article>
            </section>}
            {activeSection === 'users' && <section className="admin-table-card">
              <div className="admin-section-heading"><h2>All accounts</h2><span>{dashboard.users.length} accounts</span></div>
              <div className="admin-table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Action</th></tr></thead>
                <tbody>{dashboard.users.map((user) => <tr key={user._id}>
                  <td>{user.name}</td><td>{user.email}</td><td><span className={`admin-role role-${user.role}`}>{user.role}</span></td>
                  <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                  <td>{user.role === 'admin' ? <span className="admin-muted">Protected</span> : <button className="admin-danger" type="button" disabled={busyId === user._id} onClick={() => deleteUser(user)}>Delete</button>}</td>
                </tr>)}</tbody>
              </table></div>
            </section>}
            {activeSection === 'doctors' && <section className="admin-table-card">
              <div className="admin-section-heading"><h2>Doctor directory</h2><span>{dashboard.doctors.length} doctors</span></div>
              <div className="admin-table-wrap"><table><thead><tr><th>Doctor</th><th>Specialty</th><th>Account email</th><th>Experience</th><th>Booking status</th><th>Weekly schedule / time off</th></tr></thead>
                <tbody>{dashboard.doctors.map((doctor) => <tr key={doctor._id}>
                  <td>{doctor.name}</td><td>{doctor.specialty}</td><td>{doctor.user?.email || 'Managed profile'}</td><td>{doctor.experience}</td>
                  <td>{doctor.availabilityStatus === 'unavailable' ? `Unavailable: ${doctor.availabilityStatusReason || 'No reason provided'}` : 'Available'}</td>
                  <td>{doctor.unavailabilityPeriods?.length ? doctor.unavailabilityPeriods.map((period) => `${period.startDate} to ${period.endDate}: ${period.reason}`).join('; ') : 'No scheduled time off'}</td>
                </tr>)}</tbody>
              </table></div>
            </section>}
            {activeSection === 'appointments' && <section className="admin-table-card">
              <div className="admin-section-heading"><h2>All appointments</h2><span>{dashboard.appointments.length} appointments</span></div>
              <div className="admin-table-wrap"><table><thead><tr><th>Patient</th><th>Doctor</th><th>Specialty</th><th>Appointment / reschedule</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>{dashboard.appointments.map((appointment) => <tr key={appointment._id}>
                  <td>{appointment.patientName}</td><td>{appointment.doctorName}</td><td>{appointment.specialty}</td>
                  <td>
                    {appointment.date} at {appointment.time}
                    {appointment.history?.find((entry) => entry.action === 'patient_cancelled') && <small className="admin-reschedule-detail">
                      Patient cancellation reason: {appointment.history.find((entry) => entry.action === 'patient_cancelled').reason}
                    </small>}
                    {appointment.rescheduleRequest && <small className="admin-reschedule-detail">
                      {appointment.rescheduleRequest.status === 'pending' ? 'Awaiting patient response' : `Request ${appointment.rescheduleRequest.status}`}
                      : {appointment.rescheduleRequest.proposedDate} at {appointment.rescheduleRequest.proposedTime}
                      {' - '}{appointment.rescheduleRequest.reason}
                    </small>}
                  </td>
                  <td><span className={`appointment-status status-${appointment.status}`}>{appointment.status}</span></td>
                  <td><div className="admin-row-actions">
                    {appointment.status === 'pending' && <button type="button" disabled={busyId === appointment._id} onClick={() => updateAppointment(appointment, 'confirm')}>Confirm</button>}
                    {!['cancelled', 'completed'].includes(appointment.status) && <button className="admin-danger" type="button" disabled={busyId === appointment._id} onClick={() => updateAppointment(appointment, 'cancel')}>Cancel</button>}
                  </div></td>
                </tr>)}</tbody>
              </table></div>
            </section>}
            {activeSection === 'reports' && <ReportPanel token={auth.token} endpoint="/api/admin/reports" />}
          </>}
        </main>
      </div>
    </div>
  )
}

export default function AdminPanel({ auth, onLogin, onLogout }) {
  if (auth?.user?.role === 'admin') return <AdminDashboard auth={auth} onLogout={onLogout} />
  return <AdminLogin auth={auth} onLogin={onLogin} />
}
