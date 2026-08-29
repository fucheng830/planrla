// debug/ui-acceptance/req052-harness.tsx
//
// REQ-052 UI 验收 harness:真实渲染 TokenUsageSummary(打包自 src/),
// 注入真实 zh-CN chat.json 的 i18n 资源,通过 window.__setScenario 在受控
// props 场景间切换,供 playwright 无头脚本断言 hover popover / 点击压缩 /
// loading / unsupported 各状态。
import React from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import TokenUsageSummary from '../../src/components/chat/view/subcomponents/TokenUsageSummary';
import zhChat from '../../src/i18n/locales/zh-CN/chat.json';

void i18next.use(initReactI18next).init({
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  resources: { 'zh-CN': { chat: zhChat } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const USAGE_FULL = {
  used: 118_000,
  total: 160_000,
  inputTokens: 102_000,
  outputTokens: 16_000,
  breakdown: { input: 102_000, output: 16_000 },
};

type Scenario = 'supported' | 'compacting' | 'unsupported' | 'empty';

const buildProps = (scenario: Scenario) => {
  const onCompact = () => {
    (window as any).__compactCalls = ((window as any).__compactCalls || 0) + 1;
  };
  switch (scenario) {
    case 'compacting':
      return { usage: USAGE_FULL, supportsCompact: true, isCompacting: true, visibleMessageCount: 42, totalMessages: 87, onCompact };
    case 'unsupported':
      return { usage: USAGE_FULL, supportsCompact: false, isCompacting: false, visibleMessageCount: 42, totalMessages: 87, onCompact };
    case 'empty':
      return { usage: null, supportsCompact: true, isCompacting: false, visibleMessageCount: 0, totalMessages: 0, onCompact };
    case 'supported':
    default:
      return { usage: USAGE_FULL, supportsCompact: true, isCompacting: false, visibleMessageCount: 42, totalMessages: 87, onCompact };
  }
};

function Harness() {
  const [scenario, setScenario] = React.useState<Scenario>('supported');

  React.useEffect(() => {
    (window as any).__setScenario = (next: Scenario) => setScenario(next);
    (window as any).__compactCalls = 0;
  }, []);

  return (
    <I18nextProvider i18n={i18next}>
      <div style={{
        padding: 40, background: '#f8fafc', minHeight: '100vh', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      }}>
        <div>
          <p data-testid="scenario-label" style={{ marginBottom: 24, fontFamily: 'sans-serif', color: '#334155' }}>
            scenario: {scenario}
          </p>
          <TokenUsageSummary {...buildProps(scenario)} />
        </div>
      </div>
    </I18nextProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
