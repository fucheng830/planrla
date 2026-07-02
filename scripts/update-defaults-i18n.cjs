#!/usr/bin/env node
// One-shot i18n updater for D5 (defaults settings keys).
// Adds tabs.defaults + top-level defaults object to all locale settings.json.
// en + zh-CN: native strings; others: English fallback.
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');

const EN = {
  permission: {
    title: 'New session defaults',
    label: 'Default permission mode',
    description: 'What permission mode new sessions start in',
    modeDefault: 'Default (prompt each action)',
    modeBypass: 'Unrestricted',
  },
  model: {
    title: 'Default model',
    label: 'Default model',
    description: 'Used when you haven\'t picked a model this session',
    placeholder: 'e.g. opus, sonnet, gpt-5.4',
  },
};

const ZH_CN = {
  permission: {
    title: '新会话默认值',
    label: '默认权限模式',
    description: '新会话启动时使用的权限模式',
    modeDefault: '默认（逐操作确认）',
    modeBypass: '不限权限',
  },
  model: {
    title: '默认模型',
    label: '默认模型',
    description: '本会话未手动选模型时使用',
    placeholder: '如 opus、sonnet、gpt-5.4',
  },
};

const TABS_LABEL = {
  'en': 'Defaults',
  'zh-CN': '默认值',
  'zh-TW': '預設值',
  'ja': 'デフォルト',
  'ko': '기본값',
  'de': 'Standardwerte',
  'fr': 'Valeurs par défaut',
  'it': 'Valori predefiniti',
  'ru': 'Значения по умолчанию',
  'tr': 'Varsayılanlar',
};

const locales = fs.readdirSync(LOCALES_DIR).filter((d) => {
  return fs.existsSync(path.join(LOCALES_DIR, d, 'settings.json'));
});

let failures = 0;
for (const locale of locales) {
  const file = path.join(LOCALES_DIR, locale, 'settings.json');
  const raw = fs.readFileSync(file, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`[INVALID JSON] ${file}: ${e.message}`);
    failures++;
    continue;
  }

  // tabs.defaults
  if (!data.tabs || typeof data.tabs !== 'object') data.tabs = {};
  data.tabs.defaults = TABS_LABEL[locale] ?? 'Defaults';

  // top-level defaults object — idempotent (do not overwrite if already present from a prior run
  // with the same locale-native content; this script is one-shot so a plain assign is fine)
  data.defaults = (locale === 'zh-CN') ? ZH_CN : (locale === 'zh-TW' ? {
    permission: {
      title: '新會話預設值',
      label: '預設權限模式',
      description: '新會話啟動時使用的權限模式',
      modeDefault: '預設（逐操作確認）',
      modeBypass: '不限權限',
    },
    model: {
      title: '預設模型',
      label: '預設模型',
      description: '本會話未手動選模型時使用',
      placeholder: '如 opus、sonnet、gpt-5.4',
    },
  } : EN);

  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`[OK] ${locale}`);
}

if (failures) {
  console.error(`${failures} file(s) had invalid JSON — NOT rewritten.`);
  process.exit(1);
}
console.log('Done.');
