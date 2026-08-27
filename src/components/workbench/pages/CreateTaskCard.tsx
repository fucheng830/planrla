import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, Search } from 'lucide-react';

import type { Project } from '../../../types/app';
import type { TaskTemplate } from '../../kanban/types';

export type CreateTaskCardProps = {
  projects: Project[];
  templates: TaskTemplate[];
  defaultProjectId: string;
  /** 创建成功回调(参数=落点项目 id),失败在内部 toast。 */
  onCreate: (input: string, projectId: string, templateId: string, priority: 'high' | 'medium' | 'low') => Promise<void>;
  onClose: () => void;
};

type Priority = 'high' | 'medium' | 'low';

const PRIORITY_LABEL: Record<Priority, string> = { high: '高', medium: '中', low: '低' };

/** 创建任务卡片(B 方案):需求大输入框为视觉主体;项目用可搜索选择器,
 *  带名称+路径副标题,杂项自然沉底;模板/优先级收进「高级」折叠。 */
export function CreateTaskCard({ projects, templates, defaultProjectId, onCreate, onClose }: CreateTaskCardProps) {
  const [input, setInput] = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [projectOpen, setProjectOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setProjectId(defaultProjectId);
  }, [defaultProjectId]);

  useEffect(() => {
    if (projectOpen) searchRef.current?.focus();
  }, [projectOpen]);

  const selected = projects.find((p) => p.projectId === projectId);
  const projectLabel = selected
    ? (selected.displayName || selected.fullPath || selected.path || selected.projectId.slice(0, 8))
    : '选择项目';

  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    const base = q
      ? projects.filter((p) => {
        const name = (p.displayName || '').toLowerCase();
        const fp = (p.fullPath || p.path || '').toLowerCase();
        return name.includes(q) || fp.includes(q);
      })
      : projects;
    // 最近活跃在前(projects 数组本身大致按注册序),稳定排序即可
    return base;
  }, [projectQuery, projects]);

  const submit = async () => {
    const text = input.trim();
    if (!text || !projectId || !templateId) return;
    setSubmitting(true);
    try {
      await onCreate(text, projectId, templateId, priority);
      setInput('');
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ds-panel w-full max-w-xl overflow-hidden" onClick={(e) => e.stopPropagation()} aria-label="创建任务卡片">
        <header className="flex items-center justify-between border-b border-workbench-border px-4 py-3">
          <h2 className="text-sm font-semibold text-workbench-ink">新建研发需求</h2>
          <button type="button" onClick={onClose} className="ds-focus-ring rounded px-2 py-1 text-xs text-workbench-subtle hover:bg-workbench-muted">关闭</button>
        </header>

        <div className="space-y-4 p-4">
          {/* 需求描述:视觉主体 */}
          <textarea
            autoFocus
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit(); }}
            placeholder="描述这条需求…(⌘/Ctrl + Enter 创建)"
            rows={4}
            className="ds-focus-ring placeholder:text-workbench-faint w-full resize-none rounded-md border border-workbench-border bg-workbench-surface px-3 py-2.5 text-sm leading-relaxed text-workbench-ink"
          />

          {/* 项目搜索式选择器 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setProjectOpen((v) => !v)}
              className="ds-focus-ring flex h-9 w-full items-center justify-between rounded-md border border-workbench-border bg-workbench-surface px-3 text-sm"
            >
              <span className={selected ? 'text-workbench-ink' : 'text-workbench-subtle'}>
                关联项目:<span className="font-medium">{projectLabel}</span>
                {selected?.fullPath && <span className="text-workbench-faint ml-2 hidden truncate text-[11px] sm:inline">{selected.fullPath}</span>}
              </span>
              <ChevronDown className={`size-4 flex-shrink-0 text-workbench-subtle transition-transform ${projectOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {projectOpen && (
              <div className="absolute bottom-full left-0 right-0 z-10 mb-1 overflow-hidden rounded-md border border-workbench-border bg-white shadow-lg">
                <label className="flex items-center gap-2 border-b border-workbench-border px-3 py-2">
                  <Search className="size-3.5 flex-shrink-0 text-workbench-subtle" aria-hidden="true" />
                  <input
                    ref={searchRef}
                    value={projectQuery}
                    onChange={(event) => setProjectQuery(event.target.value)}
                    placeholder="搜索项目名称或路径…"
                    className="placeholder:text-workbench-faint w-full bg-transparent text-xs text-workbench-ink outline-none"
                  />
                </label>
                <ul className="max-h-56 overflow-auto py-1">
                  {filteredProjects.map((p) => (
                    <li key={p.projectId}>
                      <button
                        type="button"
                        onClick={() => { setProjectId(p.projectId); setProjectOpen(false); setProjectQuery(''); }}
                        className={`ds-focus-ring block w-full px-3 py-2 text-left transition-colors hover:bg-workbench-muted ${p.projectId === projectId ? 'bg-workbench-accent/5' : ''}`}
                      >
                        <span className={`block truncate text-xs font-medium ${p.projectId === projectId ? 'text-workbench-accent' : 'text-workbench-ink'}`}>{p.displayName || p.path}</span>
                        <span className="text-workbench-faint block truncate text-[10px]">{p.fullPath || p.path}</span>
                      </button>
                    </li>
                  ))}
                  {filteredProjects.length === 0 && <li className="px-3 py-4 text-center text-xs text-workbench-subtle">没有匹配的项目</li>}
                </ul>
              </div>
            )}
          </div>

          {/* 高级项折叠 */}
          <div>
            <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="ds-focus-ring inline-flex items-center gap-1 text-xs text-workbench-subtle hover:text-workbench-ink">
              <ChevronDown className={`size-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} aria-hidden="true" />高级选项{!showAdvanced && ` · 模板:${templates.find((t) => t.id === templateId)?.name ?? '-'} · 优先级:${PRIORITY_LABEL[priority]}`}
            </button>
            {showAdvanced && (
              <div className="mt-2 space-y-2 rounded-md border border-workbench-border bg-workbench-surface p-2.5">
                <label className="flex items-center gap-2 text-xs text-workbench-subtle">
                  模板
                  <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} className="ds-focus-ring h-7 flex-1 rounded border border-workbench-border bg-workbench-surface px-2 text-xs text-workbench-ink">
                    {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-workbench-subtle">
                  优先级
                  <select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)} className="ds-focus-ring h-7 flex-1 rounded border border-workbench-border bg-workbench-surface px-2 text-xs text-workbench-ink">
                    <option value="high">高</option>
                    <option value="medium">中</option>
                    <option value="low">低</option>
                  </select>
                </label>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <span className="text-workbench-faint mr-auto text-[11px]">任务将落到所选项目的看板,agent 在其工作树内执行</span>
            <button type="button" onClick={onClose} className="ds-focus-ring h-8 rounded border border-workbench-border px-3 text-xs text-workbench-subtle hover:bg-workbench-muted">取消</button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!input.trim() || !projectId || !templateId || submitting}
              className="ds-focus-ring inline-flex h-8 items-center gap-1 rounded bg-workbench-accent px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="size-3.5" aria-hidden="true" />{submitting ? '创建中…' : '创建任务'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
