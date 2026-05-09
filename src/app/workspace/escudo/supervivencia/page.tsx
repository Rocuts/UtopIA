'use client';

/**
 * /workspace/escudo/supervivencia — Modo Supervivencia Élite.
 *
 * Dedicated sub-page that renders the SurvivalModePanel inside the
 * standard AreaShell (same shell used by the parent /workspace/escudo page).
 * Routing decision: dedicated sub-page (not querystring) so the URL is
 * bookmarkable, shareable, and the browser history is clean.
 */

import { useLanguage } from '@/context/LanguageContext';
import { AreaShell } from '@/components/workspace/layouts/AreaShell';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SurvivalModePanel } from '@/components/workspace/areas/SurvivalModePanel';

export default function SupervivenciaPage() {
  const { t } = useLanguage();
  const survival = t.elite.areas.escudo.modes.supervivenciaElite;

  return (
    <AreaShell areaAccent="escudo">
      {/* Page header */}
      <div className="mb-10">
        <SectionHeader
          eyebrow={
            t.elite.areas.escudo.concept
          }
          title={survival.title}
          subtitle={survival.subtitle}
          align="left"
          accent="wine"
          divider
          titleAs="h1"
        />
      </div>

      {/* Main panel — flow: idle → running → done/error */}
      <SurvivalModePanel />
    </AreaShell>
  );
}
