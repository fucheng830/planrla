import * as Tabs from '@radix-ui/react-tabs';
import { Bot, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

import { workflowStages } from './messageHubData';

type MessageHubInspectorProps = { onApprove: () => void };

export function MessageHubInspector({ onApprove }: MessageHubInspectorProps) {
  return (
    <aside className="mh-inspector" aria-labelledby="mh-inspector-title">
      <div className="mh-inspector-heading"><h2 id="mh-inspector-title">消息详情</h2><span className="mh-unread-state"><i className="mh-dot tone-green" />未读</span></div>
      <Tabs.Root defaultValue="details" className="mh-inspector-tabs">
        <Tabs.List aria-label="详情面板"><Tabs.Trigger value="details">消息详情</Tabs.Trigger><Tabs.Trigger value="tasks">关联任务</Tabs.Trigger></Tabs.List>
        <Tabs.Content value="details" className="mh-inspector-body">
          <InspectorCard title="来源信息"><DefinitionList rows={[['来源', <><Bot className="mh-inline-icon tone-purple" /> AI Agents</>], ['代理', <>Codex <small>v1.2.3</small></>], ['消息类型', <span className="mh-tag tone-purple">AI 请求</span>], ['接收时间', '2024-05-21 21:49:12']]} /></InspectorCard>
          <InspectorCard title="发送方"><DefinitionList rows={[['名称', 'Codex (AI Agent)'], ['角色', <><Bot className="mh-inline-icon tone-purple" /> AI 架构与问题分析</>]]} /></InspectorCard>
          <InspectorCard title="绑定信息"><DefinitionList rows={[['项目', <span className="mh-link">Planrla 系统</span>], ['任务', <span className="mh-link">REQ-081 后台任务：Windows 打包修复</span>], ['会话', <span className="mh-link">Session #2658</span>], ['优先级', <span className="mh-priority">高</span>], ['当前状态', <span className="mh-tag tone-amber">待负责人确认</span>]]} /></InspectorCard>
          <InspectorCard title="建议的下一步"><ol className="mh-next-steps"><li>批准后分配给 AI Agent 执行分析与修复</li><li>绑定到项目与任务并开始开发流程</li><li>跟踪进度并在完成后自动验收</li></ol><div className="mh-inspector-actions"><button type="button" className="mh-primary-button" onClick={onApprove}>批准并启动</button><button type="button" className="mh-secondary-button" onClick={() => toast('已打开转交面板')}>转交给他人</button></div></InspectorCard>
          <InspectorCard title="研发流程"><ol className="mh-process-list">{workflowStages.map((stage) => <li key={stage.id} data-state={stage.state}><i>{stage.state === 'complete' ? '✓' : stage.state === 'running' ? '◉' : '○'}</i><span>{stage.label}<small>{stage.meta}</small></span></li>)}</ol></InspectorCard>
        </Tabs.Content>
        <Tabs.Content value="tasks" className="mh-inspector-body"><div className="mh-empty-inspector"><Bot /><strong>尚未绑定其他任务</strong><span>批准后可以在这里查看关联任务。</span></div></Tabs.Content>
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
