// ---------------------------------------------------------------------------
// P8 — Smoke E2E para la Ola Élite (P1-P7).
// ---------------------------------------------------------------------------
// Valida los puentes entre módulos:
//   (1) preprocesador genera snapshot con curator inyectado
//   (2) curator emite findings R1-R4 según el TB
//   (3) aggregatePillars consume el snapshot y produce 4 pilares con scores
//   (4) los 4 triggers del Sentinel evalúan correctamente las métricas
//   (5) los insights generados pueden interpolarse y producir subject/CTA
//
// NO toca DB ni red — todo es determinístico in-memory.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  preprocessTrialBalance,
  type RawAccountRow,
} from '@/lib/preprocessing/trial-balance';
import { aggregatePillars } from '@/lib/pillars/service';
import { runT1 } from '@/lib/workflows/sentinel/triggers/r1-truth-gap';
import { runT2 } from '@/lib/workflows/sentinel/triggers/r2-shield-liquidity';
import { runT3 } from '@/lib/workflows/sentinel/triggers/r3-value-anomaly';
import { runT4 } from '@/lib/workflows/sentinel/triggers/r4-future-inflection';
import { fillInsightFromTemplate } from '@/lib/notifications/insight-templates';
import type { SentinelMetrics } from '@/lib/workflows/sentinel/types';

// ─── Fixture: un balance de prueba realista con descuadre intencional ────

function row(
  code: string,
  name: string,
  level: string,
  current: number,
  prior: number,
): RawAccountRow {
  return {
    code,
    name,
    level,
    transactional: level === 'Auxiliar',
    balancesByPeriod: { '2025': prior, '2026': current },
  };
}

// PUC simplificado pero con clases 1, 2, 3, 4, 5 representadas y un descuadre
// inducido en cuenta 1305 (clientes) que dispara R3.
const TB: RawAccountRow[] = [
  // Clase
  row('1', 'Activo', 'Clase', 1_456_000_000, 1_000_000_000),
  row('11', 'Disponible', 'Grupo', 200_000_000, 200_000_000),
  row('110505', 'Caja', 'Auxiliar', 200_000_000, 200_000_000),
  row('13', 'Deudores', 'Grupo', 556_000_000, 100_000_000),
  row('130505', 'Clientes nacionales', 'Auxiliar', 556_000_000, 100_000_000),
  row('14', 'Inventarios', 'Grupo', 700_000_000, 700_000_000),
  row('143505', 'Mercancías', 'Auxiliar', 700_000_000, 700_000_000),

  // Pasivo
  row('2', 'Pasivo', 'Clase', 600_000_000, 600_000_000),
  row('21', 'Obligaciones financieras', 'Grupo', 200_000_000, 200_000_000),
  row('210505', 'Bancos nacionales', 'Auxiliar', 200_000_000, 200_000_000),
  row('23', 'Cuentas por pagar', 'Grupo', 350_000_000, 350_000_000),
  row('230505', 'Proveedores', 'Auxiliar', 350_000_000, 350_000_000),
  row('24', 'Impuestos por pagar', 'Grupo', 50_000_000, 50_000_000),
  row('240505', 'Renta', 'Auxiliar', 3_800_000, 50_000_000),

  // Patrimonio
  row('3', 'Patrimonio', 'Clase', 400_000_000, 400_000_000),
  row('3105', 'Capital autorizado', 'Cuenta', 300_000_000, 300_000_000),
  row('3305', 'Reserva legal', 'Cuenta', 100_000_000, 100_000_000),

  // Resultado (utilidad neta = 2_000_000_000 — alto vs provisión 3.8M para R4)
  row('4', 'Ingresos', 'Clase', 12_000_000_000, 10_000_000_000),
  row('413505', 'Ventas', 'Auxiliar', 12_000_000_000, 10_000_000_000),
  row('5', 'Gastos', 'Clase', 3_500_000_000, 3_000_000_000),
  row('510505', 'Sueldos', 'Auxiliar', 3_500_000_000, 3_000_000_000),
  row('6', 'Costos', 'Clase', 6_500_000_000, 5_500_000_000),
  row('610505', 'Costo mercancía', 'Auxiliar', 6_500_000_000, 5_500_000_000),
];

// ───────────────────────────────────────────────────────────────────────────

describe('P8 Elite Pipeline Smoke — full bridge', () => {
  it('(1) preprocessor produce snapshot multiperiodo con curator inyectado', () => {
    const out = preprocessTrialBalance(TB);
    expect(out.periods.length).toBe(2);
    expect(out.primary.period).toBe('2026');
    expect(out.comparative?.period).toBe('2025');
    // El curator se inyectó al final de buildSnapshotForPeriod (vía
    // preprocessTrialBalance loop):
    expect(out.primary.curator).toBeDefined();
    expect(out.primary.curator?.findings.length).toBeGreaterThan(0);
  });

  it('(2) curator dispara R8 (cierre virtual) y R4 (provisión renta) sobre el TB de fixture', () => {
    const out = preprocessTrialBalance(TB);
    const findings = out.primary.curator?.findings ?? [];
    const codes = new Set(findings.map((f) => f.code));
    // R8 (Cierre Virtual): SIEMPRE dispara cuando hay actividad P&L. Absorbe la
    // brecha original (Activo 1.456B vs Pasivo+Patrimonio 1.0B = gap 456M) en
    // cuenta virtual 3710VC y deja la ecuación cuadrada al centavo. Por eso
    // R3 ya NO dispara post-R8 (la brecha se anuló en patrimonio).
    expect(codes.has('CUR-R8')).toBe(true);
    expect(out.primary.curator?.virtualCloseAdjustment).toBeDefined();
    // R4: utilidadNeta = 2B (12B - 3.5B - 6.5B), provisión 24 = 3.8M → ratio 0.19% << 30%
    expect(codes.has('CUR-R4')).toBe(true);
    expect(out.primary.curator?.taxProvisionRisk?.severidad).toBe('critico');
  });

  it('(3) aggregatePillars consume snapshot real y produce 4 pilares con scores válidos', () => {
    const pre = preprocessTrialBalance(TB);
    const pillars = aggregatePillars({
      snapshot: pre.primary,
      comparative: pre.comparative,
    });
    expect(pillars.escudo.kpis).toHaveLength(3);
    expect(pillars.valor.kpis).toHaveLength(3);
    expect(pillars.verdad.kpis).toHaveLength(3);
    expect(pillars.futuro.kpis).toHaveLength(3);
    // Verdad: post-R8 la ecuación cuadra al centavo, así que el status ya no
    // es 'critical' por descuadre. Pero R4 (provisión renta 0,19% << 30%) y la
    // utilidad masiva sin respaldo de caja siguen produciendo señales — el
    // status debe ser al menos 'watch' (degradado vs healthy).
    expect(['watch', 'warning', 'critical']).toContain(pillars.verdad.status);
    // Cada pilar tiene score 0-100.
    for (const p of [pillars.escudo, pillars.valor, pillars.verdad, pillars.futuro]) {
      expect(p.healthScore).toBeGreaterThanOrEqual(0);
      expect(p.healthScore).toBeLessThanOrEqual(100);
    }
    expect(pillars.overallScore).toBeGreaterThanOrEqual(0);
    expect(pillars.overallScore).toBeLessThanOrEqual(100);
  });

  it('(4) Sentinel triggers evalúan correctamente las métricas derivadas del snapshot', () => {
    const pre = preprocessTrialBalance(TB);
    const ct = pre.primary.controlTotals;

    // Post-R8 la ecuación cuadra al centavo, así que `ct.activo - pasivo - patrimonio`
    // ≈ 0 y T1 (equationGapPct) jamás dispararía. Para preservar la cobertura del
    // trigger T1 sobre el gap PRE-R8, simulamos el descuadre original aquí
    // (Activo 1.456B vs Pasivo+Patrimonio 1.0B = gap 456M = 31% del activo).
    const equationGapAmount = 456_000_000;
    const equationGapPct = 0.31;

    const metrics: SentinelMetrics & { equationGapAmount: number } = {
      equationGapPct,
      equationGapAmount,
      diasAutonomia: 30, // bajo → T2 dispara
      coberturaFiscal: 0.05,
      margenBruto: 0.45,
      diasInventario: 50,
      puntoInflexion: 8, // < 12 → T4 dispara
      efectivo: ct.efectivoCuenta11,
      utilidadNeta: ct.utilidadNeta,
      impuestos: ct.impuestosCuenta24,
    };

    const ctx = { workspaceId: 'ws-smoke', periodId: 'p-smoke' };
    expect(runT1(metrics, ctx).fired).toBe(true);
    expect(runT2(metrics, ctx).fired).toBe(true);
    expect(runT3(metrics, ctx).fired).toBe(false); // ni inventario ni margen extremo
    expect(runT4(metrics, ctx).fired).toBe(true);
  });

  it('(5) Insight template render produce subject/hallazgo/CTA interpolados', () => {
    const insight = fillInsightFromTemplate({
      pillar: 'verdad',
      severity: 'critico',
      vars: {
        empresario_nombre: 'Andreita',
        monto_diferencia: '$456.000.000',
      },
      workspaceId: 'ws-smoke',
    });
    expect(insight.subject).toContain('⚠️');
    expect(insight.hallazgo).toContain('Andreita');
    expect(insight.hallazgo).toContain('$456.000.000');
    expect(insight.accionRecomendada.label).toBeTruthy();
    expect(insight.accionRecomendada.href).toBe('/workspace/contabilidad/mayor?showGap=true');
  });
});
