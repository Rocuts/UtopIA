'use client';

/**
 * SettingsLayout — Two-column shell for the settings page.
 *
 * Desktop (md+): sticky 240px nav on the left, content on the right.
 * Mobile (<md): single column with a native <select> dropdown for nav.
 *
 * Hash routing keeps sections linkable and preserves state on reload without
 * requiring a router change. `hashchange` + `popstate` listeners sync state.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useLanguage } from '@/context/LanguageContext';
import { SettingsNav, SETTINGS_SECTION_ORDER, type SettingsSectionId } from './SettingsNav';
import { ThemeSection } from './sections/ThemeSection';
import { DensitySection } from './sections/DensitySection';
import { LanguageSection } from './sections/LanguageSection';
import { IntegrationsSection } from './sections/IntegrationsSection';
import { SecuritySection } from './sections/SecuritySection';
import { ResetSection } from './sections/ResetSection';

const VALID: ReadonlyArray<SettingsSectionId> = SETTINGS_SECTION_ORDER;

function parseHash(hash: string): SettingsSectionId | null {
  const raw = hash.replace(/^#/, '') as SettingsSectionId;
  return VALID.includes(raw) ? raw : null;
}

export function SettingsLayout() {
  const { t } = useLanguage();
  const [active, setActive] = useState<SettingsSectionId>('theme');

  // Sync from URL hash on mount + on back/forward.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      const parsed = parseHash(window.location.hash);
      if (parsed) setActive(parsed);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const handleSelect = useCallback((id: SettingsSectionId) => {
    setActive(id);
    if (typeof window !== 'undefined') {
      // Use history.replaceState to avoid polluting back-button history.
      window.history.replaceState(null, '', `#${id}`);
    }
  }, []);

  const section = (() => {
    switch (active) {
      case 'theme':
        return <ThemeSection />;
      case 'density':
        return <DensitySection />;
      case 'language':
        return <LanguageSection />;
      case 'integrations':
        return <IntegrationsSection />;
      case 'security':
        return <SecuritySection />;
      case 'reset':
        return <ResetSection />;
    }
  })();

  return (
    <div className="flex flex-col md:flex-row gap-6 md:gap-10">
      {/* Mobile: select dropdown */}
      <div className="md:hidden">
        <label className="block text-xs uppercase tracking-eyebrow text-n-500 mb-2">
          {t.settings.title}
        </label>
        <select
          value={active}
          onChange={(e) => handleSelect(e.target.value as SettingsSectionId)}
          className="w-full h-10 px-3 rounded-md bg-n-900 border border-gold-500/20 text-n-100 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500"
          aria-label={t.settings.title}
        >
          {SETTINGS_SECTION_ORDER.map((id) => (
            <option key={id} value={id}>
              {t.settings.sections[id]}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop: sticky nav */}
      <aside className="hidden md:block shrink-0 w-[240px]">
        <div className="sticky top-20">
          <SettingsNav active={active} onSelect={handleSelect} />
        </div>
      </aside>

      {/* Content */}
      <motion.main
        key={active}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className="flex-1 min-w-0"
        role="region"
        aria-label={t.settings.sections[active]}
      >
        {section}
      </motion.main>
    </div>
  );
}
