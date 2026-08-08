// ---------------------------------------------------------------------------
// Anclas del reporte — fuente única de las cifras vinculantes
// ---------------------------------------------------------------------------
// El preprocesador calcula los totales de forma determinista y exacta, en
// BigInt de centavos (`controlTotals.cents`). El LLM debe COPIARLOS, no
// recalcularlos: es lo que el prompt le pide y lo que el validador comprueba.
//
// El problema que este módulo resuelve (auditoría 2026-08, P0
// `anclas-en-pesos-schema-en-centavos`): el bloque TOTALES VINCULANTES emitía
// las anclas en PESOS con separadores es-CO —`$4.196.558.242,90`— mientras el
// contrato `MoneyCop` exige CENTAVOS enteros como string —`419655824290`—.
// Cada cifra "vinculante" obligaba al modelo a des-formatear el número y
// multiplicarlo por cien. Un anclaje que exige aritmética del modelo no es un
// anclaje: es una invitación a que se equivoque, y explica por qué el prompt
// ordena "NO recalcular" algo que sólo se puede obtener recalculando.
//
// La solución es emitir AMBAS representaciones: la legible, para que el modelo
// entienda la magnitud y pueda redactar sobre ella, y el token literal
// `[MoneyCop: N]`, que es el que debe copiar carácter por carácter al schema.
//
// Estas mismas anclas son las que el validador cruza contra el reporte
// devuelto (reglas E9 y E14) y contra las que el reconciliador determinista
// sobrescribe cualquier desviación.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';
import { pesosToCents } from '@/lib/preprocessing/curator-rules/sync-control-totals';

/**
 * Claves de ancla. Son las cifras que el preprocesador calcula de forma
 * determinista y que el LLM nunca debería autorar.
 */
export type AnchorKey =
  | 'activo'
  | 'pasivo'
  | 'patrimonio'
  | 'ingresos'
  | 'ingresosNetos'
  | 'gastos'
  | 'utilidadAntesImpuestos'
  | 'impuestoCausado'
  | 'utilidadNeta'
  | 'efectivoCuenta11';

/** Ancla de un período: centavos exactos + presentación legible. */
export interface PeriodAnchors {
  period: string;
  /** Centavos exactos por clave. Ausente si el snapshot no lo trae. */
  cents: Partial<Record<AnchorKey, bigint>>;
}

/** Etiquetas legibles, tal como aparecen en el bloque vinculante. */
export const ANCHOR_LABELS: Record<AnchorKey, string> = {
  activo: 'Total Activo',
  pasivo: 'Total Pasivo',
  patrimonio: 'Total Patrimonio',
  ingresos: 'Total Ingresos (bruto Clase 4)',
  ingresosNetos: 'Total Ingresos Netos',
  gastos: 'Total Gastos',
  utilidadAntesImpuestos: 'Utilidad Antes de Impuestos (UAI)',
  impuestoCausado: 'Impuesto de Renta causado del periodo',
  utilidadNeta: 'Utilidad Neta',
  efectivoCuenta11: 'Efectivo al cierre (PUC 11)',
};

/**
 * Token literal que el modelo debe copiar al campo `MoneyCop` del schema.
 * El formato es exactamente el que exige el contrato: entero con signo
 * opcional, sin separadores.
 */
export function moneyCopToken(cents: bigint): string {
  return `[MoneyCop: ${cents.toString(10)}]`;
}

/**
 * Extrae las anclas de un snapshot ya procesado por el curator.
 *
 * Prefiere SIEMPRE `controlTotals.cents` (BigInt exacto). Sólo cae a convertir
 * desde el `number` cuando el snapshot no trae la representación en centavos
 * —caso de consumidores legacy y de tests que construyen `ControlTotals` a
 * mano—, y en ese caso el redondeo al centavo se hace una sola vez.
 */
export function buildPeriodAnchors(snapshot: PeriodSnapshot | undefined): PeriodAnchors | null {
  if (!snapshot?.controlTotals) return null;
  // UAI e impuesto causado sólo existen en la representación `cents` del
  // contrato; el nivel `number` no los declara. El lookup laxo cubre los
  // snapshots legacy que sí los traen sueltos.
  const t = snapshot.controlTotals as typeof snapshot.controlTotals & {
    utilidadAntesImpuestos?: number;
    impuestoCausado?: number;
  };
  const c = t.cents;
  const cents: Partial<Record<AnchorKey, bigint>> = {};

  const put = (key: AnchorKey, fromCents: bigint | undefined, fromPesos: number | undefined) => {
    if (typeof fromCents === 'bigint') {
      cents[key] = fromCents;
      return;
    }
    if (typeof fromPesos === 'number' && Number.isFinite(fromPesos)) {
      cents[key] = pesosToCents(fromPesos);
    }
  };

  put('activo', c?.activo, t.activo);
  put('pasivo', c?.pasivo, t.pasivo);
  put('patrimonio', c?.patrimonio, t.patrimonio);
  put('ingresos', c?.ingresos, t.ingresos);
  put('ingresosNetos', c?.ingresosNetos, t.ingresosNetos);
  put('gastos', c?.gastos, t.gastos);
  put('utilidadAntesImpuestos', c?.utilidadAntesImpuestos, t.utilidadAntesImpuestos);
  put('impuestoCausado', c?.impuestoCausado, t.impuestoCausado);
  put('utilidadNeta', c?.utilidadNeta, t.utilidadNeta);
  put('efectivoCuenta11', c?.efectivoCuenta11, t.efectivoCuenta11);

  return { period: snapshot.period, cents };
}

/**
 * Anclas de un reporte completo: período principal y comparativo.
 * `primary` es el año que el cliente firma — hasta la auditoría 2026-08 era
 * justamente el único que NO se cruzaba contra el preprocesador.
 */
export interface ReportAnchors {
  primary: PeriodAnchors | null;
  comparative: PeriodAnchors | null;
}

export function buildReportAnchors(
  primary: PeriodSnapshot | undefined,
  comparative: PeriodSnapshot | undefined,
): ReportAnchors {
  return {
    primary: buildPeriodAnchors(primary),
    comparative: buildPeriodAnchors(comparative),
  };
}
