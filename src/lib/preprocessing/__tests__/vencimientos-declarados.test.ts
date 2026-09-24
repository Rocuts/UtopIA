// ---------------------------------------------------------------------------
// P4 (b) — pendiente #4 de la auditoría integral 2026-09-24: excepciones de
// vencimiento por cuenta (`maturityOverrides`).
//
// La clasificación corriente / no corriente sigue siendo por grupo PUC
// (supuesto revelado, niif-preproceso-21). El usuario puede declarar el
// vencimiento real de una cuenta; la excepción se aplica de forma determinista
// (el código más específico prevalece), sobrevive al Curator (R1 y R8
// recalculan por grupo) y se revela con su monto. Sin excepciones, las cifras
// son idénticas a las de hoy.
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';

import { escribirDirectivasIngesta } from '@/lib/upload/ingest-directives';
import {
  parseUploadedTrialBalanceText,
  preprocessUploadedTrialBalanceText,
  TrialBalanceIngestError,
} from '../raw-data';
import {
  aplicarVencimientosDeclarados,
  CLASIFICACION_CORRIENTE_SUPUESTA,
  parseTrialBalanceCSVWithMeta,
  preprocessTrialBalance,
  type RawAccountRow,
} from '../trial-balance';

// A 390.000 = P 150.000 + K 200.000 + resultado 40.000 (R8 traslada a 3605VC).
const CSV = [
  'codigo,nombre,nivel,Saldo 2025',
  '110505,Caja,Auxiliar,140000',
  '120505,CDT a 18 meses,Auxiliar,30000',
  '120510,Acciones negociables,Auxiliar,20000',
  '152405,Equipo de oficina,Auxiliar,200000',
  '210505,Crédito bancario a 3 años,Auxiliar,80000',
  '220505,Proveedores,Auxiliar,70000',
  '310505,Capital,Auxiliar,200000',
  '413505,Ventas,Auxiliar,100000',
  '510506,Sueldos,Auxiliar,60000',
].join('\n');

const rowsOf = (csv: string): RawAccountRow[] => parseTrialBalanceCSVWithMeta(csv).rows;

describe('P4 (b) — excepciones de vencimiento declaradas por el usuario', () => {
  it('sin excepciones: clasificación por grupo PUC idéntica a hoy (no regresión)', () => {
    const base = preprocessTrialBalance(rowsOf(CSV)).primary;
    const sinMapa = preprocessTrialBalance(aplicarVencimientosDeclarados(rowsOf(CSV), null).rows).primary;
    const mapaVacio = preprocessTrialBalance(aplicarVencimientosDeclarados(rowsOf(CSV), {}).rows).primary;
    for (const s of [base, sinMapa, mapaVacio]) {
      expect(s.controlTotals.activoCorriente).toBe(190000);
      expect(s.controlTotals.activoNoCorriente).toBe(200000);
      expect(s.controlTotals.pasivoCorriente).toBe(150000);
      expect(s.controlTotals.pasivoNoCorriente).toBe(0);
      expect(s.controlTotals.clasificacionSupuesta).toBe(CLASIFICACION_CORRIENTE_SUPUESTA);
      expect(s.vencimientosAplicados).toBeUndefined();
      expect(s.validation.adjustments.some((a) => /vencimiento/.test(a))).toBe(false);
    }
    expect(sinMapa.controlTotals).toEqual(base.controlTotals);
    expect(mapaVacio.controlTotals).toEqual(base.controlTotals);
  });

  it('1205 → no corriente y 2105 → no corriente: saldos trasladados, KPIs de liquidez recalculados y revelados', () => {
    const { rows, errores } = aplicarVencimientosDeclarados(rowsOf(CSV), {
      '1205': 'no_corriente',
      '2105': 'no_corriente',
    });
    expect(errores).toEqual([]);
    const s = preprocessTrialBalance(rows).primary;
    // R8 actuó (hay P&G) y aun así la excepción se conserva.
    expect(s.virtualCloseAdjustment).toBeDefined();
    const ct = s.controlTotals;
    expect(ct.activoCorriente).toBe(140000);
    expect(ct.activoNoCorriente).toBe(250000);
    expect(ct.pasivoCorriente).toBe(70000);
    expect(ct.pasivoNoCorriente).toBe(80000);
    // Totales de sección intactos.
    expect(ct.activo).toBe(390000);
    expect(ct.pasivo).toBe(150000);
    expect(ct.razonCorriente).toBeCloseTo(2, 10);
    expect(ct.capitalTrabajo).toBe(70000);
    expect(s.vencimientosAplicados).toEqual([
      { codigo: '120505', seccion: 'activo', vencimiento: 'no_corriente', saldo: 30000 },
      { codigo: '120510', seccion: 'activo', vencimiento: 'no_corriente', saldo: 20000 },
      { codigo: '210505', seccion: 'pasivo', vencimiento: 'no_corriente', saldo: 80000 },
    ]);
    expect(ct.clasificacionSupuesta).toContain(CLASIFICACION_CORRIENTE_SUPUESTA);
    expect(ct.clasificacionSupuesta).toMatch(/DECLARADAS por el usuario/);
    expect(ct.clasificacionSupuesta).toMatch(/210505 \(pasivo\) → no corriente \$80\.000/);
    // Nota de ingesta visible en el informe de validación.
    expect(s.validation.adjustments.some((a) => /excepciones de vencimiento declaradas por el usuario/.test(a))).toBe(true);
  });

  it('el código más específico prevalece (12 → no corriente, 120510 → corriente)', () => {
    const { rows } = aplicarVencimientosDeclarados(rowsOf(CSV), { '12': 'no_corriente', '120510': 'corriente' });
    expect(rows.find((r) => r.code === '120505')!.vencimiento).toBe('no_corriente');
    expect(rows.find((r) => r.code === '120510')!.vencimiento).toBe('corriente');
    const ct = preprocessTrialBalance(rows).primary.controlTotals;
    // Sólo 120505 se traslada: 120510 declarada corriente ya lo era por grupo.
    expect(ct.activoCorriente).toBe(160000);
    expect(ct.activoNoCorriente).toBe(230000);
  });

  it('una excepción igual a la del grupo no mueve saldo; un código sin cuentas se revela', () => {
    const { rows, sinCuentas } = aplicarVencimientosDeclarados(rowsOf(CSV), {
      '1105': 'corriente',
      '2705': 'corriente',
    });
    expect(sinCuentas).toEqual(['2705']);
    const s = preprocessTrialBalance(rows).primary;
    expect(s.controlTotals.activoCorriente).toBe(190000);
    expect(s.vencimientosAplicados).toBeUndefined();
    expect(s.validation.adjustments.some((a) => /Sin cuentas en el balance: 2705/.test(a))).toBe(true);
  });

  it('códigos fuera de las clases 1 y 2 o plazos desconocidos son errores explícitos', () => {
    expect(aplicarVencimientosDeclarados(rowsOf(CSV), { '4135': 'corriente' }).errores[0]).toMatch(
      /no es de activo \(clase 1\) ni de pasivo \(clase 2\)/,
    );
    expect(
      aplicarVencimientosDeclarados(rowsOf(CSV), { '1205': 'largo' as unknown as 'corriente' }).errores[0],
    ).toMatch(/use corriente o no_corriente/);
  });

  it('el balance con R1 (activo con saldo crédito): la virtual sigue la excepción de su cuenta de origen', () => {
    // 133005 (anticipo a proveedores) con saldo crédito material: R1 lo
    // reclasifica a pasivo con una virtual `…ZZ-133005` / `…VC-133005`.
    const csv = [
      'codigo,nombre,nivel,Saldo 2025',
      '110505,Caja,Auxiliar,500000',
      '133005,Anticipos,Auxiliar,-100000',
      '220505,Proveedores,Auxiliar,100000',
      '310505,Capital,Auxiliar,300000',
    ].join('\n');
    const base = preprocessTrialBalance(rowsOf(csv)).primary;
    const virtual = base.classes
      .find((c) => c.code === 2)!
      .accounts.find((a) => a.code.endsWith('-133005'));
    expect(virtual).toBeDefined();
    expect(base.controlTotals.pasivoCorriente).toBe(200000);

    const { rows } = aplicarVencimientosDeclarados(rowsOf(csv), { '1330': 'no_corriente' });
    const s = preprocessTrialBalance(rows).primary;
    expect(s.controlTotals.pasivoCorriente).toBe(100000);
    expect(s.controlTotals.pasivoNoCorriente).toBe(100000);
    expect(s.vencimientosAplicados?.map((a) => a.codigo)).toEqual([virtual!.code]);
  });

  it('la directiva en rawData llega al helper compartido (upload, /niif, Stage 0, /export) y a las opciones', () => {
    const rawData = escribirDirectivasIngesta(CSV, { vencimientos: { '2105': 'no_corriente' } });
    expect(rawData.split('\n')[0]).toBe('[vencimientos=2105:no_corriente]');
    const read = preprocessUploadedTrialBalanceText(rawData);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.preprocessed.primary.controlTotals.pasivoNoCorriente).toBe(80000);

    const porOpcion = parseUploadedTrialBalanceText(CSV, { vencimientos: { '2105': 'no_corriente' } });
    expect(porOpcion.vencimientos).toEqual({ '2105': 'no_corriente' });
    expect(porOpcion.rows.find((r) => r.code === '210505')!.vencimiento).toBe('no_corriente');
  });

  it('directiva y opción contradictorias o un código inválido: motivo de ingesta (422), nunca se elige en silencio', () => {
    const rawData = escribirDirectivasIngesta(CSV, { vencimientos: { '2105': 'no_corriente' } });
    expect(() => parseUploadedTrialBalanceText(rawData, { vencimientos: { '2105': 'corriente' } })).toThrow(
      TrialBalanceIngestError,
    );
    const invalida = preprocessUploadedTrialBalanceText(`[vencimientos=4135:corriente]\n${CSV}`);
    expect(invalida.kind).toBe('rejected');
    if (invalida.kind === 'rejected') expect(invalida.reasons[0]).toMatch(/4135/);
  });

  it('escribirDirectivasIngesta es idempotente y ordena las excepciones', () => {
    const una = escribirDirectivasIngesta(CSV, {
      unidadConfirmada: 'miles',
      vencimientos: { '2105': 'no_corriente', '1205': 'no_corriente' },
    });
    const dos = escribirDirectivasIngesta(una, {});
    expect(dos).toBe(una);
    expect(una.split('\n').slice(0, 2)).toEqual([
      '[unidad-confirmada=miles]',
      '[vencimientos=1205:no_corriente;2105:no_corriente]',
    ]);
    // Quitar la unidad conserva las excepciones y el cuerpo.
    const sinUnidad = escribirDirectivasIngesta(una, { unidadConfirmada: null });
    expect(sinUnidad.split('\n')[0]).toBe('[vencimientos=1205:no_corriente;2105:no_corriente]');
    expect(sinUnidad.endsWith(CSV)).toBe(true);
  });
});
