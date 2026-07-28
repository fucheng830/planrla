// src/components/markdown-editor/types.ts
//
// REQ-047 — 侧边栏 Markdown 编辑器类型。
// AiEditSlot 统一从 code-editor/view/CodeEditor 导出复用(避免两处定义漂移)。
// 这里 re-export 以便 markdown-editor 内部模块集中导入。
export type { AiEditSlot } from '../code-editor/view/CodeEditor';

// 服务端 GET /api/projects/:id/markdown-files 返回的树节点(wire-compatible)。
export type MdFileNode = {
  name: string;
  // 项目相对路径(/ 分分隔),可直接喂 /api/projects/:id/file?filePath=。
  path: string;
  type: 'file' | 'dir';
  children?: MdFileNode[];
};

// useAiSelectionEdit 内部状态机(AiEditSlot.status 的取值)。
export type AiEditStatus = 'idle' | 'running' | 'success' | 'error';
