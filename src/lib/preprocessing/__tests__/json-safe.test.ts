// ---------------------------------------------------------------------------
// Regresión producción — serialización JSON de PreprocessedBalance.
//
// Bug original (fix/production-ready): `controlTotals.cents` viaja en BigInt
// y `JSON.stringify` desnudo lanzaba `TypeError: Do not know how to serialize
// a BigInt` en (a) el evento SSE `niif_phase` de /api/financial-report/niif y
// (b) la respuesta JSON de /api/upload — es decir, el CAMINO FELIZ del
// pipeline 1+1 con cualquier balance real. Los tests de ruta no lo veían
// porque mockeaban `preprocessTrialBalance → undefined`. Este test usa el
// preprocesador REAL.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  bigintReplacer,
  revivePreprocessedBalance,
  toJsonSafe,
} from '../json-safe';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '../trial-balance';

function buildRealPreprocessed() {
  const csv = [
    'codigo,nombre,nivel,saldo 2025',
    '1,Activos,Clase,200000000',
    '11,Disponible,Grupo,50000000',
    '110505,Caja,Auxiliar,50000000',
    '13,Deudores,Grupo,40000000',
    '130505,Clientes,Auxiliar,40000000',
    '14,Inventarios,Grupo,60000000',
    '143505,Mercancías,Auxiliar,60000000',
    '15,PPE,Grupo,50000000',
    '152405,Equipo oficina,Auxiliar,50000000',
    '2,Pasivos,Clase,80000000',
    '22,Proveedores,Grupo,30000000',
    '220505,Proveedores nacionales,Auxiliar,30000000',
    '23,Cxp,Grupo,30000000',
    '230505,Cxp comerciales,Auxiliar,30000000',
    '24,Impuestos,Grupo,20000000',
    '240405,Renta,Auxiliar,20000000',
    '3,Patrimonio,Clase,120000000',
    '311505,Capital suscrito,Auxiliar,100000000',
    '4,Ingresos,Clase,210000000',
    '410505,Ventas,Auxiliar,200000000',
    '417505,Devoluciones rebajas,Auxiliar,10000000',
    '5,Gastos,Clase,30000000',
    '510505,Sueldos,Auxiliar,20000000',
    '530505,Intereses,Auxiliar,10000000',
    '6,Costos,Clase,150000000',
    '613505,CMV,Auxiliar,150000000',
  ].join('\n');

  return preprocessTrialBalance(parseTrialBalanceCSV(csv));
}

describe('json-safe — regresión BigInt en el camino feliz del pipeline', () => {
  it('el preprocesador real produce BigInt que rompe JSON.stringify desnudo (precondición del bug)', () => {
    const pp = buildRealPreprocessed();
    expect(typeof pp.primary.controlTotals.cents?.activo).toBe('bigint');
    expect(() => JSON.stringify(pp)).toThrow();
  });

  it('toJsonSafe hace el payload serializable sin perder los valores', () => {
    const pp = buildRealPreprocessed();
    const safe = toJsonSafe(pp);
    const json = JSON.stringify(safe);
    expect(json.length).toBeGreaterThan(100);
    const parsed = JSON.parse(json);
    expect(parsed.primary.controlTotals.cents.activo).toBe(
      pp.primary.controlTotals.cents!.activo.toString(),
    );
  });

  it('bigintReplacer permite JSON.stringify directo (camino SSE)', () => {
    const pp = buildRealPreprocessed();
    expect(() => JSON.stringify({ context: { preprocessed: pp } }, bigintReplacer)).not.toThrow();
  });

  it('round-trip completo restaura los BigInt con precisión exacta (intake /strategy /governance)', () => {
    const pp = buildRealPreprocessed();
    const wire = JSON.parse(JSON.stringify(toJsonSafe(pp)));
    const revived = revivePreprocessedBalance(wire);

    expect(revived).not.toBeNull();
    expect(typeof revived!.primary.controlTotals.cents?.activo).toBe('bigint');
    expect(revived!.primary.controlTotals.cents!.activo).toBe(
      pp.primary.controlTotals.cents!.activo,
    );
    expect(revived!.primary.controlTotals.cents!.utilidadNeta).toBe(
      pp.primary.controlTotals.cents!.utilidadNeta,
    );
    // periods[] también revive (primary/comparative son copias tras el wire).
    const last = revived!.periods[revived!.periods.length - 1];
    expect(typeof last.controlTotals.cents?.activo).toBe('bigint');
  });

  it('rechaza shapes inválidos con null (la ruta responde 400, nunca TypeError 500)', () => {
    expect(revivePreprocessedBalance(null)).toBeNull();
    expect(revivePreprocessedBalance({})).toBeNull();
    expect(revivePreprocessedBalance([])).toBeNull();
    expect(revivePreprocessedBalance({ primary: {} })).toBeNull();
    expect(revivePreprocessedBalance({ primary: { period: '2025' }, periods: [] })).toBeNull();
    expect(revivePreprocessedBalance('preprocessed')).toBeNull();
  });

  it('tolera saldo_invertido_centavos corrupto sin lanzar (cae a 0n)', () => {
    const pp = buildRealPreprocessed();
    const wire = JSON.parse(JSON.stringify(toJsonSafe(pp)));
    wire.reclasificacionesNoCompensacion = [
      { cuenta_origen: '1305', saldo_invertido_centavos: 'garbage', cuenta_destino_pasivo: '2895', motivo_norma: 'x' },
    ];
    const revived = revivePreprocessedBalance(wire);
    expect(revived).not.toBeNull();
    expect(revived!.reclasificacionesNoCompensacion[0].saldo_invertido_centavos).toBe(BigInt(0));
  });

  it('cents corrupto se elimina y los consumidores caen al fallback float', () => {
    const pp = buildRealPreprocessed();
    const wire = JSON.parse(JSON.stringify(toJsonSafe(pp)));
    wire.primary.controlTotals.cents = { activo: 'no-numerico', pasivo: {} };
    const revived = revivePreprocessedBalance(wire);
    expect(revived).not.toBeNull();
    expect(revived!.primary.controlTotals.cents).toBeUndefined();
    expect(typeof revived!.primary.controlTotals.activo).toBe('number');
  });
});
