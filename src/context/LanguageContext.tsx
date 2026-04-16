'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { dict, Language, Dictionary } from '@/lib/i18n/dictionaries';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Dictionary;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Default to 'es' for SSR (Colombian-focused app). Client-side detection runs in useEffect.
  const [language, setLanguageState] = useState<Language>('es');

  // On mount: 1) check localStorage, 2) detect browser locale, 3) fallback to 'es'
  useEffect(() => {
    // Priority 1: user's explicit previous choice
    const saved = localStorage.getItem('language') as Language;
    if (saved && (saved === 'en' || saved === 'es')) {
      setLanguageState(saved);
      return;
    }

    // Priority 2: detect browser/device language
    const browserLang = navigator.language || (navigator as unknown as { userLanguage?: string }).userLanguage || '';
    const detected: Language = browserLang.startsWith('es') ? 'es' : browserLang.startsWith('en') ? 'en' : 'es';
    setLanguageState(detected);
    localStorage.setItem('language', detected);
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('language', lang);
  };

  const t = dict[language];

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
