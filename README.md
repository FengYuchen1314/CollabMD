@ -1,181 +0,0 @@
# Markdown 协作编辑器

一个现代化的实时协作 Markdown 编辑器，支持多用户实时编辑、文档共享、权限管理和图片上传功能。

## 功能特性

- 📝 **实时协作编辑** - 多用户同时编辑同一文档，实时同步
- 👥 **用户管理** - 用户注册、登录、权限控制
- 🔐 **权限系统** - 私有文档和自定义权限管理
- 📋 **文档管理** - 创建、编辑、删除文档，支持备注
- 🖼️ **图片上传** - 支持粘贴图片自动上传
- 🌐 **WebSocket 通信** - 实时同步和在线用户状态
- 💻 **现代化 UI** - 响应式设计，美观的界面
- 🔧 **后台管理** - 用户管理和系统配置

## 技术栈

### 前端
- React 18 + Vite
- CodeMirror 6 - Markdown 编辑器
- Y.js + y-websocket - 实时协作
- React Router - 路由管理
- React Markdown - Markdown 预览

### 后端
- Node.js + Express
- JWT 身份验证
- WebSocket 服务器
- JSON 文件存储
- 图片上传处理

### 其他
- Docker 容器化
- 支持本地存储和 S3 存储

## 项目结构

```
markdown在线编辑/
├── backend/              # 后端服务
│   ├── src/
│   │   ├── middleware/  # 中间件（认证等）
│   │   ├── routes/      # API 路由
│   │   └── services/    # 业务逻辑
│   └── data/            # 数据存储
├── frontend/            # 前端应用
│   ├── src/
│   │   ├── components/  # 公共组件
│   │   ├── pages/       # 页面组件
│   │   └── styles/      # 样式文件
├── data/                # 生产环境数据
└── docker-compose.yml   # Docker 编排配置
```

## 快速开始

### 1. 本地开发

```bash
# 克隆项目
git clone <repository-url>
cd markdown在线编辑

# 启动后端服务
cd backend
npm install
npm run dev

# 启动前端服务
cd ../frontend
npm install
npm run dev
```

访问 http://localhost:30051/

### 2. Docker 部署

```bash
# 使用 Docker Compose
docker-compose up -d
```

访问 http://localhost:3000/

### 3. 生产环境部署

1. 配置环境变量
2. 设置存储类型（本地或 S3）
3. 配置 HTTPS
4. 使用 PM2 或 Docker 部署

## 配置说明

### 存储配置

支持两种存储方式：

1. **本地存储** - 默认方式，文件存储在服务器本地
2. **S3 对象存储** - 支持兼容 S3 协议的对象存储服务

### 权限系统

- **私有文档** - 仅文档创建者可访问
- **自定义权限** - 邀请特定用户，设置读写或只读权限

### 图片上传

- 支持粘贴图片自动上传
- 可配置图片重命名规则（UUID、时间戳、原名称）
- 支持本地存储和 S3 存储

## API 文档

### 认证相关
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户信息

### 文档管理
- `GET /api/docs` - 获取用户文档列表
- `POST /api/docs` - 创建新文档
- `GET /api/docs/:id` - 获取文档详情
- `PUT /api/docs/:id` - 更新文档
- `DELETE /api/docs/:id` - 删除文档

### 文档共享
- `POST /api/docs/:id/invite` - 邀请用户协作文档
- `POST /api/docs/:id/accept` - 接受邀请
- `DELETE /api/docs/:id/invitations/:userId` - 移除邀请

## 部署到云平台

### Vercel / Netlify (前端)
- 配置环境变量
- 设置代理到后端 API

### Railway / Render (后端)
- 设置环境变量
- 配置持久化存储
- 设置 WebSocket 支持

## 开发说明

### 添加新功能
1. 后端：在 `backend/src/routes/` 添加路由
2. 前端：在 `frontend/src/pages/` 添加页面
3. 样式：在 `frontend/src/index.css` 添加样式

### 测试
```bash
# 后端测试
cd backend
npm test

# 前端测试
cd frontend
npm test
```

## 许可证

MIT License

## 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 联系信息

如有问题或建议，请提交 Issue 或联系维护者。

## 许可证

本项目采用 [MIT License](LICENSE) 开源许可证。有关详细信息，请参阅 [LICENSE](LICENSE) 文件。

Copyright (c) 2026 FengYuchen
