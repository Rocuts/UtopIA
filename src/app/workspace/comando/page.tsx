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

    // Runway 36 meses · 3 escenarios. Flujos mensuales = ingresos netos y
    // egresos del periodo divididos por los MESES CUBIERTOS (la etiqueta
    // YYYY-MM trae resultados acumulados del año), no por 12 fijo
    // (ratios-kpis-03). Fuente única `mesesCubiertos` (NM-01): sin duración
    // derivable (rango incompleto, saldo de apertura) no hay flujo mensual
    // verificable ⇒ runway vacío y sin Monte Carlo, nunca 12 meses supuestos.
    const meses = mesesCubiertos(snap);
    const runway: RunwayMonth[] = [];
    if (meses !== null) {
      const ingresoMes = ingresosNetosPeriodo(ct) / meses;
      const egresoMes = ct.gastos / meses;
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
    }

    // La serie de inflexión necesitaba "salidas fiscales" = UN × 35 % / 12,
    // una métrica fiscal sin base verificada (ratios-kpis-10). Sin esa base no
    // se dibuja (el runway ya muestra los tres escenarios de caja).
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
