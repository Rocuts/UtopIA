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
import { buildPnlBridge } from '@/lib/pillars/pnl-bridge';
import {
  diasAutonomia,
  ingresosNetosPeriodo,
  mesesCubiertos,
  pruebaAcida,
  razonCorriente,
} from '@/lib/pillars/shared-metrics';
import type { CashInflectionPoint, RunwayMonth } from '@/components/charts';
import { buildRunway } from '@/lib/kpis/runway';

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

    const snap = balance.primary;
    const ct = snap.controlTotals;

    // Puente P&L con bloques disjuntos que cierran al centavo contra la
    // utilidad neta (ratios-kpis-13). Si no cierra, no se pinta.
    const pnlBridge = buildPnlBridge(snap) ?? undefined;

    // Liquidez: MISMAS funciones que pilar y tarjetas (ratios-kpis-15).
    const liquidity = {
      razonCorriente: razonCorriente(ct),
      pruebaAcida: pruebaAcida(ct),
      diasAutonomia: diasAutonomia(snap).value,
    };

    // Runway 36 meses · 3 escenarios (src/lib/kpis/runway.ts). Flujos
    // mensuales = ingresos netos y egresos del periodo divididos por los MESES
    // CUBIERTOS (ratios-kpis-03, NM-01): sin duración derivable no hay runway
    // ni Monte Carlo. Los escenarios conservador/agresivo son supuestos de
    // sensibilidad sobre los ingresos, rotulados en RUNWAY_ESCENARIOS.
    const meses = mesesCubiertos(snap);
    const runway: RunwayMonth[] = buildRunway({
      ingresosPeriodo: ingresosNetosPeriodo(ct),
      egresosPeriodo: ct.gastos,
      cajaInicial: ct.efectivoCuenta11,
      meses,
      desde: new Date(),
    });

    // Sin serie de inflexión fiscal: las «salidas fiscales» se estimaban sobre
    // la utilidad neta, ya después de impuestos (ratios-kpis-10, valoracion-24).
    // Sin impuesto causado por cuota del calendario DIAN no se dibuja.
    const inflectionSeries: CashInflectionPoint[] = [];

    // Serie temporal EBITDA/FCF/Ingresos para el gráfico de barras del pilar Valor.
    const valorTrend = buildValorBarSeries(balance);

    // Serie temporal Caja/Activo Corriente/Solvencia para el gráfico de barras del pilar Escudo.
    const escudoTrend = buildEscudoBarSeries(balance);

    // Serie temporal Errores/Descalces/Anomalías para el gráfico de barras del pilar Verdad.
    const verdadTrend = buildVerdadBarSeries(balance);

    // Proyección de caja 12 meses · 3 escenarios para el gráfico de líneas del pilar Futuro.
    const futuroTrend = buildFuturoBarSeries(balance);

    // Monte Carlo — 9.600 sims en ~15ms, corre server-side sin bloquear.
    // Sólo con meses cubiertos derivables (misma base del runway).
    const monteCarlo = meses !== null ? runMonteCarlo(balance.primary) : undefined;

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
