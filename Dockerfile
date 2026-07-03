# Planrla Server — Linux headless (no Electron)
FROM node:20-bookworm

WORKDIR /app

# native deps（bcrypt/better-sqlite3/node-pty）build 工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 make \
    && rm -rf /var/lib/apt/lists/*

# package.json + scripts（postinstall 跑 fix-node-pty.js）
COPY package.json ./
COPY scripts ./scripts
RUN npm install --production

# 构建产物（client 静态 + server 编译 + assets）
COPY dist ./dist
COPY dist-server ./dist-server
COPY public ./public

EXPOSE 3001
ENV HOST=0.0.0.0
ENV SERVER_PORT=3001

CMD ["node", "dist-server/server/cli.js", "start", "--port", "3001"]
