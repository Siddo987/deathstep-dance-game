import React, { createContext, useContext, useState, useEffect } from 'react';
import en from './locales/en.js';
import de from './locales/de.js';
import ru from './locales/ru.js';
import uk from './locales/uk.js';
import nl from './locales/nl.js';
import fr from './locales/fr.js';

const LANG_KEY = 'deathstep_language';
// de first - this app's default/primary audience is German-speaking, and
// object key order drives SUPPORTED_LANGS below, so every language list
// derived from it (Home.jsx's picker, Modal.jsx's LanguageModal) shows
// German first rather than in alphabetical/arbitrary order.
const dictionaries = { de, en, ru, uk, nl, fr };
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
  // Falls back to German (this app's default language), not English, for a
  // browser language this app doesn't support at all.
  return SUPPORTED_LANGS.includes(prefix) ? prefix : 'de';
}

const LanguageContext = createContext({
  lang: 'de',
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
  // back to German (this app's default/primary language), then to the raw
  // key so missing entries stay visible.
  const t = (key, params) => {
    let text = dictionaries[lang][key] ?? dictionaries.de[key] ?? key;
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
