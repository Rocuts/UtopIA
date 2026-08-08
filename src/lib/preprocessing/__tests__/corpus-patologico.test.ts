// ---------------------------------------------------------------------------
// Corpus de balances PATOLÓGICOS
// ---------------------------------------------------------------------------
// La auditoría integral 2026-08 encontró que los fixtures del repo se diseñaron
// para hacer pasar reglas, no para representar contabilidad real: ningún fixture
// de validador tenía líneas (`assets: []`), y el único balance de producción se
// probaba con aserciones envueltas en un `if`, así que pasaba aunque la regla no
// se disparara.
//
// Este corpus cubre los casos que un contador colombiano ve todas las semanas y
// que el pipeline nunca ejercitó:
//
//   · pérdida del ejercicio + patrimonio negativo (causal del Art. 459 C.Co.)
//   · sin periodo comparativo (modo LÍNEA BASE)
//   · convención algebraica frente a su gemelo en convención natural
//   · cifras por encima de 2^53 centavos (donde `number` deja de ser exacto)
//   · balance descuadrado en origen (el gate DEBE bloquearlo)
//   · cuentas de orden fuera del PUC 1..7
//
// Cada aserción es incondicional a propósito: un test que se auto-desactiva con
// un `if` no es un test.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
} from '@/lib/preprocessing/trial-balance';
import { detectSignConvention } from '@/lib/preprocessing/sign-convention';
import { buildReportAnchors } from '@/lib/agents/financial/contracts/anchors';

const DIR = path.resolve(process.cwd(), 'src/lib/preprocessing/__fixtures__/patologicos');

function load(name: string) {
  return fs.readFileSync(path.join(DIR, `${name}.csv`), 'utf8');
}

function preprocess(name: string) {
  return preprocessTrialBalance(parseTrialBalanceCSV(load(name)));
}

describe('Patológico — pérdida del ejercicio y patrimonio negativo', () => {
  it('preserva el signo de la pérdida y del patrimonio en las anclas', () => {
    const pp = preprocess('perdida-y-patrimonio-negativo');
    const a = buildReportAnchors(pp.primary, pp.comparative ?? undefined).primary!;

    // Patrimonio negativo: la sociedad está en causal de disolución del
    // Art. 459 C.Co. Si el signo se pierde, el informe dice lo contrario de
    // lo que dice la contabilidad.
    expect(a.cents.patrimonio!).toBeLessThan(BigInt(0));
    expect(a.cents.utilidadNeta!).toBeLessThan(BigInt(0));
    expect(a.cents.activo!).toBeGreaterThan(BigInt(0));
  });

  it('la ecuación patrimonial cierra al centavo pese al patrimonio negativo', () => {
    const pp = preprocess('perdida-y-patrimonio-negativo');
    const { activo, pasivo, patrimonio } = pp.primary.controlTotals;
    expect(activo - pasivo - patrimonio).toBeCloseTo(0, 2);
  });

  it('la depreciación acumulada NO se reclasifica a pasivo (correctora de activo)', () => {
    // Regresión del P0 `r1-reclasifica-cuentas-correctoras`: R1 trataba la
    // 1592 como anomalía y la movía a Clase 2, inflando Activo y Pasivo por
    // el mismo monto y presentando PPE bruto.
    const pp = preprocess('perdida-y-patrimonio-negativo');
    const clase2 = pp.primary.classes.find((c) => c.accounts?.[0]?.code?.startsWith('2'));
    const virtuales = (clase2?.accounts ?? []).filter((a) => a.code.includes('159205'));
    expect(virtuales).toHaveLength(0);
  });
});

describe('Patológico — sin periodo comparativo', () => {
  it('produce un solo periodo y marca los comparativos como impracticables', () => {
    const pp = preprocess('sin-comparativo');
    expect(pp.periods).toHaveLength(1);
    expect(pp.comparative).toBeNull();
    expect(pp.comparativos_impracticables).toBe(true);
  });

  it('las anclas comparativas quedan nulas, no en cero', () => {
    // Un cero es una cifra; la ausencia de comparativo no lo es. Confundirlos
    // hace que el informe presente una columna de ceros como si el año
    // anterior hubiera existido y no tuviera movimiento.
    const pp = preprocess('sin-comparativo');
    expect(buildReportAnchors(pp.primary, pp.comparative ?? undefined).comparative).toBeNull();
  });
});

describe('Patológico — convención algebraica frente a su gemelo natural', () => {
  it('detecta cada archivo con su convención', () => {
    expect(
      detectSignConvention(
        parseTrialBalanceCSV(load('sin-comparativo'), { normalizeSignConvention: false }),
      ).convention,
    ).toBe('natural');
    expect(
      detectSignConvention(
        parseTrialBalanceCSV(load('signos-algebraicos'), { normalizeSignConvention: false }),
      ).convention,
    ).toBe('algebraica');
  });

  it('ambos archivos producen ANCLAS IDÉNTICAS al centavo', () => {
    // Es la prueba de fondo de la normalización: el mismo balance expresado en
    // las dos convenciones tiene que producir el mismo informe. `sin-comparativo`
    // y `signos-algebraicos` contienen exactamente las mismas cuentas y montos.
    const natural = buildReportAnchors(preprocess('sin-comparativo').primary, undefined).primary!;
    const algebraica = buildReportAnchors(
      preprocess('signos-algebraicos').primary,
      undefined,
    ).primary!;

    for (const key of ['activo', 'pasivo', 'patrimonio', 'ingresos', 'utilidadNeta'] as const) {
      expect(algebraica.cents[key], `ancla ${key} difiere entre convenciones`).toBe(
        natural.cents[key],
      );
    }
  });
});

describe('Patológico — cifras por encima de 2^53 centavos', () => {
  it('las anclas conservan precisión exacta donde `number` ya no la tiene', () => {
    // 2^53 centavos = $90.071.992.547.409,92. Los grupos económicos grandes de
    // Colombia superan ese activo, y ahí `number` deja de representar cada
    // centavo. Las anclas viajan en BigInt justamente por esto.
    const pp = preprocess('cifras-mayores-2e53');
    const a = buildReportAnchors(pp.primary, undefined).primary!;

    expect(a.cents.activo!).toBe(BigInt('30000000000000000'));
    expect(a.cents.activo!).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    // La representación en centavos NO pasa por un `number` intermedio.
    expect(a.cents.activo!.toString()).not.toContain('e');
  });
});

describe('Patológico — balance descuadrado en origen', () => {
  it('el descuadre queda registrado y no se disimula', () => {
    const pp = preprocess('descuadrado-en-origen');
    const { activo, pasivo, patrimonio } = pp.primary.controlTotals;
    // Activo 350M · Pasivo 120M · Patrimonio 70M ⇒ faltan 160M.
    expect(activo).toBeCloseTo(350_000_000, 2);
    // Sin actividad de resultados R8 no corre (sale temprano por
    // `hasPnLActivity === false`), así que NADIE tapa el hueco: la ecuación
    // queda abierta y `validation.blocking` lo refleja. Es el comportamiento
    // correcto — el balance de verdad no cuadra y no debe producir informe.
    expect(pasivo + patrimonio).toBeCloseTo(190_000_000, 2);
    expect(pp.primary.summary.equationBalanced).toBe(false);
    expect(Math.abs(pp.primary.summary.equationBalance)).toBeCloseTo(160_000_000, 2);
    expect(pp.primary.validation.blocking).toBe(true);
  });
});

describe('Patológico — cuentas de orden fuera del PUC 1..7', () => {
  it('las clases 9x no contaminan ninguna ancla', () => {
    // Las cuentas de orden (8x deudoras, 9x acreedoras) no son activo, pasivo
    // ni patrimonio. Si se colaran, inflarían el balance por partida doble
    // fantasma y la ecuación seguiría cerrando.
    const pp = preprocess('cuentas-sin-clasificar');
    const a = buildReportAnchors(pp.primary, undefined).primary!;

    expect(a.cents.activo!).toBe(BigInt(200_000_000_00)); // 50M + 150M
    expect(a.cents.pasivo!).toBe(BigInt(80_000_000_00));
    expect(a.cents.patrimonio!).toBe(BigInt(120_000_000_00));
  });
});

describe('Patológico — CSV del conector ERP (Siigo / Odoo)', () => {
  // `src/lib/erp/pipeline.ts:47-54` emite el header
  // `codigo,cuenta,debitos,creditos,saldo`, y los conectores calculan
  // `balance = debit - credit` para TODA clase (siigo.ts:238, odoo.ts:385), es
  // decir convención ALGEBRAICA. La columna `saldo` hace que
  // `isBalanceHeader` acierte, y con ello la rama de normalización por
  // naturaleza PUC del parser queda inalcanzable. Es el camino de mayor volumen
  // en producción y llegaba con Pasivo e Ingresos negativos.
  const ERP_CSV = [
    'codigo,cuenta,debitos,creditos,saldo',
    '110505,Caja general,18000000,0,18000000',
    '111005,Bancos,142000000,0,142000000',
    '130505,Clientes nacionales,260000000,0,260000000',
    '143505,Mercancias,380000000,0,380000000',
    '220505,Proveedores nacionales,0,310000000,-310000000',
    '240805,IVA por pagar,0,44000000,-44000000',
    '240405,Impuesto de renta,0,63000000,-63000000',
    '310505,Capital suscrito y pagado,0,150000000,-150000000',
    '330505,Reserva legal,0,26000000,-26000000',
    '370505,Resultados de ejercicios anteriores,0,20000000,-20000000',
    '413550,Comercio al por mayor,0,1240000000,-1240000000',
    '613550,Costo de venta de mercancias,760000000,0,760000000',
    '510506,Sueldos de personal administrativo,158000000,0,158000000',
    '529505,Gastos de venta comisiones,72000000,0,72000000',
    '540505,Impuesto de renta y complementarios,63000000,0,63000000',
  ].join('\n');

  it('detecta la convención algebraica del conector', () => {
    expect(
      detectSignConvention(parseTrialBalanceCSV(ERP_CSV, { normalizeSignConvention: false }))
        .convention,
    ).toBe('algebraica');
  });

  it('el Pasivo y los Ingresos llegan como magnitudes, no en negativo', () => {
    const antes = preprocessTrialBalance(
      parseTrialBalanceCSV(ERP_CSV, { normalizeSignConvention: false }),
    ).primary.controlTotals;
    expect(antes.pasivo).toBeLessThan(0); // el defecto
    expect(antes.ingresos).toBeLessThan(0);

    const ct = preprocessTrialBalance(parseTrialBalanceCSV(ERP_CSV)).primary.controlTotals;
    expect(ct.pasivo).toBeCloseTo(417_000_000, 2);
    expect(ct.ingresos).toBeCloseTo(1_240_000_000, 2);
    expect(ct.activo).toBeCloseTo(800_000_000, 2);
  });
});
