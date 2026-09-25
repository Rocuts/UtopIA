'use client';

/**
 * /workspace/valor/inteligencia-financiera — submódulo en preparación.
 *
 * Auditoría V7a-extra-01: esta página era una maqueta estática con cifras
 * literales (montos, porcentajes, estados y casos) presentadas como datos de la
 * empresa, sin rótulo de demostración. Ahora muestra el rótulo visible
 * "Módulo en preparación — sin datos de su empresa" y ninguna cifra.
 * El CTA abre el flujo real existente (`financial_intel`) con los datos del
 * usuario.
 */

import { Activity } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { ModuleInPreparation } from '@/components/workspace/areas/shared/ModuleInPreparation';

export default function InteligenciaFinancieraPage() {
  const { t } = useLanguage();
  const sub = t.elite.areas.valor.submodules.inteligenciaFinanciera;
  return (
    <ModuleInPreparation
      area="valor"
      title={sub.title}
      description={sub.description}
      icon={Activity}
      intakeCaseType="financial_intel"
    />
  );
}
