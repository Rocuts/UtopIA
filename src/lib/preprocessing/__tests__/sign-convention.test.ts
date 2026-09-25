// ---------------------------------------------------------------------------
// Convención de signos del balance de prueba — regresión FASE 0 (2026-08-07)
// ---------------------------------------------------------------------------
// Los ERP colombianos exportan el balance de prueba en una de dos convenciones:
//
//   NATURAL     — cada clase se publica como magnitud de su naturaleza: activo,
//                 pasivo, patrimonio, ingresos, gastos y costos, todos positivos.
//   ALGEBRAICA  — partida doble literal: débitos positivos, créditos negativos,
//                 de modo que la suma de TODOS los saldos vale cero.
//
// `parseTrialBalanceCSV` sólo derivaba el signo por naturaleza PUC en la rama de
// columnas débito/crédito separadas (trial-balance.ts:793-799), inalcanzable en
// cuanto el archivo trae cualquier columna que `isBalanceHeader` reconozca. Con
// un export algebraico eso significaba leer Pasivo e Ingresos en NEGATIVO.
//
// Lo que hacía invisible el defecto: R8 (Cierre Virtual) calcula
// `residualGapBeforeCents = activo − pasivo − patrimonio` y lo absorbe ENTERO en
// la cuenta virtual 3710VC, de modo que `A = P + K` vuelve a cuadrar contra sí
// misma. Sobre el único balance de cliente real del repo, ese tapón valía
// $8.773.827.814,43 — el 210% del activo — y la ecuación seguía "cuadrando".
//
// Estos tests fallan contra el parser anterior a la corrección.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type RawAccountRow,
} from '@/lib/preprocessing/trial-balance';
import {
  detectSignConvention,
  normalizeSignConvention,
} from '@/lib/preprocessing/sign-convention';

const FIXTURES = path.resolve(process.cwd(), 'src/lib/preprocessing/__fixtures__');

/** Export ERP real: header en la fila 8, una columna de saldo firmada por año. */
async function loadGrupo2TresCsv(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(FIXTURES, 'grupo-empresarial-2tres-sas.xlsx'));
  const ws = wb.worksheets[0];
  const lines: string[] = [];
  ws.eachRow((row) => {
    const values = row.values as unknown[];
    lines.push(
      values
        .slice(1)
        .map((v) => {
          if (v === null || v === undefined) return '';
          if (typeof v === 'string') return v;
          if (typeof v === 'number') return String(v);
          const o = v as { text?: string; result?: unknown };
          return o.text ?? (o.result !== undefined ? String(o.result) : String(v));
        })
        .join(','),
    );
  });
  return lines.slice(7).join('\n');
}

function loadEliteCsv(): string {
  return fs.readFileSync(path.join(FIXTURES, 'elite-pulido-diamante.csv'), 'utf8');
}

/**
 * Parseo SIN normalizar, para poder comparar el antes y el después dentro del
 * mismo test sin depender de un snapshot congelado.
 */
function parseRaw(csv: string): RawAccountRow[] {
  return parseTrialBalanceCSV(csv, { normalizeSignConvention: false });
}

describe('detectSignConvention', () => {
  it('clasifica como ALGEBRAICA el export ERP real (Grupo Empresarial 2 Tres SAS)', async () => {
    const rows = parseRaw(await loadGrupo2TresCsv());
    const detection = detectSignConvention(rows);

    expect(detection.convention).toBe('algebraica');
    // La firma del defecto: la suma de todos los saldos auxiliares es ~0 por
    // partida doble. Medido: 0,12% del activo en 2025, 0,24% en 2024.
    expect(detection.ratioByPeriod['2025']).toBeLessThan(0.05);
    expect(detection.ratioByPeriod['2024']).toBeLessThan(0.05);
  });

  it('clasifica como NATURAL el fixture canónico', () => {
    const rows = parseRaw(loadEliteCsv());
    const detection = detectSignConvention(rows);

    expect(detection.convention).toBe('natural');
    // En convención natural la suma vale A+P+K+I+G+C — del orden del doble del
    // activo, no cero. Medido: 156% en 2025, 191% en 2024.
    expect(detection.ratioByPeriod['2025']).toBeGreaterThan(1);
    expect(detection.ratioByPeriod['2024']).toBeGreaterThan(1);
  });

  it('mantiene NATURAL un balance material sin actividad de resultados', () => {
    const csv = [
      'codigo,nombre,nivel,transaccional,Saldo 2025',
      '110505,Caja,Auxiliar,1,10000000',
      '220505,Proveedores,Auxiliar,1,6000000',
      '310505,Capital,Auxiliar,1,4000000',
    ].join('\n');
    expect(detectSignConvention(parseRaw(csv)).convention).toBe('natural');
  });

  // -------------------------------------------------------------------------
  // niif-preproceso-11 — partida doble real con saldo en 3605
  // -------------------------------------------------------------------------
  // Excluir el grupo 36 de la suma sólo sirve para el patrón NO de partida
  // doble (3605 duplicado con el P&G). En un export algebraico de partida
  // doble, Σ(todas las hojas) = 0 CON el 36: excluirlo dejaba |3605| y el
  // archivo se leía como natural (pasivo y patrimonio negativos).
  const ALGEBRAICO_PARTIDA_DOBLE = [
    'codigo,nombre,nivel,transaccional,Saldo 2024,Saldo 2025',
    // 2024 = después del cierre (P&G en cero, resultado en 3605)
    // 2025 = antes del cierre (3605 del año previo aún sin trasladar, P&G activo)
    '110505,Caja,Auxiliar,1,1000000000,1300000000',
    '220505,Proveedores,Auxiliar,1,-400000000,-500000000',
    '310505,Capital,Auxiliar,1,-400000000,-400000000',
    '360505,Utilidad del ejercicio,Auxiliar,1,-200000000,-200000000',
    '370505,Utilidades acumuladas,Auxiliar,1,0,0',
    '413505,Ventas,Auxiliar,1,0,-900000000',
    '613505,Costo,Auxiliar,1,0,500000000',
    '513505,Gastos,Auxiliar,1,0,200000000',
  ].join('\n');

  it('detecta ALGEBRAICA una partida doble con 3605 real (año cerrado y utilidad previa)', () => {
    const rows = parseRaw(ALGEBRAICO_PARTIDA_DOBLE);
    for (const p of ['2024', '2025']) {
      expect(rows.reduce((s, r) => s + (r.balancesByPeriod[p] ?? 0), 0)).toBe(0);
    }
    const detection = detectSignConvention(rows);
    expect(detection.convention).toBe('algebraica');
    expect(detection.ratioByPeriod['2024']).toBeLessThan(0.05);
    expect(detection.ratioByPeriod['2025']).toBeLessThan(0.05);

    // Y el preprocesado queda con pasivo y patrimonio positivos y cuadrado.
    const s = preprocessTrialBalance(parseTrialBalanceCSV(ALGEBRAICO_PARTIDA_DOBLE)).primary;
    expect(s.controlTotals.pasivo).toBe(500_000_000);
    expect(s.controlTotals.patrimonio).toBe(800_000_000);
    expect(s.summary.equationBalanced).toBe(true);
  });

  it('empate de votos en multiperiodo: algebraica si las clases 2 y 3 suman negativo en todos', () => {
    // 2024 es partida doble exacta (voto algebraico). 2025 trae un error de
    // captura de 100M (Σ ≠ 0 → voto natural). Clases 2+3 negativas en ambos.
    const csv = [
      'codigo,nombre,nivel,transaccional,Saldo 2024,Saldo 2025',
      '110505,Caja,Auxiliar,1,1000000000,1100000000',
      '220505,Proveedores,Auxiliar,1,-400000000,-400000000',
      '310505,Capital,Auxiliar,1,-600000000,-600000000',
    ].join('\n');
    const detection = detectSignConvention(parseRaw(csv));
    expect(detection.periodsEvaluated).toEqual(['2024', '2025']);
    expect(detection.convention).toBe('algebraica');
  });

  // recalculo-07 (IW2): un export algebraico a nivel Cuenta (4 dígitos), sin
  // columna "Transaccional", no tiene filas de 6+ dígitos. El detector sólo
  // sumaba transaccionales o códigos de longitud ≥ 6, así que no evaluaba
  // ningún periodo y el archivo quedaba como "natural" (pasivo e ingresos
  // negativos). Las filas sumables son las hojas estructurales.
  it('detecta ALGEBRAICA un export a nivel Cuenta (4 dígitos) sin columna transaccional', () => {
    const csv = [
      'codigo,nombre,Saldo 2025',
      '1,Activo,1300000000',
      '11,Disponible,1300000000',
      '1105,Caja,1300000000',
      '2,Pasivo,-500000000',
      '22,Proveedores,-500000000',
      '2205,Proveedores nacionales,-500000000',
      '3,Patrimonio,-600000000',
      '3105,Capital suscrito y pagado,-400000000',
      '3605,Utilidad del ejercicio,-200000000',
      '4135,Comercio al por mayor,-900000000',
      '5135,Servicios,200000000',
      '6135,Costo de ventas,500000000',
    ].join('\n');
    const detection = detectSignConvention(parseRaw(csv));
    expect(detection.periodsEvaluated).toEqual(['2025']);
    expect(detection.convention).toBe('algebraica');

    const s = preprocessTrialBalance(parseTrialBalanceCSV(csv)).primary;
    expect(s.controlTotals.pasivo).toBe(500_000_000);
    // 400M capital + 200M del 3605 anterior (R8 → 3710VC) + 200M del periodo.
    expect(s.controlTotals.patrimonio).toBe(800_000_000);
    expect(s.controlTotals.ingresosNetos).toBe(900_000_000);
    expect(s.summary.equationBalanced).toBe(true);
  });

  it('no evalúa periodos cuyo activo es inmaterial — no toca balances de juguete', () => {
    const csv = [
      'codigo,nombre,nivel,transaccional,Saldo 2025',
      '110505,Caja,Auxiliar,1,1000',
      '220505,Proveedores,Auxiliar,1,-600',
      '310505,Capital,Auxiliar,1,-400',
    ].join('\n');
    const detection = detectSignConvention(parseRaw(csv));
    expect(detection.periodsEvaluated).toEqual([]);
    expect(detection.convention).toBe('natural');
  });
});

describe('normalizeSignConvention', () => {
  it('invierte las clases de naturaleza crédito y deja intactas las de débito', () => {
    const csv = [
      'codigo,nombre,nivel,transaccional,Saldo 2025',
      '110505,Caja,Auxiliar,1,10000000',
      '220505,Proveedores,Auxiliar,1,-6000000',
      '310505,Capital,Auxiliar,1,-4000000',
      '413505,Ventas,Auxiliar,1,-50000000',
      '510506,Sueldos,Auxiliar,1,50000000',
    ].join('\n');
    const { rows, detection } = normalizeSignConvention(parseRaw(csv));

    expect(detection.convention).toBe('algebraica');
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r.balancesByPeriod['2025']]));
    expect(byCode['110505']).toBe(10_000_000); // clase 1 — débito, sin tocar
    expect(byCode['510506']).toBe(50_000_000); // clase 5 — débito, sin tocar
    expect(byCode['220505']).toBe(6_000_000); // clase 2 — invertida
    expect(byCode['310505']).toBe(4_000_000); // clase 3 — invertida
    expect(byCode['413505']).toBe(50_000_000); // clase 4 — invertida
  });

  it('preserva los saldos contrarios a la naturaleza dentro de una clase crédito', () => {
    // 11 de las 26 cuentas de clase 2 del balance real llevan saldo débito
    // (IVA descontable, retenciones a favor). Un `Math.abs` por cuenta las
    // rompería; la conversión de convención es una NEGACIÓN, que las preserva
    // como débitos legítimos — negativos bajo la convención natural.
    const csv = [
      'codigo,nombre,nivel,transaccional,Saldo 2025',
      '110505,Caja,Auxiliar,1,10000000',
      '220505,Proveedores,Auxiliar,1,-9000000',
      '24081001,IVA descontable,Auxiliar,1,3000000',
      '310505,Capital,Auxiliar,1,-4000000',
      '413505,Ventas,Auxiliar,1,-50000000',
      '510506,Sueldos,Auxiliar,1,50000000',
    ].join('\n');
    const { rows } = normalizeSignConvention(parseRaw(csv));
    const iva = rows.find((r) => r.code === '24081001');
    expect(iva?.balancesByPeriod['2025']).toBe(-3_000_000);
  });
});

describe('parseTrialBalanceCSV — normalización automática', () => {
  it('el balance real deja de tener Pasivo e Ingresos negativos', async () => {
    const csv = await loadGrupo2TresCsv();

    const antes = preprocessTrialBalance(parseRaw(csv)).primary.controlTotals;
    expect(antes.pasivo).toBeLessThan(0); // el defecto, tal como estaba
    expect(antes.ingresos).toBeLessThan(0);

    const despues = preprocessTrialBalance(parseTrialBalanceCSV(csv)).primary.controlTotals;
    expect(despues.pasivo).toBeGreaterThan(0);
    expect(despues.ingresos).toBeGreaterThan(0);
    expect(despues.activo).toBeCloseTo(antes.activo, 2); // clase 1 no se toca
  });

  it('sin normalizar, el descuadre ya no se esconde como patrimonio: bloquea', async () => {
    const csv = await loadGrupo2TresCsv();

    const antes = preprocessTrialBalance(parseRaw(csv)).primary;
    const despues = preprocessTrialBalance(parseTrialBalanceCSV(csv)).primary.controlTotals
      .patrimonio;

    // Hasta la auditoría 2026-09 R8 llevaba el descuadre de la lectura sin
    // normalizar a 3710VC y el patrimonio salía en $6.144.148.261,02 (mayor
    // que el activo entero). Ahora ese residual queda expuesto y bloquea: el
    // patrimonio publicado es Σ clase 3 + resultado del ejercicio.
    expect(antes.controlTotals.patrimonio).toBeLessThan(6_000_000_000);
    expect(antes.virtualCloseAdjustment?.blocking).toBe(true);
    expect(antes.validation.blocking).toBe(true);
    // Después: ~$2.223.439.991,54 = aportes ($42.720) + utilidad del ejercicio.
    expect(despues).toBeGreaterThan(2_200_000_000);
    expect(despues).toBeLessThan(2_300_000_000);
  });

  it('R8 pasa de absorber el 210% del activo a un residual inmaterial', async () => {
    const csv = await loadGrupo2TresCsv();

    const snapAntes = preprocessTrialBalance(parseRaw(csv)).primary;
    const snapDespues = preprocessTrialBalance(parseTrialBalanceCSV(csv)).primary;

    const ratio = (s: typeof snapAntes) =>
      Math.abs(s.virtualCloseAdjustment?.residualGapBeforeCents ?? 0) /
      Math.abs(s.controlTotals.activo);

    // El "antes" medía 210% del activo hasta que `netIncome` pasó a derivarse de
    // `ingresosNetos` en vez de Σ clase 4: sin normalizar, la clase 4 llega
    // negativa y `netIncome` heredaba ese signo, inflando el residual de R8. La
    // fórmula nueva toma magnitudes (|Σ ordinarias| − |Σ4175|), así que el caso
    // sin normalizar ya no es tan catastrófico. Medido hoy: 93,5% del activo.
    // Lo que este test guarda sigue intacto — sin normalización R8 tapa un
    // agujero del orden del activo entero; con ella, es inmaterial.
    expect(ratio(snapAntes)).toBeGreaterThan(0.5); // 93,5% del activo
    expect(ratio(snapDespues)).toBeLessThan(0.01); // 0,12% del activo
    // Y la mejora sigue siendo de dos órdenes de magnitud.
    expect(ratio(snapAntes) / ratio(snapDespues)).toBeGreaterThan(50);
  });

  it('no altera el fixture canónico, que ya venía en convención natural', () => {
    const csv = loadEliteCsv();
    const ct = preprocessTrialBalance(parseTrialBalanceCSV(csv)).primary.controlTotals;

    // Totales post-curator — si la normalización se disparara sobre un balance
    // natural, cambiarían. El patrimonio es Σ clase 3 tras el cierre virtual
    // ($815,5M); antes de la auditoría 2026-09 salía en $2.390M porque R5
    // lo anclaba a un desglose parcial y R8 absorbía el descuadre del fixture.
    expect(ct.activo).toBeCloseTo(3_270_000_000, 2);
    expect(ct.pasivo).toBeCloseTo(880_000_000, 2);
    expect(ct.patrimonio).toBeCloseTo(815_500_000, 2);
  });

  it('respeta el opt-out explícito para los callers que ya normalizan', async () => {
    const csv = await loadGrupo2TresCsv();
    const ct = preprocessTrialBalance(
      parseTrialBalanceCSV(csv, { normalizeSignConvention: false }),
    ).primary.controlTotals;
    expect(ct.pasivo).toBeLessThan(0);
  });
});
