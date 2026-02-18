import { Router } from 'express';
import { getDocs, getDoc, createDoc, updateDoc, deleteDoc, canAccessDoc, findUserById, getUsers, getSharedDocs, getAllAccessibleDocs, getInvitations, inviteUserToDoc, acceptInvitation, declineInvitation, leaveSharedDoc, getDocInvitations, updateSharedUserPermission, removePendingInvite, removeSharedUser } from '../services/userService.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

router.get('/', (req, res) => {
  const docs = getDocs(req.user.id);
  res.json(docs);
});

// 获取他人共享给我的文档
router.get('/shared', (req, res) => {
  const sharedDocs = getSharedDocs(req.user.id);
  res.json(sharedDocs);
});

// 获取所有可访问文档（我创建的 + 共享给我的）
router.get('/all', (req, res) => {
  const allDocs = getAllAccessibleDocs(req.user.id);
  res.json(allDocs);
});

// 获取我的待处理邀请
router.get('/invitations', (req, res) => {
  const invitations = getInvitations(req.user.id);
  res.json(invitations);
});

router.get('/:id', (req, res) => {
  const doc = getDoc(req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }
  const access = canAccessDoc(doc, req.user);
  if (!access.canAccess) {
    return res.status(403).json({ error: access.reason });
  }
  res.json({ ...doc, canEdit: access.canEdit });
});

router.post('/', (req, res) => {
  const { title, description } = req.body;
  const doc = createDoc(req.user.id, title || 'Untitled', description || '');
  res.status(201).json(doc);
});

router.put('/:id', (req, res) => {
  const doc = getDoc(req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }
  const access = canAccessDoc(doc, req.user);
  if (!access.canAccess) {
    return res.status(403).json({ error: access.reason });
  }
  if (!access.canEdit) {
    return res.status(403).json({ error: 'No edit permission' });
  }
  const updated = updateDoc(req.params.id, req.body);
  res.json(updated);
});

router.post('/:id/invite', (req, res) => {
  const doc = getDoc(req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }
  if (doc.ownerId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { username, permission = 'read' } = req.body;
  
  const allUsers = getUsers();
  const target = allUsers.find(u => u.id === username || u.username === username);
  
  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // 使用新的邀请系统
  const updated = inviteUserToDoc(req.params.id, target.id, req.user.id, permission);
  res.json(updated);
});

// 获取他人共享给我的文档
router.get('/shared', (req, res) => {
  const sharedDocs = getSharedDocs(req.user.id);
  res.json(sharedDocs);
});

// 获取所有可访问文档（我创建的 + 共享给我的）
router.get('/all', (req, res) => {
  const allDocs = getAllAccessibleDocs(req.user.id);
  res.json(allDocs);
});

// 获取我的待处理邀请
router.get('/invitations', (req, res) => {
  const invitations = getInvitations(req.user.id);
  res.json(invitations);
});

// 接受邀请
router.post('/:id/accept', (req, res) => {
  const doc = getDoc(req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }
  
  const updated = acceptInvitation(req.params.id, req.user.id);
  if (!updated) {
    return res.status(400).json({ error: 'No pending invitation found' });
  }
  
  res.json(updated);
});

// 拒绝邀请
router.post('/:id/decline', (req, res) => {
  const doc = getDoc(req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }
  
  const updated = declineInvitation(req.params.id, req.user.id);
  if (!updated) {
    return res.status(400).json({ error: 'No pending invitation found' });
  }
  
  res.json(updated);
});

// 离开共享文档
router.post('/:id/leave', (req, res) => {
  const doc = getDoc(req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }
  
  // 检查用户是否是共享用户
  const isShared = doc.sharedUsers?.some(su => su.userId === req.user.id);
  if (!isShared) {
    return res.status(400).json({ error: 'You are not a shared user of this document' });
  }
  
  const updated = leaveSharedDoc(req.params.id, req.user.id);
  res.json(updated);
});

// 获取文档的邀请管理信息（文档所有者使用）
router.get('/:id/invitations/manage', (req, res) => {
  const doc = getDoc(req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }
  if (doc.ownerId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  const invitations = getDocInvitations(req.params.id);
  res.json(invitations);
});

// 更新共享用户的权限
router.put('/:id/invitations/:userId/permission', (req, res) => {
  const doc = getDoc(req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }
  if (doc.ownerId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  const { permission } = req.body;
  if (!permission || !['read', 'readwrite'].includes(permission)) {
    return res.status(400).json({ error: 'Invalid permission value' });
  }
  
  const updated = updateSharedUserPermission(req.params.id, req.params.userId, permission);
  if (!updated) {
    return res.status(404).json({ error: 'Shared user not found' });
  }
  
  res.json(updated);
});

// 移除待处理的邀请或共享用户
router.delete('/:id/invitations/:userId', (req, res) => {
  const doc = getDoc(req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }
  if (doc.ownerId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  const userId = req.params.userId;
  
  // 检查用户是共享用户还是待处理邀请
  const isSharedUser = doc.sharedUsers?.some(su => su.userId === userId);
  const hasPendingInvite = doc.pendingInvites?.some(invite => 
    invite.userId === userId && invite.status === 'pending'
  );
  
  let updated;
  if (isSharedUser) {
    // 移除共享用户
    updated = removeSharedUser(req.params.id, userId);
  } else if (hasPendingInvite) {
    // 移除待处理邀请
    updated = removePendingInvite(req.params.id, userId);
  } else {
    return res.status(404).json({ error: 'User not found in invitations or shared users' });
  }
  
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const doc = getDoc(req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }
  if (doc.ownerId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  deleteDoc(req.params.id);
  res.status(204).send();
});

export default router;
