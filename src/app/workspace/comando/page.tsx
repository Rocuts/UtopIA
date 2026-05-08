// ---------------------------------------------------------------------------
// /workspace/comando — Vista Dueño v2 (P5 + Ola Élite +1)
//
// Server Component que intenta cargar el balance del último periodo abierto
// del workspace. Si existe → renderiza con datos REALES (pilares + curator +
// chart series derivadas). Si no → fallback demo con mocks (la página
// nunca sale vacía).
// ---------------------------------------------------------------------------

import { PillarsCommandCenter } from '@/components/workspace/pillars/PillarsCommandCenter';
import { aggregatePillars } from '@/lib/pillars/service';
import {
  findComparativePeriod,
  getCachedPreprocessedBalance,
  getLatestOpenPeriod,
} from '@/lib/cache/preprocessed-balance';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { buildValorBarSeries } from '@/lib/pillars/valor-bars';
import { buildEscudoBarSeries } from '@/lib/pillars/escudo-bars';
import { buildVerdadBarSeries } from '@/lib/pillars/verdad-bars';
import { buildFuturoBarSeries } from '@/lib/pillars/futuro-bars';
import { runMonteCarlo } from '@/lib/pillars/monte-carlo';
import type {
  CashInflectionPoint,
  PnLWaterfallData,
  RunwayMonth,
} from '@/components/charts';

export const dynamic = 'force-dynamic'; // workspace cookie obliga SSR per request

export default async function ComandoPage() {
  try {
    const ws = await getOrCreateWorkspace();
    const latestPeriod = await getLatestOpenPeriod(ws.id);

    if (!latestPeriod) {
      return <PillarsCommandCenter demo />;
    }

    const comparative = await findComparativePeriod(ws.id, latestPeriod);
    const { balance } = await getCachedPreprocessedBalance(
      ws.id,
      latestPeriod.id,
      comparative?.id,
    );

    if (!balance) {
      return <PillarsCommandCenter demo />;
    }

    const pillars = aggregatePillars({
      snapshot: balance.primary,
      comparative: balance.comparative ?? undefined,
    });

    const ct = balance.primary.controlTotals;

    // Build P&L waterfall from control totals.
    const pnlBridge: PnLWaterfallData = {
      ingresos: ct.ingresos,
      // Costos clase 6+7
      costos:
        (balance.primary.classes.find((c) => c.code === 6)?.auxiliaryTotal ?? 0) +
        (balance.primary.classes.find((c) => c.code === 7)?.auxiliaryTotal ?? 0),
      gastosOperacionales: balance.primary.classes.find((c) => c.code === 5)?.auxiliaryTotal ?? 0,
      gastosFinancieros: 0, // TODO: separar 5305 (financieros) si hay subgrupo
      impuestos: ct.impuestosCuenta24,
      utilidadNeta: ct.utilidadNeta,
    };

    // Liquidity ratios.
    const razonCorriente =
      ct.pasivoCorriente > 0 ? ct.activoCorriente / ct.pasivoCorriente : null;
    const diasAutonomia =
      ct.gastos > 0 ? ct.efectivoCuenta11 / (ct.gastos / 365) : null;
    const liquidity = {
      razonCorriente,
      pruebaAcida: razonCorriente, // TODO: refinar quitando inventarios cuando WS3 los exponga
      diasAutonomia,
    };

    // Runway projection (3 escenarios, 36 meses) — replica la lógica del
    // pilar Futuro pero genera la serie completa para el chart.
    const ingresoMes = ct.ingresos / 12;
    const egresoMes = ct.gastos / 12;
    const runway: RunwayMonth[] = [];
    let base = ct.efectivoCuenta11;
    let cons = ct.efectivoCuenta11;
    let agr = ct.efectivoCuenta11;
    for (let i = 0; i < 36; i++) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() + i);
      const month = d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
      runway.push({ month, base, conservador: cons, agresivo: agr });
      base = base + ingresoMes - egresoMes;
      cons = cons + ingresoMes * 0.85 - egresoMes;
      agr = agr + ingresoMes * 1.10 - egresoMes;
    }

    // Inflection series — caja base/conservador/agresivo + salidas fiscales
    // (impuesto renta proyectado en mayo del año siguiente, distribuido).
    const taxOutflowMes = Math.max(0, ct.utilidadNeta * 0.35) / 12;
    const inflectionSeries: CashInflectionPoint[] = runway.slice(0, 13).map((r) => ({
      date: r.month,
      base: r.base,
      conservador: r.conservador,
      agresivo: r.agresivo,
      salidasFiscales: taxOutflowMes,
    }));

    // Serie temporal EBITDA/FCF/Ingresos para el gráfico de barras del pilar Valor.
    const valorTrend = buildValorBarSeries(balance);

    // Serie temporal Caja/Activo Corriente/Solvencia para el gráfico de barras del pilar Escudo.
    const escudoTrend = buildEscudoBarSeries(balance);

    // Serie temporal Errores/Descalces/Anomalías para el gráfico de barras del pilar Verdad.
    const verdadTrend = buildVerdadBarSeries(balance);

    // Proyección de caja 12 meses · 3 escenarios para el gráfico de líneas del pilar Futuro.
    const futuroTrend = buildFuturoBarSeries(balance);

    // Monte Carlo — 9.600 sims en ~15ms, corre server-side sin bloquear.
    const monteCarlo = runMonteCarlo(balance.primary);

    // Gap attribution del Curator (R3) si hay descuadre.
    const curatorGap = balance.primary.curator?.balanceGapAttribution;
    const gapAttribution = curatorGap
      ? {
          accountCode: curatorGap.accountCode,
          accountName: curatorGap.accountName,
          amountCop: curatorGap.amountCop,
          zScore: curatorGap.zScore,
        }
      : undefined;

    return (
      <PillarsCommandCenter
        pillars={pillars}
        liquidity={liquidity}
        pnlBridge={pnlBridge}
        runway={runway}
        inflectionSeries={inflectionSeries}
        gapAttribution={gapAttribution}
        valorTrend={valorTrend}
        escudoTrend={escudoTrend}
        verdadTrend={verdadTrend}
        futuroTrend={futuroTrend}
        balance={balance}
        monteCarlo={monteCarlo}
        demo={false}
      />
    );
  } catch (err) {
    // Si algo falla en server-side (ws cookie ausente, DB unavailable),
    // degradamos a demo en vez de pantalla blanca.
    console.warn('[/workspace/comando] fallback a demo:', err);
    return <PillarsCommandCenter demo />;
  }
}
