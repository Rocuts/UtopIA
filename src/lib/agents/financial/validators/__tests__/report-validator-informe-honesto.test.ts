// ---------------------------------------------------------------------------
// Validador del consolidado (Markdown) sobre informes HONESTOS
// ---------------------------------------------------------------------------
// e2e-niif-03 (re-auditoría 2026-09): /consolidate cableó `validateConsolidatedReport`
// y con él `detectInflatedCash`, que leía "4.2" del encabezado
// "### 4.2 Saldo Inicial Depurado (PUC 11)" como $4,20 → "Caja inflada" en
// TODO informe con AC ≥ PC (validation.ok=false, descarga bloqueada).
// e2e-niif-04: el extractor tomaba cualquier número de la línea: la columna
// comparativa, "$-40 M" del dashboard como -$40, "> 15%" como $15. Con un
// patrimonio negativo "($20.000.000,00)" los avisos citaban cifras falsas.
// Los fixtures replican el Markdown real del renderer y del adaptador de la
// Parte II (tablas de dos columnas, negativos entre paréntesis, dashboard en
// millones abreviados, KPIs en porcentaje).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import {
  detectInflatedCash,
  extractCopTokens,
  validateConsolidatedReport,
} from '../report-validator';

const M = 1_000_000;

/** Empresa sana: AC 110M ≥ PC 50M, PUC 11 = 70M, UN 20M, comparativo 2024. */
const SANA = [
  '# PARTE I: ESTADOS FINANCIEROS NIIF',
  '### Estado de Situación Financiera',
  '| Rubro | 2025 | 2024 |',
  '| :--- | ---: | ---: |',
  '|   11 — Efectivo y equivalentes de efectivo | $70.000.000,00 | $50.000.000,00 |',
  '|   13 — Deudores comerciales | $40.000.000,00 | $30.000.000,00 |',
  '| **Total activo corriente** | **$110.000.000,00** | **$80.000.000,00** |',
  '|   15 — Propiedades, planta y equipo | $40.000.000,00 | $40.000.000,00 |',
  '| **TOTAL ACTIVOS** | **$150.000.000,00** | **$120.000.000,00** |',
  '| **Total pasivo corriente** | **$50.000.000,00** | **$40.000.000,00** |',
  '| **TOTAL PASIVOS** | **$50.000.000,00** | **$40.000.000,00** |',
  '| **Total patrimonio** | **$100.000.000,00** | **$80.000.000,00** |',
  '| **✅ TOTAL PASIVO + PATRIMONIO** | **$150.000.000,00** | **$120.000.000,00** |',
  '### Estado de Resultados Integral',
  '| **UTILIDAD NETA DEL PERÍODO** | **$20.000.000,00** | **$20.000.000,00** |',
  '### Estado de Flujos de Efectivo',
  '|   Utilidad neta del ejercicio | $20.000.000,00 |',
  '| **EFECTIVO AL FINAL DEL PERÍODO** | **$70.000.000,00** |',
  '# PARTE II: ANALISIS ESTRATEGICO Y PROYECCIONES',
  '## 1. DASHBOARD EJECUTIVO',
  '| Rubro | Periodo actual | Periodo comparativo | Variación | Variación % | Comentario |',
  '|---|---:|---:|---:|---:|---|',
  '| Total Activo | $150 M | $120 M | $30 M | 25,0% | Cierre. |',
  '| Utilidad Neta | $20 M | $20 M | $0 M | 0,0% | Estable. |',
  '## 2. KPIs FINANCIEROS',
  '| Categoría | KPI | Fórmula | Resultado | Comparativo | Banda | Variación YoY | Diagnóstico |',
  '|---|---|---|---:|---:|---|---|---|',
  '| profitability | ROE | Utilidad neta / patrimonio promedio | 22,2% | 25,0% | > 15% | — | Sano. |',
  '## 3. ANÁLISIS DE TENDENCIAS',
  '- Utilidad Neta YoY: 0,0%',
  '## 4. PROYECCIONES',
  '### 4.1 Gate de Liquidez',
  'AC ≥ PC: proyección habilitada.',
  '',
  '### 4.2 Saldo Inicial Depurado (PUC 11)',
  '- Saldo Inicial Caja: $70.000.000,00',
  '- DSO usado: 30 días',
  '# PARTE III: GOBIERNO CORPORATIVO',
  'Se aprueban los estados con una utilidad neta del ejercicio de $20.000.000,00.',
].join('\n');

const SANA_TOTALS = {
  activo: 150 * M,
  activoCorriente: 110 * M,
  pasivo: 50 * M,
  pasivoCorriente: 50 * M,
  patrimonio: 100 * M,
  utilidadNeta: 20 * M,
  efectivoCuenta11: 70 * M,
};

/** Pérdida y patrimonio negativo: A 50M = P 70M + K (20M). */
const PNC = [
  '# PARTE I: ESTADOS FINANCIEROS NIIF',
  '| Rubro | 2025 | 2024 |',
  '| :--- | ---: | ---: |',
  '| **TOTAL ACTIVOS** | **$50.000.000,00** | **$90.000.000,00** |',
  '| **TOTAL PASIVOS** | **$70.000.000,00** | **$70.000.000,00** |',
  '|   36 — Resultados del ejercicio | ($40.000.000,00) | ($30.000.000,00) |',
  '| **Total patrimonio** | **($20.000.000,00)** | **$20.000.000,00** |',
  '| **✅ TOTAL PASIVO + PATRIMONIO** | **$50.000.000,00** | **$90.000.000,00** |',
  '| **PÉRDIDA NETA DEL PERÍODO** | **($40.000.000,00)** | **($30.000.000,00)** |',
  '|   Utilidad neta del ejercicio | ($40.000.000,00) |',
  '| **Saldo al 31 de diciembre de 2025** | **$50.000.000,00** | **($40.000.000,00)** | **($20.000.000,00)** |',
  '# PARTE II: ANALISIS ESTRATEGICO Y PROYECCIONES',
  '| Total Activo | $50 M | $90 M | $-40 M | — | Cierre. |',
  '| Utilidad Neta | $-40 M | $-30 M | $-10 M | — | Pérdida. |',
  '| profitability | ROE | Utilidad neta / patrimonio promedio | ND | -150,0% | > 15% | — | Patrimonio negativo. |',
  '### 4.1 Gate de Liquidez',
  '**Triggered:** ALERTA DE LIQUIDEZ: AC ($20.000.000,00) < PC ($70.000.000,00).',
  '# PARTE III: GOBIERNO CORPORATIVO',
].join('\n');

const PNC_TOTALS = {
  activo: 50 * M,
  pasivo: 70 * M,
  patrimonio: -20 * M,
  utilidadNeta: -40 * M,
  efectivoCuenta11: 5 * M,
};

const numericWarnings = (w: string[]) =>
  w.filter((x) => /^(Total Activo|Total Pasivo|Total Patrimonio|Utilidad Neta)/.test(x));

describe('extractCopTokens — sólo montos COP (e2e-niif-03/-04)', () => {
  it('la numeración de sección y los códigos PUC no son montos', () => {
    expect(extractCopTokens('### 4.2 Saldo Inicial Depurado (PUC 11)')).toEqual([]);
  });

  it('negativo contable con el signo pesos dentro o fuera del paréntesis', () => {
    const values = extractCopTokens('($20.000.000,00) $(1.234,50) -$2.000 $-3.000 (4.500)').map((t) => t.value);
    expect(values).toEqual([-20 * M, -1234.5, -2000, -3000, -4500]);
  });

  it('abreviados del dashboard y porcentajes quedan marcados', () => {
    const [m, b, pct] = extractCopTokens('$-40 M | $1,5 B | 25,0% | 1.250,0%');
    expect(m).toMatchObject({ value: -40 * M, abbreviated: true, roundingTolerance: 0.5 * M });
    expect(b).toMatchObject({ value: 1.5e9, abbreviated: true });
    // "25,0%" no tiene "$" ni miles: no es un monto; "1.250,0%" se marca porcentaje.
    expect(pct).toMatchObject({ percent: true });
  });
});

describe('detectInflatedCash — encabezados y rótulo (e2e-niif-03)', () => {
  it('Markdown real de la Parte II con saldo inicial = PUC 11: sin error', () => {
    expect(detectInflatedCash(SANA, SANA_TOTALS)).toBeNull();
  });

  it('"Saldo inicial de caja (PUC 11) | $70.000.000,00" en tabla: sin error', () => {
    const md = SANA.replace(
      '- Saldo Inicial Caja: $70.000.000,00',
      '| Saldo inicial de caja (PUC 11) | $70.000.000,00 |',
    );
    expect(detectInflatedCash(md, SANA_TOTALS)).toBeNull();
  });

  it('sigue detectando un saldo inicial inflado con el Activo Corriente', () => {
    const md = SANA.replace('- Saldo Inicial Caja: $70.000.000,00', '- Saldo Inicial Caja: $110.000.000,00');
    expect(detectInflatedCash(md, SANA_TOTALS)).toMatch(/Caja inflada.*\$110\.000\.000,00/);
  });
});

describe('validateConsolidatedReport — informes honestos no se bloquean', () => {
  it('(a) empresa sana con AC ≥ PC: ok=true y sin avisos numéricos falsos', () => {
    const r = validateConsolidatedReport(SANA, SANA_TOTALS, {
      comparativeTotals: { activo: 120 * M, pasivo: 40 * M, patrimonio: 80 * M, utilidadNeta: 20 * M },
      primaryPeriod: '2025',
      comparativePeriod: '2024',
    });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(numericWarnings(r.warnings)).toEqual([]);
  });

  it('(b) patrimonio negativo "($20.000.000,00)": ok=true y sin avisos numéricos falsos', () => {
    const r = validateConsolidatedReport(PNC, PNC_TOTALS, { primaryPeriod: '2025' });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(numericWarnings(r.warnings)).toEqual([]);
  });

  it('una cifra abreviada falsa en el dashboard sí genera aviso con la cifra leída', () => {
    const r = validateConsolidatedReport(
      PNC.replace('| Utilidad Neta | $-40 M |', '| Utilidad Neta | $-4 M |'),
      PNC_TOTALS,
    );
    expect(numericWarnings(r.warnings)).toEqual([
      expect.stringMatching(/^Utilidad Neta: reportado -\$4\.000\.000,00 vs\. esperado -\$40\.000\.000,00/),
    ]);
  });

  it('un Total Patrimonio del periodo actual con signo invertido sí descuadra la ecuación', () => {
    const r = validateConsolidatedReport(
      PNC.replace('| **Total patrimonio** | **($20.000.000,00)** |', '| **Total patrimonio** | **$20.000.000,00** |'),
      PNC_TOTALS,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Ecuacion contable interna descuadrada/);
  });
});
