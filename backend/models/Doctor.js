import mongoose from 'mongoose'

const doctorSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true },
  name: { type: String, required: true, unique: true },
  specialty: { type: String, required: true },
  experience: { type: String, required: true },
  rating: { type: String, required: true },
  patients: { type: String, required: true },
  color: { type: String, required: true },
  initials: { type: String, required: true },
  slots: { type: [String], required: true },
  availableDays: { type: [String], default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] },
  availabilityStatus: {
    type: String,
    enum: ['available', 'unavailable'],
    default: 'available',
  },
  availabilityStatusReason: { type: String, trim: true, maxlength: 500, default: '' },
  unavailabilityPeriods: {
    type: [{
      startDate: { type: String, required: true },
      endDate: { type: String, required: true },
      reason: {
        type: String,
        enum: [
          'Personal Emergency',
          'Medical Emergency',
          'On Leave',
          'Hospital Duty',
          'Technical Issue',
          'Other',
        ],
        required: true,
      },
      explanation: { type: String, trim: true, maxlength: 500, default: '' },
      createdAt: { type: Date, default: Date.now },
    }],
    default: [],
  },
  weeklyAvailability: {
    type: [{
      _id: false,
      day: { type: String, enum: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], required: true },
      times: { type: [String], required: true },
    }],
    default: [],
  },
})

export default mongoose.model('Doctor', doctorSchema)