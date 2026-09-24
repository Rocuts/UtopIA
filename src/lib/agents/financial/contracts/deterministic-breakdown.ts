// ---------------------------------------------------------------------------
// Desglose determinista del Balance y del Estado de Flujos de Efectivo
// ---------------------------------------------------------------------------
// El desglose del Estado de Situación Financiera NO es un juicio contable: es
// una proyección del balance de prueba. El preprocesador ya tiene todas las
// cuentas auxiliares con sus centavos exactos; agruparlas por grupo PUC y
// sumarlas es aritmética, no criterio.
//
// Por qué existe este módulo: medido con LLM real sobre el balance de un cliente
// real (docs/FASE0_MEDICION_2026-08.md), el modelo copia los TOTALES sin un solo
// error —9/9 anclas exactas en tres corridas— pero omite renglones del desglose
// de forma inestable: el detalle del Activo se quedó corto un 0,10%, un 41,2% y
// un 99,9% según la corrida, y en una de ellas el Pasivo salió con los dos
// encabezados de sección y NINGÚN renglón bajo un total de $1.962.538.849,62.
//
// Se probó primero la vía barata —reinvocar el pase con la brecha exacta en
// pesos inyectada en el prompt— y NO funciona: el bucle dispara, cuesta ~110s, y
// el desglose sigue incompleto. Por eso el desglose pasa a construirlo el
// código.
//
// Qué sigue aportando el modelo: la clasificación corriente / no corriente
// cuando el plazo no se deduce del código PUC, la etiqueta NIIF de cada rubro, y
// toda la narrativa. Este módulo no le quita criterio; le quita la aritmética,
// que es donde falla.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';
import { pesosToCents } from '@/lib/preprocessing/curator-rules/sync-control-totals';
import { DIVIDEND_EVIDENCE_PREFIXES } from '@/lib/preprocessing/curator-rules/dividend-evidence';
import { isContraAsset } from '@/lib/preprocessing/curator-rules/contra-asset-registry';
import {
  isCurrentLiabilityCode,
  isNonCurrentLiabilityCode,
  r1OriginGroup,
} from '@/lib/preprocessing/curator-rules/balance-groups';
import type { EquityChangeRowJson, NiifReportJson } from './niif-report';

const ZERO = BigInt(0);

/** Renglón de detalle listo para inyectar en el Balance. */
export interface BreakdownRow {
  /** Código del grupo PUC de dos dígitos: '11', '13', '22', '31', ... */
  account: string;
  /** Etiqueta NIIF por defecto. El modelo puede afinarla; el monto, no. */
  label: string;
  /** Centavos exactos, en convención natural. */
  cents: bigint;
}

/**
 * Etiquetas NIIF por grupo PUC (Decreto 2650/1993 ↔ NIIF para PYMES).
 *
 * Sólo se listan los grupos que aparecen en un balance de PYME colombiana con
 * frecuencia suficiente para justificar una etiqueta propia. Los que no estén
 * caen a "Grupo NN" — visible y verificable, en vez de desaparecer del informe,
 * que es el fallo que este módulo viene a cerrar.
 */
const GROUP_LABELS: Record<string, string> = {
  // Activo
  '11': 'Efectivo y equivalentes de efectivo',
  '12': 'Inversiones',
  '13': 'Deudores comerciales y otras cuentas por cobrar',
  '14': 'Inventarios',
  '15': 'Propiedades, planta y equipo',
  '16': 'Intangibles',
  '17': 'Diferidos',
  '18': 'Otros activos',
  '19': 'Valorizaciones',
  // Pasivo
  '21': 'Obligaciones financieras',
  '22': 'Proveedores',
  '23': 'Cuentas por pagar',
  '24': 'Impuestos, gravámenes y tasas',
  '25': 'Beneficios a empleados',
  '26': 'Pasivos estimados y provisiones',
  '27': 'Diferidos',
  '28': 'Otros pasivos',
  '29': 'Bonos y papeles comerciales',
  // Patrimonio
  '31': 'Capital social',
  '32': 'Superávit de capital',
  '33': 'Reservas',
  '34': 'Revalorización del patrimonio',
  '35': 'Dividendos o participaciones decretados en acciones',
  '36': 'Resultados del ejercicio',
  '37': 'Resultados de ejercicios anteriores',
  '38': 'Superávit por valorizaciones',
};

/**
 * Grupos PUC de activo que son NO CORRIENTES por naturaleza.
 *
 * NIIF para PYMES §4.5: un activo es corriente si se espera realizar dentro del
 * ciclo normal de operación o de los doce meses siguientes. Para propiedades,
 * planta y equipo, intangibles y valorizaciones la respuesta no depende del
 * caso; para el resto sí, y por eso NO se clasifican aquí — el modelo conserva
 * ese juicio.
 */
const NON_CURRENT_ASSET_GROUPS = new Set(['15', '16', '19']);

/** Grupos PUC de pasivo no corrientes por naturaleza. */
const NON_CURRENT_LIABILITY_GROUPS = new Set(['29']);

export type BreakdownSection = 'assets' | 'liabilities' | 'equity';

const CLASS_BY_SECTION: Record<BreakdownSection, number> = {
  assets: 1,
  liabilities: 2,
  equity: 3,
};

/** Clases PUC que participan del EFE: el flujo de caja es el residuo del Balance. */
const CASH_FLOW_CLASSES = new Set([1, 2, 3]);

/**
 * Construye el desglose por grupo PUC de un estado, desde las cuentas del
 * snapshot. La suma de los renglones devueltos es EXACTAMENTE el total de la
 * clase — es la misma cifra, agregada de otra forma.
 *
 * Las cuentas correctoras conservan su signo negativo: NIC 16.73 y NIIF PYMES
 * 17.31 exigen presentar el importe en libros neto, y agregar por grupo lo hace
 * de forma natural (la 1592 vive dentro del grupo 15 y lo reduce).
 */
export function buildDeterministicBreakdown(
  snapshot: PeriodSnapshot,
  section: BreakdownSection,
): BreakdownRow[] {
  const classCode = CLASS_BY_SECTION[section];
  const puc = snapshot.classes.find((c) => c.code === classCode);
  if (!puc) return [];

  const byGroup = new Map<string, bigint>();
  for (const account of puc.accounts) {
    // Sólo hojas: sumar además los niveles agregados duplicaría todo.
    if (!account.isLeaf) continue;
    const code = String(account.code).replace(/\D/g, '');
    if (code.length < 2) continue;
    const group = code.slice(0, 2);
    byGroup.set(group, (byGroup.get(group) ?? ZERO) + pesosToCents(account.balance));
  }

  return [...byGroup.entries()]
    .filter(([, cents]) => cents !== ZERO)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, cents]) => ({
      account: group,
      label: GROUP_LABELS[group] ?? `Grupo ${group}`,
      cents,
    }));
}

/**
 * `true` si el grupo es no corriente por naturaleza. Lo consume el prompt para
 * decirle al modelo qué NO tiene que decidir.
 */
export function isNonCurrentGroup(section: BreakdownSection, group: string): boolean {
  if (section === 'assets') return NON_CURRENT_ASSET_GROUPS.has(group);
  if (section === 'liabilities') return NON_CURRENT_LIABILITY_GROUPS.has(group);
  return false;
}

/**
 * Rótulo NIIF del grupo PUC de dos dígitos del Estado de Situación Financiera,
 * o `null` si el grupo no tiene rótulo propio. Auditoría 2026-09-24
 * (e2e-niif-09): el renglón "13" salía rotulado "Inventarios de mercancía";
 * el rótulo de un grupo PUC es un dato del catálogo (Decreto 2650/1993), no
 * redacción del modelo.
 */
export function balanceGroupLabel(group: string): string | null {
  return Object.prototype.hasOwnProperty.call(GROUP_LABELS, group) ? GROUP_LABELS[group] : null;
}

// ---------------------------------------------------------------------------
// Libro de hojas del balance de prueba (auditoría 2026-09-24, e2e-niif-02/05/06/08)
// ---------------------------------------------------------------------------
// El validador ancla cada renglón con código PUC de los cuatro estados a la
// suma de las hojas del balance de prueba que ese código agrupa. Es la misma
// proyección que `buildDeterministicBreakdown` (hojas, centavos exactos, clase
// por pertenencia en el snapshot), expuesta como lista para que el validador
// no dependa del shape del preprocesador.
// ---------------------------------------------------------------------------

/** Una cuenta hoja del balance de prueba, en centavos exactos (convención natural del snapshot). */
export interface LedgerLeaf {
  /** Sólo dígitos del código PUC (`2895VC` → `2895`). */
  code: string;
  /** Clase PUC bajo la que el snapshot publica la cuenta (1..7). */
  classCode: number;
  cents: bigint;
  /**
   * Clases 1 y 2: plazo con el que el preprocesador cuenta la hoja en
   * `controlTotals.activoCorriente` / `pasivoCorriente` (excepción de
   * vencimiento declarada, virtual de R1 por su origen, grupo PUC); `null` si
   * no es determinable. Ausente en el resto de clases y en hojas construidas a
   * mano. Con él, E27 contrasta los subtotales corriente / no corriente del ESF
   * contra esas anclas (integración I4).
   */
  term?: BalanceTerm | null;
}

/**
 * Hojas de las clases 1 a 7 de un snapshot ya curado. La clase es la de
 * pertenencia en el snapshot (R1 publica un activo negativo en la clase 2),
 * igual que el desglose determinista del ESF.
 */
export function buildLedgerLeaves(snapshot: PeriodSnapshot): LedgerLeaf[] {
  const out: LedgerLeaf[] = [];
  const declared = {
    assets: declaredTermsOf(snapshot, 'assets'),
    liabilities: declaredTermsOf(snapshot, 'liabilities'),
  };
  for (const puc of snapshot.classes ?? []) {
    if (puc.code < 1 || puc.code > 7) continue;
    const section = puc.code === 1 ? 'assets' : puc.code === 2 ? 'liabilities' : null;
    for (const account of puc.accounts) {
      if (!account.isLeaf) continue;
      const rawCode = String(account.code).trim();
      const code = rawCode.replace(/\D/g, '');
      if (code.length === 0) continue;
      const leaf: LedgerLeaf = { code, classCode: puc.code, cents: pesosToCents(account.balance) };
      if (section) {
        leaf.term = code.length < 2 ? null : termOfAccount(section, rawCode, code.slice(0, 2), declared[section]);
      }
      out.push(leaf);
    }
  }
  return out;
}

/**
 * Clasificación corriente / no corriente por grupo PUC que usa el
 * preprocesador para `controlTotals.activoCorriente` / `pasivoCorriente`
 * (`trial-balance.ts`: activo 11-14 / 15-19; pasivo 21-26 / 27-29). Es la
 * misma partición, así que los subtotales que produce el completado
 * determinista coinciden con esas anclas por construcción.
 *
 * Auditoría 2026-09 (niif-contrato-07): el completado del ESF reemplazaba la
 * sección por renglones de grupo sin subtotales y la clasificación
 * corriente/no corriente (NIIF PYMES 4.4) desaparecía del informe.
 */
const TERM_BY_GROUP: Record<'assets' | 'liabilities', Record<string, 'current' | 'nonCurrent'>> = {
  assets: {
    '11': 'current', '12': 'current', '13': 'current', '14': 'current',
    '15': 'nonCurrent', '16': 'nonCurrent', '17': 'nonCurrent', '18': 'nonCurrent', '19': 'nonCurrent',
  },
  liabilities: {
    '21': 'current', '22': 'current', '23': 'current', '24': 'current', '25': 'current', '26': 'current',
    '27': 'nonCurrent', '28': 'nonCurrent', '29': 'nonCurrent',
  },
};

export function termOfGroup(
  section: BreakdownSection,
  group: string,
): 'current' | 'nonCurrent' | null {
  if (section === 'equity') return null;
  const map = TERM_BY_GROUP[section];
  return Object.prototype.hasOwnProperty.call(map, group) ? map[group] : null;
}

export type BalanceTerm = 'current' | 'nonCurrent';

/** Renglón del desglose del ESF con el plazo con el que el preprocesador lo cuenta. */
export interface TermBreakdownRow extends BreakdownRow {
  /** `null` en patrimonio o si el plazo no es determinable desde el código. */
  term: BalanceTerm | null;
}

/**
 * Plazo con el que el preprocesador cuenta UNA cuenta del snapshot en
 * `controlTotals.activoCorriente` / `pasivoCorriente` (integración P4-b):
 *
 *   1. la excepción de vencimiento declarada por el usuario que el
 *      preprocesador aplicó (`snapshot.vencimientosAplicados`, por código);
 *   2. las virtuales de R1 (`2810ZZ-130505`) siguen al grupo de su cuenta de
 *      ORIGEN (`isCurrentLiabilityCode`, niif-preproceso-22), no al prefijo 28;
 *   3. el resto, por grupo PUC (`termOfGroup`).
 *
 * `declared` es el mapa código → plazo de la sección (ver `declaredTermsOf`).
 */
function termOfAccount(
  section: BreakdownSection,
  rawCode: string,
  group: string,
  declared: ReadonlyMap<string, BalanceTerm>,
): BalanceTerm | null {
  if (section === 'equity') return null;
  const override = declared.get(rawCode);
  if (override) return override;
  if (section === 'liabilities' && r1OriginGroup(rawCode) !== null) {
    if (isCurrentLiabilityCode(rawCode)) return 'current';
    if (isNonCurrentLiabilityCode(rawCode)) return 'nonCurrent';
    return null;
  }
  return termOfGroup(section, group);
}

/** Excepciones de vencimiento aplicadas por el preprocesador a una sección, por código de cuenta. */
function declaredTermsOf(snapshot: PeriodSnapshot, section: BreakdownSection): Map<string, BalanceTerm> {
  const seccion = section === 'assets' ? 'activo' : section === 'liabilities' ? 'pasivo' : null;
  const out = new Map<string, BalanceTerm>();
  if (seccion === null) return out;
  for (const a of snapshot.vencimientosAplicados ?? []) {
    if (a.seccion !== seccion) continue;
    out.set(a.codigo, a.vencimiento === 'corriente' ? 'current' : 'nonCurrent');
  }
  return out;
}

/**
 * Desglose por grupo PUC PARTIDO por plazo (integración P4-b, auditoría
 * 2026-09-24). `buildDeterministicBreakdown` agrega por grupo de dos dígitos y
 * el completado del ESF ubicaba cada grupo por `termOfGroup`; con excepciones
 * de vencimiento declaradas (1205 → no corriente) o con virtuales de R1
 * (`2810ZZ-13xxxx`, pasivo corriente por su origen) el subtotal impreso del ESF
 * no era `controlTotals.activoCorriente` / `pasivoCorriente`, las cifras de los
 * KPIs de liquidez, del gate y del PDF.
 *
 * Cada hoja se clasifica con `termOfAccount` (la misma regla del preprocesador)
 * y se agrega por (grupo, plazo): un grupo con cuentas de los dos plazos da
 * DOS renglones con el mismo código de grupo, uno en cada bloque. Σ renglones
 * de un plazo = subtotal del preprocesador al centavo; Σ de los renglones de
 * un grupo = el renglón de `buildDeterministicBreakdown`. Sin excepciones ni
 * virtuales de R1 devuelve exactamente los renglones de
 * `buildDeterministicBreakdown` con `term = termOfGroup(grupo)`.
 */
export function buildDeterministicBreakdownByTerm(
  snapshot: PeriodSnapshot,
  section: BreakdownSection,
): TermBreakdownRow[] {
  const classCode = CLASS_BY_SECTION[section];
  const puc = snapshot.classes.find((c) => c.code === classCode);
  if (!puc) return [];
  const declared = declaredTermsOf(snapshot, section);

  const byKey = new Map<string, { group: string; term: BalanceTerm | null; cents: bigint }>();
  for (const account of puc.accounts) {
    if (!account.isLeaf) continue;
    const rawCode = String(account.code).trim();
    const code = rawCode.replace(/\D/g, '');
    if (code.length < 2) continue;
    const group = code.slice(0, 2);
    const term = termOfAccount(section, rawCode, group, declared);
    const key = `${group}|${term ?? ''}`;
    const prev = byKey.get(key);
    const cents = pesosToCents(account.balance);
    if (prev) prev.cents += cents;
    else byKey.set(key, { group, term, cents });
  }

  const order = (t: BalanceTerm | null) => (t === 'current' ? 0 : t === 'nonCurrent' ? 1 : 2);
  return [...byKey.values()]
    .filter((r) => r.cents !== ZERO)
    .sort((a, b) => a.group.localeCompare(b.group) || order(a.term) - order(b.term))
    .map((r) => ({
      account: r.group,
      label: GROUP_LABELS[r.group] ?? `Grupo ${r.group}`,
      cents: r.cents,
      term: r.term,
    }));
}

// ===========================================================================
// Desglose determinista del Estado de Flujos de Efectivo (EFE indirecto)
// ===========================================================================
//
// Por qué existe (auditoría 2026-08-08, superficie peor puntuada: 1/10):
// el EFE que veía el cliente lo autoraba el LLM y NADIE lo cruzaba. Medido
// sobre el balance del cliente real:
//   - la sección de operación listaba 8 renglones que sumaban $834.754.377,59
//     bajo un subtotal impreso de $2.421.190.071,93 (hueco del 65,5%);
//   - la sección de financiación salía con CERO renglones bajo
//     ($1.570.997.737,30), cifra que el curator R2 llama "dividendos
//     estimados" y que el modelo publicó verbatim en la Nota 6 con cita
//     normativa de respaldo. En el balance NO existe la cuenta 2360
//     (Dividendos o participaciones por pagar): el dividendo no existió.
//     Es 2,09× la facturación del año. NIC 7 ¶43 prohíbe exactamente eso.
//
// La corrección NO es parchar el dividendo: es construir el EFE como lo que
// contablemente ES — el residuo del Balance. Si la ecuación A = P + K cierra
// en los dos periodos (el Curator lo garantiza), entonces
//
//     Δ Efectivo  ≡  Σ Δ Pasivo + Σ Δ Patrimonio − Σ Δ Activo-no-efectivo
//
// es una IDENTIDAD, no una estimación. Basta con repartir CADA grupo PUC
// distinto del 11 en exactamente una sección (operación / inversión /
// financiación) para que:
//   1. la suma de los renglones sea el subtotal de la sección POR CONSTRUCCIÓN;
//   2. la suma de las tres secciones sea la variación observada de la caja,
//      con brecha $0 al centavo;
//   3. ninguna partida se invente: cada renglón es la variación de un grupo
//      PUC que está en el balance de prueba.
//
// Medido sobre `grupo-empresarial-2tres-sas.xlsx` (2024 → 2025): operación
// $853.109.000,63 en 8 renglones, inversión ($2.916.666,00) en 1 renglón,
// financiación $0,00 en 0 renglones, Σ = $850.192.334,63 = Δ PUC 11 exacto,
// brecha $0,00. El "dividendo" de $1.570.997.737,30 desaparece porque era, al
// centavo, el resultado de ejercicios anteriores arrastrado en el patrimonio
// de apertura (PUC 3605 sin asiento de cierre) más el residuo del cierre
// virtual R8 — una partida NO monetaria de operación, no una salida de caja.
// ---------------------------------------------------------------------------

export type CashFlowSectionKey = 'operating' | 'investing' | 'financing';

export interface DeterministicCashFlowSection {
  section: CashFlowSectionKey;
  /** Renglones en orden de presentación. Σ `cents` === `netFlowCents`. */
  rows: BreakdownRow[];
  /** Subtotal de la sección. Es la suma de `rows`, no una cifra aparte. */
  netFlowCents: bigint;
}

export interface DeterministicCashFlow {
  primaryPeriod: string;
  comparativePeriod: string;
  sections: DeterministicCashFlowSection[];
  cashOpeningCents: bigint;
  cashClosingCents: bigint;
  /** Σ de los tres subtotales. */
  netChangeCents: bigint;
  /** cashClosing − cashOpening, según `controlTotals.efectivoCuenta11`. */
  observedChangeCents: bigint;
  reconciliationGapCents: bigint;
  /** Tolerancia $0: la identidad contable no admite "casi". */
  reconciled: boolean;
  /**
   * Evidencia REAL de distribución a socios. `found=false` ⇒ el EFE NO puede
   * presentar dividendos, ni "estimados" ni de ninguna otra clase.
   */
  dividendEvidence: {
    found: boolean;
    accounts: string[];
    cashFlowCents: bigint;
  };
  /** Grupos PUC que no estaban en el mapa y cayeron al default de su clase. */
  unclassifiedGroups: string[];
  /**
   * Flujo con los socios deducido del patrimonio (auditoría 2026-09,
   * niif-contrato-03/04): Δ(patrimonio salvo 38) − utilidad neta. Los traslados
   * internos (apropiación de reservas, capitalización, 3605 → 37) se anulan
   * dentro del bloque y NO son flujo (NIC 7 ¶43).
   *   - `none`: el patrimonio sólo cambió por el resultado del ejercicio.
   *   - `contribution`: aumento no explicado por el resultado → aportes
   *     (financiación), a verificar con soporte.
   *   - `distribution_pending_support`: disminución no explicada por el
   *     resultado → distribuciones a socios en financiación (NIC 7 ¶34),
   *     pendiente de acta y comprobante de egreso.
   *   - `unreconciled`: disminución con el comparativo SIN cierre contable
   *     (utilidad del periodo posiblemente acumulada): se declara como partida
   *     no conciliada que el contador debe explicar; no se presume ni
   *     distribución ni partida no monetaria.
   */
  ownerFlows: {
    residualCents: bigint;
    classification: 'none' | 'contribution' | 'distribution_pending_support' | 'unreconciled';
  };
  /**
   * Variación de cada grupo patrimonial (31, 32, 33, 34, 35, 37) en signo de
   * patrimonio. Revelación de transacciones no monetarias (NIC 7 ¶43): son
   * traslados internos que se presentan netos dentro del flujo con socios.
   */
  nonCashEquityMovements: BreakdownRow[];
  /**
   * ORI del periodo que no explican las valorizaciones del grupo 19
   * (re-auditoría 2, recalculo-final2-03): Δ38 − Δ19, en signo de patrimonio.
   * Es la revaluación registrada en el propio activo (modelo de revaluación,
   * NIC 16 / NIIF para las PYMES Sección 17), una transacción no monetaria
   * (NIC 7 ¶43 / Sección 7): no entra a operación y se descuenta de la
   * variación del activo de inversión que la registra — `group` cuando el
   * balance tiene un solo grupo de inversión (12, 15, 16, 18); `null` si tiene
   * varios (o ninguno), y entonces el descuento va en un renglón propio de
   * inversión (clave `38`) con rótulo explícito. El campo es `null` sin grupo
   * 38, sin ORI en el periodo (Δ38 = 0) o si Δ38 = Δ19. Se revela en
   * methodNote.
   */
  oriRevaluation: { cents: bigint; group: string | null } | null;
}

/**
 * Reparto grupo PUC → sección del EFE. Es la extensión al EFE de lo que
 * `CLASS_BY_SECTION` hace para el Balance.
 *
 * Criterio (NIC 7 ¶10-¶17 / NIIF PYMES §7.4-§7.6):
 *   - operación: capital de trabajo y partidas que atraviesan el resultado.
 *   - inversión: activos de largo plazo e inversiones (¶16).
 *   - financiación: recursos de acreedores financieros y de los socios (¶17).
 *   - `nonCash`: partidas que NO son flujo de efectivo y que NIC 7 ¶43 manda
 *     excluir del estado y revelar aparte (valorizaciones 19 y su superávit
 *     38). El 19 y el 38 se anulan entre sí; lo que el 19 no explica del 38
 *     es revaluación registrada en el activo y se descuenta de su variación
 *     en inversión (`oriRevaluation`, re-auditoría 2 recalculo-final2-03).
 *     Sólo un 19 que se mueve sin el 38 queda en el renglón conciliatorio de
 *     operación.
 *     La revalorización del patrimonio (34) y los dividendos en acciones (35)
 *     viajan con el bloque patrimonial (`isEquityBlockGroup`).
 *
 * El grupo 11 (disponible) no aparece: es el objetivo de la conciliación.
 */
const CASHFLOW_SECTION_BY_PUC_GROUP: Record<string, CashFlowSectionKey | 'cash' | 'nonCash'> = {
  // --- Clase 1 — Activo ---
  '11': 'cash',
  '12': 'investing',
  '13': 'operating',
  '14': 'operating',
  '15': 'investing',
  '16': 'investing',
  '17': 'operating',
  '18': 'investing',
  '19': 'nonCash',
  // --- Clase 2 — Pasivo ---
  '21': 'financing',
  '22': 'operating',
  '23': 'operating',
  '24': 'operating',
  '25': 'operating',
  '26': 'operating',
  '27': 'operating',
  '28': 'operating',
  '29': 'financing',
  // --- Clase 3 — Patrimonio ---
  '31': 'financing',
  '32': 'financing',
  '33': 'financing',
  '34': 'nonCash',
  '35': 'nonCash',
  '36': 'operating',
  '37': 'operating',
  '38': 'nonCash',
};

/**
 * Excepciones de 4 dígitos que pesan más que el grupo.
 *
 * `2360` — Dividendos o participaciones por pagar (Decreto 2650/1993). Vive en
 * el grupo 23 (cuentas por pagar, operación) pero su movimiento es el ÚNICO
 * flujo de caja a socios que un balance de prueba puede probar: financiación.
 *
 * NO se lista `2365`: en el PUC colombiano `2365` es *Retención en la fuente*,
 * no dividendos. Medido sobre el balance del cliente real, ese balance tiene
 * $17.6M en subcuentas 2365 de retefuente — tomarlo como "evidencia de
 * dividendos" habría dejado viva exactamente la cifra que hay que matar.
 */
const CASHFLOW_SECTION_BY_PUC_SUBACCOUNT: Record<string, CashFlowSectionKey> = {
  '2360': 'financing',
};

/** Etiquetas NIIF de los renglones del EFE, por clave de agregación. */
const CASHFLOW_ROW_LABELS: Record<string, string> = {
  '12': 'Inversiones',
  '13': 'Variación de deudores comerciales y otras cuentas por cobrar',
  '14': 'Variación de inventarios',
  '15': 'Adquisición y disposición de propiedades, planta y equipo',
  '16': 'Adquisición y disposición de activos intangibles',
  '17': 'Variación de gastos pagados por anticipado y diferidos',
  '18': 'Variación de otros activos',
  '21': 'Obtención y pago de obligaciones financieras',
  '22': 'Variación de proveedores',
  '23': 'Variación de cuentas por pagar',
  '24': 'Variación de impuestos, gravámenes y tasas por pagar',
  '25': 'Variación de beneficios a empleados por pagar',
  '26': 'Variación de pasivos estimados y provisiones',
  '27': 'Variación de pasivos diferidos',
  '28': 'Variación de otros pasivos',
  '29': 'Emisión y redención de bonos y papeles comerciales',
  '2360': 'Dividendos pagados a socios (PUC 2360)',
};

/**
 * Renglón de inversión que descuenta la revaluación reconocida en el ORI
 * cuando el balance tiene varios grupos de inversión (o ninguno) y no se puede
 * atribuir a uno (ver `DeterministicCashFlow.oriRevaluation`).
 */
const ORI_REVALUATION_ROW_LABEL =
  'Revaluación de activos reconocida en el ORI (partida no monetaria, NIC 7 ¶43): se descuenta de la ' +
  'variación de los activos de inversión';

/** Etiquetas de los grupos patrimoniales para la revelación no monetaria. */
const EQUITY_MOVEMENT_LABELS: Record<string, string> = {
  '31': 'Capital social',
  '32': 'Superávit de capital',
  '33': 'Reservas',
  '34': 'Revalorización del patrimonio',
  '35': 'Dividendos o participaciones decretados en acciones',
  '37': 'Resultados de ejercicios anteriores',
};

/**
 * Grupos del bloque patrimonial cuyo movimiento interno se anula contra el
 * resultado (auditoría niif-contrato-03). El 38 (superávit por valorizaciones)
 * queda fuera: su contrapartida es el 19 o el activo revaluado, y ambos son
 * partida no monetaria (ver `oriRevaluation`).
 */
function isEquityBlockGroup(group: string): boolean {
  return group.startsWith('3') && group !== '38';
}

/**
 * Correctoras cuyo movimiento es gasto no monetario del periodo (depreciación,
 * amortización, agotamiento, deterioro). Registro canónico del repo
 * (`contra-asset-registry`). Las provisiones de cartera (1399) e inventarios
 * (1499) se quedan dentro del capital de trabajo, que ya se presenta neto.
 */
function isNonCashContraAccount(code: string): boolean {
  if (!isContraAsset(code)) return false;
  const c = code.replace(/\D/g, '');
  return !c.startsWith('1399') && !c.startsWith('1499');
}


/**
 * Cuentas que prueban una distribución a socios. `2360` es la obligación
 * reconocida cuando la asamblea decreta (Art. 155 C.Co.); el grupo `35` es el
 * dividendo decretado en acciones, que NO es flujo de efectivo (NIC 7 ¶43)
 * pero sí es evidencia de que hubo distribución.
 */
// La lista canónica vive en preprocessing — ver `curator-rules/dividend-evidence.ts`.
// Se importa en vez de redeclararse para que R2 y el EFE no puedan divergir.

interface LeafBalance {
  cents: bigint;
  /** Clase PUC bajo la que el snapshot tiene la cuenta: 1, 2 o 3. */
  classCode: number;
}

/**
 * Suma en centavos de las cuentas HOJA de las clases 1/2/3, por código.
 *
 * La CLASE se toma de la pertenencia en el snapshot, no del primer dígito del
 * código: el curator reclasifica cuentas (R1 mueve un activo negativo a la
 * virtual `2895VC`) y el signo del flujo debe seguir a la clase con la que el
 * Balance publica la cuenta, no a su código de origen.
 */
function leafCentsByCode(snapshot: PeriodSnapshot): Map<string, LeafBalance> {
  const map = new Map<string, LeafBalance>();
  for (const puc of snapshot.classes) {
    if (!CASH_FLOW_CLASSES.has(puc.code)) continue;
    for (const account of puc.accounts) {
      // Sólo hojas: sumar además los niveles agregados duplicaría el flujo.
      if (!account.isLeaf) continue;
      const code = String(account.code);
      const prev = map.get(code);
      const cents = pesosToCents(account.balance);
      if (prev) prev.cents += cents;
      else map.set(code, { cents, classCode: puc.code });
    }
  }
  return map;
}

function pucGroupOf(code: string): string {
  return code.replace(/\D/g, '').slice(0, 2);
}

function subaccountOf(code: string): string {
  return code.replace(/\D/g, '').slice(0, 4);
}

// Accesores tipados: el tsconfig no tiene `noUncheckedIndexedAccess`, así que
// indexar un Record devuelve el tipo del valor y TS daría por imposibles las
// ramas de "grupo PUC desconocido" — que son justamente las que impiden que
// una cuenta desaparezca del EFE y rompa la identidad.
function sectionForSubaccount(subaccount: string): CashFlowSectionKey | undefined {
  return CASHFLOW_SECTION_BY_PUC_SUBACCOUNT[subaccount];
}

function sectionForGroup(group: string): CashFlowSectionKey | 'cash' | 'nonCash' | undefined {
  return CASHFLOW_SECTION_BY_PUC_GROUP[group];
}

function labelForCashFlowRow(key: string): string | undefined {
  return CASHFLOW_ROW_LABELS[key];
}

/**
 * Construye el EFE determinista por método indirecto a partir de los dos
 * snapshots ya curados.
 *
 * Devuelve `null` sin periodo comparativo: sin saldo de apertura no hay
 * variación que medir y el "EFE parcial" que asume apertura = $0 no es un EFE
 * (NIC 7 ¶1); presentarlo como tal es lo que abrió la puerta a las cifras
 * inventadas.
 */
export function buildDeterministicCashFlow(
  primary: PeriodSnapshot,
  comparative: PeriodSnapshot | undefined,
): DeterministicCashFlow | null {
  if (!comparative) return null;

  const closing = leafCentsByCode(primary);
  const opening = leafCentsByCode(comparative);
  const codes = new Set<string>([...closing.keys(), ...opening.keys()]);

  // Agregación por clave de presentación (grupo PUC, o subcuenta cuando hay
  // excepción). `flow` ya lleva el signo de caja: un activo que sube consume
  // efectivo; un pasivo o patrimonio que sube lo aporta.
  const flowByKey = new Map<string, { section: CashFlowSectionKey | 'nonCash'; cents: bigint }>();
  const unclassifiedGroups = new Set<string>();
  // Gasto no monetario por grupo de activo (12, 15, 16, 17, 18): Δ de sus
  // correctoras. NIC 7 ¶18(b) lo devuelve a operación y deja en el grupo la
  // variación BRUTA (auditoría niif-contrato-05: antes sólo 1592/1598 y un
  // inexistente '1595'; la 1698 salía como ENTRADA de inversión).
  const nonCashAddBackByGroup = new Map<string, bigint>();
  const addBackAccounts = new Set<string>();
  // Bloque patrimonial (clase 3 salvo 38) en signo de caja = signo de patrimonio.
  let equityBlockDelta = ZERO;
  const equityDeltaByGroup = new Map<string, bigint>();
  let dividendCashFlow = ZERO;
  const dividendAccounts: string[] = [];

  for (const code of codes) {
    const at = closing.get(code);
    const atMinus1 = opening.get(code);
    const delta = (at?.cents ?? ZERO) - (atMinus1?.cents ?? ZERO);
    const classCode = at?.classCode ?? atMinus1?.classCode ?? 0;
    // Signo de caja: un activo que sube consume efectivo; un pasivo o una
    // partida patrimonial que sube lo aporta.
    const cents = classCode === 1 ? -delta : delta;
    const group = pucGroupOf(code);

    if (classCode === 1 && isNonCashContraAccount(code)) {
      // La correctora es crédito: su Δ es negativo cuando se reconoce el gasto
      // del periodo, y su reverso se devuelve a operación. NIC 7 ¶18(b).
      nonCashAddBackByGroup.set(group, (nonCashAddBackByGroup.get(group) ?? ZERO) - delta);
      if (delta !== ZERO) addBackAccounts.add(subaccountOf(code));
    }

    const subaccount = subaccountOf(code);
    if (DIVIDEND_EVIDENCE_PREFIXES.some((p) => code.startsWith(p)) && delta !== ZERO) {
      dividendAccounts.push(code);
    }

    if (classCode === 3 && group.length === 2 && isEquityBlockGroup(group)) {
      // Todo el bloque patrimonial se trata como UNA partida: su variación es
      // resultado del ejercicio + flujo con socios. Los traslados internos
      // (3605 → 3305/3705/3105) se anulan dentro del bloque.
      equityBlockDelta += cents;
      if (group !== '36') {
        equityDeltaByGroup.set(group, (equityDeltaByGroup.get(group) ?? ZERO) + cents);
      }
      continue;
    }

    const override = sectionForSubaccount(subaccount);
    const mapped = group.length === 2 ? (override ?? sectionForGroup(group)) : undefined;
    if (mapped === 'cash') continue; // PUC 11 es el objetivo, no un renglón.

    let section: CashFlowSectionKey | 'nonCash';
    let key: string;
    if (override && mapped) {
      section = override;
      key = subaccount;
      if (subaccount === '2360') dividendCashFlow += cents;
    } else if (mapped) {
      section = mapped;
      key = group;
    } else {
      // Grupo desconocido —o código sin dos dígitos utilizables—: NO se
      // descarta. Descartarlo rompería la identidad Δ caja = Σ secciones en
      // silencio, que es exactamente el fallo que este módulo viene a cerrar.
      // Cae al default de su clase y queda declarado para la nota técnica.
      key = group.length === 2 ? group : `clase ${classCode || '?'}`;
      unclassifiedGroups.add(key);
      if (classCode === 3) {
        // Sin grupo utilizable: dentro del bloque patrimonial.
        equityBlockDelta += cents;
        continue;
      }
      section = 'operating';
    }

    const prev = flowByKey.get(key);
    if (prev) prev.cents += cents;
    else flowByKey.set(key, { section, cents });
  }

  // --- Operación: utilidad neta + gasto no monetario -------------------------
  const netIncomeCents = pesosToCents(primary.controlTotals.utilidadNeta);
  const depreciationAddBack = [...nonCashAddBackByGroup.values()].reduce((a, v) => a + v, ZERO);

  // Rótulo según el signo (e2e-niif-09): una pérdida no se rotula "utilidad".
  const operatingRows: BreakdownRow[] = [
    {
      account: '36',
      label: netIncomeCents < ZERO ? 'Pérdida neta del ejercicio' : 'Utilidad neta del ejercicio',
      cents: netIncomeCents,
    },
  ];
  if (depreciationAddBack !== ZERO) {
    operatingRows.push({
      account: [...addBackAccounts].sort().join('/') || '1592',
      label: 'Depreciación, amortización y deterioro del ejercicio (partida no monetaria)',
      cents: depreciationAddBack,
    });
  }

  // --- Flujo con los socios: residuo del bloque patrimonial -------------------
  // Δ(patrimonio salvo 38) = utilidad neta + aportes − distribuciones. Lo que
  // no explica el resultado es flujo con los socios. Una disminución NO se
  // presume no monetaria (auditoría niif-contrato-04): si el balance no la
  // explica, se presenta como distribución pendiente de soporte, o —cuando el
  // comparativo no tiene cierre contable y la utilidad publicada puede ser
  // acumulada— como partida no conciliada que el contador debe explicar.
  const ownerResidual = equityBlockDelta - netIncomeCents;
  const comparativeWithoutClosing = comparative.findings?.librosNoCerrados === true;
  let ownerClassification: DeterministicCashFlow['ownerFlows']['classification'] = 'none';
  const ownerFinancingRows: BreakdownRow[] = [];
  if (ownerResidual > ZERO) {
    ownerClassification = 'contribution';
    ownerFinancingRows.push({
      account: '31/32/33/37',
      label:
        'Aportes de socios (aumento patrimonial no explicado por el resultado del ejercicio; ' +
        'verificar soporte del aporte en efectivo)',
      cents: ownerResidual,
    });
  } else if (ownerResidual < ZERO) {
    if (comparativeWithoutClosing) {
      ownerClassification = 'unreconciled';
      operatingRows.push({
        account: '36/37',
        label:
          'Partida patrimonial no conciliada: resultado de ejercicios anteriores no trasladado ' +
          '(utilidad posiblemente acumulada) o distribución a socios — requiere explicación del contador',
        cents: ownerResidual,
      });
    } else {
      ownerClassification = 'distribution_pending_support';
      ownerFinancingRows.push({
        account: '36/37',
        label:
          'Distribuciones a socios (disminución patrimonial no explicada por el resultado del ' +
          'ejercicio) — pendiente de soporte: acta y comprobante de egreso',
        cents: ownerResidual,
      });
    }
  }

  const investingRows: BreakdownRow[] = [];
  const financingRows: BreakdownRow[] = [];
  let nonCashNet = ZERO;

  // --- ORI por revaluación (re-auditoría 2, recalculo-final2-03) -------------
  // El 38 y el 19 se agregan en el renglón no monetario y se anulan cuando se
  // mueven juntos (valorizaciones, Decreto 2650/1993). Con el modelo de
  // revaluación (NIC 16 / Sección 17) la contrapartida del 38 es el propio
  // activo: la Δ38 sin 19 entraba a OPERACIÓN y la variación del activo, con
  // la revaluación dentro, salía como adquisición o disposición en INVERSIÓN.
  // La revaluación no es flujo (NIC 7 ¶43): Δ38 − Δ19 (en signo de caja,
  // flujo del 38 + flujo del 19) se saca del renglón no monetario y se suma a
  // la variación del activo de inversión que la registra. Un balance de saldos
  // no distingue un traslado del superávit a resultados acumulados
  // (realización): rige la misma lectura que el ORI (Δ38) del ERI y del ECP.
  // Sin ORI en el periodo (Δ38 = 0) no hay revaluación que descontar: un 19
  // que se mueve sin el 38 no es ORI y sigue en el renglón no monetario, como
  // en un balance sin grupo 38 (revisión F-contrato).
  const oriFlow = flowByKey.get('38')?.cents ?? ZERO;
  const oriRevaluationCents = oriFlow !== ZERO ? oriFlow + (flowByKey.get('19')?.cents ?? ZERO) : ZERO;
  const investingAssetGroups = [...flowByKey.entries()]
    .filter(([key, v]) => v.section === 'investing' && /^1\d$/.test(key))
    .map(([key]) => key);
  const oriRevaluationGroup =
    oriRevaluationCents !== ZERO && investingAssetGroups.length === 1 ? investingAssetGroups[0] : null;

  for (const [key, { section, cents }] of [...flowByKey.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (section === 'nonCash') {
      nonCashNet += cents;
      continue;
    }
    // La variación BRUTA se queda en su grupo; el gasto no monetario ya se
    // devolvió a operación arriba, y la revaluación del ORI se descuenta.
    const amount =
      cents - (nonCashAddBackByGroup.get(key) ?? ZERO) + (key === oriRevaluationGroup ? oriRevaluationCents : ZERO);
    if (amount === ZERO) continue;
    const label = labelForCashFlowRow(key);
    const row: BreakdownRow = {
      account: key,
      label: label ?? `Variación del grupo PUC ${key}`,
      cents: amount,
    };
    if (section === 'operating') operatingRows.push(row);
    else if (section === 'investing') investingRows.push(row);
    else financingRows.push(row);
  }
  if (oriRevaluationCents !== ZERO && oriRevaluationGroup === null) {
    investingRows.push({ account: '38', label: ORI_REVALUATION_ROW_LABEL, cents: oriRevaluationCents });
  }
  nonCashNet -= oriRevaluationCents;
  financingRows.push(...ownerFinancingRows);

  if (nonCashNet !== ZERO) {
    // NIC 7 ¶43: las transacciones no monetarias se excluyen del EFE y se
    // revelan. Se dejan visibles en UN renglón conciliatorio en vez de
    // repartirse como flujos falsos de inversión o financiación. Tras
    // descontar la revaluación del ORI sólo llega aquí un 19 que se movió sin
    // el 38 (balance sin grupo 38 o con el 38 sin variación).
    operatingRows.push({
      account: '19/38',
      label: 'Partidas no monetarias netas (valorizaciones)',
      cents: nonCashNet,
    });
  }

  const nonCashEquityMovements: BreakdownRow[] = [...equityDeltaByGroup.entries()]
    .filter(([, v]) => v !== ZERO)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, v]) => ({
      account: group,
      label: EQUITY_MOVEMENT_LABELS[group] ?? `Grupo ${group}`,
      cents: v,
    }));

  const sumRows = (rows: BreakdownRow[]): bigint => rows.reduce((acc, r) => acc + r.cents, ZERO);
  const sections: DeterministicCashFlowSection[] = [
    { section: 'operating', rows: operatingRows, netFlowCents: sumRows(operatingRows) },
    { section: 'investing', rows: investingRows, netFlowCents: sumRows(investingRows) },
    { section: 'financing', rows: financingRows, netFlowCents: sumRows(financingRows) },
  ];

  const cashClosingCents = pesosToCents(primary.controlTotals.efectivoCuenta11);
  const cashOpeningCents = pesosToCents(comparative.controlTotals.efectivoCuenta11);
  const netChangeCents = sections.reduce((acc, s) => acc + s.netFlowCents, ZERO);
  const observedChangeCents = cashClosingCents - cashOpeningCents;
  const reconciliationGapCents = netChangeCents - observedChangeCents;

  return {
    primaryPeriod: primary.period,
    comparativePeriod: comparative.period,
    sections,
    cashOpeningCents,
    cashClosingCents,
    netChangeCents,
    observedChangeCents,
    reconciliationGapCents,
    reconciled: reconciliationGapCents === ZERO,
    dividendEvidence: {
      found: dividendAccounts.length > 0,
      accounts: dividendAccounts.sort(),
      cashFlowCents: dividendCashFlow,
    },
    unclassifiedGroups: [...unclassifiedGroups].sort(),
    ownerFlows: { residualCents: ownerResidual, classification: ownerClassification },
    nonCashEquityMovements,
    oriRevaluation:
      oriRevaluationCents === ZERO ? null : { cents: oriRevaluationCents, group: oriRevaluationGroup },
  };
}

// ---------------------------------------------------------------------------
// Invariantes del EFE emitido por el modelo
// ---------------------------------------------------------------------------
// Lo que la auditoría midió: 8 renglones de operación sumaban $834.754.377,59
// bajo un subtotal impreso de $2.421.190.071,93, y financiación traía CERO
// renglones bajo ($1.570.997.737,30) — con 0 errores y 0 warnings. Un estado
// financiero cuyos renglones no suman su subtotal no es un estado financiero.
// Estas comprobaciones son aritmética pura, tolerancia $0, y están escritas
// para que las consuma el canal que SELLA (no basta con avisar).
// ---------------------------------------------------------------------------

export interface CashFlowLineLike {
  /** Código PUC que el renglón declara (el bloque "EFE VINCULANTE" lo muestra como [PUC xx]). */
  readonly account?: string | null;
  readonly label: string;
  readonly amountPrimary: string;
  /** Columna comparativa (pendiente #3); ausente en los EFE de un periodo. */
  readonly amountComparative?: string | null;
}

export interface CashFlowSectionLike {
  readonly section: string;
  readonly lines: readonly CashFlowLineLike[];
  readonly netFlow: string;
  readonly netFlowComparative?: string | null;
}

export interface CashFlowStatementLike {
  readonly sections: readonly CashFlowSectionLike[];
  readonly netChange: string;
  readonly cashOpening: string;
  readonly cashClosing: string;
  readonly netChangeComparative?: string | null;
  readonly cashOpeningComparative?: string | null;
  readonly cashClosingComparative?: string | null;
}

/** Columna del EFE a la que se refiere una violación (ausente = periodo actual). */
export type CashFlowColumn = 'primary' | 'comparative';

export type CashFlowInvariantViolation =
  | {
      kind: 'section_sum';
      section: string;
      lineCount: number;
      sumOfLinesCents: bigint;
      netFlowCents: bigint;
      gapCents: bigint;
      column?: CashFlowColumn;
    }
  | {
      kind: 'net_change';
      sumOfSectionsCents: bigint;
      netChangeCents: bigint;
      gapCents: bigint;
      column?: CashFlowColumn;
    }
  | {
      kind: 'closure';
      cashOpeningCents: bigint;
      netChangeCents: bigint;
      cashClosingCents: bigint;
      gapCents: bigint;
      column?: CashFlowColumn;
    };

function parseCents(value: string): bigint {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`EFE: MoneyCop inválido (len=${value.length}) — se esperaba entero en centavos`);
  }
  return BigInt(value);
}

/**
 * Comprueba las tres identidades del EFE, tolerancia $0:
 *   1. Σ renglones de cada sección == subtotal declarado de esa sección;
 *   2. Σ subtotales == variación neta declarada;
 *   3. apertura + variación neta == cierre.
 *
 * Con columna comparativa presentada (todos sus subtotales y totales no
 * nulos — pendiente #3 de la auditoría 2026-09-24) las mismas tres identidades
 * se comprueban también sobre ella. Una celda comparativa ausente no aporta a
 * la suma; el validador la declara aparte (E2), no se da por cero en silencio.
 *
 * Devuelve la lista de violaciones (vacía = el EFE cierra).
 */
export function checkCashFlowInvariants(
  cashFlow: CashFlowStatementLike,
): CashFlowInvariantViolation[] {
  const violations = checkCashFlowColumnInvariants(cashFlow);
  const cmpTotals = [
    cashFlow.netChangeComparative,
    cashFlow.cashOpeningComparative,
    cashFlow.cashClosingComparative,
    ...cashFlow.sections.map((s) => s.netFlowComparative),
  ];
  if (cmpTotals.every((v) => v !== null && v !== undefined)) {
    const view: CashFlowStatementLike = {
      sections: cashFlow.sections.map((s) => ({
        section: s.section,
        lines: s.lines
          .filter((l) => l.amountComparative !== null && l.amountComparative !== undefined)
          .map((l) => ({ label: l.label, amountPrimary: l.amountComparative as string })),
        netFlow: s.netFlowComparative as string,
      })),
      netChange: cashFlow.netChangeComparative as string,
      cashOpening: cashFlow.cashOpeningComparative as string,
      cashClosing: cashFlow.cashClosingComparative as string,
    };
    for (const v of checkCashFlowColumnInvariants(view)) violations.push({ ...v, column: 'comparative' });
  }
  return violations;
}

function checkCashFlowColumnInvariants(cashFlow: CashFlowStatementLike): CashFlowInvariantViolation[] {
  const violations: CashFlowInvariantViolation[] = [];
  let sumOfSections = ZERO;

  for (const section of cashFlow.sections) {
    const netFlowCents = parseCents(section.netFlow);
    sumOfSections += netFlowCents;
    let sumOfLines = ZERO;
    for (const line of section.lines) sumOfLines += parseCents(line.amountPrimary);
    if (sumOfLines !== netFlowCents) {
      violations.push({
        kind: 'section_sum',
        section: section.section,
        lineCount: section.lines.length,
        sumOfLinesCents: sumOfLines,
        netFlowCents,
        gapCents: sumOfLines - netFlowCents,
      });
    }
  }

  const netChangeCents = parseCents(cashFlow.netChange);
  if (sumOfSections !== netChangeCents) {
    violations.push({
      kind: 'net_change',
      sumOfSectionsCents: sumOfSections,
      netChangeCents,
      gapCents: sumOfSections - netChangeCents,
    });
  }

  const cashOpeningCents = parseCents(cashFlow.cashOpening);
  const cashClosingCents = parseCents(cashFlow.cashClosing);
  const expectedClosing = cashOpeningCents + netChangeCents;
  if (expectedClosing !== cashClosingCents) {
    violations.push({
      kind: 'closure',
      cashOpeningCents,
      netChangeCents,
      cashClosingCents,
      gapCents: expectedClosing - cashClosingCents,
    });
  }

  return violations;
}

/** Mensajes en español listos para el sello / las salvedades. */
export function formatCashFlowViolations(
  violations: readonly CashFlowInvariantViolation[],
): string[] {
  const cop = (cents: bigint): string => {
    const negative = cents < ZERO;
    const abs = (negative ? -cents : cents).toString().padStart(3, '0');
    const whole = (abs.slice(0, -2) || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${negative ? '-' : ''}$${whole},${abs.slice(-2)}`;
  };
  const sectionName: Record<string, string> = {
    operating: 'Operación',
    investing: 'Inversión',
    financing: 'Financiación',
  };
  return violations.map((v) => {
    const efe = v.column === 'comparative' ? 'EFE (columna comparativa)' : 'EFE';
    if (v.kind === 'section_sum') {
      return (
        `${efe} — Actividades de ${sectionName[v.section] ?? v.section}: los ${v.lineCount} ` +
        `renglones suman ${cop(v.sumOfLinesCents)} bajo un subtotal declarado de ` +
        `${cop(v.netFlowCents)} (brecha ${cop(v.gapCents)}). NIC 7 ¶10.`
      );
    }
    if (v.kind === 'net_change') {
      return (
        `${efe} — la suma de los tres subtotales (${cop(v.sumOfSectionsCents)}) no es la ` +
        `variación neta declarada (${cop(v.netChangeCents)}); brecha ${cop(v.gapCents)}.`
      );
    }
    return (
      `${efe} — efectivo de apertura ${cop(v.cashOpeningCents)} + variación neta ` +
      `${cop(v.netChangeCents)} no da el efectivo de cierre declarado ` +
      `${cop(v.cashClosingCents)}; brecha ${cop(v.gapCents)}. NIC 7 ¶45.`
    );
  });
}

// ---------------------------------------------------------------------------
// Cruce del EFE emitido por el modelo contra el EFE determinista
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (niif-contrato-02): sobre el EFE sólo corrían invariantes
// de coherencia INTERNA (Σ renglones = subtotal, apertura + variación =
// cierre). Una reclasificación entre secciones que cuadra consigo misma, un
// efectivo de apertura inventado compensado en inversión o un "dividendo"
// compensado en operación salían limpios, aunque el EFE determinista —la
// identidad del Balance— estaba calculado y sólo se inyectaba en el prompt.
// Este cruce lo convierte en la autoridad: subtotal por actividad, efectivo
// inicial, variación neta y efectivo final, tolerancia $0 al centavo.
// ---------------------------------------------------------------------------

export type CashFlowCrossCheckViolation =
  | {
      kind: 'section_net_flow';
      section: CashFlowSectionKey;
      emittedCents: bigint | null;
      expectedCents: bigint;
      gapCents: bigint;
    }
  | {
      kind: 'cash_opening' | 'cash_closing' | 'net_change';
      emittedCents: bigint;
      expectedCents: bigint;
      gapCents: bigint;
    }
  | { kind: 'distribution_without_support'; section: string; label: string; amountCents: bigint }
  | { kind: 'deterministic_unreconciled'; gapCents: bigint };

/**
 * Renglones que afirman un pago o distribución a los socios. Auditoría
 * 2026-09-24 (e2e-niif-07): "Utilidades giradas a los accionistas" quedaba
 * fuera de la expresión; se cubren giros, retiros y utilidades pagadas,
 * distribuidas, decretadas o repartidas.
 */
const DISTRIBUTION_LABEL_RE =
  /dividend|distribuci[oó]n(?:es)?\s+(?:a|de|entre)\s+(?:los\s+)?(?:socios|accionistas|utilidades|propietarios)|pagos?\s+(?:de\s+)?(?:utilidades|participaciones)|pagos?\s+a\s+(?:los\s+)?(?:socios|accionistas|propietarios)|participaciones\s+pagadas|utilidades\s+(?:giradas|pagadas|distribuidas|decretadas|repartidas|retiradas)|giros?\s+(?:de\s+)?(?:utilidades|excedentes)|retiros?\s+(?:de\s+)?(?:los\s+)?(?:socios|accionistas|propietarios|utilidades)/i;

/**
 * Compara el EFE del modelo con el determinista. Devuelve la lista de
 * discrepancias (vacía = el EFE emitido es el del balance de prueba).
 */
export function crossCheckCashFlowAgainstDeterministic(
  cashFlow: CashFlowStatementLike,
  deterministic: DeterministicCashFlow,
): CashFlowCrossCheckViolation[] {
  const out: CashFlowCrossCheckViolation[] = [];

  if (!deterministic.reconciled) {
    out.push({ kind: 'deterministic_unreconciled', gapCents: deterministic.reconciliationGapCents });
  }

  for (const expected of deterministic.sections) {
    const emitted = cashFlow.sections.find((s) => s.section === expected.section);
    const emittedCents = emitted ? parseCents(emitted.netFlow) : null;
    if (emittedCents === expected.netFlowCents) continue;
    out.push({
      kind: 'section_net_flow',
      section: expected.section,
      emittedCents,
      expectedCents: expected.netFlowCents,
      gapCents: (emittedCents ?? ZERO) - expected.netFlowCents,
    });
  }

  const totals: Array<['cash_opening' | 'cash_closing' | 'net_change', string, bigint]> = [
    ['cash_opening', cashFlow.cashOpening, deterministic.cashOpeningCents],
    ['net_change', cashFlow.netChange, deterministic.netChangeCents],
    ['cash_closing', cashFlow.cashClosing, deterministic.cashClosingCents],
  ];
  for (const [kind, emittedRaw, expectedCents] of totals) {
    const emittedCents = parseCents(emittedRaw);
    if (emittedCents === expectedCents) continue;
    out.push({ kind, emittedCents, expectedCents, gapCents: emittedCents - expectedCents });
  }

  // Una línea de dividendos/distribución sólo cabe si el balance la sostiene:
  // movimiento en 2360/35 o un flujo con socios deducido del patrimonio.
  const distributionSupported =
    deterministic.dividendEvidence.found ||
    deterministic.ownerFlows.classification === 'distribution_pending_support' ||
    deterministic.ownerFlows.classification === 'unreconciled';
  if (!distributionSupported) {
    for (const section of cashFlow.sections) {
      for (const line of section.lines) {
        const amount = parseCents(line.amountPrimary);
        if (amount === ZERO || !DISTRIBUTION_LABEL_RE.test(line.label ?? '')) continue;
        out.push({
          kind: 'distribution_without_support',
          section: section.section,
          label: line.label,
          amountCents: amount,
        });
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Renglón a renglón: el EFE emitido contra las partidas del determinista
// ---------------------------------------------------------------------------
// Auditoría 2026-09-24 (e2e-niif-07): E18 cruza subtotales y totales, no
// renglones ni rótulos. Dentro de una actividad que cuadra, el modelo podía
// inflar la depreciación compensándola en deudores, partir la financiación en
// un préstamo y un "giro de utilidades" inventados, o rotular la deuda como
// aportes de los socios. Con el EFE determinista conciliado, cada renglón con
// monto del EFE emitido debe ser una partida del determinista en la MISMA
// actividad (multiconjunto por importe, tolerancia $0) y su rótulo no puede
// afirmar una categoría distinta (resultado, partidas no monetarias, socios,
// deuda financiera) de la de esa partida.
// ---------------------------------------------------------------------------

export type CashFlowFlowCategory = 'netIncome' | 'nonCash' | 'owners' | 'debt';

export type CashFlowLineViolation =
  | { kind: 'line_without_source'; section: CashFlowSectionKey; label: string; amountCents: bigint }
  | {
      kind: 'label_category';
      section: CashFlowSectionKey;
      label: string;
      amountCents: bigint;
      claimed: CashFlowFlowCategory[];
      sourceLabel: string;
    };

const NET_INCOME_LABEL_RE =
  /\b(?:utilidad|p[eé]rdida|resultado|ganancia|excedente|d[eé]ficit)(?:es)?\s+(?:neta|neto|del\s+(?:ejercicio|periodo|per[ií]odo|a[nñ]o))/i;
const NON_CASH_LABEL_RE = /deprecia|amortiza|agotamiento|deterioro/i;
// Sólo términos que afirman un FLUJO con los socios; "socios" a secas no (una
// cuenta por pagar a socios, 2355, es capital de trabajo).
const OWNERS_LABEL_RE =
  /aporte|capitaliza|dividend|participaciones\s+(?:pagadas|decretadas|distribuidas)|distribuci[oó]n|utilidades\s+(?:giradas|pagadas|distribuidas|decretadas|repartidas|retiradas)|giros?\s+(?:de\s+)?(?:utilidades|excedentes)|retiros?\s+(?:de\s+)?(?:los\s+)?(?:socios|accionistas|propietarios|utilidades)|pagos?\s+a\s+(?:los\s+)?(?:socios|accionistas|propietarios)/i;
const DEBT_LABEL_RE =
  /obligaci[oó]n(?:es)?\s+financiera|pr[eé]stamo|cr[eé]dito(?:s)?\s+(?:bancario|financiero)|sobregiro|bonos|papeles\s+comerciales|leasing|arrendamiento\s+financiero|deuda\s+financiera/i;

/** Categorías que el rótulo de un renglón del EFE afirma (vacío = rótulo neutro). */
export function cashFlowLabelClaims(label: string): CashFlowFlowCategory[] {
  const out: CashFlowFlowCategory[] = [];
  if (NET_INCOME_LABEL_RE.test(label)) out.push('netIncome');
  if (NON_CASH_LABEL_RE.test(label)) out.push('nonCash');
  if (OWNERS_LABEL_RE.test(label)) out.push('owners');
  if (DEBT_LABEL_RE.test(label)) out.push('debt');
  return out;
}

/** Categoría de una partida del EFE determinista, por su clave de agregación. */
function sourceRowCategory(row: BreakdownRow): CashFlowFlowCategory | null {
  const acc = row.account;
  if (acc === '36') return 'netIncome';
  if (acc === '2360' || acc === '31/32/33/37' || acc === '36/37') return 'owners';
  if (acc === '21' || acc === '29') return 'debt';
  if (acc === '19/38') return 'nonCash';
  const parts = acc.split('/');
  if (parts.length > 0 && parts.every((p) => /^\d{4,}$/.test(p) && isNonCashContraAccount(p))) {
    return 'nonCash';
  }
  return null;
}

/**
 * Relación entre el código PUC que declara un renglón y la clave de una
 * partida determinista: 'exact' (misma clave, p. ej. "13" o "31/32/33/37"),
 * 'prefix' (subcuenta de un grupo de la clave, p. ej. "1305" → "13") o null.
 */
function lineAccountMatch(lineAccount: string | null | undefined, rowAccount: string): 'exact' | 'prefix' | null {
  const acc = (lineAccount ?? '').trim();
  if (acc === '') return null;
  if (acc === rowAccount) return 'exact';
  const digits = acc.replace(/\D/g, '');
  if (digits === '') return null;
  if (digits === rowAccount.replace(/\D/g, '')) return 'exact';
  const parts = rowAccount.split('/').filter((p) => /^\d{2,}$/.test(p));
  return parts.some((p) => digits.startsWith(p)) ? 'prefix' : null;
}

/** Emparejamiento de un renglón del EFE emitido con su partida determinista. */
export interface CashFlowLineMatch {
  /** Partida de origen; `null` = renglón en $0 (no se evalúa) o sin partida. */
  row: BreakdownRow | null;
  /**
   * Otras partidas del mismo importe entre las que el renglón se asignó por
   * orden: ni su código PUC, ni su rótulo, ni la categoría que el rótulo
   * afirma las distinguían. Vacío = asignación inequívoca.
   */
  tiedWith: BreakdownRow[];
}

/**
 * Empareja cada renglón con importe del EFE emitido con una partida del EFE
 * determinista de la misma actividad (multiconjunto por importe, tolerancia
 * $0). Entre partidas del mismo importe decide, en este orden, el código PUC
 * que declara el renglón (el bloque "EFE VINCULANTE" lo muestra), el rótulo
 * idéntico al determinista y la categoría que el rótulo afirma; primero se
 * asignan todos los renglones así identificados y después, por orden, los
 * demás (`tiedWith` dice cuándo ese orden eligió entre partidas distintas).
 * Lo usan el cruce renglón a renglón (E23) y la columna comparativa del EFE,
 * que así sabe qué grupo PUC representa cada renglón que el modelo rotuló.
 */
export function matchCashFlowLinesToDeterministicDetailed(
  lines: readonly CashFlowLineLike[],
  rows: readonly BreakdownRow[],
): CashFlowLineMatch[] {
  const pool = rows.filter((r) => r.cents !== ZERO).map((r) => ({ row: r, used: false }));
  const out: CashFlowLineMatch[] = lines.map(() => ({ row: null, tiedWith: [] }));
  const amounts = lines.map((l) => parseCents(l.amountPrimary));
  const claimsOf = lines.map((l) => cashFlowLabelClaims(l.label ?? ''));
  const pending = new Set(lines.map((_, i) => i).filter((i) => amounts[i] !== ZERO));

  const identifying: Array<(i: number, row: BreakdownRow) => boolean> = [
    (i, row) => lineAccountMatch(lines[i].account, row.account) === 'exact',
    (i, row) => lineAccountMatch(lines[i].account, row.account) === 'prefix',
    (i, row) => row.label === lines[i].label,
    (i, row) => {
      const cat = sourceRowCategory(row);
      return cat !== null && claimsOf[i].includes(cat);
    },
  ];
  for (const identifies of identifying) {
    for (const i of [...pending]) {
      const match = pool.find((p) => !p.used && p.row.cents === amounts[i] && identifies(i, p.row));
      if (!match) continue;
      match.used = true;
      out[i] = { row: match.row, tiedWith: [] };
      pending.delete(i);
    }
  }
  for (const i of pending) {
    const candidates = pool.filter((p) => !p.used && p.row.cents === amounts[i]);
    const match =
      candidates.find((p) => {
        const cat = sourceRowCategory(p.row);
        return claimsOf[i].length === 0 || (cat !== null && claimsOf[i].includes(cat));
      }) ?? candidates[0];
    if (!match) continue;
    match.used = true;
    out[i] = { row: match.row, tiedWith: candidates.filter((p) => p !== match).map((p) => p.row) };
  }
  return out;
}

/** `matchCashFlowLinesToDeterministicDetailed` sin el detalle de empates. */
export function matchCashFlowLinesToDeterministic(
  lines: readonly CashFlowLineLike[],
  rows: readonly BreakdownRow[],
): Array<BreakdownRow | null> {
  return matchCashFlowLinesToDeterministicDetailed(lines, rows).map((m) => m.row);
}

/**
 * Cruza cada renglón del EFE emitido contra las partidas del EFE determinista
 * de su misma actividad. Sólo aplica con el determinista conciliado (si no
 * concilia, E18 ya bloquea). Los renglones en $0 no se evalúan: no imprimen
 * cifra.
 */
export function crossCheckCashFlowLinesAgainstDeterministic(
  cashFlow: CashFlowStatementLike,
  deterministic: DeterministicCashFlow,
): CashFlowLineViolation[] {
  if (!deterministic.reconciled) return [];
  const out: CashFlowLineViolation[] = [];
  for (const expected of deterministic.sections) {
    const emitted = cashFlow.sections.find((s) => s.section === expected.section);
    const lines = emitted?.lines ?? [];
    const matches = matchCashFlowLinesToDeterministic(lines, expected.rows);
    for (const [i, line] of lines.entries()) {
      const amount = parseCents(line.amountPrimary);
      if (amount === ZERO) continue;
      const claims = cashFlowLabelClaims(line.label ?? '');
      const matched = matches[i];
      if (!matched) {
        out.push({ kind: 'line_without_source', section: expected.section, label: line.label, amountCents: amount });
        continue;
      }
      const match = { row: matched };
      const category = sourceRowCategory(match.row);
      // Una partida de capital de trabajo rotulada como deuda (p. ej. cuentas
      // por pagar) es un matiz de presentación, no un cambio de naturaleza.
      const effective = category === null ? claims.filter((c) => c !== 'debt') : claims;
      if (effective.length > 0 && (category === null || !claims.includes(category))) {
        out.push({
          kind: 'label_category',
          section: expected.section,
          label: line.label,
          amountCents: amount,
          claimed: claims,
          sourceLabel: match.row.label,
        });
      }
    }
    // Una partida del determinista que no aparece no se reporta aquí: con el
    // subtotal anclado (E18), su ausencia rompe Σ renglones = subtotal y la
    // bloquean los invariantes del EFE (`checkCashFlowInvariants`).
  }
  return out;
}

/** Mensajes del cruce renglón a renglón (E23), listos para el sello. */
export function formatCashFlowLineViolations(violations: readonly CashFlowLineViolation[]): string[] {
  const cop = (cents: bigint): string => {
    const negative = cents < ZERO;
    const abs = (negative ? -cents : cents).toString().padStart(3, '0');
    const whole = (abs.slice(0, -2) || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${negative ? '-' : ''}$${whole},${abs.slice(-2)}`;
  };
  const sectionName: Record<CashFlowSectionKey, string> = {
    operating: 'operación',
    investing: 'inversión',
    financing: 'financiación',
  };
  const categoryName: Record<CashFlowFlowCategory, string> = {
    netIncome: 'resultado del ejercicio',
    nonCash: 'partida no monetaria',
    owners: 'flujo con los socios',
    debt: 'deuda financiera',
  };
  return violations.map((v) => {
    switch (v.kind) {
      case 'line_without_source':
        return (
          `EFE — actividades de ${sectionName[v.section]}: el renglón "${v.label}" (${cop(v.amountCents)}) ` +
          `no es ninguna partida del EFE determinista del balance de prueba. Un renglón del EFE es la ` +
          `variación de un grupo PUC; una cifra que no lo es no puede imprimirse (NIC 7 ¶10, ¶43).`
        );
      case 'label_category':
        return (
          `EFE — actividades de ${sectionName[v.section]}: el renglón "${v.label}" (${cop(v.amountCents)}) ` +
          `se rotula como ${v.claimed.map((c) => categoryName[c]).join(' / ')} y la partida del balance ` +
          `de prueba es "${v.sourceLabel}". El rótulo no puede cambiar la naturaleza del flujo (NIC 7 ¶17, ¶43).`
        );
    }
  });
}

/** Mensajes en español del cruce, listos para el sello / las salvedades. */
export function formatCashFlowCrossCheckViolations(
  violations: readonly CashFlowCrossCheckViolation[],
): string[] {
  const cop = (cents: bigint): string => {
    const negative = cents < ZERO;
    const abs = (negative ? -cents : cents).toString().padStart(3, '0');
    const whole = (abs.slice(0, -2) || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${negative ? '-' : ''}$${whole},${abs.slice(-2)}`;
  };
  const sectionName: Record<string, string> = {
    operating: 'operación',
    investing: 'inversión',
    financing: 'financiación',
  };
  const totalName: Record<string, string> = {
    cash_opening: 'efectivo al inicio del periodo',
    net_change: 'variación neta del efectivo',
    cash_closing: 'efectivo al final del periodo',
  };
  return violations.map((v) => {
    switch (v.kind) {
      case 'section_net_flow':
        return (
          `EFE — actividades de ${sectionName[v.section] ?? v.section}: el estado emitido declara ` +
          `${v.emittedCents === null ? 'la sección ausente' : cop(v.emittedCents)} y el EFE ` +
          `determinista del balance de prueba da ${cop(v.expectedCents)} (brecha ${cop(v.gapCents)}). ` +
          `NIC 7 ¶10 / NIIF PYMES 7.3.`
        );
      case 'cash_opening':
      case 'net_change':
      case 'cash_closing':
        return (
          `EFE — ${totalName[v.kind]}: el estado emitido declara ${cop(v.emittedCents)} y el ` +
          `balance de prueba da ${cop(v.expectedCents)} (brecha ${cop(v.gapCents)}). NIC 7 ¶45.`
        );
      case 'distribution_without_support':
        return (
          `EFE — el renglón "${v.label}" (${cop(v.amountCents)}, ${sectionName[v.section] ?? v.section}) ` +
          `presenta una distribución a socios que el balance de prueba no sostiene ` +
          `(sin movimiento en 2360/35 ni disminución patrimonial no explicada). NIC 7 ¶43.`
        );
      case 'deterministic_unreconciled':
        return (
          `EFE — el EFE determinista no concilia con la variación del PUC 11 ` +
          `(brecha ${cop(v.gapCents)}): el estado no puede certificarse. NIC 7 ¶45.`
        );
    }
  });
}

// ===========================================================================
// curatorFlags desde el snapshot (auditoría 2026-09, niif-contrato-23)
// ===========================================================================

/**
 * Banderas del Curator tal como quedaron en el snapshot del periodo actual.
 * Son hechos del preprocesador, no juicio del modelo: el Pass-1 las copiaba
 * de TOTALES VINCULANTES y ninguna regla las contrastaba, y Pass-2/3 las
 * recibían como ancla (un `reclassifiedAmountCop` erróneo podía citarse en
 * las notas). El analista las sobrescribe con este valor y el validador lo
 * exige (E26).
 *   - equityConvergenceApplied: R5 registró `equityAnchorAdjustment` ≠ 0.
 *   - cashFlowClosureForced: R6 registró `cashFlowClosureAdjustment` ≠ 0.
 *   - negativeAssetReclassified: R1 aplicó al menos una reclasificación.
 *   - presumedCostWarning: R7 emitió la advertencia de costo presunto.
 *   - reclassifiedAmountCop: Σ |monto efectivamente trasladado| por R1.
 */
export function deterministicCuratorFlags(snapshot: PeriodSnapshot): {
  equityConvergenceApplied: boolean;
  cashFlowClosureForced: boolean;
  negativeAssetReclassified: boolean;
  presumedCostWarning: boolean;
  reclassifiedAmountCop: string;
} {
  const nonZero = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v !== 0;
  const applied = (snapshot.reclassifications ?? []).filter((r) => r.applied === true);
  let reclassified = ZERO;
  for (const r of applied) {
    const cents = pesosToCents(
      typeof r.effectiveTransferCop === 'number' ? r.effectiveTransferCop : r.amountCop,
    );
    reclassified += cents < ZERO ? -cents : cents;
  }
  return {
    equityConvergenceApplied: nonZero(snapshot.equityAnchorAdjustment),
    cashFlowClosureForced: nonZero(snapshot.cashFlowClosureAdjustment),
    negativeAssetReclassified: applied.length > 0,
    presumedCostWarning: !!snapshot.presumedCostWarning,
    reclassifiedAmountCop: reclassified.toString(),
  };
}

// ===========================================================================
// Comparativos del EFE y del ECP (auditoría integral 2026-09-24, pendiente #3)
// ===========================================================================
//
// NIIF para las PYMES 3.14 exige información comparativa de todos los importes
// de los estados del periodo, salvo impracticabilidad (3.14 / 10.21). El
// informe presentaba el ESF y el ERI con su columna comparativa, pero el EFE y
// el ECP sólo con el periodo actual y la leyenda "comparativo no presentado".
//
// El EFE y el ECP del periodo comparativo tienen la misma naturaleza que los
// del periodo actual: son proyecciones del balance de prueba. Sólo que para
// medir las variaciones del periodo comparativo hace falta su saldo de
// APERTURA: el corte anterior al comparativo (tres cortes) o los saldos
// iniciales del comparativo. Con ese corte, `buildDeterministicCashFlow` y el
// ECP por grupo patrimonial se calculan igual que los del periodo actual; sin
// él, el comparativo no se presenta y se dice con una nota determinista —
// nunca con cifras del modelo.
//
// La nota NO declara impracticabilidad (integración I2, hallazgo
// prompts-normativa-23): que el balance recibido no traiga el corte anterior
// no significa que la entidad no pueda obtenerlo. Dice qué falta y lo pide
// ("suministre ese corte"). La impracticabilidad sólo la declaran el
// preprocesador o la entidad (`comparativos_impracticables`, Regla R1), y en
// ese caso el informe no tiene periodo comparativo y no hay nota que redactar.
// ---------------------------------------------------------------------------

/** Forma mínima del preprocesado que necesita la base comparativa. */
export interface ComparativeStatementsSource {
  periods?: readonly PeriodSnapshot[] | null;
  comparative?: PeriodSnapshot | null;
  comparativos_impracticables?: boolean;
}

export type ComparativeNoteLanguage = 'es' | 'en';

/**
 * Base determinista de los comparativos del EFE y del ECP. Cada estado trae
 * sus cifras o, si no son calculables, la nota de comparativo no presentado.
 */
export interface ComparativeStatementsBasis {
  /** Año (o etiqueta) del periodo comparativo del informe. */
  comparativePeriod: string;
  /** Corte usado como apertura del periodo comparativo; `null` si no existe. */
  openingPeriod: string | null;
  cashFlow: DeterministicCashFlow | null;
  /** Nota del EFE comparativo no presentado; `null` cuando se presenta. */
  cashFlowNote: string | null;
  equityRows: EquityChangeRowJson[] | null;
  /** Nota del ECP comparativo no presentado; `null` cuando se presenta. */
  equityNote: string | null;
  /**
   * ORI del periodo comparativo = Δ grupo 38 entre el corte de apertura y el
   * comparativo (enmienda 12, spec v2.1). `null` cuando no hay apertura
   * utilizable: la variación no es medible. Opcional por compatibilidad con
   * bases construidas a mano (se lee como no medible).
   */
  oriCents?: bigint | null;
  /** Idioma de las notas (default `'es'`). */
  language?: ComparativeNoteLanguage;
}

/**
 * Por qué un estado comparativo no se presenta, en los dos idiomas del
 * informe. `request` = qué insumo lo haría calculable ("suministre …");
 * ausente cuando lo que falla es el propio balance (no concilia, grupos sin
 * columna), que se revisa en lugar de pedirse.
 */
export interface ComparativeGap {
  es: string;
  en: string;
  request?: { es: string; en: string };
}

function yearOfPeriodLabel(period: string | null | undefined): string | null {
  const m = /(?:19|20)\d{2}/.exec(period ?? '');
  return m ? m[0] : null;
}

function copOf(cents: bigint): string {
  const negative = cents < ZERO;
  const abs = (negative ? -cents : cents).toString().padStart(3, '0');
  const whole = (abs.slice(0, -2) || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}$${whole},${abs.slice(-2)}`;
}

const STATEMENT_NAMES: Record<'cashFlow' | 'equity', Record<ComparativeNoteLanguage, string>> = {
  cashFlow: { es: 'Estado de flujos de efectivo', en: 'Statement of cash flows' },
  equity: { es: 'Estado de cambios en el patrimonio', en: 'Statement of changes in equity' },
};

/**
 * Nota de un estado comparativo NO presentado, redactada por el código.
 * Dice qué falta y, cuando es un insumo, lo pide: NIIF para las PYMES 3.14
 * exige comparativos. No declara impracticabilidad (ver la cabecera).
 */
export function comparativeNotPresentedNote(
  statement: 'cashFlow' | 'equity',
  comparativePeriod: string,
  gap: ComparativeGap,
  language: ComparativeNoteLanguage = 'es',
): string {
  const name = STATEMENT_NAMES[statement][language];
  if (language === 'en') {
    return (
      `${name} — ${comparativePeriod} comparative not presented: ${gap.en}` +
      (gap.request
        ? `; IFRS for SMEs 3.14 requires comparative information — ${gap.request.en}.`
        : '.') +
      ' No estimated figures are substituted.'
    );
  }
  return (
    `${name} — comparativo ${comparativePeriod} no presentado: ${gap.es}` +
    (gap.request
      ? `; NIIF para las PYMES 3.14 exige comparativos — ${gap.request.es}.`
      : '.') +
    ' No se sustituye por cifras estimadas.'
  );
}

/**
 * Motivo por el que el periodo comparativo no tiene saldo de apertura
 * utilizable, o `null` si el corte anterior sirve de apertura.
 */
function comparativeOpeningGap(
  comparative: PeriodSnapshot,
  opening: PeriodSnapshot | null,
  cy: string,
  priorYear: string | null,
): ComparativeGap | null {
  const prior = priorYear ?? null;
  if (comparative.saldosDeApertura === true) {
    return {
      es:
        `la columna ${cy} del archivo es de saldos de apertura y no hay estado de resultados ` +
        `del periodo ${cy} con el cual explicar sus variaciones`,
      en:
        `the ${cy} column of the file holds opening balances and there is no ${cy} income ` +
        `statement to explain its movements`,
      request: {
        es: `suministre el balance de prueba de cierre de ${cy}${prior ? ` y el de cierre de ${prior}` : ''}`,
        en: `provide the ${cy} closing trial balance${prior ? ` and the ${prior} closing trial balance` : ''}`,
      },
    };
  }
  if (!opening) {
    return {
      es:
        `el balance no incluye el corte de cierre anterior al periodo comparativo` +
        `${prior ? ` (${prior})` : ''} ni los saldos iniciales de ${cy}`,
      en:
        `the trial balance does not include the closing cut before the comparative period` +
        `${prior ? ` (${prior})` : ''} nor the ${cy} opening balances`,
      request: { es: 'suministre ese corte', en: 'provide that cut' },
    };
  }
  const oy = yearOfPeriodLabel(opening.period);
  if (priorYear === null || oy !== priorYear) {
    return {
      es:
        `el corte anterior disponible (${opening.period}) no es el cierre inmediatamente anterior ` +
        `al periodo comparativo${prior ? ` (${prior})` : ''}`,
      en:
        `the earlier cut available (${opening.period}) is not the closing immediately before ` +
        `the comparative period${prior ? ` (${prior})` : ''}`,
      request: prior
        ? { es: `suministre el corte de cierre de ${prior}`, en: `provide the ${prior} closing cut` }
        : { es: 'suministre ese corte', en: 'provide that cut' },
    };
  }
  if (opening.periodoTipo === 'parcial' && opening.saldosDeApertura !== true) {
    return {
      es: `el corte anterior (${opening.period}) es un corte parcial, no el cierre del ejercicio ${priorYear}`,
      en: `the earlier cut (${opening.period}) is a partial cut, not the ${priorYear} year-end closing`,
      request: {
        es: `suministre el corte de cierre del ejercicio ${priorYear}`,
        en: `provide the ${priorYear} year-end closing cut`,
      },
    };
  }
  return null;
}

type EquityColumnKey =
  | 'capitalSocial'
  | 'primaColocacion'
  | 'reservaLegal'
  | 'otrasReservas'
  | 'resultadosAcumulados'
  | 'resultadoEjercicio'
  | 'ori';

const EQUITY_ROW_KEYS: readonly EquityColumnKey[] = [
  'capitalSocial',
  'primaColocacion',
  'reservaLegal',
  'otrasReservas',
  'resultadosAcumulados',
  'resultadoEjercicio',
  'ori',
];

/**
 * Columnas del ECP desde las hojas de la clase 3 del snapshot: 31 capital,
 * 32 prima, 3305 reserva legal, resto de 33 otras reservas, 37 acumulados,
 * 36 resultado del ejercicio y 38 ORI / superávit por valorizaciones. Los
 * grupos sin columna (34, 35 y códigos fuera de 31–38) se devuelven aparte:
 * con saldo en ellos el ECP por columnas no es una proyección fiel.
 */
function equityColumnsOfSnapshot(snapshot: PeriodSnapshot): {
  cols: Record<EquityColumnKey, bigint>;
  unmappedGroups: string[];
} {
  const cols: Record<EquityColumnKey, bigint> = {
    capitalSocial: ZERO,
    primaColocacion: ZERO,
    reservaLegal: ZERO,
    otrasReservas: ZERO,
    resultadosAcumulados: ZERO,
    resultadoEjercicio: ZERO,
    ori: ZERO,
  };
  const unmapped = new Map<string, bigint>();
  for (const leaf of buildLedgerLeaves(snapshot)) {
    if (leaf.classCode !== 3) continue;
    const g = leaf.code.slice(0, 2);
    if (g === '31') cols.capitalSocial += leaf.cents;
    else if (g === '32') cols.primaColocacion += leaf.cents;
    else if (g === '33') {
      if (leaf.code.startsWith('3305')) cols.reservaLegal += leaf.cents;
      else cols.otrasReservas += leaf.cents;
    } else if (g === '36') cols.resultadoEjercicio += leaf.cents;
    else if (g === '37') cols.resultadosAcumulados += leaf.cents;
    else if (g === '38') cols.ori += leaf.cents;
    else unmapped.set(g, (unmapped.get(g) ?? ZERO) + leaf.cents);
  }
  const unmappedGroups = [...unmapped.entries()]
    .filter(([, v]) => v !== ZERO)
    .map(([g]) => g)
    .sort();
  return { cols, unmappedGroups };
}

// ---------------------------------------------------------------------------
// ORI del periodo (enmienda 12, spec v2.1 — integración I4)
// ---------------------------------------------------------------------------
// Una sola regla para el ERI, el ECP y el validador: el Otro Resultado
// Integral del periodo es la VARIACIÓN del grupo PUC 38 (superávit por
// valorizaciones / ORI; Decreto 2650/1993) entre el corte de apertura y el de
// cierre del periodo. Es la misma cifra que mueve la columna ORI del ECP
// (NIIF para las PYMES, Secciones 5 y 6 — 6.3(c): el ORI del estado del
// resultado integral es el cambio de ese componente del patrimonio). Antes, el
// ECP determinista registraba Δ38 en la columna ORI mientras E6b exigía ORI $0
// en el ERI: con un grupo 38 que se movió en el año, ninguna cifra del ERI
// satisfacía las dos reglas y el informe honesto salía sellado.
//
// El PUC no distingue las partidas que se reclasifican a resultados de las que
// no (ORI_COMPONENT_MAP sigue vacío): el ORI se presenta en UNA línea. Un
// traslado del superávit a resultados acumulados (realización) tampoco se
// distingue en un balance de prueba de saldos: el código presenta Δ38 como ORI
// y la revelación del traslado queda a cargo del contador.
// ---------------------------------------------------------------------------

/** Σ en centavos de las hojas del grupo PUC 38 de un corte. */
export function group38Cents(snapshot: PeriodSnapshot): bigint {
  return equityColumnsOfSnapshot(snapshot).cols.ori;
}

/** ORI del periodo = Δ grupo 38 entre el corte de apertura y el de cierre. */
export function oriOfPeriodCents(opening: PeriodSnapshot, closing: PeriodSnapshot): bigint {
  return group38Cents(closing) - group38Cents(opening);
}

/**
 * Ancla del ORI de un periodo:
 *   - `measured`: hay corte de apertura utilizable; el ORI es Δ38.
 *   - `noGroup38`: sin apertura y sin saldo en el grupo 38 al cierre: no hay
 *     ORI acumulado del cual medir un movimiento; se presenta $0.
 *   - `notMeasurable`: sin apertura y con saldo en el grupo 38: la variación
 *     no es medible. En el comparativo se presenta N/D (null); en el periodo
 *     actual (un solo corte) el contrato no admite N/D y rige $0 con la
 *     limitación revelada.
 */
export type OriAnchor =
  | { kind: 'measured'; cents: bigint; openingPeriod: string; closingPeriod: string }
  | { kind: 'noGroup38'; cents: bigint }
  | { kind: 'notMeasurable'; group38Cents: bigint; period: string };

function unmeasuredOriAnchor(closing: PeriodSnapshot): OriAnchor {
  const g38 = group38Cents(closing);
  return g38 === ZERO
    ? { kind: 'noGroup38', cents: ZERO }
    : { kind: 'notMeasurable', group38Cents: g38, period: closing.period };
}

/**
 * Nota determinista del ORI no medible del periodo actual (I5-niif 3): sin
 * corte de apertura utilizable (un solo corte, o comparativo impracticable) y
 * con saldo en el grupo 38. `oriPrimary` no admite N/D y el ERI
 * presenta $0; la nota dice que esa cifra no es una medición y qué corte hace
 * falta para medirla (NIIF para las PYMES, Sección 5: estado del resultado
 * integral). `null` para cualquier otra ancla. En el idioma del informe.
 */
export function oriNotMeasurableNote(
  anchor: OriAnchor | null,
  language: ComparativeNoteLanguage = 'es',
): { ref: null; norma: string; body: string } | null {
  if (!anchor || anchor.kind !== 'notMeasurable') return null;
  if (language === 'en') {
    return {
      ref: null,
      norma: 'IFRS for SMEs, Section 5',
      body:
        `Other comprehensive income (OCI) for ${anchor.period}: not measurable without the opening cut-off. ` +
        'The trial balance shows a balance in PUC group 38 (revaluation surplus / OCI), but without a usable ' +
        'opening cut-off its movement for the period cannot be determined; OCI for the period is presented as ' +
        '$0 and that figure is not a measurement. Measuring it requires a usable trial balance of the previous ' +
        'cut-off.',
    };
  }
  return {
    ref: null,
    norma: 'NIIF para las PYMES, Sección 5',
    body:
      `Otro resultado integral (ORI) del periodo ${anchor.period}: no medible sin el corte de apertura. ` +
      'El balance de prueba registra saldo en el grupo 38 (superávit por valorizaciones / ORI), pero sin un ' +
      'corte de apertura utilizable su variación del periodo no se puede determinar; el ORI del periodo se ' +
      'presenta en $0 y esa cifra no es una medición. Para medirlo se requiere un balance de prueba utilizable ' +
      'del corte anterior.',
  };
}

/**
 * Anclas del ORI de los dos periodos del informe. `primary` usa el corte
 * comparativo como apertura (el mismo que abre el ECP y el EFE del periodo);
 * `comparative` usa el corte anterior al comparativo con las mismas
 * condiciones que la base comparativa del EFE/ECP (`comparativeOpeningOf`).
 * `comparative` es `null` si el informe no tiene periodo comparativo.
 */
export function buildOriAnchors(
  source: (ComparativeStatementsSource & { primary?: PeriodSnapshot | null }) | null | undefined,
): { primary: OriAnchor | null; comparative: OriAnchor | null } {
  const primary = source?.primary && typeof source.primary === 'object' ? source.primary : null;
  if (!primary) return { primary: null, comparative: null };
  const opening = comparativeOpeningOf(source);
  if (!opening) return { primary: unmeasuredOriAnchor(primary), comparative: null };
  const { comparative, opening: prior, gap } = opening;
  return {
    primary: {
      kind: 'measured',
      cents: oriOfPeriodCents(comparative, primary),
      openingPeriod: comparative.period,
      closingPeriod: primary.period,
    },
    comparative:
      gap === null && prior
        ? {
            kind: 'measured',
            cents: oriOfPeriodCents(prior, comparative),
            openingPeriod: prior.period,
            closingPeriod: comparative.period,
          }
        : unmeasuredOriAnchor(comparative),
  };
}

function equityRow(
  kind: EquityChangeRowJson['kind'],
  label: string,
  cols: Partial<Record<EquityColumnKey, bigint>>,
): EquityChangeRowJson {
  let total = ZERO;
  const values = {} as Record<EquityColumnKey, string>;
  for (const k of EQUITY_ROW_KEYS) {
    const v = cols[k] ?? ZERO;
    values[k] = v.toString();
    total += v;
  }
  return { kind, label, ...values, total: total.toString() };
}

/**
 * ECP determinista de un periodo a partir de su corte de apertura y su corte
 * de cierre (NIIF para las PYMES 6.3). Filas:
 *   - saldo inicial = columnas del corte de apertura;
 *   - traslado del resultado anterior (Dr 3605 / Cr 37, total $0) cuando la
 *     apertura arrastra resultado del ejercicio;
 *   - resultado del ejercicio = utilidad neta del periodo;
 *   - ORI = variación del grupo 38, si la hubo (`oriOfPeriodCents`: la misma
 *     cifra que el ERI presenta como ORI del periodo — enmienda 12);
 *   - lo que el resultado no explica, en UNA fila cuyo tipo sale del signo
 *     del flujo con los socios del EFE determinista (aportes, distribuciones
 *     pendientes de soporte, partida no conciliada o traslados internos de
 *     total $0);
 *   - saldo final = columnas del corte de cierre.
 * Por construcción, apertura + movimientos = cierre, columna a columna.
 */
export function buildDeterministicEquityChanges(
  opening: PeriodSnapshot,
  closing: PeriodSnapshot,
): { rows: EquityChangeRowJson[] } | { reason: string; reasonEn?: string } {
  const o = equityColumnsOfSnapshot(opening);
  const c = equityColumnsOfSnapshot(closing);
  const unmapped = Array.from(new Set([...o.unmappedGroups, ...c.unmappedGroups])).sort();
  if (unmapped.length > 0) {
    return {
      reason:
        `el patrimonio registra saldos en grupos sin columna propia en el estado ` +
        `(${unmapped.join(', ')}: revalorización del patrimonio, dividendos decretados en ` +
        `acciones u otros de la clase 3), y el estado por columnas no los reflejaría`,
      reasonEn:
        `equity carries balances in groups without their own column in the statement ` +
        `(${unmapped.join(', ')}: equity revaluation, share dividends declared or other ` +
        `class 3 groups), which the column layout would not reflect`,
    };
  }
  const cy = yearOfPeriodLabel(closing.period) ?? closing.period;
  const oy = yearOfPeriodLabel(opening.period) ?? opening.period;
  const closedYear = closing.periodoTipo === 'cerrado';
  const netIncome = pesosToCents(closing.controlTotals.utilidadNeta);
  const efe = buildDeterministicCashFlow(closing, opening);

  const rows: EquityChangeRowJson[] = [
    equityRow(
      'opening_balance',
      closedYear ? `Saldo al 1 de enero de ${cy}` : `Saldo al inicio del periodo ${cy}`,
      o.cols,
    ),
  ];
  const moved: Record<EquityColumnKey, bigint> = { ...o.cols };
  const apply = (cols: Partial<Record<EquityColumnKey, bigint>>) => {
    for (const k of EQUITY_ROW_KEYS) moved[k] += cols[k] ?? ZERO;
  };

  if (o.cols.resultadoEjercicio !== ZERO) {
    const cancel = {
      resultadoEjercicio: -o.cols.resultadoEjercicio,
      resultadosAcumulados: o.cols.resultadoEjercicio,
    };
    rows.push(
      equityRow('prior_period_result_cancellation', `Traslado del resultado ${oy} a resultados acumulados`, cancel),
    );
    apply(cancel);
  }

  rows.push(
    equityRow(
      'profit_for_period',
      netIncome < ZERO
        ? `Pérdida del ejercicio ${cy}`
        : netIncome > ZERO
          ? `Utilidad del ejercicio ${cy}`
          : `Resultado del ejercicio ${cy}`,
      { resultadoEjercicio: netIncome },
    ),
  );
  apply({ resultadoEjercicio: netIncome });

  const oriDelta = oriOfPeriodCents(opening, closing);
  if (oriDelta !== ZERO) {
    rows.push(
      equityRow(
        'other_comprehensive_income',
        `Otro resultado integral / superávit por valorizaciones del ejercicio ${cy}`,
        { ori: oriDelta },
      ),
    );
    apply({ ori: oriDelta });
  }

  const residual: Partial<Record<EquityColumnKey, bigint>> = {};
  let residualTotal = ZERO;
  let anyResidual = false;
  for (const k of EQUITY_ROW_KEYS) {
    const r = c.cols[k] - moved[k];
    if (r === ZERO) continue;
    residual[k] = r;
    residualTotal += r;
    anyResidual = true;
  }
  if (anyResidual) {
    const classification = efe?.ownerFlows.classification ?? 'none';
    if (residualTotal > ZERO) {
      rows.push(
        equityRow(
          'capital_contribution',
          `Aportes de socios y traslados internos del ejercicio ${cy} (aumento patrimonial no explicado ` +
            'por el resultado; verificar soporte del aporte)',
          residual,
        ),
      );
    } else if (residualTotal < ZERO) {
      rows.push(
        equityRow(
          'dividend_distribution',
          classification === 'unreconciled'
            ? `Partida patrimonial no conciliada ${cy} (resultado de ejercicios anteriores no trasladado ` +
                'o distribución a socios) — requiere explicación del contador'
            : `Distribuciones a socios del ejercicio ${cy} (disminución patrimonial no explicada por el ` +
                'resultado) — pendiente de soporte: acta y comprobante de egreso',
          residual,
        ),
      );
    } else {
      rows.push(
        equityRow(
          'reserve_appropriation',
          `Traslados entre cuentas del patrimonio del ejercicio ${cy} (apropiación de reservas o ` +
            'capitalización; sin efecto en el total)',
          residual,
        ),
      );
    }
  }

  rows.push(
    equityRow(
      'closing_balance',
      closedYear ? `Saldo al 31 de diciembre de ${cy}` : `Saldo al cierre del periodo ${cy}`,
      c.cols,
    ),
  );
  return { rows };
}

/**
 * Corte comparativo del informe y su apertura: el corte anterior al
 * comparativo en `periods`, con el motivo por el que no sirve de apertura
 * (`gap`, `null` si sirve). `null` cuando el informe no tiene periodo
 * comparativo (un solo corte, o comparativo impracticable según el
 * preprocesador). Lo comparten la base del EFE/ECP comparativos y el ancla del
 * ORI comparativo, para que las dos midan desde el mismo corte.
 */
function comparativeOpeningOf(source: ComparativeStatementsSource | null | undefined): {
  comparative: PeriodSnapshot;
  opening: PeriodSnapshot | null;
  cy: string;
  priorYear: string | null;
  gap: ComparativeGap | null;
} | null {
  const comparative = source?.comparative;
  if (!comparative || typeof comparative !== 'object' || source?.comparativos_impracticables === true) {
    return null;
  }
  const cy = yearOfPeriodLabel(comparative.period) ?? comparative.period;
  const priorYear = /^\d{4}$/.test(cy) ? String(Number(cy) - 1) : null;
  const periods: readonly PeriodSnapshot[] = Array.isArray(source?.periods) ? source.periods : [];
  const idx = periods.findIndex((p) => p && p.period === comparative.period);
  const opening = idx > 0 ? periods[idx - 1] : null;
  return { comparative, opening, cy, priorYear, gap: comparativeOpeningGap(comparative, opening, cy, priorYear) };
}

/**
 * Base determinista de los comparativos del EFE y del ECP a partir del
 * preprocesado. `null` cuando el informe no tiene periodo comparativo (un solo
 * corte, o comparativo impracticable según el preprocesador — el mismo
 * criterio con que el orquestador fija `company.comparativePeriod`).
 * `language` fija el idioma de las notas de comparativo no presentado.
 */
export function buildComparativeStatementsBasis(
  source: ComparativeStatementsSource | null | undefined,
  language: ComparativeNoteLanguage = 'es',
): ComparativeStatementsBasis | null {
  const resolved = comparativeOpeningOf(source);
  if (!resolved) return null;
  const { comparative, opening, cy, gap: openingGap } = resolved;
  let cashFlow: DeterministicCashFlow | null = null;
  let cashFlowGap = openingGap;
  let equityRows: EquityChangeRowJson[] | null = null;
  let equityGap = openingGap;
  if (openingGap === null && opening) {
    const efe = buildDeterministicCashFlow(comparative, opening);
    if (efe && efe.reconciled) {
      cashFlow = efe;
    } else if (efe) {
      const gap = copOf(efe.reconciliationGapCents);
      cashFlowGap = {
        es:
          `el EFE determinista del periodo ${cy} no concilia con la variación del efectivo (PUC 11): ` +
          `brecha ${gap}; revise el balance de prueba de ese periodo`,
        en:
          `the deterministic ${cy} cash flow statement does not reconcile with the change in cash ` +
          `(PUC 11): gap ${gap}; review that period's trial balance`,
      };
    }
    const ecp = buildDeterministicEquityChanges(opening, comparative);
    if ('rows' in ecp) equityRows = ecp.rows;
    else equityGap = { es: ecp.reason, en: ecp.reasonEn ?? ecp.reason };
  }
  const fallback: ComparativeGap = {
    es: `sin saldo de apertura del periodo ${cy} no hay variaciones que medir`,
    en: `without ${cy} opening balances there are no movements to measure`,
  };
  return {
    comparativePeriod: cy,
    openingPeriod: opening?.period ?? null,
    cashFlow,
    cashFlowNote: cashFlow
      ? null
      : comparativeNotPresentedNote('cashFlow', cy, cashFlowGap ?? fallback, language),
    equityRows,
    equityNote: equityRows
      ? null
      : comparativeNotPresentedNote('equity', cy, equityGap ?? fallback, language),
    oriCents: openingGap === null && opening ? oriOfPeriodCents(opening, comparative) : null,
    language,
  };
}

/**
 * Clave de presentación de una partida del EFE determinista para alinear los
 * dos periodos en un mismo renglón: el grupo PUC (o la clave de agregación)
 * y, para el gasto no monetario, una sola clave aunque las correctoras que lo
 * componen difieran entre periodos (1592 en uno, 1592/1698 en otro).
 */
function cashFlowPresentationKey(row: BreakdownRow): string {
  if (sourceRowCategory(row) === 'nonCash' && row.account !== '19/38') return 'nonCash:depreciation';
  return row.account;
}

type CashFlowJson = NiifReportJson['cashFlow'];
type CashFlowLineJson = CashFlowJson['sections'][number]['lines'][number];

/** Rótulo del resultado del ejercicio cuando los dos periodos tienen signo distinto. */
const NET_INCOME_NEUTRAL_LABEL = 'Utilidad (pérdida) neta del ejercicio';

/**
 * Adjunta al informe la columna comparativa del EFE y el ECP del periodo
 * comparativo desde la base determinista (o la nota de comparativo no
 * presentado).
 * Función pura: toda cifra comparativa que imprimen esos dos estados sale de
 * aquí; las que el modelo hubiera escrito se descartan.
 *
 * EFE: cada renglón que el analista rotuló se identifica con su partida del
 * EFE determinista del periodo actual (mismo emparejamiento que E23: importe
 * y, entre partidas del mismo importe, código PUC, rótulo o categoría) y
 * recibe el importe de la MISMA partida en el periodo comparativo, o $0 si esa
 * partida no se movió. Las partidas que sólo se movieron en el periodo
 * comparativo se añaden al final de su actividad con $0 en el periodo actual.
 * Un renglón sin partida de origen queda sin cifra comparativa (`null`): el
 * validador ya lo bloquea (E23). Así la columna comparativa suma, por
 * construcción, el subtotal comparativo de cada actividad.
 */
export function attachComparativeStatements(
  json: NiifReportJson,
  basis: ComparativeStatementsBasis | null,
  primaryCashFlow: DeterministicCashFlow | null,
): NiifReportJson {
  const cf = json.cashFlow;
  const compEfe = basis?.cashFlow ?? null;
  let cashFlow: CashFlowJson;
  if (compEfe && primaryCashFlow) {
    const sections = cf.sections.map((section) => {
      const primaryRows = primaryCashFlow.sections.find((s) => s.section === section.section)?.rows ?? [];
      const compSection = compEfe.sections.find((s) => s.section === section.section);
      const compRows = (compSection?.rows ?? []).filter((r) => r.cents !== ZERO);
      const unused = new Map<string, BreakdownRow>();
      const extra: BreakdownRow[] = [];
      for (const r of compRows) {
        const k = cashFlowPresentationKey(r);
        // Dos partidas con la misma clave no ocurren en el determinista; si
        // ocurrieran, la segunda se presenta como renglón propio.
        if (unused.has(k)) extra.push(r);
        else unused.set(k, r);
      }
      const matches = matchCashFlowLinesToDeterministicDetailed(section.lines, primaryRows);
      const comparativeOf = (row: BreakdownRow): bigint =>
        compRows.find((r) => cashFlowPresentationKey(r) === cashFlowPresentationKey(row))?.cents ?? ZERO;
      // Renglones del mismo importe que ni el código PUC, ni el rótulo, ni su
      // categoría distinguen: el orden decidió cuál es cuál. Si sus partidas
      // difieren en el periodo comparativo, el rótulo del modelo podría quedar
      // junto a la cifra comparativa de OTRA partida; esos renglones toman el
      // rótulo y el código de la partida determinista que representan (su
      // importe del periodo actual es el mismo, así que ninguna cifra cambia).
      const ambiguousRows = new Set<BreakdownRow>();
      for (const m of matches) {
        if (m.row && m.tiedWith.some((t) => comparativeOf(t) !== comparativeOf(m.row!))) {
          ambiguousRows.add(m.row);
          for (const t of m.tiedWith) ambiguousRows.add(t);
        }
      }
      const take = (key: string): string => {
        const row = unused.get(key);
        if (!row) return '0';
        unused.delete(key);
        return row.cents.toString();
      };
      const lines: CashFlowLineJson[] = section.lines.map((line, i) => {
        const source = matches[i].row;
        if (source) {
          const amountComparative = take(cashFlowPresentationKey(source));
          const comparativeCents = BigInt(amountComparative);
          const signsDiffer =
            source.account === '36' &&
            comparativeCents !== ZERO &&
            parseCents(line.amountPrimary) < ZERO !== comparativeCents < ZERO;
          return {
            ...line,
            ...(ambiguousRows.has(source) ? { account: source.account, label: source.label } : {}),
            ...(signsDiffer ? { label: NET_INCOME_NEUTRAL_LABEL } : {}),
            amountComparative,
          };
        }
        if (parseCents(line.amountPrimary) !== ZERO) return { ...line, amountComparative: null };
        // Renglón en $0 del periodo actual: se alinea por su código si lo trae.
        const key = (line.account ?? '').trim();
        return { ...line, amountComparative: key && unused.has(key) ? take(key) : '0' };
      });
      for (const row of [...unused.values(), ...extra]) {
        lines.push({
          account: row.account,
          label: row.label,
          amountPrimary: '0',
          amountComparative: row.cents.toString(),
          level: 2,
          isAbsolute: false,
          confidence: null,
          anomalyFlag: null,
        });
      }
      return { ...section, lines, netFlowComparative: (compSection?.netFlowCents ?? ZERO).toString() };
    });
    cashFlow = {
      ...cf,
      sections,
      netChangeComparative: compEfe.netChangeCents.toString(),
      cashOpeningComparative: compEfe.cashOpeningCents.toString(),
      cashClosingComparative: compEfe.cashClosingCents.toString(),
      comparativeNote: null,
    };
  } else {
    cashFlow = {
      ...cf,
      sections: cf.sections.map((s) => ({
        ...s,
        lines: s.lines.map((l) => ({ ...l, amountComparative: null })),
        netFlowComparative: null,
      })),
      netChangeComparative: null,
      cashOpeningComparative: null,
      cashClosingComparative: null,
      comparativeNote: basis
        ? (basis.cashFlowNote ??
          comparativeNotPresentedNote(
            'cashFlow',
            basis.comparativePeriod,
            {
              es: 'el EFE del periodo actual no es calculable y no hay partidas contra las cuales alinear el comparativo',
              en: 'the current-period cash flow statement is not computable and there are no items to align the comparative with',
            },
            basis.language ?? 'es',
          ))
        : null,
    };
  }
  return {
    ...json,
    cashFlow,
    equityChanges: {
      ...json.equityChanges,
      comparativeRows: basis?.equityRows ?? null,
      comparativeNote: basis && !basis.equityRows ? basis.equityNote : null,
    },
  };
}
