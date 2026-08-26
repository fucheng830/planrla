import { ArrowRight, Check } from 'lucide-react';

import type { MessageStage } from './messageHubData';

type MessageHubWorkflowStripProps = {
  label: string;
  stages: MessageStage[];
};

export function MessageHubWorkflowStrip({ label, stages }: MessageHubWorkflowStripProps) {
  if (stages.length === 0) return null;
  return (
    <section className="mh-workflow" aria-labelledby="mh-workflow-title">
      <div className="mh-workflow-title"><h2 id="mh-workflow-title">研发流程总览</h2><span>{label}</span></div>
      <div className="mh-workflow-cards">{stages.map((stage, index) => <article key={stage.id} className={`mh-workflow-card state-${stage.state}`}><i>{stage.state === 'complete' ? <Check /> : stage.state === 'running' ? '●' : '○'}</i><strong>{stage.label}</strong><small>{stage.meta}{stage.ref ? <><br />{stage.ref}</> : null}</small>{index < stages.length - 1 && <ArrowRight aria-hidden="true" />}</article>)}</div>
    </section>
  );
}
