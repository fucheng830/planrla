/**
 * i18n Configuration
 *
 * Configures i18next for internationalization support.
 * Features:
 * - Lazy-loading of translation namespaces
 * - Language detection from localStorage
 * - Fallback to English for missing translations
 * - Development mode warnings for missing keys
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
// eslint-disable-next-line import-x/order
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation resources
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enAuth from './locales/en/auth.json';
import enSidebar from './locales/en/sidebar.json';
import enChat from './locales/en/chat.json';
import enCodeEditor from './locales/en/codeEditor.json';
// eslint-disable-next-line import-x/order
import enKanban from './locales/en/kanban.json';

import koCommon from './locales/ko/common.json';
import koSettings from './locales/ko/settings.json';
import koAuth from './locales/ko/auth.json';
import koSidebar from './locales/ko/sidebar.json';
import koChat from './locales/ko/chat.json';
// eslint-disable-next-line import-x/order
import koCodeEditor from './locales/ko/codeEditor.json';

import zhCommon from './locales/zh-CN/common.json';
import zhSettings from './locales/zh-CN/settings.json';
import zhAuth from './locales/zh-CN/auth.json';
import zhSidebar from './locales/zh-CN/sidebar.json';
import zhChat from './locales/zh-CN/chat.json';
import zhCodeEditor from './locales/zh-CN/codeEditor.json';
// eslint-disable-next-line import-x/order
import zhKanban from './locales/zh-CN/kanban.json';

import jaCommon from './locales/ja/common.json';
import jaSettings from './locales/ja/settings.json';
import jaAuth from './locales/ja/auth.json';
import jaSidebar from './locales/ja/sidebar.json';
import jaChat from './locales/ja/chat.json';
// eslint-disable-next-line import-x/order
import jaCodeEditor from './locales/ja/codeEditor.json';

import ruCommon from './locales/ru/common.json';
import ruSettings from './locales/ru/settings.json';
import ruAuth from './locales/ru/auth.json';
import ruSidebar from './locales/ru/sidebar.json';
import ruChat from './locales/ru/chat.json';
// eslint-disable-next-line import-x/order
import ruCodeEditor from './locales/ru/codeEditor.json';

import deCommon from './locales/de/common.json';
import deSettings from './locales/de/settings.json';
import deAuth from './locales/de/auth.json';
import deSidebar from './locales/de/sidebar.json';
import deChat from './locales/de/chat.json';
// eslint-disable-next-line import-x/order
import deCodeEditor from './locales/de/codeEditor.json';

import trCommon from './locales/tr/common.json';
import trSettings from './locales/tr/settings.json';
import trAuth from './locales/tr/auth.json';
import trSidebar from './locales/tr/sidebar.json';
import trChat from './locales/tr/chat.json';
import trCodeEditor from './locales/tr/codeEditor.json';
import itCommon from './locales/it/common.json';
import itSettings from './locales/it/settings.json';
import itAuth from './locales/it/auth.json';
import itSidebar from './locales/it/sidebar.json';
import itChat from './locales/it/chat.json';
// eslint-disable-next-line import-x/order
import itCodeEditor from './locales/it/codeEditor.json';

import frCommon from './locales/fr/common.json';
import frSettings from './locales/fr/settings.json';
import frAuth from './locales/fr/auth.json';
import frSidebar from './locales/fr/sidebar.json';
import frChat from './locales/fr/chat.json';
// eslint-disable-next-line import-x/order
import frCodeEditor from './locales/fr/codeEditor.json';

import zhTWCommon from './locales/zh-TW/common.json';
import zhTWSettings from './locales/zh-TW/settings.json';
import zhTWAuth from './locales/zh-TW/auth.json';
import zhTWSidebar from './locales/zh-TW/sidebar.json';
import zhTWChat from './locales/zh-TW/chat.json';
// eslint-disable-next-line import-x/order
import zhTWCodeEditor from './locales/zh-TW/codeEditor.json';

// Import supported languages configuration
import { languages } from './languages.js';

// 读 localStorage 已保存的语言偏好；未设置时返回 null，让 detection 链（navigator）兜底
const getSavedLanguage = () => {
  try {
    const saved = localStorage.getItem('userLanguage');
    if (saved && languages.some((lang) => lang.value === saved)) {
      return saved;
    }
    return null;
  } catch {
    return null;
  }
};

// Initialize i18next
i18n
  .use(LanguageDetector) // Detect user language
  .use(initReactI18next) // Pass i18n instance to react-i18next
  .init({
    // Resources containing all translations
    resources: {
      en: {
        common: enCommon,
        settings: enSettings,
        auth: enAuth,
        sidebar: enSidebar,
        chat: enChat,
        codeEditor: enCodeEditor,
        kanban: enKanban,
      },
      ko: {
        common: koCommon,
        settings: koSettings,
        auth: koAuth,
        sidebar: koSidebar,
        chat: koChat,
        codeEditor: koCodeEditor,
      },
      'zh-CN': {
        common: zhCommon,
        settings: zhSettings,
        auth: zhAuth,
        sidebar: zhSidebar,
        chat: zhChat,
        codeEditor: zhCodeEditor,
        kanban: zhKanban,
      },
      ja: {
        common: jaCommon,
        settings: jaSettings,
        auth: jaAuth,
        sidebar: jaSidebar,
        chat: jaChat,
        codeEditor: jaCodeEditor,
      },
      ru: {
        common: ruCommon,
        settings: ruSettings,
        auth: ruAuth,
        sidebar: ruSidebar,
        chat: ruChat,
        codeEditor: ruCodeEditor,
      },
      de: {
        common: deCommon,
        settings: deSettings,
        auth: deAuth,
        sidebar: deSidebar,
        chat: deChat,
        codeEditor: deCodeEditor,
      },
      tr: {
        common: trCommon,
        settings: trSettings,
        auth: trAuth,
        sidebar: trSidebar,
        chat: trChat,
        codeEditor: trCodeEditor,
      },
      it: {
        common: itCommon,
        settings: itSettings,
        auth: itAuth,
        sidebar: itSidebar,
        chat: itChat,
        codeEditor: itCodeEditor,
      },
      fr: {
        common: frCommon,
        settings: frSettings,
        auth: frAuth,
        sidebar: frSidebar,
        chat: frChat,
        codeEditor: frCodeEditor,
      },
      'zh-TW': {
        common: zhTWCommon,
        settings: zhTWSettings,
        auth: zhTWAuth,
        sidebar: zhTWSidebar,
        chat: zhTWChat,
        codeEditor: zhTWCodeEditor,
      },
    },

    // Default language
    lng: getSavedLanguage(),

    // Fallback language when a translation is missing
    fallbackLng: 'en',

    // 让无 region 的语言码（如 navigator 返回 'zh'）匹配已注册的 region 变体（zh-CN/zh-TW）
    nonExplicitSupportedLngs: true,

    // Enable debug mode in development (logs missing keys to console)
    debug: false,

    // Namespaces - load only what's needed
    ns: ['common', 'settings', 'auth', 'sidebar', 'chat', 'codeEditor', 'kanban'],
    defaultNS: 'common',

    // Key separator for nested keys (default: '.')
    keySeparator: '.',

    // Namespace separator (default: ':')
    nsSeparator: ':',

    // Save missing translations (disabled - requires manual review)
    saveMissing: false,

    // Interpolation settings
    interpolation: {
      escapeValue: false, // React already escapes values
    },

    // React-specific settings
    react: {
      useSuspense: true, // Use Suspense for lazy-loading
      bindI18n: 'languageChanged', // Re-render on language change
      bindI18nStore: false, // Don't re-render on resource changes
    },

    // Detection options
    detection: {
      // localStorage 优先（用户手动选过的覆盖系统）；其次用 navigator（系统语言，首次启动生效）
      order: ['localStorage', 'navigator'],

      // Keys to look for in localStorage
      lookupLocalStorage: 'userLanguage',

      // Cache user language（手动选过后写入 localStorage，之后不再跟随系统）
      caches: ['localStorage'],
    },
  });

// Save language preference when it changes
i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem('userLanguage', lng);
  } catch (error) {
    console.error('Failed to save language preference:', error);
  }
});

export default i18n;
