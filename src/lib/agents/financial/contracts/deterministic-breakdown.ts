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
  '31': 'Aportes y reembolsos de capital social',
  '32': 'Movimientos de superávit de capital',
  '33': 'Constitución y liberación de reservas',
  '2360': 'Dividendos pagados a socios (PUC 2360)',
};

/** Cuentas de depreciación / amortización acumulada dentro del grupo 15. */
const ACCUMULATED_DEPRECIATION_PREFIXES = ['1592', '1595', '1598'];

/**
 * Cuentas que prueban una distribución a socios. `2360` es la obligación
 * reconocida cuando la asamblea decreta (Art. 155 C.Co.); el grupo `35` es el
 * dividendo decretado en acciones, que NO es flujo de efectivo (NIC 7 ¶43)
 * pero sí es evidencia de que hubo distribución.
 */
const DIVIDEND_EVIDENCE_PREFIXES = ['2360', '35'];

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
  let accumulatedDepreciationDelta = ZERO;
  let resultsDelta = ZERO; // Δ grupos 36 + 37 (se presenta desagregado abajo)
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

    if (ACCUMULATED_DEPRECIATION_PREFIXES.some((p) => code.startsWith(p))) {
      // La depreciación acumulada es crédito: su Δ es negativo y su reverso
      // (gasto no monetario) se devuelve a operación. NIC 7 ¶18(b).
      accumulatedDepreciationDelta += delta;
    }

    const subaccount = subaccountOf(code);
    if (DIVIDEND_EVIDENCE_PREFIXES.some((p) => code.startsWith(p)) && delta !== ZERO) {
      dividendAccounts.push(code);
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
      section = classCode === 3 ? 'financing' : 'operating';
    }

    if (group === '36' || group === '37') {
      resultsDelta += cents;
      continue; // se presenta como utilidad + conciliación, más abajo.
    }

    const prev = flowByKey.get(key);
    if (prev) prev.cents += cents;
    else flowByKey.set(key, { section, cents });
  }

  // --- Operación: utilidad neta + conciliación de resultados acumulados -----
  // `resultsDelta` es la variación de los grupos 36/37. Su parte "utilidad del
  // ejercicio" es el ancla del P&G; el resto NO es flujo: es el resultado de
  // periodos anteriores arrastrado en el patrimonio de apertura (PUC 3605 sin
  // asiento de cierre, situación normal en SAS colombianas) más el residuo del
  // cierre virtual R8. Presentarlo como "dividendos estimados" en financiación
  // es lo que la auditoría encontró y lo que NIC 7 ¶43 prohíbe.
  const netIncomeCents = pesosToCents(primary.controlTotals.utilidadNeta);
  let openingResult3605 = ZERO;
  for (const [code, balance] of opening) {
    if (code.startsWith('3605')) openingResult3605 += balance.cents;
  }
  const priorResultAdjustment = -openingResult3605;
  const retainedEarningsRemainder = resultsDelta - netIncomeCents - priorResultAdjustment;

  // La depreciación acumulada vive dentro del grupo 15 (inversión). NIC 7
  // ¶18(b) la devuelve a operación como gasto no monetario y deja en inversión
  // la compra BRUTA. El traslado no altera la variación neta de caja.
  const depreciationAddBack = -accumulatedDepreciationDelta;

  const operatingRows: BreakdownRow[] = [
    { account: '36', label: 'Utilidad neta del ejercicio', cents: netIncomeCents },
  ];
  if (depreciationAddBack !== ZERO) {
    operatingRows.push({
      account: '1592/1595/1598',
      label: 'Depreciación y amortización del ejercicio (partida no monetaria)',
      cents: depreciationAddBack,
    });
  }
  if (priorResultAdjustment !== ZERO) {
    operatingRows.push({
      account: '3605',
      label:
        'Resultado de periodos anteriores reconocido en patrimonio de apertura ' +
        '(ajuste de conciliación — no representa flujo de efectivo del período)',
      cents: priorResultAdjustment,
    });
  }
  if (retainedEarningsRemainder !== ZERO) {
    operatingRows.push({
      account: '36/37',
      label:
        'Variación de resultados de ejercicios anteriores y ajuste de cierre virtual ' +
        '(partida no monetaria)',
      cents: retainedEarningsRemainder,
    });
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
    let amount = cents;
    if (key === '15') amount -= depreciationAddBack; // la compra bruta se queda aquí
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

  if (nonCashNet !== ZERO) {
    // NIC 7 ¶43: las transacciones no monetarias se excluyen del EFE y se
    // revelan. Se dejan visibles en UN renglón conciliatorio en vez de
    // repartirse como flujos falsos de inversión o financiación.
    operatingRows.push({
      account: '19/34/35/38',
      label: 'Partidas no monetarias netas (valorizaciones, revalorización, dividendos en acciones)',
      cents: nonCashNet,
    });
  }

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
