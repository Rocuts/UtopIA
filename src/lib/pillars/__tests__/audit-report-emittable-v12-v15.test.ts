// ---------------------------------------------------------------------------
// Gate de emitibilidad — V12 con P&G acumulado y V15 sin "§"
// ---------------------------------------------------------------------------
// recalculo-03 (W3-A): cuando R12 detecta que el comparativo no se cerró
// (`closingDetectorAudit.pygAcumulado`), V12 decía "utilidad del ejercicio sin
// trasladar al patrimonio" — otra causa y otra corrección. Debe nombrar el
// periodo no cerrado y el resultado alternativo del ejercicio.
// prompts-normativa-23 (W3-A): V15 sólo aceptaba "§3.14"/"§10.21"; un informe
// que escribe "Sección 3.14" o "párrafo 10.21" sí declara la impracticabilidad.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
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

const report = (text: string) => ({ consolidatedReport: text }) as never;

function snapshotWith(overrides: Partial<PeriodSnapshot>): PeriodSnapshot {
  const pp = preprocessTrialBalance(parseTrialBalanceCSV(SINGLE_2025));
  return { ...pp.primary, ...overrides };
}

describe('V12 — P&G posiblemente acumulado (recalculo-03)', () => {
  it('nombra el periodo no cerrado y el resultado alternativo del ejercicio', () => {
    const snap = snapshotWith({
      findings: { librosNoCerrados: true },
      closingDetectorAudit: {
        utilidadTransitoriaCop: 60_000_000,
        grupo36SaldoCop: 60_000_000,
        grupo37SaldoCop: 0,
        librosNoCerrados: true,
        suggestedClosingEntries: ['Cierre del periodo 2024: cancelar las clases 4-7 contra 5905.'],
        pygAcumulado: {
          comparativePeriod: '2024',
          utilidadComparativo: 20_000_000,
          utilidadPublicada: 60_000_000,
          utilidadMovimientoRaw: '40000000.00',
          ingresosNetosMovimientoRaw: '50000000.00',
          variacionResultadosAnterioresRaw: '0.00',
        },
      },
    });
    const r = auditReportEmittable(report('Informe'), snap, COMPANY);
    const v12 = r.blockers.find((b) => b.code === 'V12');
    expect(v12).toBeDefined();
    expect(v12!.message).toMatch(/P&G posiblemente acumulado/);
    expect(v12!.message).toContain('2024');
    expect(v12!.message).toContain('$40.000.000,00');
    expect(v12!.message).not.toMatch(/sin trasladar al patrimonio/);
  });

  it('sin pygAcumulado conserva el mensaje de utilidad sin trasladar', () => {
    const snap = snapshotWith({
      findings: { librosNoCerrados: true },
      closingDetectorAudit: {
        utilidadTransitoriaCop: 20_000_000,
        grupo36SaldoCop: 0,
        grupo37SaldoCop: 0,
        librosNoCerrados: true,
        suggestedClosingEntries: [],
      },
    });
    const r = auditReportEmittable(report('Informe'), snap, COMPANY);
    expect(r.blockers.find((b) => b.code === 'V12')!.message).toMatch(/sin trasladar al patrimonio/);
  });
});

describe('V15 — declaración de impracticabilidad sin "§" (prompts-normativa-23)', () => {
  const elite = { comparativos_impracticables: true };

  it.each([
    'Se aplica la Sección 3.14 de la NIIF para las PYMES: no se presentan comparativos.',
    'Conforme a las secciones 3.14 y 10.21, el comparativo no se presenta.',
    'Párrafo 10.21 de la NIIF para las PYMES: reexpresión no practicable.',
  ])('acepta "%s"', (text) => {
    expect(checkComparativosImpracticablesDeclaration(text, elite, '2025')).toBeNull();
  });

  it('una cifra que contiene "10.21" no cuenta como declaración', () => {
    const blocker = checkComparativosImpracticablesDeclaration(
      'Ingresos del periodo: $10.210.000,00.',
      elite,
      '2025',
    );
    expect(blocker?.code).toBe('V15');
  });
});
