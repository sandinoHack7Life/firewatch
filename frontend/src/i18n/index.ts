import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import pt from './locales/pt.json';

function getInitialLanguage(): 'en' | 'pt' {
  try {
    return window.localStorage.getItem('firewatch-language') === 'pt' ? 'pt' : 'en';
  } catch {
    return 'en';
  }
}

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      pt: { translation: pt },
    },
    lng: getInitialLanguage(),
    fallbackLng: 'en',
    keySeparator: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });

export default i18n;
