import { ArrowRight, Check } from 'lucide-react';

import { workflowStages } from './messageHubData';

export function MessageHubWorkflowStrip() {
  return (
    <section className="mh-workflow" aria-labelledby="mh-workflow-title">
      <div className="mh-workflow-title"><h2 id="mh-workflow-title">研发流程总览</h2><span>Planrla 系统 / REQ-081 后台任务：Windows 打包修复</span></div>
      <div className="mh-workflow-cards">{workflowStages.map((stage, index) => <article key={stage.id} className={`mh-workflow-card state-${stage.state}`}><i>{stage.state === 'complete' ? <Check /> : stage.state === 'running' ? '●' : '○'}</i><strong>{stage.label}</strong><small>{stage.meta}<br />{stage.ref}</small>{index < workflowStages.length - 1 && <ArrowRight aria-hidden="true" />}</article>)}</div>
    </section>
  );
}
