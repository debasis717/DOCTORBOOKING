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