# Changelog

All notable changes to Planrla will be documented in this file.


## [0.8.1](https://github.com/fucheng830/planrla/compare/v0.8.0...v0.8.1) (2026-07-09)

### Bug Fixes

* **server:** taskmaster 安装检测 Windows 兼容 ([7372682](https://github.com/fucheng830/planrla/commit/73726828c6bf5648acb13309c489908004a6e2bf))

### Documentation

* **backlog:** 回填 REQ-016 released v0.8.0(L2+L3 MCP 查询+全局搜索) ([6f01709](https://github.com/fucheng830/planrla/commit/6f0170922276bc17cc7d217cc4fe96219742fb6e))
* **release:** v0.8.0 产物回填(exe 238MB zip 338MB r2 live) ([f64ac61](https://github.com/fucheng830/planrla/commit/f64ac619b1a84a9ee43536865867109d55ad31e9))
* **release:** v0.8.0 note(req013 会话重命名 chat mcp) ([b10facf](https://github.com/fucheng830/planrla/commit/b10facfbb9b612788cfc10ae9fa41882374e4c4c))

## [0.8.0](https://github.com/fucheng830/planrla/compare/v0.7.1...v0.8.0) (2026-07-09)

### New Features

* **chat:** /search 命令 + 搜索结果卡片 (REQ-016 L3 B+C) ([76f3be3](https://github.com/fucheng830/planrla/commit/76f3be3eca1f319d2a3a80a837191a2a43f19435))
* **chat:** 加 session reference 格式化纯逻辑 + 测试 (REQ-016) ([3047c33](https://github.com/fucheng830/planrla/commit/3047c33c9352ef96dca5220bbd360cc51c6cae9f))
* **chat:** 加 SessionReferenceChip 组件 (REQ-016) ([4443dd7](https://github.com/fucheng830/planrla/commit/4443dd74477afad58f6e0fb1cd00b766777c1c08))
* **chat:** 加 SessionReferencePicker 组件 (REQ-016) ([d87fa50](https://github.com/fucheng830/planrla/commit/d87fa50949e17c3fa8a1525ca6130e7506dec48e))
* **chat:** 加 useSessionReferences hook (REQ-016) ([843613c](https://github.com/fucheng830/planrla/commit/843613c9ba3c8b42e3a51e8643bcfeaeed6e4fa1))
* **chat:** add /rename command parser and hint formatter ([6ec6bac](https://github.com/fucheng830/planrla/commit/6ec6bac125df81cad9f1d81e7466608c39b0e620))
* **chat:** intercept /rename and inject sessionId hint ([7ae8eee](https://github.com/fucheng830/planrla/commit/7ae8eee89dc17f5be118a7c29ed7fe99eb34b371))
* **chat:** listen for session_renamed to refresh sidebar ([864759f](https://github.com/fucheng830/planrla/commit/864759f359e55e82dd0561f6a1aefc368329616a))
* **chat:** REQ-016 接 pickerAllSessions 跨 project 搜索 ([b66409e](https://github.com/fucheng830/planrla/commit/b66409e2c1809f90250954d4d69abbfec3e00c8d))
* **chat:** REQ-016 用户消息渲染折叠引用块 ([8f8c760](https://github.com/fucheng830/planrla/commit/8f8c7600350e26aaad15bf77bcf6eb6e05fa58c6))
* **chat:** REQ-016 ChatComposer 引用按钮 + chip + Picker 接线 ([f1ffe96](https://github.com/fucheng830/planrla/commit/f1ffe96f866fc1fc6d92f03486beef129628de48))
* **chat:** REQ-016 composer 注入引用 + Ctrl/Cmd+L ([356861d](https://github.com/fucheng830/planrla/commit/356861d43d029aedf008ad4e712dbcf404a52e86))
* **chat:** REQ-027 ① getLanguageFromPath util + 单测 ([4196f70](https://github.com/fucheng830/planrla/commit/4196f70ff2cc134fca5712f5b8250e962f90b55b))
* **chat:** REQ-027 ① ToolDiffViewer 语法高亮(+大diff fallback) ([01e1add](https://github.com/fucheng830/planrla/commit/01e1add1241bbb082afdde605273d55379988131))
* **chat:** REQ-027 ② parsePlanSteps util + 单测 ([3f06a85](https://github.com/fucheng830/planrla/commit/3f06a851944d68610e5f0ff8269d440b3cda3746))
* **chat:** REQ-027 ② PlanDisplay 步骤结构化渲染(checkbox/编号) ([05a9d0a](https://github.com/fucheng830/planrla/commit/05a9d0ad4581c1f48eebbd066b7b08a2252e7e26))
* **chat:** REQ-027 ④ ComposerContext(insertText 注入路径) ([99e556c](https://github.com/fucheng830/planrla/commit/99e556ca724ff7ee16314d07f1ac96252be2e8fd))
* **chat:** REQ-027 ④ diff 行级评论 + 复制为消息(本地 state) ([86f4443](https://github.com/fucheng830/planrla/commit/86f4443474b0c3a98ba1ad1c8c35bea560da154f))
* **i18n:** REQ-016 references 段(en + zh-CN) ([1f79b49](https://github.com/fucheng830/planrla/commit/1f79b491ee8d6cb162d5680f391c2e14a553b5aa))
* **i18n:** REQ-027 ④/② diffComments + plan.steps(en + zh-CN) ([ee6c8bf](https://github.com/fucheng830/planrla/commit/ee6c8bf31afddb7c78a90d7946e2d34986786bd7))
* **mcp:** expose set_session_title tool to agent ([d3c9fbe](https://github.com/fucheng830/planrla/commit/d3c9fbe03e8de192aa96c3c2be8bc80c047062d1))
* **mcp:** session rename service (validate/persist/broadcast) ([648d6db](https://github.com/fucheng830/planrla/commit/648d6dbfc547eda885fa7fdbd284e37da9c4e412))
* **server:** 加 search_conversations 全局搜索 MCP 工具 (REQ-016 L3 A) ([06a6818](https://github.com/fucheng830/planrla/commit/06a68185955bb0e82897a2efbf7d4013015f35cf))
* **server:** 加 session-query MCP server (REQ-016 L2) ([12f2ca3](https://github.com/fucheng830/planrla/commit/12f2ca317ecbc36dcbd4bbf9a163430f6cebb906))
* **server:** 启动注册 session-query MCP 给各 provider (REQ-016 L2) ([8a1bf9f](https://github.com/fucheng830/planrla/commit/8a1bf9f3f1b4c65807760611a99bb01c42b682ec))

### Bug Fixes

* **chat:** REQ-016 chip saveEdit 保留多行 content(按 [role] 标记扫描) ([9c824c6](https://github.com/fucheng830/planrla/commit/9c824c6a635ccf9091814312551228ca868f19dc))
* **chat:** REQ-027 final review 修(④ 行号真实化/去L# + 删 dead i18n key) ([a4a6ed3](https://github.com/fucheng830/planrla/commit/a4a6ed3367e4d7f7e88db3c28e25f6ba66f4e6ae))
* **mcp:** session-rename lint (barrel import + import order) ([bb91406](https://github.com/fucheng830/planrla/commit/bb914068f3c86c7577aa23cd59fe745f081fe937))
* **server:** 跨会话 MCP 改 HTTP 进程内(修 asar spawn 失败) ([20d1aad](https://github.com/fucheng830/planrla/commit/20d1aad04facefb2534d7a389908ab3bff16b6ac))

### Refactoring

* **chat:** 简化 Picker(一步选)+ Chip(标签) (REQ-016 L2) ([8fba0ad](https://github.com/fucheng830/planrla/commit/8fba0adee980bc33352bfaaa148a64694b884cdc))
* **chat:** 简化 sessionReferenceFormat + hook (REQ-016 L2) ([18b79aa](https://github.com/fucheng830/planrla/commit/18b79aa6d03913dd3655c20c3f0fd87024d52c5f))
* **chat:** L2 composer/message/props/i18n 收尾 (REQ-016 L2) ([810b111](https://github.com/fucheng830/planrla/commit/810b111b7e754a2a4468134130e5abab343171b9))

### Documentation

* **backlog:** 清理 backlog(合并主题+REQ-008 核对已实现+Parked 暂搁) ([12062cb](https://github.com/fucheng830/planrla/commit/12062cbf3fa5db7ed28911b82b4ee5c475dd7892))
* **plan:** 写 REQ-016 跨会话引用实施 plan ([867313e](https://github.com/fucheng830/planrla/commit/867313e4b7dfdde9e9f5b22d2cc2bfd8d504fc23))
* **plan:** 写 REQ-016 L2 MCP 查询实施 plan ([7756274](https://github.com/fucheng830/planrla/commit/7756274f6b0e8aec4d912c5d0356e1cc7334c460))
* **plan:** 写 REQ-027 UX 对齐 Codex 渲染层交互实施 plan ([7cd3217](https://github.com/fucheng830/planrla/commit/7cd3217b52e3432455d898f4034ce7ad74f63084))
* **plan:** req013 会话重命名 chat mcp 实施计划 ([29a2f0c](https://github.com/fucheng830/planrla/commit/29a2f0ca2abc81d3430f136587884ef841cfd510))
* **release:** v0.7.1 note (REQ-026 Sessions 按钮去双徽标) ([8b36269](https://github.com/fucheng830/planrla/commit/8b362692ac512d08c5758718e46a636e9dbc358a))
* **spec:** 会话重命名(chat 触发 mcp) ([be394fe](https://github.com/fucheng830/planrla/commit/be394fe1d8c3f6e676602e28066e510ea271aa0f))
* **spec:** 跨会话 @引用+整段历史 L1 设计 (REQ-016) ([d5389c2](https://github.com/fucheng830/planrla/commit/d5389c2aa0c3d38f97f1e1ab3b87b739f5bd64ac))
* **spec:** 写 REQ-016 L2 MCP 定点查询设计(取代 v1 preload) ([dbbbd83](https://github.com/fucheng830/planrla/commit/dbbbd8310689f3209236b76610346af5daf761c9))
* **spec:** 写 REQ-027 UX 对齐 Codex 渲染层交互优化设计 ([7f47cec](https://github.com/fucheng830/planrla/commit/7f47cecc0038620dd57424c533858e9b4133d1b4))

### Maintenance

* **backlog:** 会话重命名(chat mcp)进入实施 ([4b31551](https://github.com/fucheng830/planrla/commit/4b3155146a09240e42a3cf49b9f5536582edee89))
* **backlog:** REQ-027 → review(实施完成+lint fix) ([e1185c2](https://github.com/fucheng830/planrla/commit/e1185c2f3d1f480dd676546014f630854bea9d44))
* **backlog:** req013 验收通过 accepted ([de51ab8](https://github.com/fucheng830/planrla/commit/de51ab8fe1237f26b34a609c2ae35bcd8b932319))

## [0.7.1](https://github.com/fucheng830/planrla/compare/v0.7.0...v0.7.1) (2026-07-07)

### Bug Fixes

* **sidebar:** 去掉 Sessions 按钮 running 徽标,只留 completed 计数 (REQ-026) ([e34ee44](https://github.com/fucheng830/planrla/commit/e34ee444043e16337a35691341aae6da81dfc140))

### Documentation

* **backlog:** 入池 REQ-026(Sessions 按钮去双徽标) ([555de73](https://github.com/fucheng830/planrla/commit/555de73561568f28e2a14b25b22df3e795b0de6d))
* **release:** v0.7.0 note (REQ-024 合并对话/Running + REQ-025 状态 UI 统一) ([ae6c887](https://github.com/fucheng830/planrla/commit/ae6c88714c90665f607e3ef3444020d72e315919))

## [0.7.0](https://github.com/fucheng830/planrla/compare/v0.6.2...v0.7.0) (2026-07-07)

### New Features

* **sidebar:** REQ-024 会话按钮迁移 running emerald 计数徽标 ([89ce020](https://github.com/fucheng830/planrla/commit/89ce0204a29d040cea8097c02da7615e2e43cf0b))
* **sidebar:** REQ-024 会话列表 running 置顶 + emerald 标识 ([71b9b9d](https://github.com/fucheng830/planrla/commit/71b9b9d35371133425148a0ff74355c13f455c2f))
* **sidebar:** REQ-024 搜索结果 running 命中加 emerald 点(不置顶) ([4d9e1aa](https://github.com/fucheng830/planrla/commit/4d9e1aaaadc005228ba1127f4af4785fd9588f15))

### Bug Fixes

* **i18n:** track zh-CN/tasks.json (was gitignored, broke fresh-clone build) ([8fb26c2](https://github.com/fucheng830/planrla/commit/8fb26c26d9863bd03e1829d8689c1e365497cb39))

### Refactoring

* **i18n:** REQ-024 全量统一 conversation→session(spec §5.1) ([5e11690](https://github.com/fucheng830/planrla/commit/5e116904e2f152c263351784ae35a6885ccc6667))
* **shared:** 抽出 SessionTaskStatusBadge 到 shared (REQ-025) ([68e6165](https://github.com/fucheng830/planrla/commit/68e61659e7ba83a85992d0d5cc3055ea1b231467))
* **sidebar:** 顶层 Sessions 列表状态走共享 badge (REQ-025) ([f742107](https://github.com/fucheng830/planrla/commit/f742107eeffd8f96a40c35b250a969486340d077))
* **sidebar:** 搜索结果状态走共享 badge (REQ-025) ([14540c0](https://github.com/fucheng830/planrla/commit/14540c07b17c3301c4c3ce94537dc712eaf7c4a1))
* **sidebar:** 统一 session 行状态视觉,删冗余信号 (REQ-025) ([b33cca5](https://github.com/fucheng830/planrla/commit/b33cca5b5e5b973194118696f29a2ad245c013d5))
* **sidebar:** REQ-024 删除 Running tab(类型+UI+分支+死代码) ([871ef0f](https://github.com/fucheng830/planrla/commit/871ef0fa6264dd1b6e7892dc23a83d739d3ec508))
* **sidebar:** REQ-024 统一 conversations → sessions(类型+i18n+code) ([d8cab49](https://github.com/fucheng830/planrla/commit/d8cab49b7867d1cc370b4567c9f905ad1e708b38))

### Documentation

* **backlog:** 入池 REQ-025(侧边栏状态 UI 统一) ([2925177](https://github.com/fucheng830/planrla/commit/2925177436bca9460bb27c14849947293f2777b2))
* **plan:** 写 REQ-025 sidebar 状态 UI 统一实施 plan ([77e5db9](https://github.com/fucheng830/planrla/commit/77e5db963f99aba5fc3bcbbda0b584183a80fd37))
* **plan:** REQ-024 合并对话/Running sessions 实施计划 ([7f054de](https://github.com/fucheng830/planrla/commit/7f054dedd3bccf67c936ad968f9fea26abc00553))
* **release:** v0.6.2 note (REQ-023 external links + chat badge fix) ([33560e6](https://github.com/fucheng830/planrla/commit/33560e6502e38e4e1080e1253e0ccf03b4910d5a))
* **spec:** 统一 sidebar session 状态 UI (REQ-025) ([8815cab](https://github.com/fucheng830/planrla/commit/8815cabe4255a74a84ccd9c5622a5b5d526c262b))
* **spec:** REQ-024 合并「对话」与 Running sessions 侧边栏视图设计 ([28bdf1d](https://github.com/fucheng830/planrla/commit/28bdf1d6eaf0629519ba312ae0233576219c318f))
* **spec:** REQ-024 修正语言数(11→10实测)+ 补 useSidebarController/Sidebar.tsx 改动 ([5db739a](https://github.com/fucheng830/planrla/commit/5db739a0e56dc09463a44b014da9cf43f88d4e10))

### Maintenance

* **backlog:** REQ-024 plan→review(实施完成+final review 通过) ([f8c8f76](https://github.com/fucheng830/planrla/commit/f8c8f76986ec3873bf8cc06bce6bfc8a791a39cd))

## [0.6.2](https://github.com/fucheng830/planrla/compare/v0.6.1...v0.6.2) (2026-07-06)

### New Features

* **req023:** add isAllowedUrl protocol whitelist + tests ([fa2bbd1](https://github.com/fucheng830/planrla/commit/fa2bbd15f33013c3fdc1cde67976815b6fdd9957))
* **req023:** add selfOrigins/isSelfOrigin + tests ([5ce7b43](https://github.com/fucheng830/planrla/commit/5ce7b438062c3f04c1adc5c4ab4ebf3776c14cce))
* **req023:** intercept external links in main window (system browser) ([59db3ad](https://github.com/fucheng830/planrla/commit/59db3adf21bc6c1152c8c3da862a67f87fef17af))

### Bug Fixes

* **chat:** 权限决策后恢复 sidebar Running 徽章 ([912a48b](https://github.com/fucheng830/planrla/commit/912a48bc1de55e4860ab6b521b941e227cf982f0))
* **chat:** permission_cancelled 后恢复 sidebar Running 徽章 ([a27c71c](https://github.com/fucheng830/planrla/commit/a27c71c16d455366868f5b6af3e533fe27fa0487))

### Documentation

* **backlog:** 标记 REQ-023 验收通过 accepted(待 v0.6.2) ([b9b5162](https://github.com/fucheng830/planrla/commit/b9b51629b2b5304a61879cf4361879dfeef39a93))
* **backlog:** 录入 REQ-019~022(Kanban/A2A/Codex UX/Codex 全特性母) ([bb2cfe5](https://github.com/fucheng830/planrla/commit/bb2cfe5781898e0cf94120df2aac82005eead2e4))
* **backlog:** 录入 REQ-023(桌面端外链系统浏览器打开)+ spec ([f84d705](https://github.com/fucheng830/planrla/commit/f84d7059435f2d585fa05fe3e3cc9dd7b0abc72a))
* **backlog:** mark REQ-011 done (auto-update e2e passed v0.6.0->v0.6.1) ([83743f5](https://github.com/fucheng830/planrla/commit/83743f54f93ed6a2dbe0767385596e7c5fff1113))
* **plan:** 录入 REQ-023 实施计划(外链系统浏览器打开) ([46d0763](https://github.com/fucheng830/planrla/commit/46d0763cf8b03a3c02d43d3feeddae538284e47a))
* **release:** v0.6.1 note (publish-r2 fixes + auto-update test carrier) ([d8d494b](https://github.com/fucheng830/planrla/commit/d8d494b96dcbec1ee66fdd53ee9271791554251f))

## [0.6.1](https://github.com/fucheng830/planrla/compare/v0.6.0...v0.6.1) (2026-07-05)

### Bug Fixes

* **req011:** publish-r2 invokedDirectly detection + use npx wrangler ([3393d55](https://github.com/fucheng830/planrla/commit/3393d55acf7279fc6f790fc8eeccb7cad80bbda6))
* **req011:** publish-r2 skip large files >300MiB with warning (wrangler limit) ([65dbfaa](https://github.com/fucheng830/planrla/commit/65dbfaa12efc5f942a9636fa7da6ef8b1bc1505d))

### Documentation

* **release:** v0.6.0 note + REQ-011 released ([4e4105c](https://github.com/fucheng830/planrla/commit/4e4105c8e3c2777e4e59ad8dcaaffd14ef1830cb))

## [0.6.0](https://github.com/fucheng830/planrla/compare/v0.5.0...v0.6.0) (2026-07-05)

### New Features

* **req011:** add UpdaterState type and window.updater declaration ([224158c](https://github.com/fucheng830/planrla/commit/224158c12f601978519eb189091a3123d2bb9f83))
* **req011:** main-side electron-updater module ([c849fb2](https://github.com/fucheng830/planrla/commit/c849fb294693f13ba0ef36b03ed81eb5a6068ec9))
* **req011:** mount UpdateNotification + Settings about section ([915aa77](https://github.com/fucheng830/planrla/commit/915aa77fffafecdd170a6a8126988aa7d7c99264))
* **req011:** publish-r2 script (wrangler upload latest.yml + exe + zip + blockmap) ([497fde8](https://github.com/fucheng830/planrla/commit/497fde8abf692b79644c9d37402315d8416ca03e))
* **req011:** update notification UI component ([1867710](https://github.com/fucheng830/planrla/commit/1867710573a4fd653a4533dcec29551abba2d911))
* **req011:** useAutoUpdater hook ([182024a](https://github.com/fucheng830/planrla/commit/182024a21b2e1fd09a8591f41e1c914929d72583))
* **req011:** wire auto-updater IPC bridge (main + preload + updater) ([b57f195](https://github.com/fucheng830/planrla/commit/b57f195702b2fba79e21b2848f6cab409cc32e29))

### Documentation

* **backlog:** mark REQ-011 doing (Tasks 1-8 merged, Task 9 R2 pending) ([69926eb](https://github.com/fucheng830/planrla/commit/69926eb42b6b47daa1056c7a242d6725991df3e4))
* **release:** v0.5.0 note + REQ-017/018 released ([4fd3dda](https://github.com/fucheng830/planrla/commit/4fd3dda6d4a779d3664e74cf7a0311597fd547ea))
* **req011:** publish:update script + release-checklist R2 step + NOMAD→PLANRLA rename ([bfecb8f](https://github.com/fucheng830/planrla/commit/bfecb8f14352c373e28ea56533b434f4219cb2a3))

### Maintenance

* **scripts:** auto-sync native ABI via prescripts (no more manual sync:node/electron) ([f308744](https://github.com/fucheng830/planrla/commit/f308744c7b6e74a9e8f6488d746bcc59744b16d4))

## [0.5.0](https://github.com/fucheng830/planrla/compare/v0.4.1...v0.5.0) (2026-07-05)

### New Features

* **docker:** linux headless server image ([36bf31f](https://github.com/fucheng830/planrla/commit/36bf31fd41f5e3be928686f02db32263b4d8d799))
* i18n extraction pass + Android UI fixes + cloud device management ([7716098](https://github.com/fucheng830/planrla/commit/7716098a4817a11b4c67fc1cadec302aededbc8a))

### Documentation

* **backlog:** add REQ-014 new-req entry and REQ-009 first slice ([e329c00](https://github.com/fucheng830/planrla/commit/e329c0001c466b85ae069ef75bf4d6ceb9100b38))
* **backlog:** add REQ-015/REQ-016 cross-session context share + L1 design draft ([f2f6a9d](https://github.com/fucheng830/planrla/commit/f2f6a9d08b1062fec15e1fd71460ba51625314de))
* **backlog:** mark req-003/004 released m2 c/d covered ([9d5f25d](https://github.com/fucheng830/planrla/commit/9d5f25d120976607b97a2ed98e02c5c4b2f3dc88))

### Maintenance

* ignore android verification screenshots ([63c5dd6](https://github.com/fucheng830/planrla/commit/63c5dd6ae53ded78b72f1d37d13a915cb2eab96c))

## [0.4.0](https://github.com/fucheng830/planrla/compare/v0.3.0...v0.4.0) (2026-07-03)

### New Features

* **files:** api.getFiles accepts dir parameter ([b472a05](https://github.com/fucheng830/planrla/commit/b472a0570ea0887e1e714a8d02c7d8efab54ae81))
* **files:** dir cache ttl pure fns ([9ef8121](https://github.com/fucheng830/planrla/commit/9ef8121e6fe92b0c5d7816c1136747f6156c8d98))
* **files:** error polish smoke ready manual checklist ([a0a2d30](https://github.com/fucheng830/planrla/commit/a0a2d30af4ebe9e70dbccc8a2c1e9fb68d928c75))
* **files:** file tree list react-window virtualization ([09282cc](https://github.com/fucheng830/planrla/commit/09282cc78f4774aa34c2bd108929329686e0d7fb))
* **files:** flatten visible nodes pure fn ([dc56683](https://github.com/fucheng830/planrla/commit/dc566832a6a17a647853adf50424c0d3477724b0))
* **files:** incremental single-level scan with dir query ([cd3e8b6](https://github.com/fucheng830/planrla/commit/cd3e8b6a9c9c384a3619d6b12dbe177487007b3e))
* **files:** search adapts to incremental cached dirs ([5f1f730](https://github.com/fucheng830/planrla/commit/5f1f7302ae88602ce1cdf9bdc7e20812a7654b1a))
* **files:** useFileTreeData incremental lazy load and cache ([7995f3e](https://github.com/fucheng830/planrla/commit/7995f3ecf7e4535957b9075250c6a2d560fde833))
* **files:** wire incremental data flatten virtualized list ([92ce10c](https://github.com/fucheng830/planrla/commit/92ce10c991457577566df4b0a7cf6ff0a4df0ff0))

### Bug Fixes

* **cli:** disable startup update check for private package ([a91f3df](https://github.com/fucheng830/planrla/commit/a91f3dfe06a1eadc4ab50f0ee20a7ecea745a231))
* **files:** path to dir key boundary and case ([bced290](https://github.com/fucheng830/planrla/commit/bced29013172e4c7b35a2f9f9820ff7c911f5149))

### Refactoring

* **files:** file tree node single-row no recursion ([28eaeb5](https://github.com/fucheng830/planrla/commit/28eaeb5d5619ad62332bc563df44d576a899be0f))

### Maintenance

* **files:** add react-window for virtualization ([8118954](https://github.com/fucheng830/planrla/commit/81189545b124c13247a1e1768ceabf34632159ea))

## [0.3.0](https://github.com/fucheng830/planrla/compare/v0.2.0...v0.3.0) (2026-07-03)

### New Features

* **defaults:** configurable default model per provider ([7b7fd0c](https://github.com/fucheng830/planrla/commit/7b7fd0c0fd167fb2309731c9ed772f847c0133a0))
* **defaults:** new session uses global default permission mode ([9b96b12](https://github.com/fucheng830/planrla/commit/9b96b12fa9d7cecb3082db1e1d21e08f326f256c))
* **defaults:** one-time ack before default unrestricted permissions ([3882f14](https://github.com/fucheng830/planrla/commit/3882f1402c8a63edc1bf3be8a356d621c731c443))
* **defaults:** permission default fns + extend permissionmode with yolo ([6a9f886](https://github.com/fucheng830/planrla/commit/6a9f8862ff73694fe172bc454b6839fa1c58866c))
* **defaults:** settings ui for default permission/model + yolo badge ([57c3943](https://github.com/fucheng830/planrla/commit/57c3943940e313fc746af3168665c020f7091c03))
* **desktop:** mount title bar at app root ([87c447e](https://github.com/fucheng830/planrla/commit/87c447e87904592cae9b00c6781473b014dfe4c2))
* **desktop:** self-drawn title bar container ([a2747df](https://github.com/fucheng830/planrla/commit/a2747df52d74f9a4d6ce1cf0192690aa374c5082))
* **desktop:** theme cache + title bar overlay chrome ([336777d](https://github.com/fucheng830/planrla/commit/336777dda96df7fb30a679db23ad868e4565aac8))
* **i18n:** detect system language on first launch ([89a4275](https://github.com/fucheng830/planrla/commit/89a4275561f0c0618f02f29590a413094559918a))
* **i18n:** register fr + match region-less language codes ([0e3cc62](https://github.com/fucheng830/planrla/commit/0e3cc625574ad88646e8d0080ea2f20d9b0edaa7))
* **landing:** astro project skeleton (independent package.json) ([a98c109](https://github.com/fucheng830/planrla/commit/a98c109281644239335ea5fb6cc2350723d2e7f7))
* **landing:** changelog section (build-time fetch github releases) ([3908cc3](https://github.com/fucheng830/planrla/commit/3908cc36326f441ace953562ebe8e2dfbde08327))
* **landing:** download section linking github releases ([d084089](https://github.com/fucheng830/planrla/commit/d0840892ff13950efcd48604b7a7901aba09f480))
* **landing:** features section (4 cards, responsive grid) ([a1d9eaa](https://github.com/fucheng830/planrla/commit/a1d9eaabd95c9c3e78086c06260a11da6a0e256f))
* **landing:** finalize index title + assemble all sections ([a300c0a](https://github.com/fucheng830/planrla/commit/a300c0abcccbfe0555d27ea67847b458df9c324c))
* **landing:** gen-feed script + static fallback for release feed ([3b8fc20](https://github.com/fucheng830/planrla/commit/3b8fc2005b1453ec8195081a61ca16a62f3fbc3c))
* **landing:** hero section with CTAs + provider chips ([b4d446e](https://github.com/fucheng830/planrla/commit/b4d446ed8840486a1675d4f4c744d81357843a66))
* **landing:** nav + footer chrome components ([7721fd9](https://github.com/fucheng830/planrla/commit/7721fd990e3d47c1db5d1bdc493aac9b1818609c))
* **landing:** release normalize pure fns + tests ([22e3fc4](https://github.com/fucheng830/planrla/commit/22e3fc461dd9052249b344eb04e516270b13a218))
* **process:** release lifecycle SOP + single-track versioning ([22c2622](https://github.com/fucheng830/planrla/commit/22c262205331fa72b11f3a0185c1825409e0df82))
* **theme:** appearance tab uses theme mode selector + i18n ([91c0b4b](https://github.com/fucheng830/planrla/commit/91c0b4ba7c3f07bd5425520615799ed8a737eb75))
* **theme:** theme mode pure fns (system/light/dark) ([9c79c89](https://github.com/fucheng830/planrla/commit/9c79c89cbb892a4a7752d724227ede9a03ad394f))
* **theme:** theme mode selector segmented control ([2e1692e](https://github.com/fucheng830/planrla/commit/2e1692eaa11b72fdd5a0cef498c840cb7201a722))
* **theme:** three-state context (system/light/dark) ([0746fe0](https://github.com/fucheng830/planrla/commit/0746fe0075cefb2d1a60504f75cfa9859da95bb7))

### Bug Fixes

* **defaults:** catalog reconcile does not pollute provider-model when unset ([4e16fc9](https://github.com/fucheng830/planrla/commit/4e16fc93c3fe45fd7fddc12aa740498645767654))
* **gemini:** align permission modes with cli (default/yolo) ([09697cd](https://github.com/fucheng830/planrla/commit/09697cd7424bcd7e59745032a22146bbd57ff68d))
* **landing:** align STATIC_FALLBACK body with latest.json + correct gen-feed comment ([9236539](https://github.com/fucheng830/planrla/commit/9236539c96a7f1c63fbf076d2d2e59b8514564ac))
* **landing:** features icon symbol (local) + card-icon aria-hidden ([d25245c](https://github.com/fucheng830/planrla/commit/d25245cec53f8a7d51ead8be2a70130368f9a5b9))
* **req010:** skip restartRequired toast in packaged desktop ([8026075](https://github.com/fucheng830/planrla/commit/80260757b6c8da818d72a4f88a5a39364f813471))

### Performance

* **projects:** pure fn to group batched session rows by project ([e7ff15b](https://github.com/fucheng830/planrla/commit/e7ff15b10fa73b9f2aa30f04a1c413c2b7a74b01))
* **projects:** replace N+1 session query with batched SQL ([c052fc9](https://github.com/fucheng830/planrla/commit/c052fc9520685a89c3a1174fad3ecd793f2657b7))
* **projects:** skip inline sync on read path (sync only via ?sync=1) ([0ec919b](https://github.com/fucheng830/planrla/commit/0ec919be41ff60b28ae2d3bd4da3cd9346f8777f))
* **projects:** wire refresh to ?sync=1 + grouping edge-case test (review) ([ad3dc37](https://github.com/fucheng830/planrla/commit/ad3dc37d28488506467e3ea5eb9ab69891b4c436))
* **sessions:** batched first-page sessions SQL via window functions ([6ce5512](https://github.com/fucheng830/planrla/commit/6ce5512761089c9f7643b3a235c2a779832d2b27))

### Documentation

* file tree incremental implementation plan ([c268480](https://github.com/fucheng830/planrla/commit/c268480387c4e0e49f02cc055b9fa7fded018be4))
* file tree incremental loading design spec ([2abc2f5](https://github.com/fucheng830/planrla/commit/2abc2f5cab31924f0362886b1886386c4971244c))
* **landing:** landing page design spec + ignore .superpowers/ ([8c70b05](https://github.com/fucheng830/planrla/commit/8c70b05877f138d0f28908c34fade03ed474486e))
* **landing:** landing page implementation plan (11 tasks) ([6aefb47](https://github.com/fucheng830/planrla/commit/6aefb477b247b0d1dfc85ad5154b0b272403e530))
* **landing:** sync plan with STATIC_FALLBACK body + Features icon fix ([c8cd963](https://github.com/fucheng830/planrla/commit/c8cd96387a9826607b32d237cb8e442525357b5f))
* **plan:** sidebar open perf implementation plan (5 tasks, TDD) ([2a45bcf](https://github.com/fucheng830/planrla/commit/2a45bcfdf4a5fe789e5daf89b051d993d1928c0b))
* **plan:** tick + archive desktop-experience-defaults plan ([8fb746b](https://github.com/fucheng830/planrla/commit/8fb746bc5b2a2570660c93da2a9b7200e4c6c8a7)), closes [#1](https://github.com/fucheng830/planrla/issues/1)
* **req010:** spec for restartRequired toast fix ([004714f](https://github.com/fucheng830/planrla/commit/004714febda8ceb9c8ade6bf5ed2756e07a1b35a))
* **roadmap:** redirect P1 session-list item to projects-perf (verified) ([532e96f](https://github.com/fucheng830/planrla/commit/532e96f3e34f0585329eb6732d5cd583b18f2df7))
* **spec:** sidebar open perf — projects endpoint (inline sync + N+1) ([e46d0af](https://github.com/fucheng830/planrla/commit/e46d0afc3115e3f69da8eb1309c04f98541d499f))

### Maintenance

* **i18n:** drop orphaned appearance-settings dark-mode keys ([1644ead](https://github.com/fucheng830/planrla/commit/1644ead6baaf95c9789ce26651ea0fa775fef626))
* **landing:** add @astrojs/check + typescript as devdeps ([c72bdd2](https://github.com/fucheng830/planrla/commit/c72bdd2ad0b34acc2a77913d4a3de222c9cc3390))

### Tests

* **landing:** feed schema validation script ([2c08a3a](https://github.com/fucheng830/planrla/commit/2c08a3ad5309c3405fc25bd46335b3c723066108))

# Changelog

Release notes are distributed through the commercial update feed configured by NOMAD_UPDATE_CHECK_URL.
