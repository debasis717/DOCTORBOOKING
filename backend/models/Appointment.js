import mongoose from 'mongoose'

const rescheduleRequestSchema = new mongoose.Schema({
  proposedDate: { type: String, required: true },
  proposedTime: { type: String, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  previousStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'rescheduled'],
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending',
  },
  requestedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null },
}, { _id: false })

const appointmentHistorySchema = new mongoose.Schema({
  action: {
    type: String,
    enum: [
      'confirmed',
      'reschedule_requested',
      'reschedule_accepted',
      'reschedule_rejected',
    ],
    required: true,
  },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, trim: true, maxlength: 500 },
  date: { type: String },
  time: { type: String },
  proposedDate: { type: String },
  proposedTime: { type: String },
  createdAt: { type: Date, default: Date.now },
}, { _id: false })

const appointmentSchema = new mongoose.Schema({
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  patientName: { type: String, required: true },
  doctorName: { type: String, required: true },
  specialty: { type: String, required: true },
  date: { type: String, required: true },
  time: { type: String, required: true },
  status: {
    type: String,
    enum: [
      'pending',
      'confirmed',
      'reschedule_requested',
      'rescheduled',
      'cancelled',
    ],
    default: 'pending',
  },
  rescheduleRequest: { type: rescheduleRequestSchema, default: null },
  history: { type: [appointmentHistorySchema], default: [] },
}, { timestamps: true })

export default mongoose.model('Appointment', appointmentSchema)