import { useEffect, useState } from 'react'
import './Auth.css'
import './App.css'
import AdminPanel from './AdminPanel.jsx'

const today = new Date()
const formatDateValue = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
const formatLongDate = (date) => new Intl.DateTimeFormat('en-US', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(date)
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const createDateSelection = (date) => {
  return {
    day: new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date).toUpperCase(),
    weekday: weekdays[date.getDay()],
    date: date.getDate(),
    value: formatDateValue(date),
    fullDate: formatLongDate(date),
  }
}
const getTimesForDay = (doctor, weekday) => {
  if (doctor.weeklyAvailability?.length) {
    return doctor.weeklyAvailability.find((schedule) => schedule.day === weekday)?.times || []
  }
  return doctor.availableDays?.includes(weekday) ? doctor.slots || [] : []
}
const getWeeklySchedule = (doctor) => weekdays.map((day) => {
  const schedule = doctor.weeklyAvailability?.find((entry) => entry.day === day)
  const active = doctor.weeklyAvailability?.length
    ? Boolean(schedule)
    : doctor.availableDays?.includes(day) ?? false
  return { day, active, times: (schedule?.times || (active ? doctor.slots : [])).join(', ') }
})
const getWeekdayFromValue = (dateValue) => {
  const [year, month, date] = dateValue.split('-').map(Number)
  return weekdays[new Date(year, month - 1, date).getDay()]
}
const findNextAvailableDate = (doctor) => {
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(today)
    date.setDate(date.getDate() + offset)
    if (getTimesForDay(doctor, weekdays[date.getDay()]).length) return createDateSelection(date)
  }
  return createDateSelection(today)
}
const getCurrentDateValue = () => formatDateValue(new Date())
const todayLabel = formatLongDate(today).toUpperCase()
const appointmentStatusLabels = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  reschedule_requested: 'Awaiting patient response',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
}

function readSavedSession() {
  try {
    return JSON.parse(localStorage.getItem('docbook-session'))
  } catch {
    return null
  }
}

function AuthPage({ page, error, busy, onChange, onSubmit, onBack }) {
  const signingUp = page.mode === 'signup'
  const roleName = page.role === 'doctor' ? 'doctor' : 'patient'

  return (
    <div className="app-shell auth-shell">
      <header className="topbar">
        <a className="brand" href="#top"><span className="brand-mark">+</span><span>DocBook</span></a>
        <button className="profile-button" type="button" onClick={onBack}>Back to doctors</button>
      </header>
      <main className="auth-main">
        <section className="auth-panel">
          <p className="eyebrow">DOCBOOK ACCOUNT</p>
          <h1>{signingUp ? 'Create your account' : 'Welcome back'}</h1>
          <div className="auth-switch" aria-label="Account type">
            {['patient', 'doctor'].map((role) => (
              <button className={page.role === role ? 'active' : ''} type="button" key={role} onClick={() => onChange({ ...page, role })}>
                {role === 'patient' ? 'Patient' : 'Doctor'}
              </button>
            ))}
          </div>
          <div className="auth-switch auth-mode" aria-label="Account action">
            <button className={!signingUp ? 'active' : ''} type="button" onClick={() => onChange({ ...page, mode: 'login' })}>Log in</button>
            <button className={signingUp ? 'active' : ''} type="button" onClick={() => onChange({ ...page, mode: 'signup' })}>Sign up</button>
          </div>
          <p className="auth-description">{signingUp ? `Create a ${roleName} account to get started.` : `Log in to your ${roleName} account.`}</p>
          <form className="account-form" onSubmit={onSubmit}>
            {signingUp && <label>Full name<input name="name" autoComplete="name" required /></label>}
            <label>Email<input name="email" type="email" autoComplete="email" required /></label>
            <label>Password<input name="password" type="password" autoComplete={signingUp ? 'new-password' : 'current-password'} minLength={signingUp ? 8 : undefined} required /></label>
            {signingUp && page.role === 'doctor' && <>
              <label>Specialty<input name="specialty" placeholder="For example, Dermatologist" required /></label>
              <label>Years of experience<input name="experience" type="number" min="0" max="70" required /></label>
              <label>Available appointment times<input name="slots" defaultValue="09:00 AM, 11:00 AM, 02:00 PM" required /></label>
            </>}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="confirm-button" type="submit" disabled={busy}>{busy ? 'Please wait...' : signingUp ? 'Create account' : 'Log in'}</button>
          </form>
        </section>
      </main>
    </div>
  )
}

function DoctorDashboard({ auth, appointments, error, onLogout, onSaveAvailability, onAppointmentAction }) {
  const doctor = auth.user.doctor
  const [weeklySchedule, setWeeklySchedule] = useState(() => getWeeklySchedule(doctor || { availableDays: weekdays.slice(1, 6), slots: [] }))
  const [availabilityBusy, setAvailabilityBusy] = useState(false)
  const [availabilityMessage, setAvailabilityMessage] = useState('')
  const [availabilityError, setAvailabilityError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busyAppointment, setBusyAppointment] = useState('')
  const [reschedulingId, setReschedulingId] = useState('')
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleReason, setRescheduleReason] = useState('')
  const todayValue = getCurrentDateValue()
  const [rescheduleTime, setRescheduleTime] = useState(doctor?.slots[0] || '')
  const rescheduleTimes = getTimesForDay(doctor || {}, getWeekdayFromValue(rescheduleDate || todayValue))
  const upcomingAppointments = appointments
    .filter((appointment) => appointment.date >= todayValue && appointment.status !== 'cancelled')
    .sort((first, second) => first.date.localeCompare(second.date) || first.time.localeCompare(second.time))
  const historyAppointments = appointments
    .filter((appointment) => appointment.date < todayValue || appointment.status === 'cancelled')
    .sort((first, second) => second.date.localeCompare(first.date) || second.time.localeCompare(first.time))

  const updateDay = (weekday, changes) => {
    setWeeklySchedule((current) => current.map((schedule) => schedule.day === weekday ? { ...schedule, ...changes } : schedule))
    setAvailabilityMessage('')
  }

  const saveAvailability = async (event) => {
    event.preventDefault()
    setAvailabilityBusy(true)
    setAvailabilityError('')
    setAvailabilityMessage('')
    try {
      const schedule = weeklySchedule
        .filter((entry) => entry.active)
        .map((entry) => ({
          day: entry.day,
          times: entry.times.split(',').map((time) => time.trim()).filter(Boolean),
        }))
      await onSaveAvailability(schedule)
      setAvailabilityMessage('Availability saved.')
    } catch (saveError) {
      setAvailabilityError(saveError.message)
    } finally {
      setAvailabilityBusy(false)
    }
  }

  const handleAppointmentAction = async (appointmentId, action, details = {}) => {
    setBusyAppointment(appointmentId)
    setActionError('')
    try {
      await onAppointmentAction(appointmentId, { action, ...details })
      setReschedulingId('')
    } catch (requestError) {
      setActionError(requestError.message)
    } finally {
      setBusyAppointment('')
    }
  }

  const renderAppointment = (appointment, isHistory = false) => (
    <article className="appointment-row" key={appointment._id}>
      <div className="appointment-person">
        <strong>{appointment.patientName}</strong>
        <span>{appointment.date} at {appointment.time}</span>
      </div>
      <span className={`appointment-status status-${appointment.status || 'pending'}`}>
        {appointmentStatusLabels[appointment.status] || (isHistory ? 'Past' : 'Pending')}
      </span>
      {appointment.rescheduleRequest?.status === 'pending' && <div className="appointment-notice">
        <strong>Proposed time: {appointment.rescheduleRequest.proposedDate} at {appointment.rescheduleRequest.proposedTime}</strong>
        <span>Reason: {appointment.rescheduleRequest.reason}</span>
        <span>The original appointment remains active until the patient responds.</span>
      </div>}
      {!isHistory && <div className="appointment-actions">
        {appointment.status === 'pending' && <button type="button" disabled={busyAppointment === appointment._id} onClick={() => handleAppointmentAction(appointment._id, 'confirm')}>Confirm</button>}
        {['pending', 'confirmed', 'rescheduled'].includes(appointment.status) && <button type="button" disabled={busyAppointment === appointment._id} onClick={() => {
          setReschedulingId(appointment._id)
          setRescheduleDate(appointment.date)
          setRescheduleTime(appointment.time)
          setRescheduleReason('')
        }}>Reschedule</button>}
        <button className="cancel-action" type="button" disabled={busyAppointment === appointment._id} onClick={() => {
          if (window.confirm('Cancel this appointment?')) handleAppointmentAction(appointment._id, 'cancel')
        }}>Cancel</button>
      </div>}
      {!isHistory && reschedulingId === appointment._id && <form className="reschedule-form" onSubmit={(event) => {
        event.preventDefault()
        handleAppointmentAction(appointment._id, 'reschedule', {
          date: rescheduleDate,
          time: rescheduleTime,
          reason: rescheduleReason,
        })
      }}>
        <label>Date<input type="date" min={todayValue} value={rescheduleDate} onChange={(event) => {
          setRescheduleDate(event.target.value)
          setRescheduleTime(getTimesForDay(doctor || {}, getWeekdayFromValue(event.target.value))[0] || '')
        }} required /></label>
        <label>Time<select value={rescheduleTime} onChange={(event) => setRescheduleTime(event.target.value)} required>{rescheduleTimes.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</select></label>
        <label className="reschedule-reason">Reason<textarea value={rescheduleReason} onChange={(event) => setRescheduleReason(event.target.value)} maxLength={500} required /></label>
        <button type="submit" disabled={busyAppointment === appointment._id}>Send request</button>
        <button type="button" onClick={() => setReschedulingId('')}>Close</button>
      </form>}
    </article>
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top"><span className="brand-mark">+</span><span>DocBook</span></a>
        <span className="account-label">Doctor account</span>
        <button className="profile-button" type="button" onClick={onLogout}>Log out</button>
      </header>
      <main className="doctor-dashboard">
        <section className="welcome-section doctor-welcome">
          <div><p className="eyebrow">DOCTOR DASHBOARD</p><h1>Welcome, {auth.user.name}<span>.</span></h1><p className="intro">Your profile is listed for patients looking for care.</p></div>
        </section>
        <section className="doctor-dashboard-grid">
          <div className="doctor-sidebar">
            <article className="doctor-card doctor-profile-card">
              <p className="eyebrow">YOUR PUBLIC PROFILE</p>
              <div className="doctor-top"><div className={`avatar ${doctor?.color || 'blue'}`}>{doctor?.initials}</div><div className="doctor-meta"><h3>{doctor?.name}</h3><p>{doctor?.specialty}</p><span className="verified">Available to book</span></div></div>
              <p className="doctor-experience">{doctor?.experience}</p>
              <div className="card-divider" />
              <p className="next-available">Weekly availability: <b>{doctor?.availableDays.join(', ')}</b></p>
            </article>
            <form className="availability-panel" onSubmit={saveAvailability}>
              <div><p className="eyebrow">WEEKLY SCHEDULE</p><h2>Set your availability</h2></div>
              <div className="weekly-schedule">{weeklySchedule.map(({ day, active, times }) => <div className="weekly-day-row" key={day}>
                <label className="weekly-day-toggle"><input type="checkbox" checked={active} onChange={(event) => updateDay(day, { active: event.target.checked })} /><span>{day.slice(0, 3)}</span></label>
                <input type="text" aria-label={`${day} available times`} placeholder="09:00 AM, 01:30 PM" value={times} disabled={!active} onChange={(event) => updateDay(day, { times: event.target.value })} />
              </div>)}</div>
              {availabilityError && <p className="auth-error" role="alert">{availabilityError}</p>}
              {availabilityMessage && <p className="availability-success" role="status">{availabilityMessage}</p>}
              <button className="availability-save" type="submit" disabled={availabilityBusy}>{availabilityBusy ? 'Saving...' : 'Save availability'}</button>
            </form>
          </div>
          <div className="appointments-column">
            {error && <p className="auth-error" role="alert">{error}</p>}
            {actionError && <p className="auth-error" role="alert">{actionError}</p>}
            <section className="appointments-panel">
              <div className="section-heading"><div><p className="eyebrow">YOUR SCHEDULE</p><h2>Upcoming appointments</h2></div><span className="appointment-count">{upcomingAppointments.length}</span></div>
              {upcomingAppointments.length ? upcomingAppointments.map((appointment) => renderAppointment(appointment)) : <p className="empty-state">No upcoming appointments.</p>}
            </section>
            <section className="appointments-panel history-panel">
              <div className="section-heading"><div><p className="eyebrow">COMPLETED AND CANCELLED</p><h2>Appointment history</h2></div><span className="appointment-count">{historyAppointments.length}</span></div>
              {historyAppointments.length ? historyAppointments.map((appointment) => renderAppointment(appointment, true)) : <p className="empty-state">Your appointment history will appear here.</p>}
            </section>
          </div>
        </section>
      </main>
    </div>
  )
}

function PatientDashboard({ auth, appointments, error, onLogout, onBrowse, onRespondToReschedule }) {
  const [busyAppointment, setBusyAppointment] = useState('')
  const [actionError, setActionError] = useState('')
  const orderedAppointments = [...appointments].sort((first, second) =>
    first.date.localeCompare(second.date) || first.time.localeCompare(second.time))

  const respondToReschedule = async (appointmentId, action) => {
    setBusyAppointment(appointmentId)
    setActionError('')
    try {
      await onRespondToReschedule(appointmentId, action)
    } catch (requestError) {
      setActionError(requestError.message)
    } finally {
      setBusyAppointment('')
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top"><span className="brand-mark">+</span><span>DocBook</span></a>
        <span className="account-label">Patient account</span>
        <button className="profile-button" type="button" onClick={onBrowse}>Find a doctor</button>
        <button className="profile-button" type="button" onClick={onLogout}>Log out</button>
      </header>
      <main className="patient-dashboard" id="top">
        <section className="welcome-section">
          <div><p className="eyebrow">PATIENT DASHBOARD</p><h1>Welcome, {auth.user.name}<span>.</span></h1><p className="intro">View your upcoming visits and respond to doctor requests.</p></div>
        </section>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {actionError && <p className="auth-error" role="alert">{actionError}</p>}
        <section className="patient-appointments" aria-label="Your appointments">
          {orderedAppointments.length ? orderedAppointments.map((appointment) => {
            const proposalPending = appointment.status === 'reschedule_requested'
              && appointment.rescheduleRequest?.status === 'pending'
            return (
              <article className="appointment-row patient-appointment-row" key={appointment._id}>
                <div className="appointment-person">
                  <strong>{appointment.doctorName}</strong>
                  <span>{appointment.specialty}</span>
                  <span>Current appointment: {appointment.date} at {appointment.time}</span>
                </div>
                <span className={`appointment-status status-${appointment.status || 'pending'}`}>
                  {appointmentStatusLabels[appointment.status] || 'Pending'}
                </span>
                {proposalPending && <div className="appointment-notice">
                  <strong>New time proposed: {appointment.rescheduleRequest.proposedDate} at {appointment.rescheduleRequest.proposedTime}</strong>
                  <span>Reason: {appointment.rescheduleRequest.reason}</span>
                  <span>Your current appointment remains active unless you accept.</span>
                  <div className="patient-reschedule-actions">
                    <button type="button" disabled={busyAppointment === appointment._id} onClick={() => respondToReschedule(appointment._id, 'accept')}>Accept new time</button>
                    <button type="button" disabled={busyAppointment === appointment._id} onClick={() => respondToReschedule(appointment._id, 'reject')}>Reject proposal</button>
                  </div>
                </div>}
                {appointment.status !== 'cancelled' && appointment.rescheduleRequest?.status === 'rejected' && <p className="appointment-history-note">The proposed time was rejected. Your original appointment remains active.</p>}
              </article>
            )
          }) : <p className="empty-state">You do not have any appointments yet.</p>}
        </section>
      </main>
    </div>
  )
}

function App() {
  const [query, setQuery] = useState('')
  const [auth, setAuth] = useState(readSavedSession)
  const [showPatientDashboard, setShowPatientDashboard] = useState(() => readSavedSession()?.user?.role === 'patient')
  const [authPage, setAuthPage] = useState(null)
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [appointmentData, setAppointmentData] = useState({ userId: null, records: [] })
  const [appointmentErrorData, setAppointmentErrorData] = useState({ userId: null, message: '' })
  const appointments = auth?.user?.id === appointmentData.userId ? appointmentData.records : []
  const appointmentsError = auth?.user?.id === appointmentErrorData.userId ? appointmentErrorData.message : ''
  const [doctors, setDoctors] = useState([])
  const [selectedDoctorState, setSelectedDoctor] = useState(null)
  const [selectedDate, setSelectedDate] = useState(() => createDateSelection(today))
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedTimeValue, setSelectedTime] = useState('')
  const selectedDoctor = selectedDoctorState
    ? { ...selectedDoctorState, slots: getTimesForDay(selectedDoctorState, selectedDate.weekday) }
    : null
  const selectedTime = selectedDoctor?.slots.includes(selectedTimeValue) ? selectedTimeValue : selectedDoctor?.slots[0] || ''
  const [booked, setBookedState] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    fetch('/api/doctors')
      .then((response) => {
        if (!response.ok) throw new Error('Could not load doctors.')
        return response.json()
      })
      .then((doctorList) => {
        const doctorsWithIds = doctorList.map((doctor) => ({ ...doctor, id: doctor._id }))
        setDoctors(doctorsWithIds)
        if (doctorsWithIds.length) {
          const firstDate = findNextAvailableDate(doctorsWithIds[0])
          const firstDateTimes = getTimesForDay(doctorsWithIds[0], firstDate.weekday)
          setSelectedDoctor({ ...doctorsWithIds[0], slots: firstDateTimes })
          setSelectedDate(firstDate)
          setSelectedTime(firstDateTimes[0] || '')
        }
      })
      .catch(() => setLoadError('Could not load doctors. Check that the backend and MongoDB are running.'))
  }, [])

  useEffect(() => {
    if (!auth?.token) return
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${auth.token}` } })
      .then((response) => {
        if (!response.ok) throw new Error('Session expired.')
        return response.json()
      })
      .then(({ user }) => setAuth((session) => session ? { ...session, user } : session))
      .catch(() => {
        localStorage.removeItem('docbook-session')
        setAuth(null)
      })
  }, [auth?.token])

  useEffect(() => {
    if (!auth?.token || !['doctor', 'patient'].includes(auth.user.role)) return

    let active = true
    fetch('/api/appointments', { headers: { Authorization: `Bearer ${auth.token}` } })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.message || 'Could not load appointments.')
        return result
      })
      .then((result) => {
        if (active) {
          setAppointmentData({ userId: auth.user.id, records: result })
          setAppointmentErrorData({ userId: auth.user.id, message: '' })
        }
      })
      .catch((error) => {
        if (active) setAppointmentErrorData({ userId: auth.user.id, message: error.message })
      })
    return () => { active = false }
  }, [auth?.token, auth?.user?.id, auth?.user?.role])

  const filteredDoctors = doctors.filter((doctor) => `${doctor.name} ${doctor.specialty}`.toLowerCase().includes(query.toLowerCase()))
  const monthDates = Array.from(
    { length: new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate() },
    (_, index) => createDateSelection(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index + 1)),
  )
  const monthOffset = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1).getDay()
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(visibleMonth)
  const canGoToPreviousMonth = visibleMonth.getFullYear() > today.getFullYear()
    || (visibleMonth.getFullYear() === today.getFullYear() && visibleMonth.getMonth() > today.getMonth())
  const chooseDoctor = (doctor) => {
    const firstDate = findNextAvailableDate(doctor)
    const firstDateTimes = getTimesForDay(doctor, firstDate.weekday)
    setSelectedDoctor({ ...doctor, slots: firstDateTimes })
    setSelectedDate(firstDate)
    setSelectedTime(firstDateTimes[0] || '')
    setBooked(false)
  }
  const openAuth = (mode = 'login', role = 'patient') => {
    setAuthError('')
    setAuthPage({ mode, role })
  }
  const logout = () => {
    localStorage.removeItem('docbook-session')
    setAuth(null)
    setShowPatientDashboard(false)
    setAuthPage(null)
  }
  const submitAuth = async (event) => {
    event.preventDefault()
    setAuthError('')
    setAuthBusy(true)
    const details = Object.fromEntries(new FormData(event.currentTarget))
    details.role = authPage.role
    try {
      const response = await fetch(`/api/auth/${authPage.mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(details),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Could not sign in.')
      if (result.user.role === 'doctor' && result.user.doctor) {
        const newDoctor = { ...result.user.doctor, id: result.user.doctor._id }
        setDoctors((current) => [...current.filter((doctor) => doctor.id !== newDoctor.id), newDoctor]
          .sort((first, second) => first.name.localeCompare(second.name)))
      }
      localStorage.setItem('docbook-session', JSON.stringify(result))
      setAuth(result)
      setShowPatientDashboard(result.user.role === 'patient')
      setAuthPage(null)
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setAuthBusy(false)
    }
  }
  const setBooked = async (value) => {
    if (!value) {
      setBookedState(false)
      return
    }
    if (!auth) {
      openAuth('login', 'patient')
      return
    }
    if (auth.user.role !== 'patient') {
      window.alert('Please log in with a patient account to book an appointment.')
      return
    }

    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({
          doctorId: selectedDoctor._id,
          date: selectedDate.value,
          time: selectedTime,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Could not book appointment.')
      setBookedState(true)
    } catch (error) {
      window.alert(error.message)
    }
  }

  const saveAvailability = async (weeklyAvailability) => {
    const response = await fetch('/api/doctors/availability', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ weeklyAvailability }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || 'Could not save availability.')
    const updatedSession = { ...auth, user: { ...auth.user, doctor: result } }
    localStorage.setItem('docbook-session', JSON.stringify(updatedSession))
    setAuth(updatedSession)
    setDoctors((current) => current.map((doctor) => doctor._id === result._id ? { ...doctor, ...result } : doctor))
  }

  const updateAppointment = async (appointmentId, action) => {
    const response = await fetch(`/api/appointments/${appointmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(action),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || 'Could not update appointment.')
    setAppointmentData((current) => current.userId === auth.user.id
      ? { ...current, records: current.records.map((appointment) => appointment._id === result._id ? result : appointment) }
      : current)
  }

  const respondToReschedule = async (appointmentId, action) => {
    const response = await fetch(`/api/appointments/${appointmentId}/reschedule-response`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.token },
      body: JSON.stringify({ action }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || 'Could not respond to the reschedule request.')
    setAppointmentData((current) => current.userId === auth.user.id
      ? { ...current, records: current.records.map((appointment) => appointment._id === result._id ? result : appointment) }
      : current)
  }

  if (window.location.pathname.replace(/\/$/, '') === '/admin') {
    return (
      <AdminPanel
        auth={auth}
        onLogin={(session) => {
          localStorage.setItem('docbook-session', JSON.stringify(session))
          setAuth(session)
        }}
        onLogout={logout}
      />
    )
  }

  if (authPage) {
    return <AuthPage page={authPage} error={authError} busy={authBusy} onChange={setAuthPage} onSubmit={submitAuth} onBack={() => setAuthPage(null)} />
  }

  if (auth?.user?.role === 'doctor') {
    return <DoctorDashboard auth={auth} appointments={appointments} error={appointmentsError} onLogout={logout} onSaveAvailability={saveAvailability} onAppointmentAction={updateAppointment} />
  }

  if (auth?.user?.role === 'patient' && showPatientDashboard) {
    return <PatientDashboard auth={auth} appointments={appointments} error={appointmentsError} onLogout={logout} onBrowse={() => setShowPatientDashboard(false)} onRespondToReschedule={respondToReschedule} />
  }

  if (!selectedDoctor) {
    return <main className="app-shell"><p className="empty-state">{loadError || 'Loading doctors...'}</p></main>
  }

  return (
    <div className="app-shell">
      <header className="topbar"><a className="brand" href="#top"><span className="brand-mark">+</span><span>DocBook</span></a><nav className="main-nav"><a className="active" href="#find-doctor">Find a doctor</a><a href="#appointments">My appointments</a><a href="#help">Help center</a></nav>{auth?.user?.role === 'patient' && <button className="profile-button" type="button" onClick={() => setShowPatientDashboard(true)}>My appointments</button>}<button className="profile-button" type="button" onClick={() => auth ? logout() : openAuth()}>{auth ? 'Log out' : 'Log in / Sign up'}</button></header>
      <main id="top">
        <section className="welcome-section" id="find-doctor"><div><p className="eyebrow">{todayLabel}</p><h1>Good morning<span>.</span></h1><p className="intro">Find the right care for you today.</p></div><div className="trust-note"><span className="shield">✓</span> Your health, handled with care</div></section>
        <section className="search-panel"><div className="search-label">What kind of care do you need?</div><div className="search-row"><label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search doctors or specialties" aria-label="Search doctors or specialties" /></label><button className="location-button" type="button"><span>⌖</span> India <b>⌄</b></button><button className="search-button" type="button" onClick={() => document.querySelector('.doctor-grid')?.scrollIntoView({ behavior: 'smooth' })}>Search <span>→</span></button></div><div className="quick-links"><span>Popular:</span> <button type="button" onClick={() => setQuery('General physician')}>General physician</button><button type="button" onClick={() => setQuery('Dermatologist')}>Dermatology</button><button type="button" onClick={() => setQuery('Pediatrician')}>Pediatrics</button></div></section>
        <section className="content-section"><div className="section-heading"><div><p className="eyebrow">AVAILABLE TODAY</p><h2>Recommended for you</h2></div><button className="view-all" type="button" onClick={() => setQuery('')}>View all doctors <span>→</span></button></div><div className="doctor-grid">{filteredDoctors.length ? filteredDoctors.map((doctor) => <article className={`doctor-card ${selectedDoctor.id === doctor.id ? 'selected' : ''}`} key={doctor.id}><div className="doctor-top"><div className={`avatar ${doctor.color}`}>{doctor.initials}</div><div className="doctor-meta"><h3>{doctor.name}</h3><p>{doctor.specialty}</p><span className="verified">✓ Verified</span></div><span className="favorite">♡</span></div><div className="doctor-stats"><span>★ <b>{doctor.rating}</b></span><span>{doctor.experience}</span><span>{doctor.patients}</span></div><div className="card-divider" /><p className="next-available"><span /> Next available <b>today</b></p><button className="select-doctor" type="button" onClick={() => chooseDoctor(doctor)}>{selectedDoctor.id === doctor.id ? 'Selected' : 'Choose doctor'} <span>→</span></button></article>) : <p className="empty-state">No doctors found. Try another search.</p>}</div></section>
        <section className="booking-section" id="appointments"><div className="booking-header"><div><p className="eyebrow">BOOK AN APPOINTMENT</p><h2>Choose a convenient time</h2></div><span className="step-count">Step 2 of 2</span></div><div className="booking-layout"><div className="booking-options"><div className="option-block"><h3>Pick a date</h3><div className="calendar-picker"><div className="calendar-header"><button type="button" aria-label="Previous month" disabled={!canGoToPreviousMonth} onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}>‹</button><strong>{monthLabel}</strong><button type="button" aria-label="Next month" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}>›</button></div><div className="calendar-grid" role="group" aria-label={monthLabel}><div className="calendar-weekday" aria-hidden="true">Sun</div><div className="calendar-weekday" aria-hidden="true">Mon</div><div className="calendar-weekday" aria-hidden="true">Tue</div><div className="calendar-weekday" aria-hidden="true">Wed</div><div className="calendar-weekday" aria-hidden="true">Thu</div><div className="calendar-weekday" aria-hidden="true">Fri</div><div className="calendar-weekday" aria-hidden="true">Sat</div>{Array.from({ length: monthOffset }, (_, index) => <span className="calendar-empty" key={`empty-${index}`} />)}{monthDates.map((date) => <button className={`calendar-date ${selectedDate.value === date.value ? 'chosen' : ''}`} type="button" key={date.value} disabled={date.value < formatDateValue(today) || !selectedDoctor.availableDays?.includes(date.weekday)} aria-label={date.fullDate} aria-pressed={selectedDate.value === date.value} onClick={() => { setSelectedDate(date); setBooked(false) }}>{date.date}</button>)}</div></div></div><div className="option-block"><h3>Available times for {selectedDate.fullDate}</h3><div className="time-list">{selectedDoctor.slots.map((time) => <button className={`time-option ${selectedTime === time ? 'chosen' : ''}`} type="button" key={time} onClick={() => { setSelectedTime(time); setBooked(false) }}>{time}</button>)}</div></div></div><aside className="summary-card"><p className="eyebrow">YOUR VISIT</p><div className="summary-doctor"><div className={`avatar small ${selectedDoctor.color}`}>{selectedDoctor.initials}</div><div><h3>{selectedDoctor.name}</h3><p>{selectedDoctor.specialty}</p></div></div><div className="summary-line"><span>Appointment</span><b>{selectedDate.fullDate}</b></div><div className="summary-line"><span>Time</span><b>{selectedTime}</b></div><button className="confirm-button" type="button" onClick={() => setBooked(true)}>{booked ? 'Appointment confirmed ✓' : 'Confirm appointment'} <span>→</span></button>{booked && <p className="confirmation">You’re all set. We’ll send a reminder to your email.</p>}</aside></div></section>
      </main><footer><span className="brand-mark">+</span> DocBook <span>Simple care, better days.</span></footer>
    </div>
  )
}

export default App
