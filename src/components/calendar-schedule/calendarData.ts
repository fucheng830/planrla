export type CalendarEventTone = 'blue' | 'green' | 'red' | 'cyan';

export type CalendarEvent = {
  id: string;
  day: number;
  title: string;
  time: string;
  tone: CalendarEventTone;
};

export const monthWeeks = [
  [28, 29, 30, 1, 2, 3, 4],
  [5, 6, 7, 8, 9, 10, 11],
  [12, 13, 14, 15, 16, 17, 18],
  [19, 20, 21, 22, 23, 24, 25],
  [26, 27, 28, 29, 30, 31, 1],
] as const;

export const calendarEvents: CalendarEvent[] = [
  { id: 'requirements', day: 1, title: '需求评审', time: '10:00', tone: 'blue' },
  { id: 'standup-1', day: 3, title: '每日站会', time: '09:30', tone: 'cyan' },
  { id: 'sync', day: 6, title: '进度同步', time: '09:30', tone: 'red' },
  { id: 'architecture', day: 8, title: '技术方案评审', time: '14:00', tone: 'blue' },
  { id: 'standup-2', day: 10, title: '每日站会', time: '09:30', tone: 'cyan' },
  { id: 'materials', day: 13, title: '素材审查', time: '10:30', tone: 'green' },
  { id: 'first-cut', day: 15, title: '成片初审', time: '14:00', tone: 'blue' },
  { id: 'script', day: 17, title: '脚本讨论', time: '11:00', tone: 'red' },
  { id: 'delivery-review', day: 20, title: '交付评审', time: '16:00', tone: 'blue' },
  { id: 'standup-3', day: 24, title: '每日站会', time: '09:30', tone: 'green' },
  { id: 'standup-4', day: 31, title: '每日站会', time: '09:30', tone: 'green' },
];

export const agendaItems = [
  { id: 'agenda-standup', time: '09:30', duration: '30m', title: '每日站会', meta: '项目全员会议', tone: 'cyan' },
  { id: 'agenda-script', time: '10:30', duration: '1h', title: '分镜脚本确认', meta: '研发流程：开工', tone: 'blue' },
  { id: 'agenda-cut', time: '14:00', duration: '1h', title: '成片初审', meta: '研发流程：测试验证', tone: 'blue' },
  { id: 'agenda-delivery', time: '16:00', duration: '1h', title: '交付评审', meta: '研发流程：交付', tone: 'red' },
];

export type AgendaItem = (typeof agendaItems)[number];

export const sidebarItems = [
  { id: 'overview', label: '项目总览', icon: '▣' },
  { id: 'messages', label: '消息盒子', icon: '◌' },
  { id: 'workflow', label: '研发流程', icon: '⌘' },
  { id: 'calendar', label: '日历与定时任务', icon: '▦' },
  { id: 'files', label: '文件中心', icon: '▤' },
  { id: 'knowledge', label: '知识库', icon: '◫' },
  { id: 'models', label: '模型管理', icon: '◎' },
];
