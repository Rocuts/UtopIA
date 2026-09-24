// ---------------------------------------------------------------------------
// Gate de emitibilidad — checks que dependen del texto (V15) y fuente del EFE (V3)
// ---------------------------------------------------------------------------
// pipeline-flujo-02: el pre-vuelo corre en Stage 0 con `consolidatedReport=''`
// y `skipReportTextChecks=true`. V8/V9/V10 respetaban la bandera; V15 (que
// busca en el TEXTO la declaración de impracticabilidad §3.14/§10.21) no, así
// que todo balance de un solo periodo quedaba CON SALVEDADES antes de que
// existiera informe alguno. El mensaje además fijaba el año literal "2024".
//
// recalculo-11: V3 evaluaba el EFE del curator R2 (que arranca de la utilidad
// acumulada y no concilia) en vez del EFE determinista, la única fuente
// vinculante del EFE.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  auditReportEmittable,
  checkComparativosImpracticablesDeclaration,
  type AuditCompanyContext,
} from '../audit-report-emittable';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';

const COMPANY: AuditCompanyContext = {
  razonSocialFromFile: 'X SAS',
  nitFromFile: '900.123.456-8',
  nit: '900123456-8',
  niifGroup: 2,
  tipoSocietario: 'SAS',
  estatutosRequierenReservaLegal: undefined,
};

const SINGLE_2025 = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000',
  '130505,Clientes,Auxiliar,1,40000000',
  '220505,Proveedores,Auxiliar,1,30000000',
  '311505,Capital,Auxiliar,1,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000',
  '410505,Ventas,Auxiliar,1,100000000',
  '510505,Sueldos,Auxiliar,1,80000000',
].join('\n');

const TWO_PERIODS = [
  'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000,80000000',
  '130505,Clientes,Auxiliar,1,40000000,60000000',
  '220505,Proveedores,Auxiliar,1,30000000,40000000',
  '311505,Capital,Auxiliar,1,40000000,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000,60000000',
  '410505,Ventas,Auxiliar,1,100000000,150000000',
  '510505,Sueldos,Auxiliar,1,80000000,110000000',
].join('\n');

const report = (text: string) => ({ consolidatedReport: text }) as never;

describe('V15 — impracticabilidad de comparativos', () => {
  const single = () => preprocessTrialBalance(parseTrialBalanceCSV(SINGLE_2025));

  it('el pre-vuelo (skipReportTextChecks) NO evalúa V15: todavía no existe texto', () => {
    const pp = single();
    expect(pp.comparativos_impracticables).toBe(true);
    const pre = auditReportEmittable(report(''), pp.primary, COMPANY, { comparativos_impracticables: true }, {
      skipReportTextChecks: true,
    });
    expect(pre.blockers.map((b) => b.code)).not.toContain('V15');
  });

  it('fuera del pre-vuelo V15 sigue bloqueando un informe que no declara la impracticabilidad', () => {
    const pp = single();
    const post = auditReportEmittable(report('Estados financieros 2025.'), pp.primary, COMPANY, {
      comparativos_impracticables: true,
    });
    expect(post.blockers.map((b) => b.code)).toContain('V15');
  });

  it('el mensaje usa el periodo anterior REAL, no el literal 2024', () => {
    const b = checkComparativosImpracticablesDeclaration('sin declaración', { comparativos_impracticables: true }, '2022');
    expect(b).not.toBeNull();
    expect(b!.message).toContain('2021');
    expect(b!.message).not.toContain('2024');
  });

  it('acepta la declaración "sin comparativos del periodo <año real>"', () => {
    const b = checkComparativosImpracticablesDeclaration(
      'Se presentan sin comparativos del periodo 2021.',
      { comparativos_impracticables: true },
      '2022',
    );
    expect(b).toBeNull();
  });
});

describe('V3 — EFE determinista como única fuente', () => {
  const twoPeriods = () => preprocessTrialBalance(parseTrialBalanceCSV(TWO_PERIODS));

  /** Simula el EFE R2 que no concilia (arranca de la utilidad acumulada). */
  function withBrokenR2(snapshot: PeriodSnapshot): PeriodSnapshot {
    const cfi = snapshot.cashFlowIndirecto!;
    return {
      ...snapshot,
      cashFlowIndirecto: { ...cfi, netChangeInCash: cfi.observedChangeInCash + 1_559_097_749.11, reconciled: false },
    };
  }

  it('un EFE R2 que no concilia NO produce V3 cuando el determinista cuadra', () => {
    const pp = twoPeriods();
    const primary = withBrokenR2(pp.primary);
    const withComparative = auditReportEmittable(report(''), primary, COMPANY, undefined, {
      skipReportTextChecks: true,
      comparativeSnapshot: pp.comparative,
    });
    expect(withComparative.blockers.map((b) => b.code)).not.toContain('V3');
    // Sin comparativo tampoco se usa el R2 como sustituto.
    const withoutComparative = auditReportEmittable(report(''), primary, COMPANY, undefined, {
      skipReportTextChecks: true,
    });
    expect(withoutComparative.blockers.map((b) => b.code)).not.toContain('V3');
  });

  it('V3 bloquea cuando el EFE determinista no concilia con el PUC 11', () => {
    const pp = twoPeriods();
    // Apertura con un activo extra que rompe A = P + Pt del comparativo: el
    // EFE determinista ya no puede cerrar contra la variación del PUC 11.
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
    const r = auditReportEmittable(report(''), pp.primary, COMPANY, undefined, {
      skipReportTextChecks: true,
      comparativeSnapshot: comparative,
    });
    const v3 = r.blockers.find((b) => b.code === 'V3');
    expect(v3).toBeDefined();
    expect(v3!.message).toMatch(/EFE determinista/);
  });
});
