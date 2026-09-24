'use client';

/**
 * /workspace/contabilidad/asientos — Listado de asientos.
 *
 * Integración IW5b (auditoría 2026-09-24): la página listaba 8 asientos de
 * demostración (DEMO_ENTRIES) como si fueran del cliente. Todavía no hay una
 * vista de listado conectada a /api/accounting/journal con filtros, así que se
 * declara «Módulo en preparación» y se ofrece el flujo real de nuevo asiento.
 * Los últimos asientos reales se ven en el hub (/workspace/contabilidad).
 */

import { FileText } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { AccountingModuleInPreparation } from '@/components/workspace/accounting/AccountingModuleInPreparation';

export default function AsientosPage() {
  const { t } = useLanguage();
  const ac = t.accounting;
  return (
    <AccountingModuleInPreparation
      title={ac.journalList}
      description={ac.journalListDesc}
      icon={FileText}
      cta={{ href: '/workspace/contabilidad/asientos/nuevo', label: ac.newEntry }}
    />
  );
}
