import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, required: true, enum: ['patient', 'doctor', 'admin'] },
  isActive: { type: Boolean, default: true },
}, { timestamps: true })

export default mongoose.model('User', userSchema)