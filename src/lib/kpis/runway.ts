/**
 * Runway de caja 36 meses · 3 escenarios (vista Comando, valoracion-24).
 *
 * Flujo mensual = (ingresos netos del periodo − egresos del periodo) / meses
 * cubiertos. Sin meses cubiertos derivables no hay runway (nunca 12 supuestos).
 *
 * No hay «salidas fiscales» en esta serie: la versión anterior restaba
 * 35 % × utilidad neta / 12, una utilidad ya neta del impuesto (5405 dentro
 * de los gastos) y repartida por meses aunque la renta se paga en cuotas del
 * calendario DIAN. Los escenarios son SUPUESTOS DE SENSIBILIDAD sobre los
 * ingresos (no pronósticos) y se exportan con su rótulo.
 */

export interface RunwayMes {
  month: string;
  base: number;
  conservador: number;
  agresivo: number;
}

export const RUNWAY_ESCENARIOS = {
  conservador: {
    factorIngresos: 0.85,
    rotulo: 'Supuesto de sensibilidad: ingresos −15 %, egresos sin cambio (no es un pronóstico)',
    rotuloEn: 'Sensitivity assumption: revenue −15%, expenses unchanged (not a forecast)',
  },
  agresivo: {
    factorIngresos: 1.1,
    rotulo: 'Supuesto de sensibilidad: ingresos +10 %, egresos sin cambio (no es un pronóstico)',
    rotuloEn: 'Sensitivity assumption: revenue +10%, expenses unchanged (not a forecast)',
  },
} as const;

export interface RunwayInput {
  /** Ingresos netos del periodo (COP). */
  ingresosPeriodo: number;
  /** Egresos del periodo (COP, clases 5-7). */
  egresosPeriodo: number;
  /** Caja inicial (cuenta 11, COP). */
  cajaInicial: number;
  /** Meses que cubre el periodo; null ⇒ sin runway. */
  meses: number | null;
  /** Mes de arranque de la serie. */
  desde: Date;
  /** Número de meses a proyectar (default 36). */
  horizonte?: number;
}

export function buildRunway(input: RunwayInput): RunwayMes[] {
  const { meses } = input;
  if (meses === null || !(meses > 0)) return [];
  if (![input.ingresosPeriodo, input.egresosPeriodo, input.cajaInicial].every(Number.isFinite)) return [];
  const ingresoMes = input.ingresosPeriodo / meses;
  const egresoMes = input.egresosPeriodo / meses;
  const horizonte = input.horizonte ?? 36;
  const out: RunwayMes[] = [];
  let base = input.cajaInicial;
  let cons = input.cajaInicial;
  let agr = input.cajaInicial;
  for (let i = 0; i < horizonte; i++) {
    const d = new Date(input.desde.getTime());
    d.setDate(1);
    d.setMonth(d.getMonth() + i);
    const month = d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
    out.push({ month, base, conservador: cons, agresivo: agr });
    base = base + ingresoMes - egresoMes;
    cons = cons + ingresoMes * RUNWAY_ESCENARIOS.conservador.factorIngresos - egresoMes;
    agr = agr + ingresoMes * RUNWAY_ESCENARIOS.agresivo.factorIngresos - egresoMes;
  }
  return out;
}
