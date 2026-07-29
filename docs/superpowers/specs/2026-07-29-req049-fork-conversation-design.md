---
REQ-ID: REQ-049
title: 对话 fork(从当前对话分支新对话,对标 Codex /fork)
status: spec
created: 2026-07-29
owner: self
---

# REQ-049 设计:对话 fork

## 0. 背景与目标

**背景**:Codex `/fork`(桌面 app + `codex fork --last` CLI)复制 session `history.jsonl` → 新 `thread_id` session,社区 issue [#9499](https://github.com/openai/codex/issues/9499)(fork current)/ [#14024](https://github.com/openai/codex/issues/14024)(fork at message)证明刚需。planrla 用户跑长对话常想「试另一条思路但不丢原对话」,当前只能复制粘贴或新建空对话重述背景,上下文断。

**目标**:整体 fork——从当前对话复制全历史到新 session,前端自动切到新对话,原对话零变化。本版不做 fork at message(at point,从某消息分支),那是第二阶段。

**对标语义**(Codex-faithful):
- fork = **copy**,不是 move;原对话只读不变。
- 新对话 = 新 session id,**新 provider session**(不是 resume 原 provider session);fork 后首条消息由 provider runtime 新建 provider-native session。
- 历史 = 原对话的**只读快照**;fork 后的新轮次落在新 provider session 的新 transcript。

## 1. planrla session 机制回顾(为什么 fork 不能简单 copy jsonl)

planrla 一个 session 由两部分构成:

1. **DB 行**(`sessions` 表):`session_id`(app UUID)/ `provider` / `provider_session_id`(provider 原生 id,初始 NULL)/ `project_path` / `jsonl_path`(磁盘 transcript,初始 NULL)/ `custom_name` / 时间戳。
2. **磁盘 transcript**(provider 原生写):claude 在 `~/.claude/projects/<slug>/<provider-uuid>.jsonl`,codex/gemini/cursor/opencode/kimi 各自目录。

**关键生命周期**:
- 新建对话:`createAppSession` 写 DB 行(`provider_session_id=NULL`, `jsonl_path=NULL`)→ 首条消息走 `chat-websocket.service.ts`,`resume:false` → provider CLI spawn 新 provider-native session → 写磁盘 transcript → `assignProviderSessionId` 把 provider id + jsonl_path 回填到 DB 行。
- 加载历史:`sessionsService.fetchHistory` 先查 DB 行;**当前 `provider_session_id IS NULL` 直接返空**(L166-174);否则调 provider sessions reader,claude reader(`claude-sessions.provider.ts:104 getSessionMessages`)从 DB `jsonl_path` 流读 + 行级 `entry.sessionId === providerSessionId` 过滤。
- 新轮次:`chat-websocket.service.ts:182` 传 `sessionId: session.provider_session_id ?? undefined, resume: Boolean(provider_session_id)`;`claude-sdk.js:234` `if (sessionId) sdkOptions.resume = sessionId`。

## 2. 架构冲突分析(为什么不能简单复制 jsonl + 复用 provider_session_id)

### 2.1 方案 A(否决):复用源 provider_session_id

fork DB 行:`jsonl_path = <副本>`, `provider_session_id = <源 provider id>`。

**问题 1(历史读取看似通)**:claude reader 从 DB `jsonl_path`(副本)流读,行级 `entry.sessionId === providerSessionId`(源 id)匹配 → 历史能读出来。✓

**问题 2(新轮次隔离崩溃,致命)**:`chat-websocket.service.ts:182` `sessionId: provider_session_id` → `claude-sdk.js:234` `resume: <源 id>` → Claude CLI **resume 进源 provider session**,新轮次 **写回源 transcript 文件**(不是副本)。后果:fork 的新轮次污染原对话;两条 app session 共享一个 provider session id,DB `assignProviderSessionId` 的合并逻辑(L178-213)会触发重复行合并 → 不可预测。

**结论**:方案 A 破坏 fork 隔离,否决。

### 2.2 方案 B(否决):fork 副本 + provider_session_id=NULL,不改 fetchHistory

fork DB 行:`jsonl_path = <副本>`, `provider_session_id = NULL`。

**问题**:`fetchHistory` 当前 `provider_session_id IS NULL` 直接返空(L166-174)→ fork 打开后历史空,用户看不到副本内容,fork 形同虚设。

**结论**:方案 B 历史丢失,否决。

### 2.3 方案 C(采纳):provider_session_id=NULL + fetchHistory 分叉 + provider reader 扩 jsonlPath 入参

fork DB 行:`jsonl_path = <副本>`, `provider_session_id = NULL`。

**三处改动**:

1. **`fetchHistory` 分叉**(sessions.service.ts:166):把 `if (!session.provider_session_id) return 空` 改为 `if (!session.provider_session_id) { if (session.jsonl_path) return await readForkHistory(...); return 空; }`。`readForkHistory` 调 provider sessions reader 的新方法 `fetchHistoryByJsonlPath(jsonlPath, options)`,直接从副本流读(不过滤 provider_session_id,因为副本是 app-controlled 的整文件快照),返回 NormalizedMessage。

2. **provider reader 扩 `fetchHistoryByJsonlPath`**:`IProviderSessions` 接口加可选方法。claude 实现:复用 `getSessionMessages` 的 jsonl 流读 + JSONL 行解析 + tool/agent 合并,但**不过滤 sessionId**(读全文件);其余 provider(codex/gemini/cursor/opencode/kimi)先返空数组(它们的 history 路径不同,本版 claude 优先,fallback 空历史不报错,fork 仍可用——历史空但对话能开)。

3. **新轮次隔离**:`provider_session_id = NULL` → `chat-websocket.service.ts:182` `resume:false` → provider CLI 新建 provider-native session → 写**新** transcript 文件(不动副本)。`assignProviderSessionId` 把新 provider id 写到 fork DB 行;`jsonl_path` 在 `COALESCE(jsonl_path, ?)` 下保留副本指向(L196-200,L130)→ 历史仍可读。

**已知边界(写入第二阶段)**:fork 后**首条新消息**触发新 provider session,新 transcript 文件 = fork 后新轮次;副本 = fork 前历史快照。`fetchHistory` 只读副本(jsonl_path)→ fork 后的新轮次**当前不在 fetchHistory 视图**(它们在新 provider session 的 transcript)。这是 Codex-faithful 语义的代价:Codex fork 后新轮次在新 thread,fork 历史是快照。第二阶段可让 fetchHistory 合并「副本快照 + 当前 provider session transcript」展示连续视图;本版先保快照可见 + 新轮次正常流式推送(WebSocket 实时消息不依赖 fetchHistory)。

## 3. 数据流(方案 C 详解)

```
源 session:  DB(provider_session_id=P, jsonl_path=/proj/P.jsonl, custom_name="调试")
              disk:/proj/P.jsonl  ← provider CLI 拥有,只读
                                  
fork 调用:
  POST /api/providers/sessions/<源app_id>/fork
    ↓ sessionsService.forkSession(源app_id):
      1. sessionsDb.getSessionById(源app_id) → 源行(校验存在 + jsonl_path 非空)
      2. 新 app_id = randomUUID()
      3. sessionsDb.createAppSession(新app_id, 源provider, 源project_path)
         → DB 新行(provider_session_id=NULL, jsonl_path=NULL)
      4. 副本路径 = path.dirname(源jsonl_path) + '/' + 新app_id + '.jsonl'
      5. fsp.copyFile(源jsonl_path, 副本路径)   ← 流式,不 load 内存
      6. sessionsDb.updateSessionJsonlPath(新app_id, 副本路径)
      7. 源 custom_name 非空 → sessionsDb.updateSessionCustomName(新app_id, 源名 + ' · fork')
      8. return { sessionId: 新app_id, provider, projectPath, jsonlPath: 副本路径 }
    ↓ 前端拿 sessionId → onNavigateToSession(sessionId) → 切新对话
    
新对话打开:
  GET /api/providers/sessions/<新app_id>/messages
    → fetchHistory(新app_id):
        session = DB(新app_id)  // provider_session_id=NULL, jsonl_path=副本
        走分叉:provider_session_id IS NULL && jsonl_path 已设
        → readForkHistory(provider, 副本路径, opts)
        → claude reader.fetchHistoryByJsonlPath(副本路径) 流读全文件
        → 返回源对话全消息(normalized,id remap 到新app_id)
    
新对话首条消息:
  chat.send → chat-websocket.service.ts
    session = DB(新app_id)  // provider_session_id=NULL
    resume:false → provider CLI 新建 provider session Q
    写 disk:/proj/Q.jsonl  ← 新 transcript,不动副本
    assignProviderSessionId(新app_id, Q) → DB 更新 provider_session_id=Q
    jsonl_path 在 COALESCE 下保留 = 副本(不被覆盖)
```

## 4. API 协议

### `POST /api/providers/sessions/:sessionId/fork`

**Auth**:走现有 session API 的 middleware(同 `POST /sessions`)。

**Request**:空 body(query 无)。

**Response 201**:
```json
{
  "data": {
    "sessionId": "<新 app UUID>",
    "provider": "claude",
    "projectPath": "/workspace/foo",
    "jsonlPath": "/home/user/.claude/projects/<slug>/<新UUID>.jsonl"
  }
}
```

**错误**:
- `404 SESSION_NOT_FOUND` — 源 session 不存在。
- `409 SESSION_NOT_FORKABLE` — 源 session `jsonl_path IS NULL`(对话还没产出 transcript,如刚建空对话首条消息仍在流式)。fork 这种没意义。
- `500` — 文件复制失败(权限/磁盘满),DB 新行回滚(事务 + 删行)。

**路由位置**:`provider.routes.ts` 加在 `router.put('/sessions/:sessionId', rename)` 之后,`router.get('/sessions/:sessionId/messages')` 之前。用 `parseSessionId` + `asyncHandler`。

## 5. server 改动清单

### 5.1 `server/modules/database/repositories/sessions.db.ts`

加一个导出方法:

```typescript
/** 把 app session 的 jsonl_path 指到副本文件(fork 用)。 */
updateSessionJsonlPath(sessionId: string, jsonlPath: string): void {
  const db = getConnection();
  db.prepare(
    `UPDATE sessions SET jsonl_path = ?, updated_at = CURRENT_TIMESTAMP
     WHERE session_id = ?`
  ).run(jsonlPath, sessionId);
},
```

不动任何现有方法(零回归)。

### 5.2 `server/modules/providers/services/sessions.service.ts`

加 `forkSession` + 改 `fetchHistory` 分叉:

```typescript
async forkSession(sourceSessionId: string): Promise<ForkSessionResult> {
  const source = sessionsDb.getSessionById(sourceSessionId);
  if (!source) throw AppError('SESSION_NOT_FOUND', 404);
  if (!source.jsonl_path) throw AppError('SESSION_NOT_FORKABLE', 409);

  const newSessionId = randomUUID();
  const projectPath = source.project_path ?? '';
  // createAppSession 内部 projectsDb.createProjectPath + INSERT
  sessionsDb.createAppSession(newSessionId, source.provider, projectPath);

  const副本Path = path.join(path.dirname(source.jsonl_path), `${newSessionId}.jsonl`);
  try {
    await fsp.copyFile(source.jsonl_path, 副本Path);  // 流式
  } catch (err) {
    sessionsDb.deleteSessionById(newSessionId);  // 回滚
    throw err;
  }
  sessionsDb.updateSessionJsonlPath(newSessionId, 副本Path);

  const sourceName = source.custom_name?.trim();
  if (sourceName) {
    sessionsDb.updateSessionCustomName(newSessionId, `${sourceName} · fork`);
  }

  return { sessionId: newSessionId, provider: source.provider, projectPath, jsonlPath: 副本Path };
},
```

`fetchHistory` 改(L166-174):

```typescript
if (!session.provider_session_id) {
  // App session fork 后:provider_session_id IS NULL 但 jsonl_path 指向历史快照副本。
  if (session.jsonl_path) {
    return await readForkHistory(session, options);
  }
  return { messages: [], total: 0, hasMore: false, offset: ..., limit: ... };
}
```

新增 `readForkHistory`(模块内私有):resolve provider → 调 `provider.sessions.fetchHistoryByJsonlPath?.(jsonlPath, opts)`;若 provider 未实现该方法 → 返空 `{messages:[],...}`(fallback,不报错);走完 remap id + `filterSilentRenameTurns`(REQ-030 兼容,fork 历史也剥 silent rename turn)。

### 5.3 `server/shared/interfaces.ts`(IProviderSessions 接口)

加可选方法:

```typescript
/** fork 专用:按 jsonl_path 直接读 transcript 快照(不过滤 provider session id)。可选,未实现 provider 返空。 */
fetchHistoryByJsonlPath?(jsonlPath: string, options: Pick<FetchHistoryOptions, 'limit' | 'offset'>): Promise<FetchHistoryResult>;
```

### 5.4 `server/modules/providers/list/claude/claude-sessions.provider.ts`

实现 `fetchHistoryByJsonlPath`:复用现有 `getSessionMessages` 的 JSONL 流读逻辑,但**不过滤** `entry.sessionId`(读全文件),返回 normalized messages。其余 provider 本版不实现(fallback 空)。

### 5.5 `server/modules/providers/provider.routes.ts`

加路由:

```typescript
router.post(
  '/sessions/:sessionId/fork',
  asyncHandler(async (req, res) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const result = await sessionsService.forkSession(sessionId);
    res.status(201).json(createApiSuccessResponse(result));
  }),
);
```

## 6. 前端改动清单

### 6.1 `src/stores/useSessionStore.ts`

加 `forkSession` action:

```typescript
forkSession: async (sourceSessionId: string): Promise<string | null> => {
  const res = await authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sourceSessionId)}/fork`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`fork failed (${res.status})`);
  const body = await res.json();
  const newId = body?.data?.sessionId;
  return newId ?? null;
},
```

不直接 navigate(navigate 依赖 router,store 不应耦合);返回 newId 让调用方 navigate。

### 6.2 `src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx`

hover 操作组(Edit 前)加 fork 按钮:

```tsx
<button
  className="flex h-6 w-6 items-center justify-center rounded bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40"
  onClick={(event) => {
    event.stopPropagation();
    onForkSession?.(session.id);
  }}
  title={t('tooltips.forkSession')}
  aria-label={t('tooltips.forkSession')}
  disabled={isProcessing}  // 处理中不让 fork(避免复制到半写入的 transcript)
>
  <GitBranch className="h-3 w-3 text-gray-600 dark:text-gray-400" />
</button>
```

`onForkSession` 是新可选 prop(`(sessionId: string) => void`),由 `SidebarProjectSessions` / `useSidebarController` 提供,内部 `await store.forkSession(id)` → 成功 `navigate(/session/newId)` + reload sidebar(让新对话出现在列表);失败 toast。

移动端(mdx:hidden)操作区也加 fork 按钮(同 a2a/delete 并列)。

### 6.3 i18n(`src/i18n/locales/{zh-CN,en}/sidebar.json`)

`tooltips` 加:
- zh-CN:`"forkSession": "分支新对话(保留原对话)"` + 失败 toast `"forkFailed": "分支对话失败,请重试"`
- en:`"forkSession": "Fork conversation (keeps original)"` + `"forkFailed": "Failed to fork session. Please try again."`

其余 7 语言(de/fr/it/ja/ko/ru/tr/zh-TW)按现有惯例同步加 key(漏 key 会 fallback en,不阻塞,但保持一致)。

## 7. 文件卫生 / 行数预估

- `sessions.db.ts`:+6 行(`updateSessionJsonlPath`)→ 520 行,**超 500 限**。→ 拆 `updateSessionJsonlPath` 到现有 `updateSessionCustomName` 同区块紧凑写法,或把 `findLatestPendingAppSession` 这种较长方法外移。**实际**:+6 行 → 520,需复核;若超,把 `normalizeTimestamp`/`normalizeSessionRow` 这两个纯函数提到 `sessions-utils.ts`。
- `sessions.service.ts`:目前 315 行,+`forkSession`(~35)+ `readForkHistory`(~25)+ fetchHistory 分叉(~5)= ~380,OK。
- `provider.routes.ts`:目前 593 行,+8 行 = 601,**超 500**。→ 这是既有问题(已 593);fork 路由加 8 行不会显著恶化,但**严格遵守**需拆。本版在 spec 标注:若 typecheck 后 provider.routes.ts 超 600,把 session 路由组(sessions.*)拆到 `provider-sessions.routes.ts`(独立次序:先加 fork,拆路由单独 REQ)。本 REQ 内**不拆**(避免回归),只标 TODO。
- `SidebarSessionItem.tsx`:341 行,+15 = 356,OK。
- `claude-sessions.provider.ts`:700+ 行(已超),+30 = 不恶化;`fetchHistoryByJsonlPath` 复用现有 helper。

**结论**:本版接受 `provider.routes.ts` 和 `sessions.db.ts` 小幅超限(既有问题,fork 仅 +14 行),不引入拆文件回归;严格 500 限拆分列为后续 cleanup。

## 8. 验收标准(对照 spec)

1. **历史副本**:fork 后打开新对话,`GET /messages` 返回源对话全部消息(normalized,id remap 到新 app id);silent rename turn 被 `filterSilentRenameTurns` 剥离(REQ-030 兼容)。
2. **原对话零变化**:fork 前后对比源 DB 行(`custom_name`/`provider_session_id`/`jsonl_path`/`updated_at`)不变;源 jsonl 文件 mtime/size 不变(`copyFile` 不动源)。
3. **新对话 provider session**:fork 后 DB 行 `provider_session_id=NULL`;首条消息后 `assignProviderSessionId` 写入新 provider id(≠ 源 id);新 transcript 文件 ≠ 副本文件。
4. **大对话性能**:100MB jsonl fork 走 `fsp.copyFile`(流式,内核 pipe),不走 `readFile`;不阻塞 event loop(copyFile 是异步 libuv 线程)。
5. **错误处理**:源 `jsonl_path IS NULL` → 409(可读错误);复制失败 → DB 回滚 + 500。
6. **回归**:`npm run typecheck` 过;新增 `sessions.service.test.ts` fork 用例(复制 + DB 行 + 返回 id)过;既有 sessions/provider/sidebar 测试不回归(3 个预存 fail 不算:projectsDb.createProjectPath / createProject conflict / provider model cache)。

## 9. 与其他 REQ 的关系

- **REQ-030(自动重命名)**:fork 后新对话可触发 REQ-030(10 轮后自动重命名);fork 历史 snapshot 的 silent rename turn 在 `fetchHistory` 已被 `filterSilentRenameTurns` 剥离,不冲突。fork 当下的 `custom_name = "<原名> · fork"` 不会被 REQ-030 立即覆盖(REQ-030 守卫:已有 custom_name 且非空不重命名,需到阈值)。
- **REQ-016(跨会话上下文 MCP)**:fork 历史是独立 session,不污染 REQ-016 的 FTS5 搜索(独立行)。
- **REQ-045(侧边栏 a11y)**:fork 按钮遵循 REQ-045 约定(`<button type="button" aria-label>`,非 div onClick;hover `opacity-0 group-hover:opacity-100`)。

## 10. 第二阶段(不在本版)

- **fork at message**(从某消息分支):需 UI 选消息 + server 按行截断 jsonl 复制到新文件。issue #14024。
- **fetchHistory 合并视图**:fork 后新轮次(在新 provider transcript)+ 历史快照(副本)合并展示连续对话。本版 fork 后新轮次靠 WebSocket 实时推送可见,刷新后只看快照(已知边界)。
- **跨 provider fork**:claude → codex(需格式转换,本版禁,provider 不一致返 400)。

## 11. 偏离 BACKLOG 四要素说明

BACKLOG 写「sidebar session 项 hover 操作组加 fork 按钮」+「chat 顶栏按钮」。**spec 偏离**:chat 顶栏**不加**——ChatInterface 无现成顶栏 action 区(操作在 composer/messages pane 内),加顶栏要新建组件 + 重排布局,回归风险高且文件卫生恶化。fork 入口**集中在 sidebar hover 操作组**(含移动端),用户路径短(右键/侧栏是 session 操作的天然位置,对标 Codex 右键 fork)。此偏离已在 BACKLOG 范围内描述(spec 5.2 标注),Archie 评审可要求补 chat 顶栏入口。
