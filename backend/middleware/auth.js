import jwt from 'jsonwebtoken'

export function requireAuth(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return response.status(401).json({ message: 'Please log in first.' })

  try {
    const { id, role, name } = jwt.verify(token, process.env.JWT_SECRET)
    request.auth = { id, role, name }
    next()
  } catch {
    response.status(401).json({ message: 'Your session expired. Please log in again.' })
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