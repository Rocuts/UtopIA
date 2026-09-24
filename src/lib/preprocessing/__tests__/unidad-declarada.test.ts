// ---------------------------------------------------------------------------
// recalculo-final-03 (re-auditoría 2026-09-24) — una unidad declarada "en miles
// de pesos" / "en millones" en el encabezado o en el título se ignoraba: el
// informe publicaba Activo $570.000 en lugar de $570.000.000 sin aviso, y las
// bases en UVT y los umbrales quedaban 1.000 veces por debajo. Ahora es un
// motivo de integridad explícito (422) que pide confirmar la unidad; nunca se
// reescala ni se publica en silencio.
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';

import { BalanceValidationError, prepareFinancialContext } from '@/lib/agents/financial/orchestrator';
import { summarize } from '@/lib/api/trial-balances';
import { parseUploadedTrialBalanceText } from '../raw-data';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '../trial-balance';

const COMPANY = { name: 'Empresa Prueba SAS', nit: '900123456-7', fiscalPeriod: '2025' };

const CUERPO = [
  '110505,Caja,Auxiliar,500000,570000',
  '220505,Proveedores,Auxiliar,200000,220000',
  '310505,Capital,Auxiliar,300000,350000',
];
const csv = (header: string, pre: string[] = [], post: string[] = []) =>
  [...pre, header, ...CUERPO, ...post].join('\n');

const reasonsOf = (text: string) => preprocessTrialBalance(parseTrialBalanceCSV(text)).primary.validation;
const niif422 = (rawData: string) =>
  prepareFinancialContext({ rawData, company: COMPANY, language: 'es' }).then(
    () => null,
    (e: unknown) => (e instanceof BalanceValidationError ? e.reasons : null),
  );

describe('recalculo-final-03 — unidad declarada distinta de pesos', () => {
  it('encabezado "Saldo 2025 (miles de pesos)": motivo de integridad y 422 en /niif', async () => {
    const text = csv('codigo,nombre,nivel,Saldo 2024 (miles de pesos),Saldo 2025 (miles de pesos)');
    const v = reasonsOf(text);
    const motivo = (v.integrityReasons ?? []).find((r) => /declara las cifras en miles de pesos/.test(r));
    expect(motivo).toBeDefined();
    expect(motivo).toContain('confirme la unidad');
    expect(motivo).toContain('× 1.000');
    expect(v.blocking).toBe(true);
    const reasons = await niif422(text);
    expect(reasons?.some((r) => /miles de pesos/.test(r))).toBe(true);
  });

  it('título del XLSX "Cifras expresadas en miles de pesos colombianos" (bloque de hoja): también bloquea', async () => {
    const hoja = csv('codigo,nombre,nivel,Saldo 2024,Saldo 2025', [
      'Balance de prueba,,,,',
      'Cifras expresadas en miles de pesos colombianos,,,,',
    ]);
    const rawData = `[period=Balance 2025]\n${hoja}\n[/period]`;
    const parsed = parseUploadedTrialBalanceText(rawData);
    expect(parsed.rows[0].parseIssues?.some((i) => /miles de pesos/.test(i.message))).toBe(true);
    const reasons = await niif422(rawData);
    expect(reasons?.some((r) => /Cifras expresadas en miles de pesos colombianos/.test(r))).toBe(true);
  });

  it('"en millones" en una nota al pie: pide × 1.000.000', () => {
    const v = reasonsOf(csv('codigo,nombre,nivel,Saldo 2024,Saldo 2025', [], ['Nota: valores en millones de pesos']));
    expect((v.integrityReasons ?? []).some((r) => /en millones de pesos/.test(r) && /× 1\.000\.000/.test(r))).toBe(true);
  });

  it('el API v1 no publica "balanced" con la unidad sin confirmar', () => {
    const pp = preprocessTrialBalance(
      parseTrialBalanceCSV(csv('codigo,nombre,nivel,Saldo 2024 (miles de pesos),Saldo 2025 (miles de pesos)')),
    );
    expect(summarize(pp).status).toBe('unbalanced');
  });

  it('control: "Cifras expresadas en pesos colombianos" y una cuenta con "mil" en el nombre no bloquean', () => {
    const text = [
      'Cifras expresadas en pesos colombianos',
      'codigo,nombre,nivel,Saldo 2024,Saldo 2025',
      '110505,Caja,Auxiliar,500000,570000',
      '220505,Proveedores Mil Colores SAS,Auxiliar,200000,220000',
      '310505,Capital,Auxiliar,300000,350000',
    ].join('\n');
    const v = reasonsOf(text);
    expect((v.integrityReasons ?? []).some((r) => /declara las cifras/.test(r))).toBe(false);
    expect(v.blocking).toBe(false);
  });
});
