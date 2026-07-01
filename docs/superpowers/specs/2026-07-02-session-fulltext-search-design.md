# 会话全文搜索 — FTS5 倒排索引设计

> **状态**：设计已确认，待实现
> **日期**：2026-07-02
> **范围**：planrla 桌面端（server + UI），索引 Claude / Codex 会话

## 背景

planrla 用户已积累 **4456 个会话**（4354 Claude + 103 Codex）。现有搜索是 ripgrep 关键词匹配（`server/modules/providers/services/session-conversations-search.service.ts`），基于 `@vscode/ripgrep` 做精确字符串/正则匹配，**无相关性排序**（按文件顺序返回）。

**痛点**：用户"想到某个主题，无法精准找到之前的 session"。ripgrep 只匹配字面词，主题词分散在大量消息中难以定位，且无相关性排序，命中多的 session 和命中少的混在一起。

## 目标

用 **SQLite FTS5 trigram 倒排索引**替换 ripgrep，提供：

- **BM25 相关性排序**：最相关的 session 排前（命中次数多、篇幅短的加权）
- **snippet 高亮**：FTS5 `snippet()` 返回匹配片段
- **中文/代码友好**：trigram tokenizer（3 字符滑窗），无需中文分词 native 依赖
- **最全覆盖**：索引每个 session 的全部消息文本

### 非目标（MVP 不做）

- 语义搜索（embedding / 向量）—— 用户明确选择先用倒排索引（更轻量，无 Ollama 依赖）
- 消息级精细定位 —— session 级召回（找到 session）+ snippet 高亮即满足"找到 session"痛点

## 架构

### 数据流

```
索引：session jsonl → 提取全部消息文本 → 拼接 → FTS5 INSERT（trigram 分词）
查询：query → FTS5 MATCH + bm25() 排序 → session 列表 + snippet() 高亮片段
```

### 表结构（auth.db 新增）

```sql
CREATE VIRTUAL TABLE session_search USING fts5(
  content,                       -- session 全部消息文本拼接
  session_id UNINDEXED,          -- 关联 sessions 表（只存不索引）
  provider UNINDEXED,            -- claude / codex
  project_path UNINDEXED,        -- 可选过滤
  tokenize = 'trigram'
);
```

- `content` 是唯一被索引列（trigram 分词）
- 其余列 `UNINDEXED`（只存储，供过滤/展示，不进倒排索引）
- 外部内容表（`contentless` 或外部）暂不采用——直接存 content，简单；索引大小可接受（几十 MB）

## 组件

### 1. 索引构建器 `server/modules/search/session-search-indexer.ts`

```
buildIndexForSession(sessionId):
  1. sessionsDb 取 jsonl_path, provider
  2. 读 jsonl，复用 provider 的消息解析逻辑，提取所有消息文本
  3. 拼接成 content（角色 + 内容，如 "user: ... assistant: ..."）
  4. INSERT 或 UPDATE session_search（先 DELETE session_id 旧行，再 INSERT）

buildAllIndexes(onProgress):
  遍历 sessions 表所有 session，逐个 buildIndexForSession
  后台运行，onProgress 回调报告进度

isIndexEmpty():
  SELECT COUNT(*) FROM session_search → 决定是否触发首次全量
```

### 2. 检索服务 `server/modules/search/session-search.service.ts`

```
searchSessions(query, { scope, projectId, provider, limit }):
  1. 构造 FTS5 MATCH 表达式（处理特殊字符转义）
  2. SELECT session_id, bm25(session_search) AS score, snippet(session_search) AS highlight
     FROM session_search WHERE content MATCH ?
     [AND provider = ?] [AND project_path = ?]
     ORDER BY score LIMIT ?
  3. JOIN sessions 表补全 session 元数据（title, project, updated_at 等）
  4. 返回 [{ session, highlight, score }]
```

- BM25 分数越低越相关（FTS5 bm25 约定，负数）
- snippet 高亮默认 `<b>` 标记匹配片段

### 3. 路由 `server/routes/search.js`

```
GET /api/search/sessions?q=<query>&scope=<all|project|provider>&projectId=&provider=&limit=
```

- 鉴权：`authenticateToken` 中间件（与其他 API 一致）
- 参数校验：q 非空，limit 默认 50

### 4. UI 改造（替换 ripgrep）

- 前端现有搜索框（调用 `session-conversations-search`）改为调用 `/api/search/sessions`
- 结果展示：session 列表 + snippet 高亮 + 按相关性排序
- `session-conversations-search.service.ts`（ripgrep 实现）保留但不再作为主搜索（可作为 fallback 或后续删除）

## 索引时机

### 首次全量

- server 启动时（`initializeDatabase` 后），检测 `session_search` 表是否为空
- 空 → 后台启动 `buildAllIndexes`（不阻塞 `server.listen`，UI 通过 WebSocket / 轮询显示进度）
- 4456 session，每个读 jsonl + 提取 + INSERT，预计几分钟

### 增量

- hook 到现有 `claude-session-synchronizer` / `codex-session-synchronizer`
- session 同步（新增 / jsonl 更新）时，触发 `buildIndexForSession(sessionId)`
- 利用 sessions 表的 `updated_at` 检测变化（避免无谓重建）

## 错误处理

- **jsonl 不存在 / 读失败**：跳过该 session，log warning，不中断全量
- **FTS5 查询语法错误**（query 含 `"` `*` 等特殊字符）：转义为短语查询；仍失败则降级到 `LIKE`
- **全量索引中断**（server 重启）：下次启动重新检测空表 / 基于 `updated_at` 续传
- **FTS5 表损坏**：DROP + 重建（首次全量）

## 性能

| 指标 | 预期 |
|------|------|
| 首次全量 | 几分钟（后台，不阻塞） |
| 查询延迟 | <50ms（FTS5 倒排 + BM25） |
| 索引大小 | 几十 MB（trigram 倒排压缩） |
| 增量索引 | 单 session <1s |

## 边界与限制

- **trigram 3 字符限制**：1-2 字符查询不命中（中文"性能"2 字搜不到，"性能优化"4 字可）。主题搜索通常 ≥3 字，可接受。1-2 字短查询可降级 ripgrep 或 LIKE。
- **纯字面/短语匹配（非语义）**：同义词搜不到（搜"快"找不到"迅速"）。后续可扩展 embedding 作为二期能力。
- **FTS5 表属 auth.db**：随 schema migration 创建（init-db 加表）

## 测试

- **FTS5 trigram 中文检索**："性能优化"命中含该词的 session
- **BM25 排序**：命中次数多 / 篇幅短的 session 排前
- **snippet 高亮**：返回匹配片段且 `<b>` 标记正确
- **增量索引**：新 session 同步后立即可搜到
- **jsonl 缺失容错**：不中断全量，warning log
- **特殊字符查询**：`"` `*` 转义/降级
- **查询性能**：<50ms
- **UI 集成**：现有搜索框改 FTS5，结果展示正确

## 复用现有实现

- **jsonl 解析**：`claude-sessions.provider.ts` / `codex-sessions.provider.ts` 的消息提取逻辑（提取 role + content 文本）
- **session 元数据**：`sessionsDb`（sessions 表查询）
- **同步钩子**：现有 `session-synchronizer` 的更新点（增量索引触发）
- **数据库连接**：`getConnection()`（better-sqlite3，FTS5 原生支持）

## 不做（YAGNI）

- ❌ embedding / 向量语义搜索（用户明确先用倒排索引）
- ❌ 消息级 FTS5（session 级召回 + snippet 足够）
- ❌ FTS5 + ripgrep 混合排序（MVP 替换 ripgrep，简单统一）
- ❌ 独立搜索 UI 入口（替换现有搜索框）
- ❌ contentless / 外部内容表（直接存 content，简单；索引大小可接受）
