import jwt from 'jsonwebtoken'
import User from '../models/User.js'

export async function requireAuth(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return response.status(401).json({ message: 'Please log in first.' })

  let payload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    return response.status(401).json({ message: 'Your session expired. Please log in again.' })
  }

  try {
    const user = await User.findById(payload.id).select('isActive')
    if (!user || user.isActive === false) {
      return response.status(403).json({ message: 'This account has been deactivated.' })
    }

    request.auth = { id: payload.id, role: payload.role, name: payload.name }
    return next()
  } catch (error) {
    return next(error)
  }
}

export function requireRole(role) {
  return (request, response, next) => {
    if (request.auth.role !== role) {
      return response.status(403).json({ message: `Only ${role}s can do that.` })
    }
    next()
  }
}