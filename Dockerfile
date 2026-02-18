# 多阶段构建：前端阶段
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# 复制前端依赖文件
COPY frontend/package*.json ./

# 安装前端依赖
RUN npm install

# 复制前端源代码
COPY frontend/ ./

# 构建前端
RUN npm run build

# 多阶段构建：后端阶段
FROM node:20-alpine AS backend-builder

WORKDIR /app/backend

# 复制后端依赖文件
COPY backend/package*.json ./

# 安装后端依赖
RUN npm install --production

# 最终阶段
FROM node:20-alpine

WORKDIR /app

# 安装 Python3 和其他编译工具（某些 npm 包可能需要）
RUN apk add --no-cache python3 make g++

# 从后端构建阶段复制 node_modules
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules

# 复制后端源代码
COPY backend/ ./backend/

# 从前端构建阶段复制构建好的前端文件
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# 创建数据目录
RUN mkdir -p /app/backend/data/images

# 暴露端口
EXPOSE 30052

# 设置工作目录并启动应用
WORKDIR /app/backend
CMD ["node", "src/index.js"]