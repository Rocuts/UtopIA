// ---------------------------------------------------------------------------
// P4 (a) — pendiente #4 de la auditoría integral 2026-09-24: unidad declarada
// "en miles / millones" con confirmación EXPLÍCITA del usuario.
//
// Sin confirmación el balance sigue bloqueado (recalculo-final-03). Con la
// confirmación el servidor reexpresa cada importe a pesos en centavos exactos
// (BigInt, desde el texto decimal: nunca `valor × 1000` en coma flotante) y deja
// una nota visible ("cifras reexpresadas de miles a pesos por confirmación del
// usuario"). La confirmación viaja en `rawData` como directiva para que TODAS las
// superficies que re-derivan el balance (/niif, Stage 0 de /consolidate, /export)
// lean la misma cifra.
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';

import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { BalanceValidationError, prepareFinancialContext } from '@/lib/agents/financial/orchestrator';
import { composeEditorialReport } from '@/lib/export/pdf-elite-react';
import { escribirDirectivasIngesta } from '@/lib/upload/ingest-directives';
import {
  incorporarConfirmaciones,
  parseUploadedTrialBalanceText,
  preprocessUploadedTrialBalanceText,
  TrialBalanceIngestError,
} from '../raw-data';
import { parseTrialBalanceCSVWithMeta, preprocessTrialBalance } from '../trial-balance';

const COMPANY = { name: 'Empresa Prueba SAS', nit: '900123456-7', fiscalPeriod: '2025' };

// A 2025 = 570.000 (miles) = P 220.000 + K 350.000.
const CUERPO = [
  '110505,Caja,Auxiliar,500000,570000',
  '220505,Proveedores,Auxiliar,200000,220000',
  '310505,Capital,Auxiliar,300000,350000',
];
const CSV_MILES = ['codigo,nombre,nivel,Saldo 2024 (miles de pesos),Saldo 2025 (miles de pesos)', ...CUERPO].join('\n');

const pp = (csv: string, unidadConfirmada?: 'pesos' | 'miles' | 'millones') =>
  preprocessTrialBalance(parseTrialBalanceCSVWithMeta(csv, { unidadConfirmada }).rows);

describe('P4 (a) — unidad confirmada por el usuario', () => {
  it('sin confirmación sigue bloqueando y el parser informa la unidad detectada', () => {
    const meta = parseTrialBalanceCSVWithMeta(CSV_MILES);
    expect(meta.unidadDeclarada).toEqual({ unidad: 'miles', texto: 'Saldo 2024 (miles de pesos)' });
    expect(meta.unidadAplicada).toBeNull();
    const v = preprocessTrialBalance(meta.rows).primary.validation;
    expect(v.blocking).toBe(true);
    expect((v.integrityReasons ?? []).some((r) => /declara las cifras en miles de pesos/.test(r))).toBe(true);
  });

  it('confirmada "miles": importes × 1.000 en centavos exactos, sin motivo bloqueante y con nota visible', () => {
    const out = pp(CSV_MILES, 'miles');
    const p = out.primary;
    expect(p.controlTotals.cents!.activo).toBe(BigInt(57_000_000_000)); // $570.000.000,00
    expect(p.controlTotals.cents!.pasivo).toBe(BigInt(22_000_000_000));
    expect(p.controlTotals.cents!.patrimonio).toBe(BigInt(35_000_000_000));
    expect(p.validation.integrityReasons ?? []).toEqual([]);
    expect(p.validation.blocking).toBe(false);
    const nota = p.validation.adjustments.find((a) => /reexpresadas de miles de pesos a pesos/.test(a));
    expect(nota).toBeDefined();
    expect(nota).toMatch(/por confirmación del usuario/);
    expect(nota).toMatch(/× 1\.000/);
    // La nota también llega al informe de validación (Markdown) y al comparativo.
    expect(out.validationReport).toMatch(/reexpresadas de miles de pesos a pesos/);
    expect(out.comparative!.validation.adjustments.some((a) => /reexpresadas/.test(a))).toBe(true);
  });

  it('el escalado es exacto desde el texto decimal (4.232.848,882125 miles = $4.232.848.882,13; en flotante ...882,12)', () => {
    const csv = [
      'codigo,nombre,nivel,Saldo 2025 (miles de pesos)',
      '110505,Caja,Auxiliar,"4.232.848,882125"',
      '310505,Capital,Auxiliar,"4.232.848,882125"',
    ].join('\n');
    // La trampa del flotante: 4232848.882125 × 1000 = 4232848882.1249995 → ...882,12.
    expect(Math.round(4232848.882125 * 1000 * 100)).toBe(423284888212);
    const meta = parseTrialBalanceCSVWithMeta(csv, { unidadConfirmada: 'miles' });
    expect(meta.rows[0].balancesByPeriod['2025']).toBe(4232848882.13);
    const p = preprocessTrialBalance(meta.rows).primary;
    expect(p.controlTotals.cents!.activo).toBe(BigInt(423_284_888_213));
  });

  it('"millones" con decimales: 1,5 millones = $1.500.000 y 0,0000015 millones redondea al centavo ($1,50)', () => {
    const csv = [
      'codigo,nombre,nivel,Saldo 2025',
      'Cifras en millones de pesos,,,',
      '110505,Caja,Auxiliar,"1,5"',
      '110510,Caja menor,Auxiliar,0.0000015',
      '310505,Capital,Auxiliar,"1,5000015"',
    ].join('\n');
    const meta = parseTrialBalanceCSVWithMeta(csv, { unidadConfirmada: 'millones' });
    expect(meta.unidadDeclarada?.unidad).toBe('millones');
    const byCode = Object.fromEntries(meta.rows.map((r) => [r.code, r.balancesByPeriod['2025']]));
    expect(byCode['110505']).toBe(1500000);
    expect(byCode['110510']).toBe(1.5);
    expect(byCode['310505']).toBe(1500001.5);
  });

  it('confirmada "pesos" pese a la leyenda: no reexpresa, no bloquea y lo revela', () => {
    const p = pp(CSV_MILES, 'pesos').primary;
    expect(p.controlTotals.cents!.activo).toBe(BigInt(57_000_000));
    expect(p.validation.blocking).toBe(false);
    expect(p.validation.adjustments.some((a) => /confirmó que los importes ya están en pesos/.test(a))).toBe(true);
  });

  it('un importe que tras reexpresar excede el rango de precisión se bloquea (nunca se publica aproximado)', () => {
    const csv = [
      'codigo,nombre,nivel,Saldo 2025 (millones)',
      '110505,Caja,Auxiliar,95000000000',
      '310505,Capital,Auxiliar,95000000000',
    ].join('\n');
    const v = pp(csv, 'millones').primary.validation;
    expect(v.blocking).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/precisión monetaria/);
  });

  it('la directiva en rawData se aplica igual en el helper compartido (upload, /niif, /export)', () => {
    const rawData = escribirDirectivasIngesta(CSV_MILES, { unidadConfirmada: 'miles' });
    expect(rawData.split('\n')[0]).toBe('[unidad-confirmada=miles]');
    const parsed = parseUploadedTrialBalanceText(rawData);
    expect(parsed.unidad).toEqual({
      declarada: { unidad: 'miles', texto: 'Saldo 2024 (miles de pesos)' },
      confirmada: 'miles',
    });
    const read = preprocessUploadedTrialBalanceText(rawData);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.preprocessed.primary.controlTotals.cents!.activo).toBe(BigInt(57_000_000_000));
  });

  it('XLSX: la directiva vale para todas las hojas y la nota sobrevive a la fusión de códigos repetidos', () => {
    const hoja = (anio: string, v: [number, number, number]) =>
      [
        'Cifras expresadas en miles de pesos colombianos,,,',
        `codigo,nombre,nivel,Saldo ${anio}`,
        `110505,Caja,Auxiliar,${v[0]}`,
        `220505,Proveedores,Auxiliar,${v[1]}`,
        `310505,Capital,Auxiliar,${v[2]}`,
      ].join('\n');
    const blocks =
      `[period=Balance 2024]\n${hoja('2024', [500000, 200000, 300000])}\n[/period]\n\n` +
      `[period=Balance 2025]\n${hoja('2025', [570000, 220000, 350000])}\n[/period]`;
    const read = preprocessUploadedTrialBalanceText(escribirDirectivasIngesta(blocks, { unidadConfirmada: 'miles' }));
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    const { primary, comparative } = read.preprocessed;
    expect(primary.controlTotals.cents!.activo).toBe(BigInt(57_000_000_000));
    expect(comparative!.controlTotals.cents!.activo).toBe(BigInt(50_000_000_000));
    expect(primary.validation.blocking).toBe(false);
    expect(primary.validation.adjustments.some((a) => /reexpresadas de miles de pesos a pesos/.test(a))).toBe(true);
  });

  it('Stage 0 del orquestador (el que usan /consolidate y la ruta legacy) lee la directiva: sin 422 y totales en pesos', async () => {
    const rawData = escribirDirectivasIngesta(CSV_MILES, { unidadConfirmada: 'miles' });
    const ctx = await prepareFinancialContext({ rawData, company: COMPANY, language: 'es' });
    expect(ctx.bindingTotalsBlock).toMatch(/570\.000\.000/);
    const sinConfirmar = await prepareFinancialContext({ rawData: CSV_MILES, company: COMPANY, language: 'es' }).then(
      () => null,
      (e: unknown) => (e instanceof BalanceValidationError ? e.reasons : null),
    );
    expect(sinConfirmar?.some((r) => /miles de pesos/.test(r))).toBe(true);
  });

  it('el texto con el informe antepuesto (`extractedText` del upload) lee la directiva igual que `rawData`', () => {
    // /api/upload deja la directiva DESPUÉS de "DATOS ORIGINALES:". Stage 0
    // recortaba el informe y la leía; /niif, /export y la ruta legacy parsean
    // el texto completo y la ignoraban: bloqueaban por la unidad ya
    // confirmada y el mismo balance tenía dos lecturas según la superficie.
    const rawData = escribirDirectivasIngesta(CSV_MILES, { unidadConfirmada: 'miles' });
    const base = preprocessUploadedTrialBalanceText(rawData);
    expect(base.kind).toBe('ok');
    if (base.kind !== 'ok') return;
    const extractedText = `${base.preprocessed.validationReport}\n\n---\n\nDATOS ORIGINALES:\n${rawData}`;

    const read = preprocessUploadedTrialBalanceText(extractedText);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.preprocessed.primary.controlTotals.cents!.activo).toBe(BigInt(57_000_000_000));
    expect(read.preprocessed.primary.validation.blocking).toBe(false);
    expect(parseUploadedTrialBalanceText(extractedText).unidad.confirmada).toBe('miles');

    // Una confirmación de la solicitud que contradice la del texto es 422
    // también en ese formato; si coincide, se aplica una sola vez.
    expect(() => incorporarConfirmaciones(extractedText, { unidadConfirmada: 'millones' })).toThrow(
      TrialBalanceIngestError,
    );
    const conCampo = incorporarConfirmaciones(extractedText, { unidadConfirmada: 'miles' });
    const again = parseUploadedTrialBalanceText(conCampo);
    expect(again.rows.find((r) => r.code === '110505')!.balancesByPeriod['2025']).toBe(570000000);
  });

  it('una opción explícita que contradice la directiva del texto es un conflicto (422), no se elige en silencio', () => {
    const rawData = escribirDirectivasIngesta(CSV_MILES, { unidadConfirmada: 'miles' });
    expect(() => parseUploadedTrialBalanceText(rawData, { unidadConfirmada: 'millones' })).toThrow(
      TrialBalanceIngestError,
    );
    // Coincidentes: se aplica una sola vez.
    const ok = parseUploadedTrialBalanceText(rawData, { unidadConfirmada: 'miles' });
    expect(ok.rows.find((r) => r.code === '110505')!.balancesByPeriod['2025']).toBe(570000000);
  });

  it('una directiva mal formada es un motivo de ingesta explícito', () => {
    expect(() => parseUploadedTrialBalanceText(`[unidad-confirmada=docenas]\n${CSV_MILES}`)).toThrow(
      /Directiva de unidad inválida/,
    );
  });

  it('sin leyenda ni confirmación: cifras idénticas a hoy (no regresión)', () => {
    const csv = ['codigo,nombre,nivel,Saldo 2024,Saldo 2025', ...CUERPO].join('\n');
    const antes = preprocessTrialBalance(parseTrialBalanceCSVWithMeta(csv).rows).primary;
    expect(antes.controlTotals.cents!.activo).toBe(BigInt(57_000_000));
    expect(antes.validation.adjustments.some((a) => /reexpresad/.test(a))).toBe(false);
  });

  it('la nota "cifras reexpresadas … por confirmación del usuario" llega al anexo del informe PDF', () => {
    const pre = pp(CSV_MILES, 'miles');
    const doc = composeEditorialReport({
      report: makeExportableReport(),
      preprocessed: pre,
      pillars: null,
      language: 'es',
    });
    const avisos = doc.appendix.validationWarnings ?? [];
    expect(avisos.some((w) => /cifras reexpresadas de miles de pesos a pesos .*por confirmación del usuario/.test(w))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// recalculo-final2-02 / ICU-02 — con la unidad confirmada, un importe con un
// único separador seguido de EXACTAMENTE 3 cifras ('848,123') se leía como
// agrupación de miles y quedaba × 1.000 en silencio (el balance podía cuadrar
// y publicarse). En miles, 3 decimales son la precisión al peso: el separador
// decimal se decide por archivo (celdas con los dos separadores, grupos
// repetidos, fracciones de otra longitud; si no hay, ';' ⇒ coma decimal) y, sin
// evidencia, el importe es ambiguo y bloquea con motivo. En pesos sin unidad
// '1.234' sigue siendo mil doscientos treinta y cuatro.
// ---------------------------------------------------------------------------
describe('unidad confirmada: importes con 3 decimales (recalculo-final2-02 / ICU-02)', () => {
  const saldos = (csv: string, unidad: 'miles' | 'millones', periodo = '2025') =>
    Object.fromEntries(
      parseTrialBalanceCSVWithMeta(csv, { unidadConfirmada: unidad }).rows.map((r) => [r.code, r.balancesByPeriod[periodo]]),
    );
  const U4 = [
    'codigo;nombre;nivel;saldo 2024 (miles de pesos);saldo 2025 (miles de pesos)',
    '110505;Caja general;Auxiliar;20000;30000',
    '111005;Bancos cuenta corriente;Auxiliar;848,123;848,123',
    '220505;Proveedores nacionales;Auxiliar;10000;20000',
    '238095;Otras cuentas por pagar;Auxiliar;848,123;848,123',
    '311505;Capital suscrito y pagado;Auxiliar;10000;10000',
  ].join('\n');

  it("CSV con ';' y sin otra evidencia: coma decimal ('848,123' miles = $848.123)", () => {
    const s = saldos(U4, 'miles');
    expect(s['111005']).toBe(848_123);
    expect(s['238095']).toBe(848_123);
    expect(s['110505']).toBe(30_000_000);
    const p = preprocessTrialBalance(parseTrialBalanceCSVWithMeta(U4, { unidadConfirmada: 'miles' }).rows).primary;
    expect(p.controlTotals.cents!.activo).toBe(BigInt(3_084_812_300)); // $30.848.123,00
    expect(p.validation.blocking).toBe(false);
  });

  it("millones con coma decimal en otra celda ('5,5'): '848,123' millones = $848.123.000", () => {
    const csv = U4.replace(/miles de pesos/g, 'millones de pesos').replace('10000;10000', '10000;10000').replace(
      '110505;Caja general;Auxiliar;20000;30000',
      '110505;Caja general;Auxiliar;20000;5,5',
    );
    const s = saldos(csv, 'millones');
    expect(s['110505']).toBe(5_500_000);
    expect(s['111005']).toBe(848_123_000);
  });

  it("es-CO con ambos separadores en otra celda ('1.000,152'): '232,848' = $232.848 y el balance cuadra", () => {
    // A = 232,848 + 1.000,152 + 767,000 = 2.000,000 miles = P 500,000 + K 1.500,000.
    const csv = [
      'codigo;nombre;Saldo 2025 (miles de pesos)',
      '11050501;Caja;232,848',
      '11100501;Bancos;1.000,152',
      '15200101;PPE;767,000',
      '22050101;Proveedores;500,000',
      '31050501;Capital;1.500,000',
    ].join('\n');
    const s = saldos(csv, 'miles');
    expect(s['11050501']).toBe(232_848);
    expect(s['11100501']).toBe(1_000_152);
    expect(s['15200101']).toBe(767_000);
    const p = preprocessTrialBalance(parseTrialBalanceCSVWithMeta(csv, { unidadConfirmada: 'miles' }).rows).primary;
    expect(p.controlTotals.cents!.activo).toBe(BigInt(200_000_000));
    expect(p.validation.blocking).toBe(false);
  });

  it("la lectura errónea que cuadraba ('500,000' en caja y proveedores) ya no infla el activo", () => {
    const csv = [
      'codigo;nombre;Saldo 2025 (miles de pesos)',
      '11050501;Caja;500,000',
      '15200101;PPE;1.000,000',
      '22050101;Proveedores;500,000',
      '31050501;Capital;1.000,000',
    ].join('\n');
    const p = preprocessTrialBalance(parseTrialBalanceCSVWithMeta(csv, { unidadConfirmada: 'miles' }).rows).primary;
    expect(p.controlTotals.activo).toBe(1_500_000);
  });

  it("grupos de miles repetidos ('1.234.567') fijan la coma como decimal y '848.123' como miles", () => {
    const csv = [
      'codigo,nombre,Saldo 2025 (miles de pesos)',
      '110505,Caja,1.234.567',
      '111005,Bancos,848.123',
      '310505,Capital,2.082.690',
    ].join('\n');
    const s = saldos(csv, 'miles');
    expect(s['111005']).toBe(848_123_000);
    expect(s['110505']).toBe(1_234_567_000);
  });

  it("sin evidencia del separador (',' como separador de campos y '848.123'): importe ambiguo → motivo bloqueante, nunca × 1.000 en silencio", () => {
    const csv = [
      'codigo,nombre,saldo 2025',
      'Cifras en miles de pesos,,',
      '110505,Caja general,30000',
      '111005,Bancos cuenta corriente,848.123',
      '238095,Otras cuentas por pagar,848.123',
      '311505,Capital,30000',
    ].join('\n');
    const meta = parseTrialBalanceCSVWithMeta(csv, { unidadConfirmada: 'miles' });
    const p = preprocessTrialBalance(meta.rows).primary;
    expect(p.validation.blocking).toBe(true);
    expect(p.validation.reasons.join(' ')).toMatch(/Cuenta 111005: el saldo "848\.123".*ambiguo.*miles/);
    expect(p.controlTotals.activo).not.toBe(1_006_123_000 + 30_000_000);
  });

  it('en pesos sin unidad la regla morfológica no cambia: "1.234" = 1.234', () => {
    const csv = ['codigo;nombre;Saldo 2025', '110505;Caja;1.234', '310505;Capital;1.234'].join('\n');
    const meta = parseTrialBalanceCSVWithMeta(csv);
    expect(meta.rows[0].balancesByPeriod['2025']).toBe(1234);
  });

  it("API v1 csv con unit='miles' lee lo mismo que el upload", async () => {
    const { buildRawRowsFromInput } = await import('@/lib/api/trial-balances');
    const built = buildRawRowsFromInput({ csv: U4, period_label: '2025', unit: 'miles' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const byCode = Object.fromEntries(built.rows.map((r) => [r.code, r.balancesByPeriod['2025']]));
    expect(byCode['111005']).toBe(848_123);
  });
});
