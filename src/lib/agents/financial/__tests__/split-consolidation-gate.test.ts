// ---------------------------------------------------------------------------
// consolidateSplitReport — V3 con el EFE determinista y tipo societario único
// ---------------------------------------------------------------------------
// recalculo-11 (W3-A): el consolidado partido llamaba `auditReportEmittable`
// sin `comparativeSnapshot`, así que V3 (EFE determinista vs PUC 11) nunca se
// evaluaba en el camino que usa la UI, a diferencia del orquestador legacy.
// prompts-normativa-08 (W3-A): su `normalizeTipoSocietario` local no
// reconocía "S. A. S." ni "Sociedad por Acciones Simplificada" (→ 'OTRO'), de
// modo que V9 (reserva legal SAS sin estatutos) no corría para esas SAS.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { consolidateSplitReport } from '../split-consolidation';
import { makeExportableReport } from '../__fixtures__/coherent-niif-report';
import { composeEditorialReport } from '@/lib/export/pdf-elite-react/compose';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import type { PeriodSnapshot, PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

const TWO_PERIODS = [
  'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000,80000000',
  '130505,Clientes,Auxiliar,1,40000000,60000000',
  '220505,Proveedores,Auxiliar,1,30000000,40000000',
  '311505,Capital,Auxiliar,1,40000000,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000,40000000',
  '370505,Utilidades acumuladas,Auxiliar,1,0,20000000',
  '410505,Ventas,Auxiliar,1,100000000,150000000',
  '510505,Sueldos,Auxiliar,1,80000000,110000000',
].join('\n');

const COMPANY = {
  name: 'Demo SAS',
  nit: '900123456-8',
  fiscalPeriod: '2025',
  niifGroup: 2 as const,
};

function run(pp: PreprocessedBalance, entityType: string, governance = 'Acta de asamblea.') {
  return consolidateSplitReport({
    company: { ...COMPANY, entityType } as never,
    preprocessed: pp,
    rawData: 'NIT 900123456-8\nDEMO SAS',
    niifContent: 'Estados financieros 2025. TMT calculada.',
    strategyContent: 'Estrategia.',
    governanceContent: governance,
    language: 'es',
    now: new Date('2026-03-01T00:00:00Z'),
  });
}

const codes = (r: ReturnType<typeof run>) => r.emittability.blockers.map((b) => b.code);

describe('consolidateSplitReport — V3 sobre el EFE determinista (recalculo-11)', () => {
  it('un comparativo cuyo EFE determinista no concilia bloquea con V3', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(TWO_PERIODS));
    // Apertura con un activo extra: el EFE determinista ya no cierra contra la
    // variación del PUC 11 (mismo caso que el test del gate).
    const comparative: PeriodSnapshot = {
      ...pp.comparative!,
      classes: pp.comparative!.classes.map((c) =>
        c.code === 1
          ? {
              ...c,
              accounts: [
                ...c.accounts,
                { ...c.accounts.find((a) => a.isLeaf)!, code: '139995', name: 'Otro deudor', balance: 1_000_000 },
              ],
            }
          : c,
      ),
    };
    const r = run({ ...pp, comparative }, 'SAS');
    expect(codes(r)).toContain('V3');
  });

  it('con el EFE determinista conciliado no hay V3', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(TWO_PERIODS));
    expect(codes(run(pp, 'SAS'))).not.toContain('V3');
  });
});

describe('consolidateSplitReport — tipo societario del prompt de Gobierno (prompts-normativa-08)', () => {
  const reservaSas = 'Se constituye la reserva legal conforme al Art. 40 Ley 1258.';

  it.each(['S. A. S.', 'Sociedad por Acciones Simplificada', 'SAS'])(
    '"%s" se lee como SAS: V9 corre',
    (entityType) => {
      const pp = preprocessTrialBalance(parseTrialBalanceCSV(TWO_PERIODS));
      expect(codes(run(pp, entityType, reservaSas))).toContain('V9');
    },
  );

  it('una S.A. no dispara V9', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(TWO_PERIODS));
    expect(codes(run(pp, 'S.A.', reservaSas))).not.toContain('V9');
  });
});

// ---------------------------------------------------------------------------
// pipeline-flujo-21 — override "Continuar de todas formas" en el camino partido
// ---------------------------------------------------------------------------
// El flag `provisional` del Doctor de Datos sólo lo leía el orquestador legacy
// (sin llamador en la UI): en el camino partido el informe salía sin marca
// BORRADOR aunque el usuario lo hubiera pedido como borrador.
describe('consolidateSplitReport — override provisional (pipeline-flujo-21)', () => {
  const pp = () => preprocessTrialBalance(parseTrialBalanceCSV(TWO_PERIODS));
  const withOverride = (niifContent: string, provisional?: { active: boolean; reason: string }) =>
    consolidateSplitReport({
      company: { ...COMPANY, entityType: 'SAS' } as never,
      preprocessed: pp(),
      rawData: 'NIT 900123456-8\nDEMO SAS',
      niifContent,
      strategyContent: 'Estrategia.',
      governanceContent: 'Acta de asamblea.',
      language: 'es',
      now: new Date('2026-03-01T00:00:00Z'),
      provisional,
    });

  it('sin override no hay encabezado BORRADOR', () => {
    const r = withOverride('Estados financieros 2025. Monto $[___].');
    expect(r.validation.ok).toBe(false);
    expect(r.consolidatedReport).not.toContain('BORRADOR — VALIDACION PENDIENTE');
  });

  it('con override el consolidado sale como BORRADOR con la razón y los errores; los gates no cambian', () => {
    const base = withOverride('Estados financieros 2025. Monto $[___].');
    const r = withOverride('Estados financieros 2025. Monto $[___].', {
      active: true,
      reason: 'El cliente necesita el borrador para la junta del lunes',
    });
    expect(r.consolidatedReport.startsWith('> ⚠️ **BORRADOR — VALIDACION PENDIENTE**')).toBe(true);
    expect(r.consolidatedReport).toContain('Razon declarada: "El cliente necesita el borrador para la junta del lunes"');
    expect(r.consolidatedReport).toContain(`> - ${r.validation.errors[0]}`);
    expect(r.validation).toEqual(base.validation);
    expect(r.emittability).toEqual(base.emittability);
  });

  it('con override y validación limpia el informe igual se marca BORRADOR', () => {
    const r = withOverride('Estados financieros 2025.', { active: true, reason: 'Borrador pedido por el usuario' });
    expect(r.consolidatedReport).toContain('BORRADOR — VALIDACION PENDIENTE');
    expect(r.consolidatedReport).toContain('(la validacion post-render no reporto errores)');
  });

  it('un override inactivo no marca nada', () => {
    const r = withOverride('Estados financieros 2025.', { active: false, reason: 'x' });
    expect(r.consolidatedReport).not.toContain('BORRADOR');
  });

  it('el PDF estampa BORRADOR sobre el consolidado marcado', () => {
    const r = withOverride('Estados financieros 2025.', { active: true, reason: 'Borrador pedido por el usuario' });
    const report = { ...makeExportableReport(), consolidatedReport: r.consolidatedReport };
    const pdf = composeEditorialReport({ report, preprocessed: null, language: 'es' } as never);
    expect(pdf.meta.watermark).toBe('BORRADOR');
  });
});
