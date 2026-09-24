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
  | 'ingresosOperacionales'
  | 'utilidadBruta'
  | 'ebit'
  | 'otrosIngresos'
  | 'gastosNoOperacionales'
  | 'gastos'
  | 'gastosClase5'
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
  ingresosOperacionales: 'Ingresos operacionales netos (grupo 41 − devoluciones 4175)',
  utilidadBruta: 'Utilidad Bruta',
  ebit: 'Resultado Operacional (EBIT)',
  otrosIngresos: 'Otros ingresos no operacionales (grupo 42 y demás grupos de clase 4 distintos del 41)',
  gastosNoOperacionales: 'Gastos no operacionales (grupo 53 y demás grupos de clase 5 salvo 51, 52 y 54)',
  gastos: 'Total Gastos',
  gastosClase5: 'Total Gastos operacionales y no operacionales (Clase 5)',
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

const ZERO = BigInt(0);

/**
 * Σ en centavos de las cuentas HOJA de una clase PUC, opcionalmente acotada a
 * unos prefijos de grupo. Es la misma proyección que usa
 * `contracts/deterministic-breakdown.ts` para el Balance: sumar hojas por
 * código PUC no es criterio contable, es aritmética.
 *
 * Sólo hojas: sumar además los niveles agregados duplicaría todo.
 */
function sumLeafCents(
  snapshot: PeriodSnapshot,
  classCode: number,
  groupPrefixes?: readonly string[],
): bigint {
  const puc = snapshot.classes?.find((c) => c.code === classCode);
  if (!puc) return ZERO;
  let total = ZERO;
  for (const account of puc.accounts) {
    if (!account.isLeaf) continue;
    const code = String(account.code).replace(/\D/g, '');
    if (code.length === 0) continue;
    if (groupPrefixes && !groupPrefixes.some((p) => code.startsWith(p))) continue;
    total += pesosToCents(account.balance);
  }
  return total;
}

/**
 * Σ FIRMADA en centavos de las hojas de la clase 4 que cumplen un predicado de
 * código. La clase 4 puede venir en convención firmada (créditos negativos) o
 * de magnitudes; la orientación se resuelve fuera, con el signo del total
 * ordinario, igual que `trial-balance.ts`.
 */
function sumClass4LeafCents(snapshot: PeriodSnapshot, predicate: (code: string) => boolean): bigint {
  const puc = snapshot.classes?.find((c) => c.code === 4);
  if (!puc) return ZERO;
  let total = ZERO;
  for (const account of puc.accounts) {
    if (!account.isLeaf) continue;
    const code = String(account.code).replace(/\D/g, '');
    if (code.length === 0 || !predicate(code)) continue;
    total += pesosToCents(account.balance);
  }
  return total;
}

/**
 * Cascada del P&G del periodo, en centavos exactos.
 *
 * Por qué se derivan aquí y no se leen de `controlTotals`: el preprocesador
 * publica `ebit` como `number` en pesos y NO publica la Utilidad Bruta en
 * centavos. Un ancla con tolerancia $0 no puede colgar de un `float`.
 *
 * Por qué esto NO es "otra implementación de la cascada" —el patrón que la
 * auditoría integral nombró como causa raíz—: la derivación se acepta SÓLO si
 * reproduce, al centavo, cifras que el preprocesador ya calculó por su cuenta
 * (`ingresosNetos`, `gastos`, `impuestoCausado` y `utilidadAntesImpuestos`). Si
 * el balance tiene una forma que rompe la equivalencia, la función devuelve
 * `null` y el informe se queda SIN ancla de UB/EBIT. Ningún ancla es mejor que
 * un ancla equivocada.
 *
 * Definición (enmienda spec v2.1 del 2026-09-24, decisión del coordinador;
 * auditoría niif-contrato-01): el grupo PUC 42 (ingresos NO operacionales,
 * Decreto 2650/1993) va DEBAJO de la utilidad operacional, igual que el 53.
 *   Ingresos operacionales netos = Σ 41 (salvo 4175) − devoluciones 4175
 *   Utilidad Bruta = ingresos operacionales netos − (Clase 6 + Clase 7)
 *   EBIT           = Utilidad Bruta − Grupo 51 − Grupo 52
 *   UAI            = EBIT + otros ingresos (42…) − gastos no operacionales
 *                    (53 y resto de clase 5 salvo 54)   ← la que se contrasta
 */
function deriveGrossAndEbitCents(
  snapshot: PeriodSnapshot,
  cents: { ingresosNetos: bigint; gastos: bigint; impuestoCausado: bigint; utilidadAntesImpuestos: bigint },
): {
  ingresosOperacionales: bigint;
  otrosIngresos: bigint;
  utilidadBruta: bigint;
  ebit: bigint;
  gastosNoOperacionales: bigint;
  gastosClase5: bigint;
} | null {
  const clase5 = sumLeafCents(snapshot, 5);
  const clase6 = sumLeafCents(snapshot, 6);
  const clase7 = sumLeafCents(snapshot, 7);
  const grupo51 = sumLeafCents(snapshot, 5, ['51']);
  const grupo52 = sumLeafCents(snapshot, 5, ['52']);
  const grupo54 = sumLeafCents(snapshot, 5, ['54']);

  // Guarda 1 — la proyección por hojas reproduce el gasto total del preprocesador.
  if (clase5 + clase6 + clase7 !== cents.gastos) return null;
  // Guarda 2 — y su grupo 54 es exactamente el impuesto causado que ya publicó.
  if (grupo54 !== cents.impuestoCausado) return null;

  // Ingresos: la misma regla de signo de `trial-balance.ts` (magnitud del total
  // ordinario firmado; devoluciones 4175 por su magnitud).
  const ordinarias = sumClass4LeafCents(snapshot, (code) => !code.startsWith('4175'));
  const devoluciones = sumClass4LeafCents(snapshot, (code) => code.startsWith('4175'));
  const signo = ordinarias < ZERO ? BigInt(-1) : BigInt(1);
  const absBig = (v: bigint): bigint => (v < ZERO ? -v : v);
  // Guarda 0 — la proyección por hojas reproduce los ingresos netos publicados.
  if (absBig(ordinarias) - absBig(devoluciones) !== cents.ingresosNetos) return null;

  const operacionales41 =
    sumClass4LeafCents(snapshot, (code) => code.startsWith('41') && !code.startsWith('4175')) * signo;
  const ingresosOperacionales = operacionales41 - absBig(devoluciones);
  // Por diferencia: 41 + 42 (y cualquier otro grupo de la clase 4) = netos exactos.
  const otrosIngresos = cents.ingresosNetos - ingresosOperacionales;

  const utilidadBruta = ingresosOperacionales - (clase6 + clase7);
  const ebit = utilidadBruta - grupo51 - grupo52;
  const gastosNoOperacionales = clase5 - grupo51 - grupo52 - grupo54;

  // Guarda 3 — la cascada completa aterriza en la UAI que el preprocesador ya
  // calculó por otra vía (`ingresosNetos − (gastos − impuesto)`). Si coincide,
  // las dos rutas son la misma cifra y UB/EBIT son tan vinculantes como ella.
  if (ebit + otrosIngresos - gastosNoOperacionales !== cents.utilidadAntesImpuestos) return null;

  return {
    ingresosOperacionales,
    otrosIngresos,
    utilidadBruta,
    ebit,
    gastosNoOperacionales,
    gastosClase5: clase5,
  };
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

  // Utilidad Bruta y EBIT — las cuatro cifras (dos por periodo) que la
  // auditoría 2026-08 midió como LIBRES: `+$500.000.000` en
  // `grossProfitPrimary` producía 0 errores, 0 warnings y descarga habilitada,
  // y la cifra falsa se promovía a binding figure del HTML.
  //
  // Sólo se emiten cuando el snapshot trae la representación en centavos
  // completa: derivar la cascada desde `number` en pesos reintroduce el
  // redondeo que el contrato MoneyCop existe para eliminar.
  if (
    typeof c?.ingresosNetos === 'bigint' &&
    typeof c?.gastos === 'bigint' &&
    typeof c?.impuestoCausado === 'bigint' &&
    typeof c?.utilidadAntesImpuestos === 'bigint'
  ) {
    const derived = deriveGrossAndEbitCents(snapshot, {
      ingresosNetos: c.ingresosNetos,
      gastos: c.gastos,
      impuestoCausado: c.impuestoCausado,
      utilidadAntesImpuestos: c.utilidadAntesImpuestos,
    });
    if (derived) {
      cents.ingresosOperacionales = derived.ingresosOperacionales;
      cents.otrosIngresos = derived.otrosIngresos;
      cents.utilidadBruta = derived.utilidadBruta;
      cents.ebit = derived.ebit;
      cents.gastosNoOperacionales = derived.gastosNoOperacionales;
      cents.gastosClase5 = derived.gastosClase5;
    }
  }

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
