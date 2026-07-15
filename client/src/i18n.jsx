import React, { createContext, useContext, useState, useEffect } from 'react';
import en from './locales/en.js';
import de from './locales/de.js';

const LANG_KEY = 'deathstep_language';
const dictionaries = { en, de };

export function detectLanguage() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'de') return saved;
  } catch (e) { /* localStorage unavailable */ }
  return (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en';
}

const LanguageContext = createContext({
  lang: 'en',
  setLang: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(detectLanguage);

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) { /* localStorage unavailable */ }
    document.documentElement.lang = lang;
  }, [lang]);

  // t('key', { name: 'X' }) replaces {name} placeholders. Unknown keys fall
  // back to English, then to the raw key so missing entries stay visible.
  const t = (key, params) => {
    let text = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
    if (params) {
      Object.keys(params).forEach(p => {
        text = text.split(`{${p}}`).join(String(params[p]));
      });
    }
    return text;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
