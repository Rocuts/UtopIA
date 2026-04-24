'use client';

/**
 * Settings page — 1+1 Centro de Comando.
 *
 * Sprint 1 full redesign with 6 sections: Tema, Densidad, Idioma,
 * Integraciones, Seguridad, Reset. The outer wrapper is neutral (no hardcoded
 * data-theme) because A1 drives theming at <html> level from the workspace
 * shell layout. `data-lenis-prevent` stays so internal wheel-scroll survives
 * the global Lenis smooth-scroll hijack (see CLAUDE.md Layout Gotchas).
 */

import { motion } from 'motion/react';
import { Settings as SettingsIcon } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { SettingsLayout } from '@/components/settings/SettingsLayout';

export default function SettingsPage() {
  const { t } = useLanguage();

  return (
    <div
      data-lenis-prevent
      className="min-h-full w-full overflow-y-auto bg-n-1000"
    >
      <div className="mx-auto w-full max-w-[1280px] px-5 md:px-8 py-8 md:py-12 flex flex-col gap-8">
        <motion.header
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="flex items-start gap-4"
        >
          <div
            aria-hidden="true"
            className="shrink-0 w-11 h-11 rounded-lg glass-elite flex items-center justify-center"
          >
            <SettingsIcon className="w-5 h-5 text-gold-500" />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-eyebrow text-n-500 font-medium font-mono">
              {t.settings.eyebrow}
            </span>
            <h1 className="font-serif-elite text-3xl md:text-4xl leading-tight tracking-tight text-n-100">
              {t.settings.title}
            </h1>
          </div>
        </motion.header>

        <SettingsLayout />
      </div>
    </div>
  );
}
