// 内置 sdlc-default 模板的单一事实源 + 磁盘模板迁移。
//
// seed 只发生在模板目录为空时(见 assembly.ts),已有部署环境的磁盘模板永远
// 不会被自动覆盖——所以模板升级走 seedVersion 定向迁移:磁盘 stage 的
// promptTemplate 仍等于旧版原文(= 用户没改过)才覆盖为新文案,用户自改的
// stage 原样保留并在日志中点名。

import type { TaskTemplate } from '@/modules/kanban/types.js';

/** 内置模板当前 seed 版本。改模板文案时 +1,并补一条迁移映射(见 MIGRATIONS)。 */
export const SDLC_DEFAULT_SEED_VERSION = 2;

// --- v1(历史)各 stage promptTemplate 原文,迁移指纹:磁盘值 === 此处才判「未自改」 ---
const V1_PROMPTS: Record<string, string> = {
  ss3: '{{input}}\n\n运行测试与验证,输出验证记录。',
  ss4: '{{input}}\n\n整理交付说明并写入 worktree 根目录的 DELIVERY.md:完成内容、改动文件清单、使用/合并方式、遗留事项。这是交付物的一部分。',
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

/** 构建 v2 内置模板(首次 seed 用)。 */
export function buildSdlcDefaultTemplate(now: string): TaskTemplate {
  const stage = (id: string, name: string, role: 'user' | 'agent', promptTemplate?: string): TaskTemplate['stages'][number]['snapshot'] => ({
    id, name, role, autoAdvance: role === 'agent', ...(role === 'agent' ? { agent: 'claude', agentCanControlStage: true } : {}), ...(promptTemplate ? { promptTemplate } : {}), createdAt: now, updatedAt: now,
  });
  return {
    id: 'sdlc-default',
    name: '研发流程(需求 → 交付)',
    maxConcurrency: 1,
    seedVersion: SDLC_DEFAULT_SEED_VERSION,
    createdAt: now,
    updatedAt: now,
    stages: [
      { id: 'st0', position: 0, snapshot: stage('ss0', '需求设计', 'user') },
      { id: 'st1', position: 1, snapshot: stage('ss1', '技术方案', 'agent', '需求:\n{{input}}\n\n请产出技术方案设计:架构选型、改动点、风险。') },
      { id: 'st2', position: 2, snapshot: stage('ss2', '开工', 'agent', '{{input}}\n\n按已确认的技术方案实施开发。') },
      { id: 'st3', position: 3, snapshot: stage('ss3', '测试验证', 'agent', V2_PROMPTS.ss3) },
      { id: 'st4', position: 4, snapshot: stage('ss4', '交付', 'agent', V2_PROMPTS.ss4) },
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
 * 未来升 v3 时:SDLC_DEFAULT_SEED_VERSION +1,在此追加 `2: {...}` 条目。
 */
const MIGRATIONS: Record<number, Record<string, { from: string; to: string }>> = {
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
  const stages = disk.stages.map((s) => {
    const sid = s.snapshot.id;
    let prompt = s.snapshot.promptTemplate;
    for (let from = fromVersion; from < SDLC_DEFAULT_SEED_VERSION; from++) {
      const step = MIGRATIONS[from]?.[sid];
      if (!step) continue;
      if (prompt === step.from) {
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
