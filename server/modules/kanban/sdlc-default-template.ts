// 内置 sdlc-default 模板的单一事实源 + 磁盘模板迁移。
//
// seed 只发生在模板目录为空时(见 assembly.ts),已有部署环境的磁盘模板永远
// 不会被自动覆盖——所以模板升级走 seedVersion 定向迁移:磁盘 stage 的
// promptTemplate 仍等于旧版原文(= 用户没改过)才覆盖为新文案,用户自改的
// stage 原样保留并在日志中点名。

import type { TaskTemplate } from '@/modules/kanban/types.js';

/** 内置模板当前 seed 版本。改模板文案时 +1,并补一条迁移映射(见 MIGRATIONS)。 */
export const SDLC_DEFAULT_SEED_VERSION = 3;

// --- v1(历史)各 stage promptTemplate 原文,迁移指纹:磁盘值命中其一才判「未自改」。
// 同一 stage 可能有多个历史变体(如 ss4 曾以单括号 {input} 写盘),都要收录,
// 否则真实存量环境会被误判为「用户自改」而跳过升级。 ---
const V1_PROMPTS: Record<string, string[]> = {
  ss3: ['{{input}}\n\n运行测试与验证,输出验证记录。'],
  ss4: [
    '{{input}}\n\n整理交付说明并写入 worktree 根目录的 DELIVERY.md:完成内容、改动文件清单、使用/合并方式、遗留事项。这是交付物的一部分。',
    '{input}\n\n整理交付说明并写入 worktree 根目录的 DELIVERY.md:完成内容、改动文件清单、使用/合并方式、遗留事项。这是交付物的一部分。',
  ],
};

// --- v2 各 stage promptTemplate(可视化验证截图留证,REQ:截图留证工程化)---
const V2_PROMPTS: Record<string, string> = {
  ss3: [
    '{{input}}',
    '',
    '运行测试与验证,输出验证记录。',
    '',
    '可视化验证要求(强制):',
    '- 若本任务改动涉及 UI / 可视化效果:必须用 playwright 无头脚本真实打开页面验证并截图留证,禁止仅凭代码推断 UI 正确:',
    '  - 截图统一存放 debug/ui-acceptance/,文件名含任务编号与场景,如 debug/ui-acceptance/task{{task_number}}-hover-popover.png;',
    '  - 截图脚本本身留存于 debug/(如 debug/capture-task{{task_number}}-hover-popover.mjs),保证可复跑;',
    '  - 页面不可访问时先启动 dev server / preview 再截图;截图失败须在验证记录中说明原因与重试结果。',
    '- 若本任务为纯后端 / 逻辑改动(无任何 UI 变化):可豁免截图,但验证记录与交付说明中必须明确声明「本任务无可视化改动」。',
    '- 验证记录末尾列出全部截图的相对路径清单,供交付阶段写入 DELIVERY.md。',
  ].join('\n'),
  ss4: [
    '{{input}}',
    '',
    '整理交付说明并写入 worktree 根目录的 DELIVERY.md:完成内容、改动文件清单、使用/合并方式、遗留事项。这是交付物的一部分。',
    '',
    'DELIVERY.md 必须包含「验证证据」小节:',
    '- 用 markdown 图片语法逐一列出全部验证截图的相对路径(如 ![场景](debug/ui-acceptance/task{{task_number}}-hover-popover.png));',
    '- 若无可视化改动,须明确声明「本任务无可视化改动」(承接测试验证阶段的记录)。',
  ].join('\n'),
};

// --- v3:需求设计 agent 化(REQ:需求设计必须走 plan 模式 + AI 澄清交互)---
// ss0 由纯人工阶段升级为 plan-mode agent 阶段:先探索项目与需求,遇到模糊点
// 直接通过 AskUserQuestion 向人提问(看板卡内联应答,REQ-038 通道),最后把
// 补全后的需求写入 worktree 根的 REQUIREMENTS.md 作为该阶段的可评审产物。
const V3_SS0_SNAPSHOT = {
  id: 'ss0',
  name: '需求设计',
  role: 'agent' as const,
  autoAdvance: false,
  agent: 'claude',
  agentCanControlStage: false,
  planMode: true,
  promptTemplate: [
    '你是需求设计负责人。任务需求(可能不完整):',
    '{{input}}',
    '',
    '请产出一份需求设计文档 REQUIREMENTS.md,写入当前工作区根目录。要求:',
    '1. 先充分探索项目现状(代码结构、既有实现、相关约定),再写需求;',
    '2. 需求描述有缺口、有歧义或有多种合理理解时,必须通过 AskUserQuestion 工具向用户提问澄清,不要自行猜测;把用户的回答补进需求;',
    '3. 文档包含:背景与目标、用户故事、功能需求(可验证的验收标准)、非功能需求、范围外事项、开放问题;',
    '4. 完成后停止,等待用户评审,不要自行进入技术方案或实施。',
  ].join('\n'),
};

// --- v3 新增人工阶段:方案确认(在 ss1 技术方案之后、ss2 开工之前)---
const V3_SS1B_SNAPSHOT = {
  id: 'ss1b',
  name: '方案确认',
  role: 'user' as const,
  autoAdvance: false,
};

/** 构建 v3 内置模板(首次 seed 用)。 */
export function buildSdlcDefaultTemplate(now: string): TaskTemplate {
  const stage = (id: string, name: string, role: 'user' | 'agent', promptTemplate?: string): TaskTemplate['stages'][number]['snapshot'] => ({
    id, name, role, autoAdvance: role === 'agent', ...(role === 'agent' ? { agent: 'claude', agentCanControlStage: true } : {}), ...(promptTemplate ? { promptTemplate } : {}), createdAt: now, updatedAt: now,
  });
  const snap = (base: typeof V3_SS0_SNAPSHOT | typeof V3_SS1B_SNAPSHOT, position: number): TaskTemplate['stages'][number] => ({
    id: base.id === 'ss1b' ? 'st1b' : 'st0',
    position,
    snapshot: { ...base, createdAt: now, updatedAt: now },
  });
  return {
    id: 'sdlc-default',
    name: '研发流程(需求 → 交付)',
    maxConcurrency: 1,
    seedVersion: SDLC_DEFAULT_SEED_VERSION,
    createdAt: now,
    updatedAt: now,
    stages: [
      snap(V3_SS0_SNAPSHOT, 0),
      { id: 'st1', position: 1, snapshot: stage('ss1', '技术方案', 'agent', '需求设计文档:\n{{input}}\n\n请产出技术方案设计:架构选型、改动点、风险。') },
      snap(V3_SS1B_SNAPSHOT, 2),
      { id: 'st2', position: 3, snapshot: stage('ss2', '开工', 'agent', '{{input}}\n\n按已确认的技术方案实施开发。') },
      { id: 'st3', position: 4, snapshot: stage('ss3', '测试验证', 'agent', V2_PROMPTS.ss3) },
      { id: 'st4', position: 5, snapshot: stage('ss4', '交付', 'agent', V2_PROMPTS.ss4) },
    ],
  };
}

/**
 * 前端模板编辑器不感知 seedVersion,整体 POST 保存会把迁移标记抹掉,导致
 * 下次启动重跑迁移(指纹比对保证不误覆盖,但产生噪音)。保存内置模板时
 * 兜底沿用磁盘上的标记。
 */
export function preserveSeedVersion(body: TaskTemplate, disk: TaskTemplate | null): TaskTemplate {
  if (body?.id === 'sdlc-default' && body.seedVersion === undefined && disk?.seedVersion !== undefined) {
    return { ...body, seedVersion: disk.seedVersion };
  }
  return body;
}

/**
 * seedVersion 迁移映射:fromVersion → 逐 stage { from 指纹, to 新文案 }。
 * v3 迁移为结构性变更(阶段角色/新增阶段/planMode),无法用 prompt 指纹
 * 表达——由 migrateSdlcDefaultSeed 内的专用分支处理,不走 MIGRATIONS 表。
 */
const MIGRATIONS: Record<number, Record<string, { from: string[]; to: string }>> = {
  1: {
    ss3: { from: V1_PROMPTS.ss3, to: V2_PROMPTS.ss3 },
    ss4: { from: V1_PROMPTS.ss4, to: V2_PROMPTS.ss4 },
  },
};

export interface SeedMigrationResult {
  tpl: TaskTemplate;
  /** 已升级为新文案的 stage snapshot id。 */
  upgraded: string[];
  /** 用户自改过、保留原文的 stage snapshot id。 */
  skipped: string[];
}

/**
 * 磁盘 sdlc-default 的 seedVersion 落后时逐级迁移到当前版本。纯函数无 IO,
 * 便于单测。任何 stage 升级与否,返回的 tpl 都带最新 seedVersion——调用方
 * 无条件写回即可幂等(下次启动不再重跑)。
 */
export function migrateSdlcDefaultSeed(disk: TaskTemplate, now = new Date().toISOString()): SeedMigrationResult {
  const fromVersion = disk.seedVersion ?? 1;
  const upgraded: string[] = [];
  const skipped: string[] = [];
  // v2 → v3:结构性变更(需求设计 agent 化 + 新增方案确认人工阶段)。
  // 不做 prompt 指纹判断:阶段集合本身变了,整体以 v3 构建器输出为准;
  // 磁盘 stage 的顺序/角色照 v3 重建,用户对 prompt 的自定义不保留——
  // 因为 v2 的 ss0 是无 prompt 的人工阶段,v3 需要注入完整 agent prompt。
  if (fromVersion < SDLC_DEFAULT_SEED_VERSION) {
    const fresh = buildSdlcDefaultTemplate(now);
    return {
      tpl: { ...disk, ...fresh, id: disk.id, createdAt: disk.createdAt, updatedAt: now },
      upgraded: fresh.stages.map((s) => s.snapshot.id),
      skipped: [],
    };
  }
  const stages = disk.stages.map((s) => {
    const sid = s.snapshot.id;
    let prompt = s.snapshot.promptTemplate;
    for (let from = fromVersion; from < SDLC_DEFAULT_SEED_VERSION; from++) {
      const step = MIGRATIONS[from]?.[sid];
      if (!step) continue;
      if (prompt !== undefined && step.from.includes(prompt)) {
        prompt = step.to;
        upgraded.push(sid);
      } else if (prompt !== undefined) {
        skipped.push(sid);
      }
    }
    if (prompt === s.snapshot.promptTemplate) return s;
    return { ...s, snapshot: { ...s.snapshot, promptTemplate: prompt, updatedAt: now } };
  });
  // 调用方只在 seedVersion 落后时进来;无条件写回最新标记,保证幂等。
  return {
    tpl: { ...disk, seedVersion: SDLC_DEFAULT_SEED_VERSION, stages, updatedAt: now },
    upgraded,
    skipped,
  };
}
