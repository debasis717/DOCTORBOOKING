import 'dotenv/config'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import Appointment from './models/Appointment.js'
import Doctor from './models/Doctor.js'
import User from './models/User.js'
import { requireAuth, requireRole } from './middleware/auth.js'

const app = express()
const port = process.env.PORT || 5000
const weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function getWeekDay(date) {
  return weekDays[new Date(`${date}T00:00:00Z`).getUTCDay()]
}

function isValidDateValue(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
}

function getTodayValue() {
  const now = new Date()
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
}

function getTimesForDay(doctor, day) {
  if (doctor.weeklyAvailability?.length) {
    return doctor.weeklyAvailability.find((schedule) => schedule.day === day)?.times || []
  }
  return doctor.availableDays.includes(day) ? doctor.slots : []
}

app.use(cors())
app.use(express.json())

function createToken(user) {
  return jwt.sign({ id: user._id, role: user.role, name: user.name }, process.env.JWT_SECRET, { expiresIn: '7d' })
}

async function publicUser(user) {
  const doctor = user.role === 'doctor' ? await Doctor.findOne({ user: user._id }) : null
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    doctor,
  }
}

app.post('/api/auth/signup', async (request, response) => {
  const { name, email, password, role, specialty, experience, slots } = request.body
  if (!name?.trim() || !email?.trim() || !password || !role) {
    return response.status(400).json({ message: 'Name, email, password, and account type are required.' })
  }
  if (!['patient', 'doctor'].includes(role)) {
    return response.status(400).json({ message: 'Choose patient or doctor account type.' })
  }
  if (password.length < 8) {
    return response.status(400).json({ message: 'Password must be at least 8 characters.' })
  }

  const doctorSlots = typeof slots === 'string' ? slots.split(',').map((slot) => slot.trim()).filter(Boolean) : []
  if (role === 'doctor' && (!specialty?.trim() || !experience || !doctorSlots.length)) {
    return response.status(400).json({ message: 'Doctors must add a specialty, experience, and available times.' })
  }

  const normalizedEmail = email.trim().toLowerCase()
  if (await User.exists({ email: normalizedEmail })) {
    return response.status(409).json({ message: 'An account with this email already exists.' })
  }

  const user = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, 10),
    role,
  })

  try {
    if (role === 'doctor') {
      const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
      await Doctor.create({
        user: user._id,
        name: name.trim(),
        specialty: specialty.trim(),
        experience: `${experience} years experience`,
        rating: 'New',
        patients: 'Accepting patients',
        color: 'blue',
        initials,
        slots: doctorSlots,
        weeklyAvailability: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
          .map((day) => ({ day, times: doctorSlots })),
      })
    }
  } catch (error) {
    await User.deleteOne({ _id: user._id })
    throw error
  }

  response.status(201).json({ token: createToken(user), user: await publicUser(user) })
})

app.post('/api/auth/login', async (request, response) => {
  const { email, password, role } = request.body
  if (!email?.trim() || !password || !['patient', 'doctor', 'admin'].includes(role)) {
    return response.status(400).json({ message: 'Email, password, and account type are required.' })
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash')
  if (!user || user.role !== role || !await bcrypt.compare(password, user.passwordHash)) {
    return response.status(401).json({ message: 'Email or password is incorrect.' })
  }

  response.json({ token: createToken(user), user: await publicUser(user) })
})

app.get('/api/admin/dashboard', requireAuth, requireRole('admin'), async (request, response) => {
  const [users, doctors, appointments] = await Promise.all([
    User.find().select('name email role createdAt').sort({ createdAt: -1 }),
    Doctor.find().populate('user', 'name email').sort({ name: 1 }),
    Appointment.find().sort({ date: -1, time: -1 }),
  ])
  response.json({
    stats: {
      users: users.filter((user) => user.role === 'patient').length,
      doctors: doctors.length,
      appointments: appointments.length,
      pendingAppointments: appointments.filter((appointment) => appointment.status === 'pending').length,
    },
    users,
    doctors,
    appointments,
  })
})

app.delete('/api/admin/users/:userId', requireAuth, requireRole('admin'), async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.userId)) {
    return response.status(400).json({ message: 'Choose a valid user account.' })
  }

  const user = await User.findById(request.params.userId)
  if (!user || user.role === 'admin') {
    return response.status(404).json({ message: 'User account not found.' })
  }

  const doctor = user.role === 'doctor' ? await Doctor.findOne({ user: user._id }) : null
  await Appointment.deleteMany({
    $or: [
      { patient: user._id },
      ...(doctor ? [{ doctor: doctor._id }] : []),
    ],
  })
  if (doctor) await doctor.deleteOne()
  await user.deleteOne()

  response.json({ message: 'User account and related records deleted.' })
})

app.patch('/api/admin/appointments/:appointmentId', requireAuth, requireRole('admin'), async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.appointmentId)) {
    return response.status(400).json({ message: 'Choose a valid appointment.' })
  }

  const { action } = request.body
  if (!['confirm', 'cancel'].includes(action)) {
    return response.status(400).json({ message: 'Choose confirm or cancel.' })
  }

  const appointment = await Appointment.findById(request.params.appointmentId)
  if (!appointment) return response.status(404).json({ message: 'Appointment not found.' })
  if (appointment.status === 'cancelled') {
    return response.status(409).json({ message: 'This appointment has been cancelled.' })
  }

  appointment.status = action === 'confirm' ? 'confirmed' : 'cancelled'
  await appointment.save()
  response.json(appointment)
})

app.get('/api/auth/me', requireAuth, async (request, response) => {
  const user = await User.findById(request.auth.id)
  if (!user) return response.status(401).json({ message: 'Account not found. Please log in again.' })
  response.json({ user: await publicUser(user) })
})

const starterDoctors = [
  { name: 'Dr. Maya Patel', specialty: 'General physician', experience: '12 years experience', rating: '4.9', patients: '1,240 patients', color: 'coral', initials: 'MP', slots: ['09:00 AM', '10:30 AM', '02:00 PM', '04:30 PM'] },
  { name: 'Dr. Lucas Reed', specialty: 'Dermatologist', experience: '8 years experience', rating: '4.8', patients: '860 patients', color: 'blue', initials: 'LR', slots: ['09:30 AM', '11:00 AM', '01:30 PM', '03:00 PM'] },
  { name: 'Dr. Anika Shah', specialty: 'Pediatrician', experience: '15 years experience', rating: '5.0', patients: '2,100 patients', color: 'gold', initials: 'AS', slots: ['10:00 AM', '11:30 AM', '03:30 PM', '05:00 PM'] },
]

app.get('/api/doctors', async (request, response) => {
  const doctors = await Doctor.find().select('-user').sort({ name: 1 })
  response.json(doctors)
})

app.put('/api/doctors/availability', requireAuth, requireRole('doctor'), async (request, response) => {
  const { weeklyAvailability } = request.body
  if (!Array.isArray(weeklyAvailability) || !weeklyAvailability.length) {
    return response.status(400).json({ message: 'Add at least one available day and time.' })
  }

  const normalizedAvailability = []
  for (const schedule of weeklyAvailability) {
    if (!weekDays.includes(schedule.day) || !Array.isArray(schedule.times)) {
      return response.status(400).json({ message: 'Choose valid days and times.' })
    }
    const times = [...new Set(schedule.times.map((time) => typeof time === 'string' ? time.trim() : '').filter(Boolean))]
    if (!times.length || normalizedAvailability.some((entry) => entry.day === schedule.day)) {
      return response.status(400).json({ message: 'Each available day needs at least one time.' })
    }
    normalizedAvailability.push({ day: schedule.day, times })
  }
  const availableDays = normalizedAvailability.map((schedule) => schedule.day)
  const slots = [...new Set(normalizedAvailability.flatMap((schedule) => schedule.times))]

  const doctor = await Doctor.findOneAndUpdate(
    { user: request.auth.id },
    { $set: { weeklyAvailability: normalizedAvailability, availableDays, slots } },
    { new: true, runValidators: true },
  )
  if (!doctor) return response.status(404).json({ message: 'Doctor profile not found.' })
  response.json(doctor)
})

app.get('/api/appointments', requireAuth, async (request, response) => {
  const filter = request.auth.role === 'doctor'
    ? { doctor: (await Doctor.findOne({ user: request.auth.id }))?._id }
    : { patient: request.auth.id }
  if (!filter.doctor && request.auth.role === 'doctor') return response.json([])
  const appointments = await Appointment.find(filter).sort({ date: 1, time: 1 })
  response.json(appointments)
})

app.patch('/api/appointments/:appointmentId', requireAuth, requireRole('doctor'), async (request, response) => {
  const doctor = await Doctor.findOne({ user: request.auth.id })
  if (!doctor) return response.status(404).json({ message: 'Doctor profile not found.' })

  const appointment = await Appointment.findOne({ _id: request.params.appointmentId, doctor: doctor._id })
  if (!appointment) return response.status(404).json({ message: 'Appointment not found.' })
  if (appointment.status === 'cancelled') return response.status(409).json({ message: 'This appointment has been cancelled.' })

  const { action, date, time } = request.body
  if (action === 'confirm') {
    appointment.status = 'confirmed'
  } else if (action === 'cancel') {
    appointment.status = 'cancelled'
  } else if (action === 'reschedule') {
    if (!isValidDateValue(date) || date < getTodayValue() || !time) {
      return response.status(400).json({ message: 'Choose a valid future date and time.' })
    }
    const dayTimes = getTimesForDay(doctor, getWeekDay(date))
    if (!dayTimes.length) {
      return response.status(400).json({ message: 'You are not available on that day.' })
    }
    if (!dayTimes.includes(time)) {
      return response.status(400).json({ message: 'Choose a time available on that day.' })
    }
    const conflict = await Appointment.exists({
      _id: { $ne: appointment._id }, doctor: doctor._id, date, time, status: { $ne: 'cancelled' },
    })
    if (conflict) return response.status(409).json({ message: 'That time is already booked.' })
    appointment.date = date
    appointment.time = time
  } else {
    return response.status(400).json({ message: 'Choose confirm, cancel, or reschedule.' })
  }

  await appointment.save()
  response.json(appointment)
})

app.post('/api/appointments', requireAuth, requireRole('patient'), async (request, response) => {
  const { doctorId, date, time } = request.body

  if (!doctorId || !date || !time) {
    return response.status(400).json({ message: 'Doctor, date, and time are required.' })
  }

  const doctor = await Doctor.findById(doctorId)
  if (!doctor) {
    return response.status(404).json({ message: 'Doctor not found.' })
  }
  if (!isValidDateValue(date) || date < getTodayValue()) {
    return response.status(400).json({ message: 'Choose a valid future appointment date.' })
  }
  const dayTimes = getTimesForDay(doctor, getWeekDay(date))
  if (!dayTimes.length) {
    return response.status(400).json({ message: 'This doctor is not available on that day.' })
  }
  if (!dayTimes.includes(time)) {
    return response.status(400).json({ message: 'That time is not available on this day.' })
  }
  const conflict = await Appointment.exists({ doctor: doctor._id, date, time, status: { $ne: 'cancelled' } })
  if (conflict) return response.status(409).json({ message: 'That appointment time is already booked.' })

  const appointment = await Appointment.create({
    doctor: doctor._id,
    patient: request.auth.id,
    patientName: request.auth.name,
    doctorName: doctor.name,
    specialty: doctor.specialty,
    date,
    time,
  })

  response.status(201).json(appointment)
})

app.use((error, request, response, next) => {
  console.error(error)
  if (error.code === 11000) return response.status(409).json({ message: 'This account or doctor profile already exists.' })
  response.status(500).json({ message: 'Something went wrong. Please try again.' })
})

async function startServer() {
  if (!process.env.JWT_SECRET) throw new Error('Set JWT_SECRET in backend/.env before starting the API.')
  await mongoose.connect(process.env.MONGODB_URI)
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const adminPassword = process.env.ADMIN_PASSWORD
  if (Boolean(adminEmail) !== Boolean(adminPassword)) {
    throw new Error('Set both ADMIN_EMAIL and ADMIN_PASSWORD to provision the admin account.')
  }
  if (adminEmail && adminPassword) {
    if (adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.')
    const existingAdmin = await User.findOne({ email: adminEmail })
    if (existingAdmin && existingAdmin.role !== 'admin') {
      throw new Error('ADMIN_EMAIL is already used by a non-admin account.')
    }
    const passwordHash = await bcrypt.hash(adminPassword, 10)
    if (existingAdmin) {
      existingAdmin.passwordHash = passwordHash
      await existingAdmin.save()
    } else {
      await User.create({
        name: 'DocBook Administrator',
        email: adminEmail,
        passwordHash,
        role: 'admin',
      })
    }
  }
  await Promise.all(starterDoctors.map((doctor) =>
    Doctor.updateOne({ name: doctor.name }, { $setOnInsert: doctor }, { upsert: true }),
  ))
  app.listen(port, () => console.log(`DocBook API running at http://localhost:${port}`))
}

startServer().catch((error) => {
  console.error('Could not start the API:', error.message)
  process.exit(1)
})