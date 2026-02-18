import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// WebSocket连接管理回调
let onPermissionChangeCallback = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DOCS_DIR = path.join(DATA_DIR, 'docs');
const IMAGES_DIR = path.join(DATA_DIR, 'images');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

function readUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function readDocs() {
  const docsFile = path.join(DATA_DIR, 'docs.json');
  if (!fs.existsSync(docsFile)) return {};
  return JSON.parse(fs.readFileSync(docsFile, 'utf-8'));
}

function writeDocs(docs) {
  const docsFile = path.join(DATA_DIR, 'docs.json');
  fs.writeFileSync(docsFile, JSON.stringify(docs, null, 2));
}

export function getUsers() {
  return readUsers();
}

export function findUserByUsername(username) {
  const users = readUsers();
  return users.find(u => u.username === username);
}

export function findUserById(id) {
  const users = readUsers();
  return users.find(u => u.id === id);
}

export function createUser(username, password, isAdmin = false) {
  const users = readUsers();
  if (users.length === 0) {
    isAdmin = true;
  }
  const user = {
    id: crypto.randomUUID(),
    username,
    password,
    isAdmin,
    createdAt: new Date().toISOString()
  };
  users.push(user);
  writeUsers(users);
  return user;
}

export function getAllUsers() {
  const users = readUsers();
  const docs = readDocs();
  return users.map(u => ({
    id: u.id,
    username: u.username,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
    docCount: Object.values(docs).filter(d => d.ownerId === u.id).length
  }));
}

export function getDocs(userId = null) {
  const docs = readDocs();
  if (userId) {
    return Object.entries(docs)
      .filter(([_, d]) => d.ownerId === userId)
      .map(([id, d]) => ({ id, ...d }));
  }
  return Object.entries(docs).map(([id, d]) => ({ id, ...d }));
}

export function getDoc(id) {
  const docs = readDocs();
  return docs[id] ? { id, ...docs[id] } : null;
}

// 获取他人共享给我的文档
export function getSharedDocs(userId) {
  const docs = readDocs();
  return Object.entries(docs)
    .filter(([_, doc]) => {
      // 排除用户自己创建的文档
      if (doc.ownerId === userId) return false;
      // 检查是否是共享用户
      const isShared = doc.sharedUsers?.some(su => su.userId === userId);
      // 检查是否有待处理的邀请
      const hasPendingInvite = doc.pendingInvites?.some(invite => 
        invite.userId === userId && invite.status === 'pending'
      );
      // 返回已接受的共享文档
      return isShared;
    })
    .map(([id, doc]) => {
      // 为共享用户计算canEdit权限
      const sharedUser = doc.sharedUsers?.find(su => su.userId === userId);
      const canEdit = sharedUser?.permission === 'readwrite';
      return { id, ...doc, canEdit };
    });
}

// 获取所有可访问文档（我创建的 + 共享给我的）
export function getAllAccessibleDocs(userId) {
  const myDocs = getDocs(userId);
  const sharedDocs = getSharedDocs(userId);
  return [...myDocs, ...sharedDocs];
}

// 获取我的待处理邀请
export function getInvitations(userId) {
  const docs = readDocs();
  const invitations = [];
  
  Object.entries(docs).forEach(([docId, doc]) => {
    const pendingInvites = doc.pendingInvites?.filter(invite => 
      invite.userId === userId && invite.status === 'pending'
    );
    
    if (pendingInvites?.length > 0) {
      pendingInvites.forEach(invite => {
        // 获取邀请人的用户名
        const inviter = findUserById(invite.invitedBy);
        const invitedByUsername = inviter ? inviter.username : invite.invitedBy;
        
        invitations.push({
          docId,
          docTitle: doc.title,
          invitedBy: invitedByUsername, // 显示用户名而不是UUID
          permission: invite.permission,
          invitedAt: invite.invitedAt,
          inviteId: crypto.randomUUID() // 为每个邀请生成唯一ID
        });
      });
    }
  });
  
  return invitations;
}

export function createDoc(ownerId, title = 'Untitled', description = '') {
  const docs = readDocs();
  const id = crypto.randomUUID();
  docs[id] = {
    ownerId,
    title,
    description,
    content: '',
    permission: 'private',
    sharedUsers: [], // 已接受邀请的用户
    pendingInvites: [], // 待处理的邀请
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  writeDocs(docs);
  return { id, ...docs[id] };
}

export function updateDoc(id, updates) {
  const docs = readDocs();
  if (!docs[id]) return null;
  
  if (updates.permission === 'private') {
    docs[id] = { 
      ...docs[id], 
      ...updates, 
      updatedAt: new Date().toISOString(),
      sharedUsers: [],
      pendingInvites: []
    };
  } else {
    docs[id] = { ...docs[id], ...updates, updatedAt: new Date().toISOString() };
  }
  
  writeDocs(docs);
  return { id, ...docs[id] };
}

// 邀请用户到文档（创建待处理邀请）
export function inviteUserToDoc(docId, userId, invitedBy, permission = 'read') {
  const docs = readDocs();
  const doc = docs[docId];
  if (!doc) return null;
  
  // 检查用户是否已经是共享用户
  const isAlreadyShared = doc.sharedUsers?.some(su => su.userId === userId);
  if (isAlreadyShared) return doc;
  
  // 检查是否已有待处理的邀请
  const existingInvite = doc.pendingInvites?.find(invite => 
    invite.userId === userId && invite.status === 'pending'
  );
  
  if (existingInvite) {
    // 更新现有邀请
    existingInvite.permission = permission;
    existingInvite.invitedBy = invitedBy;
    existingInvite.invitedAt = new Date().toISOString();
  } else {
    // 创建新的邀请
    const newInvite = {
      userId,
      invitedBy,
      permission,
      status: 'pending',
      invitedAt: new Date().toISOString(),
      respondedAt: null
    };
    
    if (!doc.pendingInvites) doc.pendingInvites = [];
    doc.pendingInvites.push(newInvite);
  }
  
  docs[docId] = { ...doc, updatedAt: new Date().toISOString() };
  writeDocs(docs);
  return { id: docId, ...docs[docId] };
}

// 接受邀请
export function acceptInvitation(docId, userId) {
  const docs = readDocs();
  const doc = docs[docId];
  if (!doc) return null;
  
  // 找到待处理的邀请
  const invite = doc.pendingInvites?.find(inv => 
    inv.userId === userId && inv.status === 'pending'
  );
  
  if (!invite) return null;
  
  // 更新邀请状态
  invite.status = 'accepted';
  invite.respondedAt = new Date().toISOString();
  
  // 添加到共享用户列表
  if (!doc.sharedUsers) doc.sharedUsers = [];
  doc.sharedUsers.push({
    userId,
    permission: invite.permission,
    joinedAt: new Date().toISOString()
  });
  
  docs[docId] = { ...doc, updatedAt: new Date().toISOString() };
  writeDocs(docs);
  
  // 触发权限变更回调（从无权限变为有权限）
  triggerPermissionChange(docId, userId, null, invite.permission);
  
  return { id: docId, ...docs[docId] };
}

// 拒绝邀请
export function declineInvitation(docId, userId) {
  const docs = readDocs();
  const doc = docs[docId];
  if (!doc) return null;
  
  // 找到待处理的邀请
  const invite = doc.pendingInvites?.find(inv => 
    inv.userId === userId && inv.status === 'pending'
  );
  
  if (!invite) return null;
  
  // 更新邀请状态
  invite.status = 'declined';
  invite.respondedAt = new Date().toISOString();
  
  docs[docId] = { ...doc, updatedAt: new Date().toISOString() };
  writeDocs(docs);
  
  // 触发权限变更回调（从pending变为declined，权限不变）
  // 注意：这里旧权限和新权限都是null，因为用户还没有实际权限
  triggerPermissionChange(docId, userId, null, null);
  
  return { id: docId, ...docs[docId] };
}

// 离开共享文档
export function leaveSharedDoc(docId, userId) {
  const docs = readDocs();
  const doc = docs[docId];
  if (!doc) return null;
  
  // 从共享用户列表中移除
  if (doc.sharedUsers) {
    doc.sharedUsers = doc.sharedUsers.filter(su => su.userId !== userId);
  }
  
  docs[docId] = { ...doc, updatedAt: new Date().toISOString() };
  writeDocs(docs);
  return { id: docId, ...docs[docId] };
}

export function deleteDoc(id) {
  const docs = readDocs();
  if (!docs[id]) return false;
  delete docs[id];
  writeDocs(docs);
  return true;
}

export function canAccessDoc(doc, user) {
  if (!doc) return { canAccess: false, canEdit: false, reason: 'Document not found' };
  
  // 1. 检查所有者或管理员
  if (doc.ownerId === user?.id || user?.isAdmin) {
    return { canAccess: true, canEdit: true, permission: 'owner' };
  }
  
  // 2. 检查共享用户
  const sharedUser = doc.sharedUsers?.find(su => su.userId === user?.id);
  if (sharedUser) {
    // 自定义权限：每个用户的权限独立，由sharedUser.permission决定
    const canEdit = sharedUser.permission === 'readwrite';
    
    return { 
      canAccess: true, 
      canEdit,
      permission: sharedUser.permission 
    };
  }
  
  // 3. 检查公开权限
  switch (doc.permission) {
    case 'custom':
    case 'invited_read':
    case 'invited_readwrite':
      // 自定义权限：需要通过共享系统处理
      return { canAccess: false, canEdit: false, reason: '需要接受邀请' };
    default:
      return { canAccess: false, canEdit: false, reason: 'Document is private' };
  }
}

export function getConfig() {
  const configFile = path.join(DATA_DIR, 'config.json');
  if (!fs.existsSync(configFile)) {
    return { storageType: 'local', imageRenameRule: 'uuid' };
  }
  const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  if (!config.imageRenameRule) {
    config.imageRenameRule = 'uuid';
  }
  if (config.s3) {
    if (typeof config.s3.accessStyle === 'undefined') {
      config.s3.accessStyle = 'virtual';
    }
    if (typeof config.s3.region === 'undefined') {
      config.s3.region = 'auto';
    }
    if (typeof config.s3.folder === 'undefined') {
      config.s3.folder = 'md-image';
    }
  }
  return config;
}

// 获取文档的邀请管理信息（供文档所有者使用）
export function getDocInvitations(docId) {
  const docs = readDocs();
  const doc = docs[docId];
  if (!doc) return null;
  
  const allUsers = readUsers();
  
  // 构建完整的邀请信息列表
  const invitations = [];
  
  // 1. 已接受的共享用户
  if (doc.sharedUsers) {
    doc.sharedUsers.forEach(sharedUser => {
      const user = allUsers.find(u => u.id === sharedUser.userId);
      invitations.push({
        userId: sharedUser.userId,
        username: user?.username || 'Unknown User',
        status: 'accepted',
        permission: sharedUser.permission,
        joinedAt: sharedUser.joinedAt,
        type: 'shared'
      });
    });
  }
  
  // 2. 待处理的邀请（只显示pending状态）
  if (doc.pendingInvites) {
    doc.pendingInvites.forEach(invite => {
      // 只显示待处理的邀请，已接受或已拒绝的不显示
      if (invite.status !== 'pending') return;
      
      const user = allUsers.find(u => u.id === invite.userId);
      const inviter = allUsers.find(u => u.id === invite.invitedBy);
      const invitedByUsername = inviter ? inviter.username : invite.invitedBy;
      
      invitations.push({
        userId: invite.userId,
        username: user?.username || 'Unknown User',
        status: invite.status,
        permission: invite.permission,
        invitedBy: invitedByUsername, // 显示用户名而不是UUID
        invitedAt: invite.invitedAt,
        respondedAt: invite.respondedAt,
        type: 'pending'
      });
    });
  }
  
  return invitations;
}

// 更新已共享用户的权限
export function updateSharedUserPermission(docId, userId, newPermission) {
  const docs = readDocs();
  const doc = docs[docId];
  if (!doc) return null;
  
  // 找到共享用户
  const sharedUser = doc.sharedUsers?.find(su => su.userId === userId);
  if (!sharedUser) return null;
  
  // 保存旧权限
  const oldPermission = sharedUser.permission;
  
  // 更新权限
  sharedUser.permission = newPermission;
  
  docs[docId] = { ...doc, updatedAt: new Date().toISOString() };
  writeDocs(docs);
  
  // 触发权限变更回调
  triggerPermissionChange(docId, userId, oldPermission, newPermission);
  
  return { id: docId, ...docs[docId] };
}

// 移除待处理的邀请
export function removePendingInvite(docId, userId) {
  const docs = readDocs();
  const doc = docs[docId];
  if (!doc) return null;
  
  // 从pendingInvites中移除
  if (doc.pendingInvites) {
    doc.pendingInvites = doc.pendingInvites.filter(invite => 
      invite.userId !== userId || invite.status !== 'pending'
    );
  }
  
  docs[docId] = { ...doc, updatedAt: new Date().toISOString() };
  writeDocs(docs);
  return { id: docId, ...docs[docId] };
}

// 移除共享用户
export function removeSharedUser(docId, userId) {
  const docs = readDocs();
  const doc = docs[docId];
  if (!doc) return null;
  
  // 查找要移除的用户及其权限
  const sharedUser = doc.sharedUsers?.find(su => su.userId === userId);
  const oldPermission = sharedUser?.permission;
  
  // 从sharedUsers中移除
  if (doc.sharedUsers) {
    doc.sharedUsers = doc.sharedUsers.filter(su => su.userId !== userId);
  }
  
  docs[docId] = { ...doc, updatedAt: new Date().toISOString() };
  writeDocs(docs);
  
  // 触发权限变更回调（从有权限变为无权限）
  if (sharedUser) {
    triggerPermissionChange(docId, userId, oldPermission, null);
  }
  
  return { id: docId, ...docs[docId] };
}

// 注册权限变更回调
export function registerPermissionChangeCallback(callback) {
  onPermissionChangeCallback = callback;
}

// 触发权限变更回调
function triggerPermissionChange(docId, userId, oldPermission, newPermission) {
  if (onPermissionChangeCallback) {
    try {
      onPermissionChangeCallback(docId, userId, oldPermission, newPermission);
    } catch (error) {
      console.error('权限变更回调错误:', error);
    }
  }
}

export function saveConfig(config) {
  const configFile = path.join(DATA_DIR, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
}

export { DATA_DIR, DOCS_DIR, IMAGES_DIR };
