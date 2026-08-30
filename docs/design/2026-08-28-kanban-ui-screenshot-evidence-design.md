# kanban 可视化验证截图留证 — 技术方案设计

- 日期:2026-08-28
- 状态:技术方案(待评审)
- 关联:kanban task #2「可视化验证必须截图留证」;BACKLOG REQ-ID 待补录

## 1. 背景与目标

kanban 内置研发流程模板(sdlc-default)的「测试验证」阶段对 UI 改动没有可视化留证要求,agent 声称验证通过时验收人无法看到证据。本方案把「UI 改动必须 playwright 截图留证」固化进模板与交付链路:

1. 模板固化:ss3「测试验证」prompt 强制截图要求 + ss4「交付」prompt 强制 DELIVERY.md 引用截图路径。
2. 已有磁盘模板环境自动迁移生效(seed 不会覆盖已存在的磁盘模板)。
3. DeliverablePanel 渲染 DELIVERY.md 引用的仓库内截图,验收人免切文件夹。

## 2. 现状与关键事实(调研结论)

| 事实 | 位置 | 影响 |
|---|---|---|
| seed 仅在模板目录为空时执行 | `server/modules/kanban/assembly.ts:105` | 磁盘旧模板永不更新 → 必须迁移 |
| 磁盘模板即 seed 产物,`TaskTemplate` 无版本字段 | `server/modules/kanban/template-store.ts`、`types.ts` | 迁移需要新增 `seedVersion` 标记 |
| 用户可在前端编辑模板,整体 POST 覆盖 | `src/components/kanban/api.ts:201` → `kanban.routes.ts:99` | 迁移标记可能被前端保存抹掉,需服务端兜底 |
| `substitute` 已支持 `{{task_number}}`/`{{input}}` 等变量 | `server/modules/kanban/prompt.ts:13` | 截图文件名规则可直接用模板变量 |
| `deliveryDoc` 用 `<pre>` 纯文本渲染 | `src/components/workbench/pages/WorkflowPage.tsx:162` | 换 Markdown 渲染即可显示图片 |
| `Markdown` 组件已把本地绝对路径映射到 `/api/providers/local-image` | `src/components/chat/view/subcomponents/Markdown.tsx:148` | 只认绝对路径/`file://`,相对路径需先解析 |
| worktree 固定建于 `<rootPath>/.worktree/<branch>`,success 任务保留现场 | `server/modules/kanban/git-worktree.ts:28`、`assembly.ts:140` | 截图路径在注册项目路径内,代理白名单天然覆盖;验收时文件仍在 |

## 3. 架构选型

### 3.1 磁盘模板迁移策略

| 方案 | 思路 | 结论 |
|---|---|---|
| A. 启动时整体重新 seed | 每次启动覆盖 sdlc-default | ❌ 丢弃用户对模板的全部自定义 |
| B. seedVersion + 旧版指纹定向覆盖 | 只升级仍等于旧版原文的 stage prompt | ✅ **选定**:幂等、最小侵入、不覆盖用户自定义 |
| C. 不迁移,用户手动改 | 文档引导 | ❌ 不满足验收「对已有磁盘模板环境生效」 |
| D. 模板继承/合并体系 | 内置层 + 用户层运行时合并 | ❌ 过度设计,引入模板语义二义性 |

**方案 B 细节**:

- `TaskTemplate` 增加可选字段 `seedVersion?: number`(仅内置模板使用;旧文件缺失视为 v1)。
- 内置模板定义从 `assembly.ts` 提取到新模块 `sdlc-default-template.ts`(单一事实源),导出:
  - `SDLC_DEFAULT_SEED_VERSION = 2`
  - `buildSdlcDefaultTemplate(now): TaskTemplate`(含 seedVersion)
  - `LEGACY_V1_STAGE_PROMPTS`:v1 旧版 ss3/ss4 的 `promptTemplate` 原文指纹
  - `migrateSdlcDefaultSeed(disk: TaskTemplate): { tpl, upgraded: string[], skipped: string[] }`(纯函数,便于单测)
- 迁移规则(逐 stage):
  - 磁盘 stage 的 `promptTemplate` **=== 旧版指纹** → 判定「用户未自改」,覆盖为 v2 新文案;
  - **不等于**指纹(用户已自定义)→ 跳过该 stage,`upgraded/skipped` 记录并在 console 提示用户手动参考新版;
  - 任意 stage 发生变更或 seedVersion 落后 → 写回 `seedVersion = 2` 与新 `updatedAt`。
- `assembly.ts` 接线:目录为空 → seed v2(现有逻辑改用 `buildSdlcDefaultTemplate`);目录非空且 id=`sdlc-default` 存在且 `(seedVersion ?? 1) < SDLC_DEFAULT_SEED_VERSION` → 执行迁移并 `saveTaskTemplate` 写回。seedVersion 相同 → no-op(幂等)。
- 其他自定义模板(非 sdlc-default id)永不触碰。

### 3.2 seedVersion 防抹除兜底

前端 `TaskTemplateEditor` 保存是整体 POST,前端类型不感知 `seedVersion`,直接落库会把标记抹掉 → 下次启动重复迁移。因指纹比对本身保护用户自定义,重复迁移不会误覆盖,但会产生噪音。兜底:`POST /tasks/templates` 路由保存 `sdlc-default` 时,若 `req.body.seedVersion` 缺失则沿用磁盘现有值。前端零改动。

### 3.3 交付说明截图渲染

| 方案 | 思路 | 结论 |
|---|---|---|
| a. 前端正则把相对路径拼 worktreePath | 前端改写 markdown | ❌ 误伤代码块示例、无法校验文件存在 |
| b. 后端读 DELIVERY.md 时解析重写 | 仅对 `existsSync` 通过的图片相对路径改写为绝对路径 | ✅ **选定**:零误伤、可单测、前端只换渲染组件 |
| c. 新增结构化接口返回 images 列表 | 前端缩略图区单独渲染 | ❌ 改动面大,首版收益不成比例 |

**方案 b 细节**:

- 新增纯函数 `resolveDeliveryDocImages(content, worktreePath): string`(server 侧,可单测):
  - 匹配 markdown 图片语法 `![alt](path)`;
  - 仅处理**相对路径**(排除 `http(s)://`、`file://`、`/` 开头、盘符开头),`join(worktreePath, path)` 后 `existsSync` 校验通过才替换为绝对路径(正斜杠归一);
  - 不存在的引用原样保留(验收人可见 agent 声明了但文件缺失——本身即验收信号)。
- `GET :taskId/delivery-doc` 路由返回前套用该函数(worktreePath 取自 task,缺失时原文返回)。
- 前端 `DeliverablePanel`:`deliveryDoc` 的 `<pre>` 换为已有的 `<Markdown>` 组件(同文件已 import,用于 deliverySummary)。绝对路径图片由 `transformLocalImageUrl` 自动走 `/api/providers/local-image` 代理。

## 4. v2 模板 prompt 文案(定稿)

### 4.1 ss3「测试验证」

```text
{{input}}

运行测试与验证,输出验证记录。

可视化验证要求(强制):
- 若本任务改动涉及 UI / 可视化效果:必须用 playwright 无头脚本真实打开页面验证并截图留证,禁止仅凭代码推断 UI 正确:
  - 截图统一存放 debug/ui-acceptance/,文件名含任务编号与场景,如 debug/ui-acceptance/task{{task_number}}-hover-popover.png;
  - 截图脚本本身留存于 debug/(如 debug/capture-task{{task_number}}-hover-popover.mjs),保证可复跑;
  - 页面不可访问时先启动 dev server / preview 再截图;截图失败须在验证记录中说明原因与重试结果。
- 若本任务为纯后端 / 逻辑改动(无任何 UI 变化):可豁免截图,但验证记录与交付说明中必须明确声明「本任务无可视化改动」。
- 验证记录末尾列出全部截图的相对路径清单,供交付阶段写入 DELIVERY.md。
```

### 4.2 ss4「交付」(在现有文案基础上追加)

```text
{{input}}

整理交付说明并写入 worktree 根目录的 DELIVERY.md:完成内容、改动文件清单、使用/合并方式、遗留事项。这是交付物的一部分。

DELIVERY.md 必须包含「验证证据」小节:
- 用 markdown 图片语法逐一列出全部验证截图的相对路径(如 ![场景](debug/ui-acceptance/task{{task_number}}-hover-popover.png));
- 若无可视化改动,须明确声明「本任务无可视化改动」(承接测试验证阶段的记录)。
```

## 5. 改动点清单

| # | 文件 | 改动 | 规模 |
|---|---|---|---|
| 1 | `server/modules/kanban/sdlc-default-template.ts` **(新)** | v2 模板定义、v1 指纹、`migrateSdlcDefaultSeed` 纯函数 | ~130 行 |
| 2 | `server/modules/kanban/types.ts` | `TaskTemplate.seedVersion?: number` | +2 行 |
| 3 | `server/modules/kanban/assembly.ts` | seed 改用构建函数 + 启动迁移接线 | +15 行 |
| 4 | `server/modules/kanban/delivery-doc.ts` **(新)** | `resolveDeliveryDocImages` 纯函数 | ~40 行 |
| 5 | `server/modules/kanban/kanban.routes.ts` | delivery-doc 套用图片解析;POST templates 保留 seedVersion | +10 行 |
| 6 | `src/components/workbench/pages/WorkflowPage.tsx` | `deliveryDoc` 的 `<pre>` → `<Markdown>` | ~5 行 |
| 7 | `server/modules/kanban/tests/sdlc-default-template.test.ts` **(新)** | 迁移矩阵测试(见 §6) | ~90 行 |
| 8 | `server/modules/kanban/tests/delivery-doc.test.ts` **(新)** | 图片解析测试 | ~60 行 |
| 9 | `server/modules/kanban/tests/prompt.test.ts` | ss3 渲染产物含截图要求、`{{task_number}}` 替换 | +15 行 |
| 10 | `server/modules/kanban/tests/template-routes.test.ts` | 保存 sdlc-default 保留 seedVersion | +20 行 |

总新增 ~390 行(测试占 ~185,业务 ~205),超出单会话 300 行预算的部分以「核心(1-6,~200 行)→ 测试与增强(7-10)」拆两个 commit 控制;实施阶段按此顺序。

## 6. 测试与验收映射

| 验收标准 | 覆盖方式 |
|---|---|
| 模板改动对已有磁盘模板环境生效 | ① 迁移单测:旧版 v1 文件 → ss3/ss4 升级 + seedVersion=2;② 用户自改 ss3 → 跳过且原文保留;③ seedVersion=2 → no-op;④ 本机 `~/.planrla/` 为真实旧版环境,启动后实测文件更新 |
| renderStagePrompt 渲染「测试验证」阶段可见截图要求 | prompt 测试:用 v2 ss3 snapshot 渲染,断言产物含 `debug/ui-acceptance/` 且 `{{task_number}}` 已替换为具体编号 |
| tsc / eslint 0 error | `npx tsc --noEmit -p server/tsconfig.json` + 前端 `npx tsc --noEmit` + eslint(改动文件) |
| 完成 DELIVERY.md | 本任务交付说明含改动文件清单与验证截图(DeliverablePanel 为 UI 改动,本任务自身 dogfood 截图留证于 `debug/ui-acceptance/`) |

## 7. 风险与缓解

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | 用户已自改 ss3/ss4 prompt → 迁移跳过,新要求不生效 | 中 | 设计上保用户数据优先;console 提示 + 本方案模板文案可手动参考;后续可选:前端模板编辑器展示「内置模板已更新」提示(不在本期) |
| 2 | prompt 是软约束,agent 可能仍不截图或伪造路径 | 中 | 双保险:ss4 要求 DELIVERY.md 列截图相对路径 + 面板只渲染 `existsSync` 通过的图片 → 未产出截图时证据区为空,验收人可见;后续可选:验收门校验(debug/ui-acceptance 非空或含豁免声明)(不在本期) |
| 3 | playwright 环境不可用(无浏览器二进制/dev server 起不来) | 中 | 模板文案已写明失败须在验证记录说明;agent 可自行 `npx playwright install`;不阻塞豁免声明路径 |
| 4 | seedVersion 被前端整体保存抹除 → 重复迁移 | 低 | 指纹比对保证重复迁移不误覆盖;POST 路由服务端兜底保留标记(§3.2) |
| 5 | local-image 代理 403(截图在 worktree 内但路径不在白名单) | 低 | worktree 恒在 `<rootPath>/.worktree/` 下,属注册项目路径前缀;未建 worktree 的任务截图落主仓,同样在项目路径内 |
| 6 | deliveryDoc 从 `<pre>` 改 Markdown 渲染,展示行为变化 | 低 | DELIVERY.md 本就是 markdown 交付物;Markdown 组件与 chat 同源,已处理本地路径编码与安全(react-markdown 不渲染裸 HTML) |
| 7 | Windows 路径分隔符混乱(DELIVERY.md 中反斜杠引用) | 低 | 解析函数统一 `path.resolve` + 正斜杠归一;`Markdown.tsx` 已有百分号解码逻辑处理 `%5C` |

## 8. 实施顺序(建议)

1. `types.ts` + `sdlc-default-template.ts` + `assembly.ts`(模板与迁移核心)+ 迁移单测 → 本机真实环境启动验证;
2. `prompt.test.ts` 截图要求断言;
3. `delivery-doc.ts` + 路由接线 + 单测;前端 `<pre>` → `<Markdown>`;
4. seedVersion 兜底 + 路由测试;
5. 本任务 DELIVERY.md + DeliverablePanel 截图留证(dogfood)。
