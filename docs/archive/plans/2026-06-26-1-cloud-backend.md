# 云端账号化扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 按任务执行。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 给 cc.brainmate.cc 中继 Worker 加账号体系(注册/登录/JWT)+ D1 设备注册表 + relay 准入绑定账号,作为 CloudCLI Desktop 商业化的云端基础。

**Architecture:** 原地扩展现有 `cloudcli-relay` Worker:加 D1 binding + `/api/*` REST(注册/登录/设备),relay 路由(`/relay`)改为「token 必须是已注册设备」才放行。纯 Web Crypto 做 PBKDF2 密码哈希 + HMAC-SHA256 JWT,**不引第三方依赖**。现有多租 DO、mux 协议保留不动。

**Tech Stack:** Cloudflare Workers(纯 TS)、D1(SQLite)、Web Crypto、wrangler。测试沿用项目惯例:`wrangler dev` + curl 集成验证(项目无单测 runner)。

---

### Task 1: D1 数据库 + schema

**Files:**
- Modify: `cloudcli-relay/worker/wrangler.toml`
- Create: `cloudcli-relay/worker/schema.sql`

- [ ] **Step 1: 建 D1 数据库**
```bash
cd cloudcli-relay/worker
npx wrangler d1 create cloudcli-db
```
记下输出的 `database_id`。

- [ ] **Step 2: wrangler.toml 加 D1 binding**
在 `wrangler.toml` 末尾追加(填入上一步的 database_id):
```toml
[[d1_databases]]
binding = "DB"
database_name = "cloudcli-db"
database_id = "<填入实际 id>"
```

- [ ] **Step 3: 写 schema.sql**
```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  last_seen INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(token);
```

- [ ] **Step 4: 本地建表**
```bash
npx wrangler d1 execute cloudcli-db --local --file schema.sql
```

- [ ] **Step 5: Commit**
```bash
git add wrangler.toml schema.sql
git commit -m "feat(relay): add D1 binding + account/device schema"
```

---

### Task 2: 认证加密工具(PBKDF2 + JWT)

**Files:**
- Create: `cloudcli-relay/worker/src/auth.ts`

- [ ] **Step 1: 写 auth.ts(纯 Web Crypto,无依赖)**
```typescript
const JWT_SECRET = () => globalThis.JWT_SECRET ?? 'dev-secret-change-me';
const PBKDF2_ITER = 100_000;

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function randomId(): string {
  return crypto.randomUUID();
}

export async function hashPassword(pw: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256
  );
  return { hash: b64url(bits), salt: b64url(salt) };
}

export async function verifyPassword(pw: string, hash: string, salt: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: b64urlDecode(salt), iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256
  );
  return b64url(bits) === hash;
}

async function hmac(key: string, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
}

export async function createJWT(payload: object, expSeconds = 7 * 86400): Promise<string> {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + expSeconds * 1000 })));
  const sig = b64url(await hmac(JWT_SECRET(), `${header}.${body}`));
  return `${header}.${body}.${sig}`;
}

export async function verifyJWT(token: string): Promise<{ sub: string; email: string; exp: number } | null> {
  const [header, body, sig] = token.split('.');
  if (!header || !body || !sig) return null;
  const expected = b64url(await hmac(JWT_SECRET(), `${header}.${body}`));
  if (expected !== sig) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  if (payload.exp < Date.now()) return null;
  return payload;
}

export { randomId };
```

- [ ] **Step 2: Commit**
```bash
git add src/auth.ts
git commit -m "feat(relay): add PBKDF2 + JWT auth helpers (web crypto, no deps)"
```

---

### Task 3: 注册 + 登录路由

**Files:**
- Modify: `cloudcli-relay/worker/src/index.ts`

- [ ] **Step 1: 扩展 Env 类型**
把 `index.ts` 顶部 `interface Env` 改为:
```typescript
interface Env {
  RELAY: DurableObjectNamespace;
  DB: D1Database;
  TOKENS: string;
  MVP_TOKEN: string;
  JWT_SECRET: string;
}
```

- [ ] **Step 2: 加 /api/auth/signup 和 /api/auth/login 处理**
在 `index.ts` 的 `fetch` 里,`/health` 分支之后、token 校验之前插入 API 路由分发:
```typescript
import { hashPassword, verifyPassword, createJWT, verifyJWT, randomId } from './auth';

// 在 fetch 内:
if (url.pathname === '/api/auth/signup') return handleSignup(request, env);
if (url.pathname === '/api/auth/login') return handleLogin(request, env);
if (url.pathname === '/api/auth/me') return handleMe(request, env);
if (url.pathname === '/api/devices' && request.method === 'GET') return handleListDevices(request, env);
if (url.pathname === '/api/devices' && request.method === 'POST') return handleRegisterDevice(request, env);
```

新增处理函数(同文件):
```typescript
async function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function readUserFromAuth(request: Request, env: Env) {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = token ? await verifyJWT(token) : null;
  if (!payload) return null;
  return payload; // { sub: userId, email, exp }
}

async function handleSignup(request: Request, env: Env): Promise<Response> {
  const { email, password } = await request.json() as { email?: string; password?: string };
  if (!email || !password || password.length < 8) return json({ error: 'invalid email or password <8' }, 400);
  const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) return json({ error: 'email already registered' }, 409);
  const id = randomId();
  const { hash, salt } = await hashPassword(password);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO users (id, email, pw_hash, pw_salt, plan, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, email, hash, salt, 'free', now).run();
  await env.DB.prepare('INSERT INTO subscriptions (user_id, plan, status, updated_at) VALUES (?, ?, ?, ?)')
    .bind(id, 'free', 'active', now).run();
  const token = await createJWT({ sub: id, email });
  return json({ token, user: { id, email, plan: 'free' } });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { email, password } = await request.json() as { email?: string; password?: string };
  const row = await env.DB.prepare('SELECT id, pw_hash, pw_salt, plan FROM users WHERE email = ?').bind(email).first() as any;
  if (!row) return json({ error: 'invalid credentials' }, 401);
  const ok = await verifyPassword(password, row.pw_hash, row.pw_salt);
  if (!ok) return json({ error: 'invalid credentials' }, 401);
  const token = await createJWT({ sub: row.id, email });
  return json({ token, user: { id: row.id, email, plan: row.plan } });
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const u = await readUserFromAuth(request, env);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const row = await env.DB.prepare('SELECT id, email, plan FROM users WHERE id = ?').bind(u.sub).first() as any;
  return json({ user: row });
}
```

- [ ] **Step 3: 配 .dev.vars 加 JWT_SECRET**
在 `cloudcli-relay/worker/.dev.vars` 加一行:
```
JWT_SECRET=dev-secret-change-me
```

- [ ] **Step 4: 本地启动 + curl 测注册/登录**
```bash
npx wrangler dev
# 另开终端
curl -s -X POST http://localhost:8787/api/auth/signup -H 'content-type: application/json' -d '{"email":"a@b.c","password":"password123"}'
curl -s -X POST http://localhost:8787/api/auth/login -H 'content-type: application/json' -d '{"email":"a@b.c","password":"password123"}'
```
预期:两次都返回 `{token, user}`。错误密码返回 401。

- [ ] **Step 5: Commit**
```bash
git add src/index.ts .dev.vars
git commit -m "feat(relay): add signup/login/me auth routes"
```

---

### Task 4: 设备注册路由(mint device token)

**Files:**
- Modify: `cloudcli-relay/worker/src/index.ts`

- [ ] **Step 1: 加 handleRegisterDevice + handleListDevices**
```typescript
async function handleRegisterDevice(request: Request, env: Env): Promise<Response> {
  const u = await readUserFromAuth(request, env);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const { name } = await request.json() as { name?: string };
  const id = randomId();
  const token = `relay-${randomId().replace(/-/g, '')}`;
  await env.DB.prepare(
    'INSERT INTO devices (id, user_id, token, name, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, u.sub, token, name ?? '', Date.now()).run();
  return json({ id, token, name: name ?? '' });
}

async function handleListDevices(request: Request, env: Env): Promise<Response> {
  const u = await readUserFromAuth(request, env);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const { results } = await env.DB.prepare('SELECT id, token, name, created_at FROM devices WHERE user_id = ?').bind(u.sub).all();
  return json({ devices: results });
}
```

- [ ] **Step 2: curl 测**
```bash
TOK=<上一步登录拿到的 token>
curl -s -X POST http://localhost:8787/api/devices -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"name":"my-desktop"}'
curl -s http://localhost:8787/api/devices -H "authorization: Bearer $TOK"
```
预期:POST 返回 `{id, token:"relay-..."}`;GET 列出该设备。

- [ ] **Step 3: Commit**
```bash
git add src/index.ts
git commit -m "feat(relay): add device register/list routes"
```

---

### Task 5: Relay 准入绑定账号(商业闸门)

**Files:**
- Modify: `cloudcli-relay/worker/src/index.ts`

**当前逻辑**(`index.ts` 现有):token 命中 `env.TOKENS`/`MVP_TOKEN` 才放行。改成**双轨过渡**:D1 devices 表里有的 **OR** 旧 `TOKENS` 白名单里的,都放行。这样现有 0.13 home 的 token(在 TOKENS 里)不会断;新账号走 D1。后续把旧 token 迁进 D1 后,可删 TOKENS 分支。

- [ ] **Step 1: 改 token 校验逻辑(双轨)**
把现有这段:
```typescript
const allowed = (env.TOKENS || env.MVP_TOKEN || '').split(',').map((t: string) => norm(t)).filter(Boolean);
console.log(`[relay] ...`);
if (!allowed.includes(token)) { return 401; }
```
替换为:
```typescript
// 双轨:D1 已注册设备 OR legacy TOKENS 白名单(过渡期,保护现有 home)
let authorized = false;
const dev = await env.DB.prepare('SELECT id FROM devices WHERE token = ?').bind(token).first();
if (dev) {
  authorized = true;
  env.DB.prepare('UPDATE devices SET last_seen = ? WHERE token = ?').bind(Date.now(), token).run();
} else {
  const legacy = (env.TOKENS || env.MVP_TOKEN || '').split(',').map((t: string) => norm(t)).filter(Boolean);
  if (legacy.includes(token)) authorized = true;
}
if (!authorized) return new Response('unauthorized\n', { status: 401, headers: { 'content-type': 'text/plain' } });
```

> `idFromName(token)` 路由不变 —— 每个 device token 仍是独立 DO。过渡期安全:现有 home 不会断。

- [ ] **Step 2: curl 测准入**
```bash
# 未注册的假 token → 401
curl -s -o /dev/null -w "%{http_code}" "http://localhost:8787/?token=relay-fake-not-registered"
# 刚注册的真 token → 非 401(到 DO)
curl -s -o /dev/null -w "%{http_code}" "http://localhost:8787/?token=<注册拿到的真 token>"
```
预期:假 token=401;真 token=非 401(200/503 等,到 DO 那层)。

- [ ] **Step 3: 清理那行调试 console.log**
顺手删掉原 `[relay] ${method} ${pathname} rawLen=…` 调试日志(之前标注的遗留)。

- [ ] **Step 4: Commit**
```bash
git add src/index.ts
git commit -m "feat(relay): gate relay on registered device tokens (account-based)"
```

---

### Task 6: 部署到 cc.brainmate.cc + 冒烟测试

- [ ] **Step 1: 建 prod D1 + 建表**
```bash
npx wrangler d1 execute cloudcli-db --remote --file schema.sql
```

- [ ] **Step 2: 设 JWT_SECRET 生产 secret**
```bash
npx wrangler secret put JWT_SECRET   # 输入一个强随机串
```

- [ ] **Step 3: 部署**
```bash
npx wrangler deploy
```

- [ ] **Step 4: 线上冒烟**
```bash
curl -s -X POST https://cc.brainmate.cc/api/auth/signup -H 'content-type: application/json' -d '{"email":"test@x.com","password":"password123"}'
curl -s -X POST https://cc.brainmate.cc/api/auth/login -H 'content-type: application/json' -d '{"email":"test@x.com","password":"password123"}'
# 用返回 token 注册设备,再用该 token 打 /?token=… 确认非 401
```

- [ ] **Step 5: Commit(plan 标记完成)**
部署完成即本子项目交付。后续桌面端 plan 消费这些 `/api/*`。

---

## 自检 / 风险

- **迁移注意**:Task 5 改了 relay 准入——现有 0.13 home 的 device token(`relay-5076…`)目前是在 `TOKENS` secret 里、**不在 D1 devices 表**。部署后 home 会被 401!**必须先把现有 token 插进 devices 表**(给一个占位 user),或保留 `TOKENS` 白名单兜底,再切。→ Task 5 应加一步:迁移现有 TOKENS 到 D1(或双轨:devices 表 ∪ TOKENS 都放行,过渡期)。
- **索引/限流**:D1 免费档 5M 读/天;relay 每次都查 devices 表会放大读次数。可加 KV 缓存 token→userId(后续优化)。
- **Stripe**:留 v1.1(本 plan 只放 `plan` 字段,不做支付)。订阅校验(Task 5)先信任 `devices` 存在即放行;v1.1 加 `subscriptions.status` 校验。
