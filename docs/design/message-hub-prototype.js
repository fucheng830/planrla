const sessionCards = [...document.querySelectorAll('[data-session-id]')];
const threadTitle = document.querySelector('#thread-title');
const threadBreadcrumb = document.querySelector('.breadcrumb');
const composer = document.querySelector('#message-composer');
const textarea = composer?.querySelector('textarea');
const threadContent = document.querySelector('.thread-content');
const approvalCard = document.querySelector('.approval-card');
const statusChip = document.querySelector('.status-chip');

const sessionCopy = {
  codex: ['AI: Codex', 'AI Agents', 'AI 请求'],
  customer: ['客户: 王先生', '企业微信', '客户消息'],
  zhang: ['张三', 'Slack', '团队消息'],
  li: ['李四', '钉钉', '团队消息'],
  support: ['在线客服 #1024', '客服渠道', '客户消息'],
  planner: ['AI: Planner', 'AI Agents', 'AI 请求'],
  'customer-2': ['客户: 张女士', '企业微信', '客户消息'],
};

function selectSession(card) {
  sessionCards.forEach((item) => item.classList.toggle('is-active', item === card));
  const [name, channel, type] = sessionCopy[card.dataset.sessionId] ?? sessionCopy.codex;
  if (threadTitle) threadTitle.firstChild.textContent = `${name} `;
  if (threadBreadcrumb) threadBreadcrumb.innerHTML = `<span>${channel}</span><svg class="icon"><use href="#icon-arrow"></use></svg><span>${type}</span>`;
}

sessionCards.forEach((card) => card.addEventListener('click', () => selectSession(card)));

document.querySelectorAll('.inbox-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.inbox-tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
  });
});

document.querySelectorAll('.inspector-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.inspector-tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
  });
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'approve' || action === 'transfer') {
      approvalCard?.classList.add('is-resolved');
      if (statusChip) {
        statusChip.textContent = action === 'approve' ? '已批准' : '已转交';
        statusChip.classList.remove('amber');
        statusChip.classList.add('purple');
      }
      button.closest('.approval-actions')?.replaceChildren(document.createTextNode(action === 'approve' ? '已批准并开始执行' : '已转交给负责人'));
    }
    if (action === 'reject' && approvalCard) {
      approvalCard.querySelector('h3').textContent = '已驳回请求';
      approvalCard.style.borderColor = '#6c3940';
    }
  });
});

composer?.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = textarea?.value.trim();
  if (!message || !threadContent) return;
  const article = document.createElement('article');
  article.className = 'message-block user-message';
  article.innerHTML = `<span class="sender-avatar user">王</span><div class="message-card"><div class="message-meta"><strong>王工</strong><time>刚刚</time></div><p></p></div>`;
  article.querySelector('p').textContent = message;
  threadContent.append(article);
  threadContent.scrollTop = threadContent.scrollHeight;
  if (textarea) textarea.value = '';
});
