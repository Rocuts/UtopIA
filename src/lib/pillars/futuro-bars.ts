// ---------------------------------------------------------------------------
// Pilar FUTURO — Series de proyección de caja (FuturoTrendBars)
// ---------------------------------------------------------------------------
// Genera 12 meses PROYECTADOS hacia el futuro bajo 3 escenarios: base,
// conservador y agresivo. Usa el snapshot actual como punto de partida.
//
// A diferencia de verdad-bars / escudo-bars / valor-bars, esta serie es
// SIEMPRE proyectada — sin granularidad histórica, sin detectGranularity.
//
// Factores por escenario aplicados al ingreso mensual:
//   Base         → 1.00 (escenario medio)
//   Conservadora → 0.85 (20% contracción de ingresos, ej. estrés de cartera)
//   Agresiva     → 1.10 (10% mejora, ej. campaña comercial exitosa)
//
// PARAMETRIZABLE (FUTURO v2):
//   - growthOverride: el usuario ajusta el "Crecimiento Estimado" desde la UI
//     (-5%, 0%, +5%, +10%, custom). Sustituye al factor base 1.0.
//   - ipcRate: indexa los GASTOS FIJOS (PUC 5105/5120/5135) anualmente
//     (default 4.5% IPC Colombia 2026).
//   - capexEvents: el usuario añade "Eventos de Futuro" (compra de maquinaria,
//     pago extra, etc.) que se restan a la caja en el mes correspondiente
//     bajo TODOS los escenarios.
// ---------------------------------------------------------------------------

import type { PreprocessedBalance, PUCClass } from '@/lib/preprocessing/trial-balance';

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export interface FuturoBarSeries {
  /** Etiqueta del eje X. Ej "M+1", "M+2". */
  label: string;
  /** Índice del mes proyectado (1-12). */
  monthIndex: number;
  /** Caja proyectada — escenario base (factor 1.0 + growthOverride). */
  cajaBase: number;
  /** Caja proyectada — escenario conservador (factor 0.85 sobre ingresos). */
  cajaConservadora: number;
  /** Caja proyectada — escenario agresivo (factor 1.10 sobre ingresos). */
  cajaAgresiva: number;
  /** Eventos CapEx aplicados en este mes (suma absoluta), 0 si no hay. */
  capexAplicado: number;
}

/**
 * Evento de Futuro — gasto puntual proyectado (CapEx, deuda, dividendo, etc.)
 * que el usuario añade desde la UI y persiste en localStorage.
 */
export interface CapexEvent {
  /** Identificador único (uuid o timestamp). */
  id: string;
  /** Etiqueta humana ("Compra Maquinaria", "Pago Préstamo"). */
  name: string;
  /** Mes proyectado donde aplica el gasto (1-12). */
  monthOffset: number;
  /** Monto en COP (positivo = salida de caja). */
  amountCop: number;
}

export interface BuildFuturoBarSeriesOptions {
  /** Override del factor base por porcentaje del usuario (ej. 0.05 = +5%).
   *  Se aplica como `(1 + growthOverride)` sobre el ingreso del escenario base.
   *  Si `null` o `undefined`, usa `FACTOR_BASE = 1.0` sin modificación. */
  growthOverride?: number | null;
  /** Tasa IPC anual aplicada a gastos fijos (default 0.045 = 4,5% Colombia 2026).
   *  Se aplica progresivamente mes a mes (rampa lineal) sobre el saldo de
   *  gastos fijos identificados (PUC 5105/5120/5135/5145/5155). */
  ipcRate?: number;
  /** Lista de eventos CapEx del usuario. Cada evento se resta a la caja en
   *  todos los escenarios en el mes `monthOffset`. */
  capexEvents?: CapexEvent[];
}

// ─── Constantes ─────────────────────────────────────────────────────────────

const FACTOR_BASE = 1.0;
const FACTOR_CONSERVADOR = 0.85;
const FACTOR_AGRESIVO = 1.10;

/** IPC default Colombia 2026 (BanRep target). */
export const IPC_DEFAULT = 0.045;

/** Prefijos PUC de gastos identificados como FIJOS (sujetos a indexación IPC).
 *  Decreto 2650/1993:
 *    5105 — Gastos de personal (nómina)
 *    5120 — Arrendamientos
 *    5135 — Servicios públicos / honorarios fijos
 *    5145 — Mantenimiento fijo
 *    5155 — Gastos legales recurrentes
 */
const FIXED_EXPENSE_PREFIXES = ['5105', '5120', '5135', '5145', '5155'];

// ─── Helpers ────────────────────────────────────────────────────────────────

function isVirtualCuratorAccount(code: string): boolean {
  return (
    code.endsWith('VC') ||
    code.endsWith('ZZ') ||
    code.startsWith('2810ZZ-') ||
    code.startsWith('3710ZZ')
  );
}

/** Suma saldos de cuentas Clase 5 cuyos códigos empiezan con cualquiera de los
 *  prefijos fijos. Ignora cuentas virtuales del Curator. */
function sumFixedExpenses(claseGastos: PUCClass | undefined): number {
  if (!claseGastos) return 0;
  return claseGastos.accounts
    .filter((a) => FIXED_EXPENSE_PREFIXES.some((p) => a.code.startsWith(p)))
    .filter((a) => !isVirtualCuratorAccount(a.code))
    .reduce((s, a) => s + a.balance, 0);
}

// ─── Función principal ───────────────────────────────────────────────────────

/**
 * Construye la serie `FuturoBarSeries[]` (12 meses proyectados) a partir del
 * balance preprocesado y opciones interactivas del usuario.
 *
 * Siempre retorna exactamente 12 puntos.
 *
 * Fórmula por escenario (mes m):
 *   ingresoMesEscenario = ingresoMes × factor (base/conservador/agresivo)
 *   egresoMesEscenario  = egresoFijoMes × ipcRamp(m) + egresoVariableMes × factorVariable
 *   caja[m] = caja[m-1] + ingresoMesEscenario − egresoMesEscenario − capexEvent[m]
 *
 * El conservador aumenta egresos variables un 5% (estrés inflación), el
 * agresivo los reduce 2% (optimización del prompt CFO).
 */
export function buildFuturoBarSeries(
  balance: PreprocessedBalance,
  opts: BuildFuturoBarSeriesOptions = {},
): FuturoBarSeries[] {
  const ct = balance.primary.controlTotals;
  const claseGastos = balance.primary.classes.find((c) => c.code === 5);

  const cajaInicial = ct.efectivoCuenta11;
  const ingresoMes = ct.ingresos / 12;
  const egresoMes = ct.gastos / 12;

  const gastosFijosAnual = sumFixedExpenses(claseGastos);
  const gastosFijosMes = gastosFijosAnual / 12;
  const gastosVariablesMes = Math.max(0, egresoMes - gastosFijosMes);

  const factorBase = FACTOR_BASE + (opts.growthOverride ?? 0);
  const ipcRate = opts.ipcRate ?? IPC_DEFAULT;

  // Mapa rápido para localizar capex events por mes.
  const capexByMonth = new Map<number, number>();
  for (const ev of opts.capexEvents ?? []) {
    if (ev.monthOffset >= 1 && ev.monthOffset <= 12) {
      capexByMonth.set(
        ev.monthOffset,
        (capexByMonth.get(ev.monthOffset) ?? 0) + ev.amountCop,
      );
    }
  }

  const series: FuturoBarSeries[] = [];

  let prevBase = cajaInicial;
  let prevCons = cajaInicial;
  let prevAgr = cajaInicial;

  for (let m = 1; m <= 12; m++) {
    const ipcRamp = 1 + (ipcRate * m) / 12;

    const egresoBase = gastosFijosMes * ipcRamp + gastosVariablesMes;
    const egresoCons = gastosFijosMes * ipcRamp + gastosVariablesMes * 1.05;
    const egresoAgr = gastosFijosMes * ipcRamp + gastosVariablesMes * 0.98;

    const capexAplicado = capexByMonth.get(m) ?? 0;

    const cajaBase = prevBase + ingresoMes * factorBase - egresoBase - capexAplicado;
    const cajaConservadora =
      prevCons + ingresoMes * FACTOR_CONSERVADOR - egresoCons - capexAplicado;
    const cajaAgresiva =
      prevAgr + ingresoMes * FACTOR_AGRESIVO - egresoAgr - capexAplicado;

    series.push({
      label: `M+${m}`,
      monthIndex: m,
      cajaBase,
      cajaConservadora,
      cajaAgresiva,
      capexAplicado,
    });

    prevBase = cajaBase;
    prevCons = cajaConservadora;
    prevAgr = cajaAgresiva;
  }

  return series;
}
