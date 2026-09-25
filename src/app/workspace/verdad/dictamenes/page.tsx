'use client';

/**
 * /workspace/verdad/dictamenes — submódulo en preparación.
 *
 * Auditoría V7a-extra-01: esta página era una maqueta estática con cifras
 * literales (montos, porcentajes, estados y casos) presentadas como datos de la
 * empresa, sin rótulo de demostración. Ahora muestra el rótulo visible
 * "Módulo en preparación — sin datos de su empresa" y ninguna cifra.
 * El CTA abre el flujo real existente (`fiscal_audit_opinion`) con los datos del
 * usuario.
 */

import { Award } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { ModuleInPreparation } from '@/components/workspace/areas/shared/ModuleInPreparation';

export default function DictamenesPage() {
  const { t } = useLanguage();
  const sub = t.elite.areas.verdad.submodules.dictamenes;
  return (
    <ModuleInPreparation
      area="verdad"
      title={sub.title}
      description={sub.description}
      icon={Award}
      intakeCaseType="fiscal_audit_opinion"
    />
  );
}
