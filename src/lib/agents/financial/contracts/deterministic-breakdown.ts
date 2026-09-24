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
 *     excluir del estado y revelar aparte (valorizaciones, revalorización del
 *     patrimonio, dividendos decretados en acciones). Se agregan en UN solo
 *     renglón conciliatorio visible en operación en vez de disfrazarse de
 *     flujo de inversión o financiación.
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
 * queda fuera: su contrapartida es el 19 y ambos son partida no monetaria.
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

  const operatingRows: BreakdownRow[] = [
    { account: '36', label: 'Utilidad neta del ejercicio', cents: netIncomeCents },
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

  for (const [key, { section, cents }] of [...flowByKey.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (section === 'nonCash') {
      nonCashNet += cents;
      continue;
    }
    // La variación BRUTA se queda en su grupo; el gasto no monetario ya se
    // devolvió a operación arriba.
    const amount = cents - (nonCashAddBackByGroup.get(key) ?? ZERO);
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
  financingRows.push(...ownerFinancingRows);

  if (nonCashNet !== ZERO) {
    // NIC 7 ¶43: las transacciones no monetarias se excluyen del EFE y se
    // revelan. Se dejan visibles en UN renglón conciliatorio en vez de
    // repartirse como flujos falsos de inversión o financiación.
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
  readonly label: string;
  readonly amountPrimary: string;
}

export interface CashFlowSectionLike {
  readonly section: string;
  readonly lines: readonly CashFlowLineLike[];
  readonly netFlow: string;
}

export interface CashFlowStatementLike {
  readonly sections: readonly CashFlowSectionLike[];
  readonly netChange: string;
  readonly cashOpening: string;
  readonly cashClosing: string;
}

export type CashFlowInvariantViolation =
  | {
      kind: 'section_sum';
      section: string;
      lineCount: number;
      sumOfLinesCents: bigint;
      netFlowCents: bigint;
      gapCents: bigint;
    }
  | {
      kind: 'net_change';
      sumOfSectionsCents: bigint;
      netChangeCents: bigint;
      gapCents: bigint;
    }
  | {
      kind: 'closure';
      cashOpeningCents: bigint;
      netChangeCents: bigint;
      cashClosingCents: bigint;
      gapCents: bigint;
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
 * Devuelve la lista de violaciones (vacía = el EFE cierra).
 */
export function checkCashFlowInvariants(
  cashFlow: CashFlowStatementLike,
): CashFlowInvariantViolation[] {
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
    if (v.kind === 'section_sum') {
      return (
        `EFE — Actividades de ${sectionName[v.section] ?? v.section}: los ${v.lineCount} ` +
        `renglones suman ${cop(v.sumOfLinesCents)} bajo un subtotal declarado de ` +
        `${cop(v.netFlowCents)} (brecha ${cop(v.gapCents)}). NIC 7 ¶10.`
      );
    }
    if (v.kind === 'net_change') {
      return (
        `EFE — la suma de los tres subtotales (${cop(v.sumOfSectionsCents)}) no es la ` +
        `variación neta declarada (${cop(v.netChangeCents)}); brecha ${cop(v.gapCents)}.`
      );
    }
    return (
      `EFE — efectivo de apertura ${cop(v.cashOpeningCents)} + variación neta ` +
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

/** Renglones que afirman un pago o distribución a los socios. */
const DISTRIBUTION_LABEL_RE =
  /dividend|distribuci[oó]n(?:es)?\s+(?:a|de|entre)\s+(?:los\s+)?(?:socios|accionistas|utilidades|propietarios)|pagos?\s+(?:de\s+)?(?:utilidades|participaciones)|pagos?\s+a\s+(?:los\s+)?(?:socios|accionistas|propietarios)|participaciones\s+pagadas/i;

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
