
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

const weekDays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

const unavailabilityReasons = [
  'Personal Emergency',
  'Medical Emergency',
  'On Leave',
  'Hospital Duty',
  'Technical Issue',
  'Other',
]
const patientCancellationReasons = [
  'Scheduling conflict',
  'Feeling better',
  'Need a different appointment time',
  'Unable to attend',
  'Other',
]

const starterDoctors = [
  {
    name: 'Dr. Maya Patel',
    specialty: 'General physician',
    experience: '12 years experience',
    rating: '4.9',
    patients: '1,240 patients',
    color: 'coral',
    initials: 'MP',
    slots: ['09:00 AM', '10:30 AM', '02:00 PM', '04:30 PM'],
  },
  {
    name: 'Dr. Lucas Reed',
    specialty: 'Dermatologist',
    experience: '8 years experience',
    rating: '4.8',
    patients: '860 patients',
    color: 'blue',
    initials: 'LR',
    slots: ['09:30 AM', '11:00 AM', '01:30 PM', '03:00 PM'],
  },
  {
    name: 'Dr. Anika Shah',
    specialty: 'Pediatrician',
    experience: '15 years experience',
    rating: '5.0',
    patients: '2,100 patients',
    color: 'gold',
    initials: 'AS',
    slots: ['10:00 AM', '11:30 AM', '03:30 PM', '05:00 PM'],
  },
]

app.use(cors())
app.use(express.json())

// -----------------------------------------------------------------------------
// Database initialization
// -----------------------------------------------------------------------------

let initializationPromise

async function initializeDatabase() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is missing from environment variables.')
  }

  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is missing from environment variables.')
  }

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI)
  }

  // Provision the admin account if both values are configured.
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const adminPassword = process.env.ADMIN_PASSWORD

  if (Boolean(adminEmail) !== Boolean(adminPassword)) {
    throw new Error('Set both ADMIN_EMAIL and ADMIN_PASSWORD.')
  }

  if (adminEmail && adminPassword) {
    if (adminPassword.length < 12) {
      throw new Error('ADMIN_PASSWORD must be at least 12 characters.')
    }

    const existingAdmin = await User.findOne({ email: adminEmail })

    if (existingAdmin && existingAdmin.role !== 'admin') {
      throw new Error(
        'ADMIN_EMAIL is already used by a non-admin account.',
      )
    }

    if (!existingAdmin) {
      await User.create({
        name: 'DocBook Administrator',
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        role: 'admin',
      })
    }
  }

  // Insert starter doctors only when they do not already exist.
  await Promise.all(
    starterDoctors.map((doctor) =>
      Doctor.updateOne(
        { name: doctor.name },
        { $setOnInsert: doctor },
        { upsert: true },
      ),
    ),
  )
}

function ensureDatabaseReady() {
  if (!initializationPromise) {
    initializationPromise = initializeDatabase().catch((error) => {
      initializationPromise = null
      throw error
    })
  }

  return initializationPromise
}

// Ensure the database is ready before handling API requests.
app.use(async (request, response, next) => {
  try {
    await ensureDatabaseReady()
    next()
  } catch (error) {
    next(error)
  }
})

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function getWeekDay(date) {
  return weekDays[new Date(`${date}T00:00:00Z`).getUTCDay()]
}

function isValidDateValue(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false
  }

  const parsedDate = new Date(`${date}T00:00:00Z`)

  return (
    !Number.isNaN(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === date
  )
}

function getTodayValue() {
  const now = new Date()

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
}

function getTimesForDay(doctor, day) {
  if (doctor.weeklyAvailability?.length) {
    return (
      doctor.weeklyAvailability.find((schedule) => schedule.day === day)
        ?.times || []
    )
  }

  return doctor.availableDays.includes(day) ? doctor.slots : []
}

function getUnavailablePeriod(doctor, date) {
  if (doctor.availabilityStatus === 'unavailable') {
    return doctor.availabilityStatusReason || 'This doctor is not accepting appointments.'
  }

  const period = doctor.unavailabilityPeriods?.find(
    (entry) => date >= entry.startDate && date <= entry.endDate,
  )

  return period
    ? `This doctor is unavailable: ${period.reason}.`
    : ''
}

function getReportDateRange(request) {
  const { from, to } = request.query

  if (!isValidDateValue(from) || !isValidDateValue(to) || from > to) {
    return null
  }

  return {
    from,
    to,
    start: new Date(`${from}T00:00:00.000Z`),
    end: new Date(`${to}T23:59:59.999Z`),
  }
}

function getAppointmentSummary(appointments) {
  const count = (status) => appointments.filter(
    (appointment) => appointment.status === status,
  ).length

  return [
    { label: 'Total appointments', value: appointments.length },
    { label: 'Pending appointments', value: count('pending') },
    { label: 'Confirmed appointments', value: count('confirmed') },
    { label: 'Completed appointments', value: count('completed') },
    { label: 'Cancelled appointments', value: count('cancelled') },
    { label: 'Reschedule requests', value: count('reschedule_requested') },
    { label: 'Rescheduled appointments', value: count('rescheduled') },
    {
      label: 'Rejected reschedule requests',
      value: appointments.filter(
        (appointment) => appointment.rescheduleRequest?.status === 'rejected',
      ).length,
    },
  ]
}

function countByMonth(records, getDate) {
  const counts = new Map()

  for (const record of records) {
    const month = getDate(record).slice(0, 7)
    counts.set(month, (counts.get(month) || 0) + 1)
  }

  return [...counts.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([month, count]) => ({ month, count }))
}

function createToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  )
}

async function publicUser(user) {
  const doctor =
    user.role === 'doctor'
      ? await Doctor.findOne({ user: user._id })
      : null

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive !== false,
    doctor,
  }
}

// -----------------------------------------------------------------------------
// Authentication routes
// -----------------------------------------------------------------------------

app.post('/api/auth/signup', async (request, response, next) => {
  try {
    const {
      name,
      email,
      password,
      role,
      specialty,
      experience,
      slots,
    } = request.body

    if (!name?.trim() || !email?.trim() || !password || !role) {
      return response.status(400).json({
        message: 'Name, email, password, and account type are required.',
      })
    }

    if (!['patient', 'doctor'].includes(role)) {
      return response.status(400).json({
        message: 'Choose patient or doctor account type.',
      })
    }

    if (typeof password !== 'string' || password.length < 8) {
      return response.status(400).json({
        message: 'Password must be at least 8 characters.',
      })
    }

    const doctorSlots =
      typeof slots === 'string'
        ? slots.split(',').map((slot) => slot.trim()).filter(Boolean)
        : []

    if (
      role === 'doctor' &&
      (!specialty?.trim() || !experience || !doctorSlots.length)
    ) {
      return response.status(400).json({
        message:
          'Doctors must add a specialty, experience, and available times.',
      })
    }

    const normalizedEmail = email.trim().toLowerCase()

    if (await User.exists({ email: normalizedEmail })) {
      return response.status(409).json({
        message: 'An account with this email already exists.',
      })
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 10),
      role,
    })

    try {
      if (role === 'doctor') {
        const initials = name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join('')
          .toUpperCase()

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
          weeklyAvailability: [
            'Monday',
            'Tuesday',
            'Wednesday',
            'Thursday',
            'Friday',
          ].map((day) => ({ day, times: doctorSlots })),
        })
      }
    } catch (error) {
      await User.deleteOne({ _id: user._id })
      throw error
    }

    return response.status(201).json({
      token: createToken(user),
      user: await publicUser(user),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const { email, password, role } = request.body

    if (
      !email?.trim() ||
      !password ||
      !['patient', 'doctor', 'admin'].includes(role)
    ) {
      return response.status(400).json({
        message: 'Email, password, and account type are required.',
      })
    }

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select('+passwordHash')

    if (
      !user ||
      user.role !== role ||
      !await bcrypt.compare(password, user.passwordHash)
    ) {
      return response.status(401).json({
        message: 'Email or password is incorrect.',
      })
    }

    if (user.isActive === false) {
      return response.status(403).json({
        message: 'This account has been deactivated. Contact an administrator.',
      })
    }

    return response.json({
      token: createToken(user),
      user: await publicUser(user),
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/me', requireAuth, async (request, response, next) => {
  try {
    const user = await User.findById(request.auth.id)

    if (!user) {
      return response.status(401).json({
        message: 'Account not found. Please log in again.',
      })
    }

    return response.json({ user: await publicUser(user) })
  } catch (error) {
    next(error)
  }
})

// -----------------------------------------------------------------------------
// Admin routes
// -----------------------------------------------------------------------------

app.get(
  '/api/admin/dashboard',
  requireAuth,
  requireRole('admin'),
  async (request, response, next) => {
    try {
      const [users, doctors, appointments] = await Promise.all([
        User.find()
          .select('name email role isActive createdAt')
          .sort({ createdAt: -1 }),
        Doctor.find().populate('user', 'name email isActive').sort({ name: 1 }),
        Appointment.find().sort({ date: -1, time: -1 }),
      ])

      return response.json({
        stats: {
          users: users.filter((user) => user.role === 'patient').length,
          doctors: doctors.length,
          appointments: appointments.length,
          pendingAppointments: appointments.filter(
            (appointment) => appointment.status === 'pending',
          ).length,
        },
        users,
        doctors,
        appointments,
      })
    } catch (error) {
      next(error)
    }
  },
)

app.get(
  '/api/admin/reports',
  requireAuth,
  requireRole('admin'),
  async (request, response, next) => {
    try {
      const range = getReportDateRange(request)

      if (!range) {
        return response.status(400).json({
          message: 'Choose a valid report start and end date.',
        })
      }

      const [registrations, totalUsers, totalPatients, doctors, appointments] = await Promise.all([
        User.find({ createdAt: { $gte: range.start, $lte: range.end } })
          .select('name email role createdAt')
          .sort({ createdAt: 1 }),
        User.countDocuments(),
        User.countDocuments({ role: 'patient' }),
        Doctor.find().populate('user', 'email').sort({ name: 1 }),
        Appointment.find({ date: { $gte: range.from, $lte: range.to } })
          .sort({ date: 1, time: 1 }),
      ])

      const appointmentSummary = getAppointmentSummary(appointments)
      const appointmentsByMonth = countByMonth(appointments, (appointment) => appointment.date)
      const registrationsByMonth = countByMonth(
        registrations,
        (user) => new Date(user.createdAt).toISOString().slice(0, 10),
      )
      const doctorsByMonth = countByMonth(
        registrations.filter((user) => user.role === 'doctor'),
        (user) => new Date(user.createdAt).toISOString().slice(0, 10),
      )
      const monthlyCounts = new Map()

      for (const month of appointmentsByMonth) {
        monthlyCounts.set(month.month, {
          month: month.month,
          appointments: month.count,
          registrations: 0,
          doctors: 0,
        })
      }

      for (const month of registrationsByMonth) {
        const counts = monthlyCounts.get(month.month) || {
          month: month.month,
          appointments: 0,
          registrations: 0,
          doctors: 0,
        }
        counts.registrations = month.count
        monthlyCounts.set(month.month, counts)
      }

      for (const month of doctorsByMonth) {
        const counts = monthlyCounts.get(month.month) || {
          month: month.month,
          appointments: 0,
          registrations: 0,
          doctors: 0,
        }
        counts.doctors = month.count
        monthlyCounts.set(month.month, counts)
      }

      const summary = [
        { label: 'Total registered users', value: totalUsers },
        { label: 'Registered patients', value: totalPatients },
        { label: 'New registrations', value: registrations.length },
        { label: 'Total doctors', value: doctors.length },
        {
          label: 'Available doctors',
          value: doctors.filter((doctor) => doctor.availabilityStatus !== 'unavailable').length,
        },
        {
          label: 'Unavailable doctors',
          value: doctors.filter((doctor) => doctor.availabilityStatus === 'unavailable').length,
        },
        ...appointmentSummary,
      ]

      const doctorRows = doctors.map((doctor) => {
        const doctorAppointments = appointments.filter(
          (appointment) => String(appointment.doctor) === String(doctor._id),
        )

        return {
          doctor: doctor.name,
          specialty: doctor.specialty,
          availability: doctor.availabilityStatus || 'available',
          appointments: doctorAppointments.length,
          completed: doctorAppointments.filter((appointment) => appointment.status === 'completed').length,
          cancelled: doctorAppointments.filter((appointment) => appointment.status === 'cancelled').length,
          rescheduled: doctorAppointments.filter((appointment) => appointment.status === 'rescheduled').length,
        }
      })

      return response.json({
        projectName: 'Doctor Booking System',
        title: 'System Activity Report',
        generatedAt: new Date().toISOString(),
        from: range.from,
        to: range.to,
        summary,
        tables: [
          {
            title: 'Registrations',
            columns: ['Name', 'Email', 'Role', 'Registered'],
            rows: registrations.map((user) => ({
              name: user.name,
              email: user.email,
              role: user.role,
              registered: user.createdAt.toISOString().slice(0, 10),
            })),
          },
          {
            title: 'Doctor appointment statistics',
            columns: ['Doctor', 'Specialty', 'Availability', 'Appointments', 'Completed', 'Cancelled', 'Rescheduled'],
            rows: doctorRows,
          },
          {
            title: 'Appointments',
            columns: ['Patient', 'Doctor', 'Specialty', 'Date', 'Time', 'Status'],
            rows: appointments.map((appointment) => ({
              patient: appointment.patientName,
              doctor: appointment.doctorName,
              specialty: appointment.specialty,
              date: appointment.date,
              time: appointment.time,
              status: appointment.status,
            })),
          },
          {
            title: 'Monthly growth',
            columns: ['Month', 'Appointments', 'Registrations', 'Doctor registrations'],
            rows: [...monthlyCounts.values()].sort(
              (first, second) => first.month.localeCompare(second.month),
            ),
          },
        ],
      })
    } catch (error) {
      next(error)
    }
  },
)

app.patch(
  '/api/admin/users/:userId/activation',
  requireAuth,
  requireRole('admin'),
  async (request, response, next) => {
    try {
      if (!mongoose.isValidObjectId(request.params.userId)) {
        return response.status(400).json({
          message: 'Choose a valid user account.',
        })
      }

      const { isActive } = request.body
      if (typeof isActive !== 'boolean') {
        return response.status(400).json({
          message: 'Choose whether the account should be active.',
        })
      }

      const user = await User.findById(request.params.userId)
      if (!user || user.role === 'admin') {
        return response.status(404).json({
          message: 'User account not found.',
        })
      }

      user.isActive = isActive
      await user.save()
      return response.json({
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      })
    } catch (error) {
      next(error)
    }
  },
)

app.delete(
  '/api/admin/users/:userId',
  requireAuth,
  requireRole('admin'),
  async (request, response, next) => {
    try {
      if (!mongoose.isValidObjectId(request.params.userId)) {
        return response.status(400).json({
          message: 'Choose a valid user account.',
        })
      }

      const user = await User.findById(request.params.userId)

      if (!user || user.role === 'admin') {
        return response.status(404).json({
          message: 'User account not found.',
        })
      }

      const doctor =
        user.role === 'doctor'
          ? await Doctor.findOne({ user: user._id })
          : null

      await Appointment.deleteMany({
        $or: [
          { patient: user._id },
          ...(doctor ? [{ doctor: doctor._id }] : []),
        ],
      })

      if (doctor) await doctor.deleteOne()
      await user.deleteOne()

      return response.json({
        message: 'User account and related records deleted.',
      })
    } catch (error) {
      next(error)
    }
  },
)

app.patch(
  '/api/admin/appointments/:appointmentId',
  requireAuth,
  requireRole('admin'),
  async (request, response, next) => {
    try {
      if (!mongoose.isValidObjectId(request.params.appointmentId)) {
        return response.status(400).json({
          message: 'Choose a valid appointment.',
        })
      }

      const { action } = request.body

      if (!['confirm', 'cancel'].includes(action)) {
        return response.status(400).json({
          message: 'Choose confirm or cancel.',
        })
      }

      const appointment = await Appointment.findById(
        request.params.appointmentId,
      )

      if (!appointment) {
        return response.status(404).json({
          message: 'Appointment not found.',
        })
      }

      if (appointment.status === 'cancelled') {
        return response.status(409).json({
          message: 'This appointment has been cancelled.',
        })
      }

      if (appointment.status === 'completed') {
        return response.status(409).json({
          message: 'Completed appointments cannot be changed.',
        })
      }

      if (action === 'confirm' && appointment.status !== 'pending') {
        return response.status(409).json({
          message: 'Only pending appointments can be confirmed.',
        })
      }

      if (action === 'cancel' && appointment.rescheduleRequest?.status === 'pending') {
        appointment.rescheduleRequest.status = 'rejected'
        appointment.rescheduleRequest.respondedAt = new Date()
      }

      appointment.status =
        action === 'confirm' ? 'confirmed' : 'cancelled'

      await appointment.save()

      return response.json(appointment)
    } catch (error) {
      next(error)
    }
  },
)

// -----------------------------------------------------------------------------
// Doctor routes
// -----------------------------------------------------------------------------

app.get('/api/doctors', async (request, response, next) => {
  try {
    const doctors = await Doctor.find()
      .populate('user', 'isActive')
      .sort({ name: 1 })

    return response.json(doctors
      .filter((doctor) => !doctor.user || doctor.user.isActive !== false)
      .map((doctor) => {
        const publicDoctor = doctor.toObject()
        delete publicDoctor.user
        return publicDoctor
      }))
  } catch (error) {
    next(error)
  }
})

app.put(
  '/api/doctors/availability',
  requireAuth,
  requireRole('doctor'),
  async (request, response, next) => {
    try {
      const { weeklyAvailability } = request.body

      if (!Array.isArray(weeklyAvailability) || !weeklyAvailability.length) {
        return response.status(400).json({
          message: 'Add at least one available day and time.',
        })
      }

      const normalizedAvailability = []

      for (const schedule of weeklyAvailability) {
        if (
          !weekDays.includes(schedule.day) ||
          !Array.isArray(schedule.times)
        ) {
          return response.status(400).json({
            message: 'Choose valid days and times.',
          })
        }

        const times = [
          ...new Set(
            schedule.times
              .map((time) => typeof time === 'string' ? time.trim() : '')
              .filter(Boolean),
          ),
        ]

        if (
          !times.length ||
          normalizedAvailability.some(
            (entry) => entry.day === schedule.day,
          )
        ) {
          return response.status(400).json({
            message: 'Each available day needs at least one time.',
          })
        }

        normalizedAvailability.push({
          day: schedule.day,
          times,
        })
      }

      const availableDays = normalizedAvailability.map(
        (schedule) => schedule.day,
      )

      const slots = [
        ...new Set(
          normalizedAvailability.flatMap((schedule) => schedule.times),
        ),
      ]

      const doctor = await Doctor.findOneAndUpdate(
        { user: request.auth.id },
        {
          $set: {
            weeklyAvailability: normalizedAvailability,
            availableDays,
            slots,
          },
        },
        { new: true, runValidators: true },
      )

      if (!doctor) {
        return response.status(404).json({
          message: 'Doctor profile not found.',
        })
      }

      return response.json(doctor)
    } catch (error) {
      next(error)
    }
  },
)

app.put(
  '/api/doctors/availability/status',
  requireAuth,
  requireRole('doctor'),
  async (request, response, next) => {
    try {
      const { status } = request.body
      const reason = typeof request.body.reason === 'string'
        ? request.body.reason.trim()
        : ''

      if (!['available', 'unavailable'].includes(status)) {
        return response.status(400).json({
          message: 'Choose available or unavailable.',
        })
      }

      if (
        status === 'unavailable' &&
        (!unavailabilityReasons.includes(reason) || reason.length > 500)
      ) {
        return response.status(400).json({
          message: 'Choose a valid reason when pausing bookings.',
        })
      }

      const doctor = await Doctor.findOne({ user: request.auth.id })

      if (!doctor) {
        return response.status(404).json({
          message: 'Doctor profile not found.',
        })
      }

      doctor.availabilityStatus = status
      doctor.availabilityStatusReason = status === 'unavailable' ? reason : ''
      await doctor.save()

      return response.json(doctor)
    } catch (error) {
      next(error)
    }
  },
)

app.post(
  '/api/doctors/unavailability',
  requireAuth,
  requireRole('doctor'),
  async (request, response, next) => {
    try {
      const { startDate, endDate, reason } = request.body
      const explanation = typeof request.body.explanation === 'string'
        ? request.body.explanation.trim()
        : ''

      if (
        !isValidDateValue(startDate) ||
        !isValidDateValue(endDate) ||
        startDate < getTodayValue() ||
        endDate < startDate ||
        !unavailabilityReasons.includes(reason) ||
        (request.body.explanation !== undefined && typeof request.body.explanation !== 'string') ||
        explanation.length > 500
      ) {
        return response.status(400).json({
          message: 'Choose a valid future date range, reason, and explanation of at most 500 characters.',
        })
      }

      const doctor = await Doctor.findOne({ user: request.auth.id })

      if (!doctor) {
        return response.status(404).json({
          message: 'Doctor profile not found.',
        })
      }

      const overlaps = doctor.unavailabilityPeriods.some(
        (period) => startDate <= period.endDate && endDate >= period.startDate,
      )

      if (overlaps) {
        return response.status(409).json({
          message: 'This date range overlaps an existing unavailability period.',
        })
      }

      doctor.unavailabilityPeriods.push({
        startDate,
        endDate,
        reason,
        explanation,
      })
      await doctor.save()

      return response.status(201).json(doctor)
    } catch (error) {
      next(error)
    }
  },
)

app.delete(
  '/api/doctors/unavailability/:periodId',
  requireAuth,
  requireRole('doctor'),
  async (request, response, next) => {
    try {
      if (!mongoose.isValidObjectId(request.params.periodId)) {
        return response.status(400).json({
          message: 'Choose a valid unavailability period.',
        })
      }

      const doctor = await Doctor.findOne({ user: request.auth.id })

      if (!doctor) {
        return response.status(404).json({
          message: 'Doctor profile not found.',
        })
      }

      const period = doctor.unavailabilityPeriods.id(request.params.periodId)

      if (!period) {
        return response.status(404).json({
          message: 'Unavailability period not found.',
        })
      }

      period.deleteOne()
      await doctor.save()

      return response.json(doctor)
    } catch (error) {
      next(error)
    }
  },
)

app.get(
  '/api/reports/doctor',
  requireAuth,
  requireRole('doctor'),
  async (request, response, next) => {
    try {
      const range = getReportDateRange(request)

      if (!range) {
        return response.status(400).json({
          message: 'Choose a valid report start and end date.',
        })
      }

      const doctor = await Doctor.findOne({ user: request.auth.id })

      if (!doctor) {
        return response.status(404).json({
          message: 'Doctor profile not found.',
        })
      }

      const appointments = await Appointment.find({
        doctor: doctor._id,
        date: { $gte: range.from, $lte: range.to },
      }).sort({ date: 1, time: 1 })
      const uniquePatients = new Set(
        appointments.map((appointment) => String(appointment.patient)),
      )
      const monthly = countByMonth(appointments, (appointment) => appointment.date)

      return response.json({
        projectName: 'Doctor Booking System',
        title: 'Doctor Appointment Report',
        generatedAt: new Date().toISOString(),
        from: range.from,
        to: range.to,
        summary: [
          ...getAppointmentSummary(appointments),
          { label: 'Unique patients', value: uniquePatients.size },
        ],
        tables: [
          {
            title: 'Appointment history',
            columns: ['Date', 'Time', 'Patient', 'Specialty', 'Status', 'Reschedule request'],
            rows: appointments.map((appointment) => ({
              date: appointment.date,
              time: appointment.time,
              patient: appointment.patientName,
              specialty: appointment.specialty,
              status: appointment.status,
              rescheduleRequest: appointment.rescheduleRequest?.status || 'none',
            })),
          },
          {
            title: 'Monthly appointment statistics',
            columns: ['Month', 'Appointments'],
            rows: monthly,
          },
        ],
      })
    } catch (error) {
      next(error)
    }
  },
)

// -----------------------------------------------------------------------------
// Appointment routes
// -----------------------------------------------------------------------------

app.get('/api/appointments', requireAuth, async (request, response, next) => {
  try {
    const filter =
      request.auth.role === 'doctor'
        ? {
            doctor: (
              await Doctor.findOne({ user: request.auth.id })
            )?._id,
          }
        : { patient: request.auth.id }

    if (!filter.doctor && request.auth.role === 'doctor') {
      return response.json([])
    }

    const appointments = await Appointment.find(filter)
      .sort({ date: 1, time: 1 })

    return response.json(appointments)
  } catch (error) {
    next(error)
  }
})

app.patch(
  '/api/appointments/:appointmentId',
  requireAuth,
  requireRole('doctor'),
  async (request, response, next) => {
    try {
      const doctor = await Doctor.findOne({ user: request.auth.id })

      if (!doctor) {
        return response.status(404).json({
          message: 'Doctor profile not found.',
        })
      }

      const appointment = await Appointment.findOne({
        _id: request.params.appointmentId,
        doctor: doctor._id,
      })

      if (!appointment) {
        return response.status(404).json({
          message: 'Appointment not found.',
        })
      }

      if (appointment.status === 'cancelled') {
        return response.status(409).json({
          message: 'This appointment has been cancelled.',
        })
      }

      if (appointment.status === 'completed') {
        return response.status(409).json({
          message: 'Completed appointments cannot be changed.',
        })
      }

      const { action, date, time } = request.body

      if (action === 'confirm') {
        if (appointment.status !== 'pending') {
          return response.status(409).json({
            message: 'Only pending appointments can be confirmed.',
          })
        }

        appointment.status = 'confirmed'
      } else if (action === 'complete') {
        if (appointment.status !== 'confirmed' || appointment.date > getTodayValue()) {
          return response.status(409).json({
            message: 'Only confirmed appointments scheduled for today or earlier can be completed.',
          })
        }

        appointment.status = 'completed'
      } else if (action === 'cancel') {
        if (appointment.rescheduleRequest?.status === 'pending') {
          appointment.rescheduleRequest.status = 'rejected'
          appointment.rescheduleRequest.respondedAt = new Date()
        }
        appointment.status = 'cancelled'
      } else if (action === 'reschedule') {
        const reason = typeof request.body.reason === 'string'
          ? request.body.reason.trim()
          : ''

        if (!['pending', 'confirmed', 'rescheduled'].includes(appointment.status)) {
          return response.status(409).json({
            message: 'This appointment cannot be rescheduled right now.',
          })
        }

        if (
          !isValidDateValue(date) ||
          date < getTodayValue() ||
          typeof time !== 'string' ||
          !time.trim() ||
          (date === appointment.date && time.trim() === appointment.time) ||
          !reason ||
          reason.length > 500
        ) {
          return response.status(400).json({
            message: 'Choose a future time different from the current appointment and provide a reason of at most 500 characters.',
          })
        }

        const unavailableReason = getUnavailablePeriod(doctor, date)

        if (unavailableReason) {
          return response.status(409).json({
            message: unavailableReason,
          })
        }

        const dayTimes = getTimesForDay(doctor, getWeekDay(date))

        if (!dayTimes.length) {
          return response.status(400).json({
            message: 'You are not available on that day.',
          })
        }

        if (!dayTimes.includes(time)) {
          return response.status(400).json({
            message: 'Choose a time available on that day.',
          })
        }

        const conflict = await Appointment.exists({
          _id: { $ne: appointment._id },
          doctor: doctor._id,
          date,
          time,
          status: { $ne: 'cancelled' },
        })

        if (conflict) {
          return response.status(409).json({
            message: 'That time is already booked.',
          })
        }

        appointment.rescheduleRequest = {
          proposedDate: date,
          proposedTime: time.trim(),
          reason,
          previousStatus: appointment.status,
          status: 'pending',
        }
        appointment.status = 'reschedule_requested'
        appointment.history.push({
          action: 'reschedule_requested',
          actor: request.auth.id,
          reason,
          date: appointment.date,
          time: appointment.time,
          proposedDate: date,
          proposedTime: time.trim(),
        })
      } else {
        return response.status(400).json({
          message: 'Choose confirm, complete, cancel, or reschedule.',
        })
      }

      await appointment.save()

      return response.json(appointment)
    } catch (error) {
      next(error)
    }
  },
)

app.patch(
  '/api/appointments/:appointmentId/reschedule-response',
  requireAuth,
  requireRole('patient'),
  async (request, response, next) => {
    try {
      if (!mongoose.isValidObjectId(request.params.appointmentId)) {
        return response.status(400).json({
          message: 'Choose a valid appointment.',
        })
      }

      const appointment = await Appointment.findOne({
        _id: request.params.appointmentId,
        patient: request.auth.id,
      })

      if (!appointment) {
        return response.status(404).json({
          message: 'Appointment not found.',
        })
      }

      const proposal = appointment.rescheduleRequest

      if (
        appointment.status !== 'reschedule_requested' ||
        proposal?.status !== 'pending'
      ) {
        return response.status(409).json({
          message: 'There is no pending reschedule request for this appointment.',
        })
      }

      const { action } = request.body

      if (!['accept', 'reject'].includes(action)) {
        return response.status(400).json({
          message: 'Choose accept or reject.',
        })
      }

      if (action === 'accept') {
        const originalDate = appointment.date
        const originalTime = appointment.time
        const doctor = await Doctor.findById(appointment.doctor)

        if (!doctor) {
          return response.status(404).json({
            message: 'The doctor profile for this appointment no longer exists.',
          })
        }

        const unavailableReason = getUnavailablePeriod(doctor, proposal.proposedDate)

        if (
          !isValidDateValue(proposal.proposedDate) ||
          proposal.proposedDate < getTodayValue() ||
          unavailableReason ||
          !getTimesForDay(doctor, getWeekDay(proposal.proposedDate))
            .includes(proposal.proposedTime)
        ) {
          return response.status(409).json({
            message: unavailableReason || 'The proposed time is no longer available. Ask the doctor for another time.',
          })
        }

        const conflict = await Appointment.exists({
          _id: { $ne: appointment._id },
          doctor: doctor._id,
          date: proposal.proposedDate,
          time: proposal.proposedTime,
          status: { $ne: 'cancelled' },
        })

        if (conflict) {
          return response.status(409).json({
            message: 'The proposed time has already been booked. Ask the doctor for another time.',
          })
        }

        appointment.date = proposal.proposedDate
        appointment.time = proposal.proposedTime
        appointment.status = 'rescheduled'
        proposal.status = 'accepted'
        appointment.history.push({
          action: 'reschedule_accepted',
          actor: request.auth.id,
          date: originalDate,
          time: originalTime,
          proposedDate: proposal.proposedDate,
          proposedTime: proposal.proposedTime,
        })
      } else {
        appointment.status = proposal.previousStatus
        proposal.status = 'rejected'
        appointment.history.push({
          action: 'reschedule_rejected',
          actor: request.auth.id,
          date: appointment.date,
          time: appointment.time,
          proposedDate: proposal.proposedDate,
          proposedTime: proposal.proposedTime,
        })
      }

      proposal.respondedAt = new Date()
      await appointment.save()

      return response.json(appointment)
    } catch (error) {
      next(error)
    }
  },
)

app.patch(
  '/api/appointments/:appointmentId/patient-cancel',
  requireAuth,
  requireRole('patient'),
  async (request, response, next) => {
    try {
      if (!mongoose.isValidObjectId(request.params.appointmentId)) {
        return response.status(400).json({
          message: 'Choose a valid appointment.',
        })
      }

      const appointment = await Appointment.findOne({
        _id: request.params.appointmentId,
        patient: request.auth.id,
      })

      if (!appointment) {
        return response.status(404).json({
          message: 'Appointment not found.',
        })
      }

      if (
        !['pending', 'confirmed', 'rescheduled', 'reschedule_requested']
          .includes(appointment.status) ||
        appointment.date < getTodayValue()
      ) {
        return response.status(409).json({
          message: 'This appointment can no longer be cancelled.',
        })
      }

      const reason = typeof request.body.reason === 'string'
        ? request.body.reason.trim()
        : ''
      const details = typeof request.body.details === 'string'
        ? request.body.details.trim()
        : ''

      if (
        !patientCancellationReasons.includes(reason) ||
        details.length > 450
      ) {
        return response.status(400).json({
          message: 'Choose a cancellation reason and keep additional details under 450 characters.',
        })
      }

      if (appointment.rescheduleRequest?.status === 'pending') {
        appointment.rescheduleRequest.status = 'rejected'
        appointment.rescheduleRequest.respondedAt = new Date()
      }

      appointment.status = 'cancelled'
      appointment.history.push({
        action: 'patient_cancelled',
        actor: request.auth.id,
        reason: details ? `${reason}: ${details}` : reason,
        date: appointment.date,
        time: appointment.time,
      })
      await appointment.save()

      return response.json(appointment)
    } catch (error) {
      next(error)
    }
  },
)

app.post(
  '/api/appointments',
  requireAuth,
  requireRole('patient'),
  async (request, response, next) => {
    try {
      const { doctorId, date, time } = request.body

      if (!doctorId || !date || !time) {
        return response.status(400).json({
          message: 'Doctor, date, and time are required.',
        })
      }

      const doctor = await Doctor.findById(doctorId)

      if (!doctor) {
        return response.status(404).json({
          message: 'Doctor not found.',
        })
      }

      if (doctor.user) {
        const doctorAccount = await User.findById(doctor.user).select('isActive')
        if (!doctorAccount || doctorAccount.isActive === false) {
          return response.status(404).json({
            message: 'Doctor not found.',
          })
        }
      }

      if (!isValidDateValue(date) || date < getTodayValue()) {
        return response.status(400).json({
          message: 'Choose a valid future appointment date.',
        })
      }

      const unavailableReason = getUnavailablePeriod(doctor, date)

      if (unavailableReason) {
        return response.status(409).json({
          message: unavailableReason,
        })
      }

      const dayTimes = getTimesForDay(doctor, getWeekDay(date))

      if (!dayTimes.length) {
        return response.status(400).json({
          message: 'This doctor is not available on that day.',
        })
      }

      if (!dayTimes.includes(time)) {
        return response.status(400).json({
          message: 'That time is not available on this day.',
        })
      }

      const conflict = await Appointment.exists({
        doctor: doctor._id,
        date,
        time,
        status: { $ne: 'cancelled' },
      })

      if (conflict) {
        return response.status(409).json({
          message: 'That appointment time is already booked.',
        })
      }

      const appointment = await Appointment.create({
        doctor: doctor._id,
        patient: request.auth.id,
        patientName: request.auth.name,
        doctorName: doctor.name,
        specialty: doctor.specialty,
        date,
        time,
      })

      return response.status(201).json(appointment)
    } catch (error) {
      next(error)
    }
  },
)

// -----------------------------------------------------------------------------
// Health check
// -----------------------------------------------------------------------------

app.get('/api/health', (request, response) => {
  response.json({
    status: 'ok',
    database:
      mongoose.connection.readyState === 1 ? 'connected' : 'connecting',
  })
})

// -----------------------------------------------------------------------------
// Error handler
// -----------------------------------------------------------------------------

app.use((error, request, response, next) => {
  console.error('API error:', error)

  if (response.headersSent) {
    return next(error)
  }

  if (error.code === 11000) {
    return response.status(409).json({
      message: 'This account or doctor profile already exists.',
    })
  }

  return response.status(500).json({
    message: 'Something went wrong. Please try again.',
  })
})

// -----------------------------------------------------------------------------
// Local development and Vercel export
// -----------------------------------------------------------------------------

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`DocBook API running at http://localhost:${port}`)
  })
}

export default app
