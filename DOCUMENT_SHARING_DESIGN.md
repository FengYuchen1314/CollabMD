# 文档共享系统设计文档

## 当前系统分析

### 现有数据结构
```javascript
{
  "ownerId": "用户ID",
  "title": "文档标题",
  "content": "文档内容",
  "permission": "private|public_read|public_readwrite|invited_read|invited_readwrite",
  "invitedUsers": ["用户ID数组"], // 已邀请用户
  "createdAt": "时间戳",
  "updatedAt": "时间戳"
}
```

### 现有权限系统
1. `private`: 仅所有者可访问
2. `public_read`: 任何人可读，仅所有者可写
3. `public_readwrite`: 任何人可读写
4. `invited_read`: 仅受邀用户可读
5. `invited_readwrite`: 仅受邀用户可读写

### 问题识别
1. 邀请系统无确认机制：用户被邀请后自动获得访问权限
2. 缺少文档共享管理：无法区分"我创建的"和"共享给我的"
3. 无邀请状态跟踪：不知道邀请是否被接受

## 新系统设计

### 数据结构扩展
```javascript
{
  "ownerId": "用户ID",
  "title": "文档标题",
  "content": "文档内容",
  "permission": "private|public_read|public_readwrite|invited_read|invited_readwrite",
  "sharedUsers": [ // 已接受邀请的用户
    {
      "userId": "用户ID",
      "permission": "read|readwrite", // 在该文档中的权限
      "joinedAt": "时间戳"
    }
  ],
  "pendingInvites": [ // 待处理的邀请
    {
      "userId": "用户ID",
      "invitedBy": "邀请者ID",
      "permission": "read|readwrite",
      "status": "pending|accepted|declined",
      "invitedAt": "时间戳",
      "respondedAt": "时间戳"
    }
  ],
  "createdAt": "时间戳",
  "updatedAt": "时间戳"
}
```

### 权限系统更新
1. **所有者权限**: 完全控制（创建、编辑、删除、邀请、管理成员）
2. **共享用户权限**: 根据sharedUsers.permission设置
3. **公开文档权限**: 不变
4. **邀请流程**: 需要确认才能加入

### API设计

#### 1. 文档获取
- `GET /api/docs` - 获取我创建的文档（现有）
- `GET /api/docs/shared` - 获取他人共享给我的文档（新增）
- `GET /api/docs/all` - 获取所有可访问文档（我创建的 + 共享给我的）

#### 2. 邀请管理
- `GET /api/docs/invitations` - 获取我的待处理邀请（新增）
- `POST /api/docs/:id/invite` - 邀请用户（更新：创建pending邀请）
- `POST /api/docs/:id/accept` - 接受邀请（新增）
- `POST /api/docs/:id/decline` - 拒绝邀请（新增）
- `DELETE /api/docs/:id/leave` - 离开共享文档（新增）

#### 3. 共享用户管理
- `GET /api/docs/:id/members` - 获取文档成员列表（新增）
- `DELETE /api/docs/:id/members/:userId` - 移除共享用户（新增）

### 前端界面设计

#### Dashboard页面重构
```jsx
<Tabs>
  <Tab label="我创建的文档">
    {/* 现有文档列表 */}
  </Tab>
  <Tab label="他人共享给我的文档">
    {/* 共享文档列表 */}
  </Tab>
  <Tab label="邀请管理">
    {/* 待处理邀请列表 */}
  </Tab>
</Tabs>
```

#### 邀请通知
- 侧边栏或顶部显示未读邀请数量
- 点击进入邀请管理页面

#### 公共文档访问流程
1. 用户打开公共文档链接
2. 系统检查用户是否已登录
3. 如果已登录且未加入，自动创建并接受邀请
4. 文档出现在"他人共享给我的文档"

### 向后兼容性

#### 数据迁移
1. 现有`invitedUsers`数组转换为`sharedUsers`
2. 每个原有受邀用户创建`pendingInvites`记录（状态为accepted）
3. 保持现有API端点功能不变

#### 权限计算更新
```javascript
// 新权限检查逻辑
function canAccessDoc(doc, user) {
  // 1. 检查所有者
  if (doc.ownerId === user?.id || user?.isAdmin) {
    return { canAccess: true, canEdit: true, permission: 'owner' };
  }
  
  // 2. 检查共享用户
  const sharedUser = doc.sharedUsers?.find(su => su.userId === user?.id);
  if (sharedUser) {
    return { 
      canAccess: true, 
      canEdit: sharedUser.permission === 'readwrite',
      permission: sharedUser.permission 
    };
  }
  
  // 3. 检查公开权限（现有逻辑）
  switch (doc.permission) {
    case 'public_readwrite':
      return { canAccess: true, canEdit: true, permission: 'public' };
    case 'public_read':
      return { canAccess: true, canEdit: false, permission: 'public' };
    case 'invited_readwrite':
    case 'invited_read':
      // 这些权限类型现在通过共享系统处理
      return { canAccess: false, canEdit: false, reason: '需要接受邀请' };
    default:
      return { canAccess: false, canEdit: false, reason: '文档是私有的' };
  }
}
```

### 实施计划

#### 阶段1：数据结构更新
1. 更新文档模型，添加sharedUsers和pendingInvites
2. 创建数据迁移脚本
3. 更新userService.js中的文档操作函数

#### 阶段2：API更新
1. 实现新的API端点
2. 更新现有API端点（/api/docs/:id/invite）
3. 添加邀请管理端点

#### 阶段3：前端更新
1. 重构Dashboard页面，添加标签页
2. 创建邀请管理组件
3. 添加邀请通知系统

#### 阶段4：测试与部署
1. 编写测试用例
2. 进行数据迁移
3. 部署更新

### 安全考虑
1. 邀请只能由文档所有者或管理员发送
2. 用户只能接受或拒绝自己的邀请
3. 离开文档后，相关权限立即撤销
4. 权限变更记录日志

### 性能考虑
1. 文档列表需要支持分页
2. 邀请列表需要实时更新（WebSocket）
3. 权限检查需要缓存优化