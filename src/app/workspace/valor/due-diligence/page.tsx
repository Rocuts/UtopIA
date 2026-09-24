'use client';

/**
 * /workspace/valor/due-diligence — submódulo en preparación.
 *
 * Auditoría V7a-extra-01: esta página era una maqueta estática con cifras
 * literales (montos, porcentajes, estados y casos) presentadas como datos de la
 * empresa, sin rótulo de demostración. Ahora muestra el rótulo visible
 * "Módulo en preparación — sin datos de su empresa" y ninguna cifra.
 * El CTA abre el flujo real existente (`due_diligence`) con los datos del
 * usuario.
 */

import { FileSearch } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { ModuleInPreparation } from '@/components/workspace/areas/shared/ModuleInPreparation';

export default function DueDiligencePage() {
  const { t } = useLanguage();
  const sub = t.elite.areas.valor.submodules.dueDiligence;
  return (
    <ModuleInPreparation
      area="valor"
      title={sub.title}
      description={sub.description}
      icon={FileSearch}
      intakeCaseType="due_diligence"
    />
  );
}
