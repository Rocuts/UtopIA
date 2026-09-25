'use client';

/**
 * /workspace/escudo/agente-fiscal — submódulo en preparación.
 *
 * Auditoría V7a-extra-01: esta página era una maqueta estática con cifras
 * literales (montos, porcentajes, estados y casos) presentadas como datos de la
 * empresa, sin rótulo de demostración. Ahora muestra el rótulo visible
 * "Módulo en preparación — sin datos de su empresa" y ninguna cifra.
 */

import { Bot } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { ModuleInPreparation } from '@/components/workspace/areas/shared/ModuleInPreparation';

export default function AgenteFiscalPage() {
  const { t } = useLanguage();
  const sub = t.elite.areas.escudo.submodules.agenteFiscal;
  return (
    <ModuleInPreparation
      area="escudo"
      title={sub.title}
      description={sub.description}
      icon={Bot}
    />
  );
}
