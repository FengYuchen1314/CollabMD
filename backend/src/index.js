import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { URL } from 'url';
import authRoutes from './routes/auth.js';
import docRoutes from './routes/docs.js';
import uploadRoutes from './routes/upload.js';
import adminRoutes from './routes/admin.js';
import configRoutes from './routes/config.js';
import { verifyToken } from './middleware/auth.js';
import { findUserById, canAccessDoc, getDoc, registerPermissionChangeCallback } from './services/userService.js';

// 跟踪活跃的WebSocket连接
const activeConnections = new Map(); // docId -> Set of connections

// 注册权限变更回调
registerPermissionChangeCallback((docId, userId, oldPermission, newPermission) => {
  console.log(`权限变更：用户 ${userId} 在文档 ${docId} 的权限从 ${oldPermission} 变为 ${newPermission}`);
  
  // 如果权限实际发生变化（包括null到有权限，有权限到null，或读写<>只读变化），断开连接
  if (oldPermission !== newPermission) {
    disconnectUserFromDoc(userId, docId);
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use('/api/upload/images', express.static(join(__dirname, '../data/images')));
app.use(express.static(join(__dirname, '../../frontend/dist')));

app.use('/api/auth', authRoutes);
app.use('/api/docs', docRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/config', configRoutes);

wss.on('connection', (conn, req) => {
  try {
    // 解析URL以获取查询参数
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    
    if (!token) {
      console.log('WebSocket连接被拒绝：无令牌');
      conn.close(1008, 'Authentication required');
      return;
    }
    
    // 验证令牌
    const decoded = verifyToken(token);
    if (!decoded) {
      console.log('WebSocket连接被拒绝：无效令牌');
      conn.close(1008, 'Invalid token');
      return;
    }
    
    // 获取用户信息
    const user = findUserById(decoded.id);
    if (!user) {
      console.log('WebSocket连接被拒绝：用户不存在');
      conn.close(1008, 'User not found');
      return;
    }
    
    // 从查询参数提取文档ID，如果不存在则从URL路径提取
    let docId = url.searchParams.get('docId');
    
    if (!docId) {
      // 从URL路径提取文档ID（房间名）
      // y-websocket的路径格式通常是：/ws/<docId>
      const pathParts = url.pathname.split('/').filter(p => p);
      if (pathParts.length < 2 || pathParts[0] !== 'ws') {
        console.log('WebSocket连接被拒绝：无效路径格式');
        conn.close(1008, 'Invalid path format');
        return;
      }
      docId = pathParts[1];
    }
    
    // 清理文档ID：移除任何额外的路径部分
    // 有时y-websocket可能会附加额外的路径信息
    if (docId.includes('/')) {
      docId = docId.split('/')[0];
    }
    
    // 检查文档是否存在
    const doc = getDoc(docId);
    if (!doc) {
      console.log(`WebSocket连接被拒绝：文档 ${docId} 不存在`);
      conn.close(1008, 'Document not found');
      return;
    }
    
    // 检查用户对文档的访问权限
    const access = canAccessDoc(doc, user);
    if (!access.canAccess) {
      console.log(`WebSocket连接被拒绝：用户 ${user.username} 无访问权限`);
      conn.close(1008, 'No access permission');
      return;
    }
    
    // 保存用户信息到连接对象，供后续使用
    conn.user = user;
    conn.docId = docId;
    conn.canEdit = access.canEdit;
    
    // 注册连接
    if (!activeConnections.has(docId)) {
      activeConnections.set(docId, new Set());
    }
    activeConnections.get(docId).add(conn);
    
    // 连接关闭时清理
    conn.on('close', () => {
      const connections = activeConnections.get(docId);
      if (connections) {
        connections.delete(conn);
        if (connections.size === 0) {
          activeConnections.delete(docId);
        }
      }
      console.log(`WebSocket连接关闭：用户 ${user.username}，文档 ${docId}`);
    });
    
    console.log(`WebSocket连接已接受：用户 ${user.username}，文档 ${docId}，可编辑：${access.canEdit}`);
    
    // 调用原始的setupWSConnection，根据权限设置readOnly
    setupWSConnection(conn, req, { 
      gc: true,
      readOnly: !access.canEdit  // 如果不可编辑，设置为只读模式
    });
    
  } catch (error) {
    console.error('WebSocket连接处理错误:', error);
    conn.close(1011, 'Internal server error');
  }
});

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../../frontend/dist/index.html'));
});

// 断开特定用户对特定文档的WebSocket连接
function disconnectUserFromDoc(userId, docId) {
  const connections = activeConnections.get(docId);
  if (!connections) {
    console.log(`断开连接：文档 ${docId} 没有活跃连接`);
    return 0;
  }
  
  console.log(`断开连接：文档 ${docId} 有 ${connections.size} 个连接`);
  let disconnectedCount = 0;
  for (const conn of connections) {
    console.log(`检查连接：用户=${conn.user?.id}，用户名=${conn.user?.username}，目标用户=${userId}`);
    if (conn.user && conn.user.id === userId) {
      console.log(`匹配到用户 ${conn.user.username}，断开连接`);
      conn.close(1008, 'Permission changed');
      disconnectedCount++;
    }
  }
  
  console.log(`已断开用户 ${userId} 在文档 ${docId} 的 ${disconnectedCount} 个连接`);
  return disconnectedCount;
}

// 断开文档的所有连接（用于文档删除等）
function disconnectAllFromDoc(docId) {
  const connections = activeConnections.get(docId);
  if (!connections) return 0;
  
  const count = connections.size;
  for (const conn of connections) {
    conn.close(1008, 'Document unavailable');
  }
  
  activeConnections.delete(docId);
  console.log(`已断开文档 ${docId} 的所有 ${count} 个连接`);
  return count;
}

const PORT = process.env.PORT || 30052;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// 导出函数供其他模块使用
export { disconnectUserFromDoc, disconnectAllFromDoc };
