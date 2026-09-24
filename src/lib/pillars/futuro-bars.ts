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
//   - ipcRate: indexa los GASTOS FIJOS (PUC 5105/5120/5135) anualmente.
//     Sin valor del usuario se usa un SUPUESTO DE ESCENARIO del 4,5 % anual:
//     no es un dato del DANE ni la meta del BanRep, y la UI debe rotularlo
//     con `describeIpcAssumption` (ratios-kpis-29).
//   - capexEvents: el usuario añade "Eventos de Futuro" (compra de maquinaria,
//     pago extra, etc.) que se restan a la caja en el mes correspondiente
//     bajo TODOS los escenarios.
// ---------------------------------------------------------------------------

import type { PreprocessedBalance, PUCClass } from '@/lib/preprocessing/trial-balance';

import { ingresosNetosPeriodo, mesesCubiertos } from './shared-metrics';

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
  /** Tasa anual de indexación de gastos fijos. Sin valor → `IPC_DEFAULT`
   *  (supuesto de escenario, ver `describeIpcAssumption`).
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

/** Supuesto de ESCENARIO para indexar gastos fijos (4,5 % anual). No es un dato
 *  oficial ni la meta del BanRep; el usuario puede cambiarlo en la UI. */
export const IPC_DEFAULT = 0.045;

/** Rótulo del supuesto de indexación que usa la proyección. */
export interface IpcAssumption {
  rate: number;
  /** 'supuesto_escenario' = valor por defecto sin fuente; 'usuario' = lo fijó el usuario. */
  origen: 'supuesto_escenario' | 'usuario';
  labelEs: string;
  labelEn: string;
}

function pctLabel(rate: number, locale: 'es' | 'en'): string {
  const pct = Math.round(rate * 1000) / 10;
  const s = locale === 'es' ? String(pct).replace('.', ',') : String(pct);
  return locale === 'es' ? `${s} %` : `${s}%`;
}

/**
 * Describe el supuesto de indexación de gastos fijos de la proyección para
 * que la UI lo rotule (ratios-kpis-29): el valor por defecto es un supuesto
 * de escenario sin fuente ni fecha, nunca "IPC Colombia" ni "meta BanRep".
 */
export function describeIpcAssumption(
  opts: Pick<BuildFuturoBarSeriesOptions, 'ipcRate'> = {},
): IpcAssumption {
  if (typeof opts.ipcRate === 'number' && Number.isFinite(opts.ipcRate)) {
    return {
      rate: opts.ipcRate,
      origen: 'usuario',
      labelEs: `Gastos fijos indexados al ${pctLabel(opts.ipcRate, 'es')} anual (valor definido por el usuario).`,
      labelEn: `Fixed expenses indexed at ${pctLabel(opts.ipcRate, 'en')} per year (user-defined value).`,
    };
  }
  return {
    rate: IPC_DEFAULT,
    origen: 'supuesto_escenario',
    labelEs:
      `Gastos fijos indexados al ${pctLabel(IPC_DEFAULT, 'es')} anual: supuesto de escenario, ` +
      'no es un dato del DANE ni la meta del Banco de la República.',
    labelEn:
      `Fixed expenses indexed at ${pctLabel(IPC_DEFAULT, 'en')} per year: scenario assumption, ` +
      'not a DANE figure nor the Banco de la República target.',
  };
}

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
 * Retorna exactamente 12 puntos, o `[]` cuando la duración del periodo no es
 * derivable (rango incompleto, saldo de apertura): sin flujo mensual no hay
 * proyección que dibujar (NM-01).
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

  // Flujos mensuales = ingresos netos (4175) y egresos del periodo divididos
  // por los MESES CUBIERTOS por el snapshot (misma regla del preprocesador:
  // 'AAAA-MM', 'AAAA-Qn', rangos), no por 12 fijo (ratios-kpis-03, NM-01).
  const meses = mesesCubiertos(balance.primary);
  if (meses === null) return [];
  const cajaInicial = ct.efectivoCuenta11;
  const ingresoMes = ingresosNetosPeriodo(ct) / meses;
  const egresoMes = ct.gastos / meses;

  const gastosFijosPeriodo = sumFixedExpenses(claseGastos);
  const gastosFijosMes = gastosFijosPeriodo / meses;
  const gastosVariablesMes = Math.max(0, egresoMes - gastosFijosMes);

  const factorBase = FACTOR_BASE + (opts.growthOverride ?? 0);
  const ipcRate = describeIpcAssumption(opts).rate;

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
