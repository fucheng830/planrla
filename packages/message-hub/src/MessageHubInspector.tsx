import * as Tabs from '@radix-ui/react-tabs';
import { Bot, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from './utils';

import type { MessageSession } from './messageHubData';

type MessageHubInspectorProps = {
  session: MessageSession | undefined;
  onApprove: () => void;
};

export function MessageHubInspector({ session, onApprove }: MessageHubInspectorProps) {
  if (!session) {
    return (
      <aside className="mh-inspector" aria-label="消息详情">
        <div className="mh-inspector-heading"><h2>消息详情</h2></div>
        <div className="mh-empty-inspector"><Bot /><strong>未选择消息</strong><span>选择会话后这里显示来源与绑定信息。</span></div>
      </aside>
    );
  }

  const Icon = session.avatar;
  const binding = session.binding;
  const stages = session.stages ?? [];

  return (
    <aside className="mh-inspector" aria-labelledby="mh-inspector-title">
      <div className="mh-inspector-heading"><h2 id="mh-inspector-title">消息详情</h2>{(session.unread ?? 0) > 0 && <span className="mh-unread-state"><i className="mh-dot tone-green" />未读</span>}</div>
      <Tabs.Root defaultValue="details" className="mh-inspector-tabs">
        <Tabs.List aria-label="详情面板"><Tabs.Trigger value="details">消息详情</Tabs.Trigger><Tabs.Trigger value="tasks">关联任务</Tabs.Trigger></Tabs.List>
        <Tabs.Content value="details" className="mh-inspector-body">
          <InspectorCard title="来源信息"><DefinitionList rows={[['来源', <><Icon className={cn('mh-inline-icon', `tone-${session.tone}`)} /> {session.source}</>], ['消息类型', <span className="mh-tag tone-purple">{session.category}</span>], ['接收时间', session.time]]} /></InspectorCard>
          <InspectorCard title="发送方"><DefinitionList rows={[['名称', session.sender]]} /></InspectorCard>
          {binding && (
            <InspectorCard title="绑定信息"><DefinitionList rows={[
              ...(binding.task ? [['任务', <span className="mh-link">{binding.task}</span>] as [string, React.ReactNode]] : []),
              ...(binding.stage ? [['阶段', binding.stage] as [string, React.ReactNode]] : []),
              ...(binding.priority ? [['优先级', <span className="mh-priority">{binding.priority}</span>] as [string, React.ReactNode]] : []),
              ...(binding.status ? [['当前状态', <span className="mh-tag tone-amber">{binding.status}</span>] as [string, React.ReactNode]] : []),
              ...(binding.worktree ? [['worktree', <span className="mh-link">{binding.worktree}</span>] as [string, React.ReactNode]] : []),
              ...(binding.session ? [['会话', binding.session] as [string, React.ReactNode]] : []),
              ...(binding.created ? [['创建时间', binding.created] as [string, React.ReactNode]] : []),
            ]} /></InspectorCard>
          )}
          {session.approval && (
            <InspectorCard title="建议的下一步"><ol className="mh-next-steps"><li>确认后分配给 AI Agent 继续推进</li><li>在研发流程看板跟踪阶段进度</li><li>完成后自动回到此会话通知</li></ol><div className="mh-inspector-actions"><button type="button" className="mh-primary-button" onClick={onApprove}>批准并启动</button><button type="button" className="mh-secondary-button" onClick={() => toast('已打开转交面板')}>转交给他人</button></div></InspectorCard>
          )}
          {stages.length > 0 && (
            <InspectorCard title="研发流程"><ol className="mh-process-list">{stages.map((stage) => <li key={stage.id} data-state={stage.state}><i>{stage.state === 'complete' ? '✓' : stage.state === 'running' ? '◉' : '○'}</i><span>{stage.label}<small>{stage.meta}</small></span></li>)}</ol></InspectorCard>
          )}
        </Tabs.Content>
        <Tabs.Content value="tasks" className="mh-inspector-body"><div className="mh-empty-inspector"><Bot /><strong>尚未绑定其他任务</strong><span>绑定后在研发流程看板中查看关联任务。</span></div></Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}

function InspectorCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <details className="mh-detail-card" open><summary>{title}<ChevronDown aria-hidden="true" /></summary>{children}</details>;
}

function DefinitionList({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return <dl className="mh-definition-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
