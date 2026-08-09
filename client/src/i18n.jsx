import React, { createContext, useContext, useState, useEffect } from 'react';
import en from './locales/en.js';
import de from './locales/de.js';
import ru from './locales/ru.js';
import uk from './locales/uk.js';
import nl from './locales/nl.js';
import fr from './locales/fr.js';

const LANG_KEY = 'deathstep_language';
const dictionaries = { en, de, ru, uk, nl, fr };
// Exported so every in-app language switcher (Home.jsx's own-screen picker,
// Modal.jsx's LanguageModal reused from GMDashboard/PlayerScreen's kebab
// menus) draws from one list - a language added here shows up everywhere
// without also needing to be hand-added to each switcher's button row.
export const SUPPORTED_LANGS = Object.keys(dictionaries);

export function detectLanguage() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (SUPPORTED_LANGS.includes(saved)) return saved;
  } catch (e) { /* localStorage unavailable */ }
  const browserLang = (navigator.language || '').toLowerCase();
  // 'uk' (Ukrainian) is checked before the generic 'uk'-looking prefixes
  // don't collide with anything else here; browser tags come as e.g.
  // 'de-DE', 'uk-UA', 'fr-CA', so match on the language subtag only.
  const prefix = browserLang.split('-')[0];
  return SUPPORTED_LANGS.includes(prefix) ? prefix : 'en';
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
