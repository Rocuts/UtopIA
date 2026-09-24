'use client';

/**
 * /workspace/valor/valoracion — submódulo en preparación.
 *
 * Auditoría valoracion-03 / V7a-extra-01: esta página era una maqueta estática con cifras
 * literales (montos, porcentajes, estados y casos) presentadas como datos de la
 * empresa, sin rótulo de demostración. Ahora muestra el rótulo visible
 * "Módulo en preparación — sin datos de su empresa" y ninguna cifra.
 * El CTA abre el flujo real existente (`business_valuation`) con los datos del
 * usuario.
 */

import { Diamond } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { ModuleInPreparation } from '@/components/workspace/areas/shared/ModuleInPreparation';

export default function ValoracionPage() {
  const { t } = useLanguage();
  const sub = t.elite.areas.valor.submodules.valoracion;
  return (
    <ModuleInPreparation
      area="valor"
      title={sub.title}
      description={sub.description}
      icon={Diamond}
      intakeCaseType="business_valuation"
    />
  );
}
