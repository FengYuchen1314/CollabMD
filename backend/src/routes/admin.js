import { Router } from 'express';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { getAllUsers, getDocs } from '../services/userService.js';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/users', (req, res) => {
  const users = getAllUsers();
  const docs = getDocs();
  const result = users.map(u => ({
    ...u,
    docCount: docs.filter(d => d.ownerId === u.id).length
  }));
  res.json(result);
});

router.get('/stats', (req, res) => {
  const users = getAllUsers();
  const docs = getDocs();
  res.json({
    totalUsers: users.length,
    totalDocs: docs.length,
    adminCount: users.filter(u => u.isAdmin).length
  });
});

export default router;
