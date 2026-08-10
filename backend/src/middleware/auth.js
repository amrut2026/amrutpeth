import jwt from 'jsonwebtoken';

export function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided' });
  const token = header.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, username, role, dealerId, retailerId }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Restrict route to a set of roles, e.g. requireRole('ADMIN','DEALER')
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden for this role' });
    }
    next();
  };
}

// Helper: resolve which owner (dealer/retailer) scope the logged-in user
// should operate under, based on their role.
export function ownerScope(req) {
  if (req.user.role === 'DEALER') return { ownerType: 'DEALER', dealerId: req.user.dealerId };
  if (req.user.role === 'RETAILER') return { ownerType: 'RETAILER', retailerId: req.user.retailerId };
  return { ownerType: null };
}
