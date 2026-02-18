FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install

COPY frontend/package*.json ./frontend/
WORKDIR /app/frontend
RUN npm install

WORKDIR /app
COPY . .

WORKDIR /app/frontend
RUN npm run build

WORKDIR /app/backend
EXPOSE 30052

CMD ["node", "src/index.js"]
