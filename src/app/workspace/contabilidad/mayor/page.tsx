'use client';

/**
 * /workspace/contabilidad/mayor — Libro mayor.
 *
 * Integración IW5b (auditoría 2026-09-24): la página mostraba una cuenta T de
 * demostración (1105 · Caja, junio 2026) con saldos literales. El componente
 * real `LedgerView` pide `/api/accounting/journal?view=ledger`, vista de
 * líneas que la API todavía no expone (lista asientos, no líneas), así que
 * montarlo mostraría un mayor vacío como si no hubiera movimientos. Se declara
 * «Módulo en preparación» hasta que exista la consulta de mayor por cuenta.
 */

import { BookOpen } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { AccountingModuleInPreparation } from '@/components/workspace/accounting/AccountingModuleInPreparation';

export default function MayorPage() {
  const { t } = useLanguage();
  const ac = t.accounting;
  return (
    <AccountingModuleInPreparation title={ac.ledger} description={ac.ledgerDesc} icon={BookOpen} />
  );
}
