# Planrla Server — Linux headless (no Electron)
FROM node:20-bookworm

WORKDIR /app

# native deps（bcrypt/better-sqlite3/node-pty）build 工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 make \
    && rm -rf /var/lib/apt/lists/*

# 装依赖：--ignore-scripts 跳过 prepare(husky,devDep 没装会 exit 127) + postinstall(fix-node-pty,macOS only)
COPY package.json ./
RUN npm install --production --ignore-scripts

# 显式 rebuild 3 个 native（node-gyp 从源码编译 Linux ABI）
RUN npm rebuild bcrypt better-sqlite3 node-pty

# 构建产物
COPY dist ./dist
COPY dist-server ./dist-server
COPY public ./public

EXPOSE 3001
ENV HOST=0.0.0.0
ENV SERVER_PORT=3001

CMD ["node", "dist-server/server/cli.js", "start", "--port", "3001"]
