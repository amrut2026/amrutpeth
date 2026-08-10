import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, dealerId: user.dealerId, retailerId: user.retailerId },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, dealerId: user.dealerId, retailerId: user.retailerId } });
});

// POST /api/auth/users - ADMIN creates login for a dealer/retailer; DEALER creates login for their retailer
router.post('/users', authRequired, requireRole('ADMIN', 'DEALER'), async (req, res) => {
  const { username, password, role, dealerId, retailerId } = req.body;
  if (req.user.role === 'DEALER' && role !== 'RETAILER') {
    return res.status(403).json({ error: 'Dealers can only create retailer logins' });
  }
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { username, password: hash, role, dealerId: dealerId || null, retailerId: retailerId || null }
  });
  res.json({ id: user.id, username: user.username, role: user.role });
});

router.get('/me', authRequired, (req, res) => res.json(req.user));

export default router;
