// ---------------------------------------------------------------------------
// Trial Balance Preprocessor — deterministic arithmetic validation
// ---------------------------------------------------------------------------
// Parses CSV/Excel trial balance data, filters a leaf set of accounts (the
// most granular level per PUC code), sums by PUC class, validates totals,
// cross-checks la ecuacion patrimonial y la utilidad del ejercicio, y emite
// un contrato de totales vinculantes (controlTotals) + desglose de patrimonio
// (equityBreakdown) que los agentes del pipeline financiero consumen como
// anclas anti-alucinacion.
//
// Multiperíodo (refactor 2026-04-28): cada `RawAccountRow` ahora puede llevar
// saldos de varios periodos en `balancesByPeriod`. `preprocessTrialBalance`
// agrupa los datos por periodo y emite un `PeriodSnapshot` por cada uno;
// `primary` apunta al periodo más reciente y `comparative` al anterior.
//
// NO LLM — computacion pura. Corre antes del pipeline financiero para que los
// agentes reciban datos limpios con garantias aritmeticas.
//
// Convenciones:
//   Clase 1 = Activo, 2 = Pasivo, 3 = Patrimonio, 4 = Ingresos, 5 = Gastos,
//   6 = Costos de Ventas, 7 = Costos de Produccion.
//   Niveles: Clase (1 digito), Grupo (2), Cuenta (4), Subcuenta (6),
//   Auxiliar (8+).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { esCreditoRenta } from '@/lib/accounting/renta-credit';
import { computeEbitda } from '@/lib/pillars/ebitda';
import { runCurator } from './balance-curator';
import { inferPeriodoTipo, mesesDelPeriodo } from './periodo-meses';
import { normalizeSignConvention, type SignConventionDetection } from './sign-convention';
import {
  isCurrentLiabilityCode,
  isNonCurrentLiabilityCode,
  r1OriginGroup,
} from './curator-rules/balance-groups';
import {
  motivoCodigoVencimientoInvalido,
  type UnidadMonetaria,
  type Vencimiento,
} from '@/lib/upload/ingest-directives';
import type {
  CashFlowStatement,
  Class18ClassificationAudit,
  ClosingDetectorAudit,
  CostClassificationAudit,
  CuratorFinding,
  CuratorResult,
  PpeDepreciationAudit,
  PrecisionCentsAudit,
  PresumedCostWarning,
  Reclassification,
  VirtualCloseAdjustment,
} from './curator-rules/types';

export interface RawAccountRow {
  /** Account code (e.g. "110505", "1105", "1") */
  code: string;
  /** Account name */
  name: string;
  /** Account level: "Clase", "Grupo", "Cuenta", "Subcuenta", "Auxiliar" */
  level: string;
  /** Whether this is a transactional account */
  transactional: boolean;
  /**
   * Saldos por periodo. Claves: "2024", "2025", etc. Para entradas sin
   * año detectado se usa la etiqueta provista (default `'current'`).
   */
  balancesByPeriod: Record<string, number>;
  /**
   * Problemas de lectura detectados por el parser: celda de saldo no vacía que
   * no es un importe legible, o columnas de saldo que no se pueden asignar a
   * un periodo sin adivinar. `buildSnapshotForPeriod` los convierte en motivos
   * de validación bloqueantes: un valor ilegible nunca desaparece en silencio
   * (niif-preproceso-05, ingesta-06). Ausente cuando no hubo problemas.
   */
  parseIssues?: RawRowParseIssue[];
  /**
   * Clasificación por vencimiento DECLARADA por el usuario para esta cuenta
   * (P4-b, `aplicarVencimientosDeclarados`). Sólo clases 1 y 2. Ausente = la
   * clasificación por grupo PUC (supuesto revelado en `clasificacionSupuesta`).
   * Viaja en la fila para que toda superficie que preprocesa las filas (upload,
   * /niif, Stage 0 del orquestador, /export, API v1 persistido) la aplique igual.
   */
  vencimiento?: Vencimiento;
  /**
   * Notas de ingesta del ARCHIVO (no bloquean): unidad reexpresada por
   * confirmación del usuario, excepciones de vencimiento, fecha de corte
   * declarada. Se adjuntan a la primera fila del archivo (no a todas) y
   * `buildSnapshotForPeriod` las publica en `validation.adjustments`, que el
   * informe de validación, el progreso del pipeline y el anexo del PDF
   * muestran. No son `parseIssues`: esos bloquean y los importadores los tratan
   * como errores de lectura.
   */
  notasIngesta?: NotaIngesta[];
}

/** Problema de lectura de una fila (o del archivo completo) del balance. */
export interface RawRowParseIssue {
  /** Periodo afectado; `null` = todos los periodos del archivo. */
  period: string | null;
  /** Descripción legible, con la cuenta y la columna cuando aplica. */
  message: string;
}

/** Nota informativa de ingesta (ver `RawAccountRow.notasIngesta`). */
export interface NotaIngesta {
  /** Periodo al que aplica; `null` = todos los periodos del archivo. */
  period: string | null;
  message: string;
  /**
   * Fecha de corte declarada en el archivo para `period` (niif-preproceso-29,
   * P4-c): determina `periodoTipo` y la nota de base de los KPIs.
   */
  corte?: { tipo: 'cerrado' | 'parcial'; meses: number; texto: string };
  /**
   * ICU-03: el archivo trae una fecha («texto») que no se interpretó como
   * fecha de corte de `period`. La nota de base de los KPIs la cita en vez de
   * afirmar que el archivo no declara la fecha.
   */
  fechaSinInterpretar?: string;
}

export interface ValidatedAccount {
  code: string;
  name: string;
  level: string;
  /** Solo el balance del snapshot al que pertenece esta cuenta. */
  balance: number;
  /** Whether this is a leaf/transactional account used in summation */
  isLeaf: boolean;
  /** Vencimiento declarado por el usuario (P4-b); ausente = por grupo PUC. */
  vencimiento?: Vencimiento;
}

export interface PUCClass {
  code: number;
  name: string;
  /** Sum of auxiliary accounts only */
  auxiliaryTotal: number;
  /** Reported class total (from the "Clase" row, if present) */
  reportedTotal: number | null;
  /** Discrepancy between reported and calculated */
  discrepancy: number;
  /** Accounts in this class */
  accounts: ValidatedAccount[];
}

export interface Discrepancy {
  /** PUC class or account code */
  location: string;
  /** What was reported */
  reported: number;
  /** What was calculated */
  calculated: number;
  /** Difference */
  difference: number;
  /** Probable cause */
  description: string;
}

// ---------------------------------------------------------------------------
// Pulido NIIF PYME Grupo 2 — contrato cents + raw (precisión preservada)
// ---------------------------------------------------------------------------
// Las anclas anti-alucinación se calculan en BigInt centavos. `cents` guarda
// la representación entera (sin floating-point drift) y `raw` la string
// canónica leída del archivo (para auditoría del parser). El gate
// `auditReportEmittable` compara SIEMPRE en cents con tolerancia 0n.
// ---------------------------------------------------------------------------
export interface ControlTotalsCents {
  activo: bigint;
  pasivo: bigint;
  patrimonio: bigint;
  ingresos: bigint;
  /** Gastos totales (clase 5 + clase 6 + clase 7), incluye impuesto. */
  gastos: bigint;
  /** Utilidad neta = ingresos − gastos totales. */
  utilidadNeta: bigint;
  /** Utilidad antes de impuestos (UAI) = ingresos − gastos sin impuesto. */
  utilidadAntesImpuestos: bigint;
  /** Impuesto causado del periodo (grupo 54 dentro de clase 5). */
  impuestoCausado: bigint;
  /** Saldo final caja (PUC 11) en cents. */
  efectivoCuenta11: bigint;
  // -----------------------------------------------------------------------
  // Wave 2.F4 — Parte 1.3 spec v2.0: ingresos netos de devoluciones 4175.
  // Devoluciones 4175: cuentas auxiliares de Clase 4 cuyo código empieza por
  // '4175'. Tienen naturaleza débito (restan ingresos); las restamos del
  // bruto para obtener `ingresosNetos`. NIIF 15 §47 + Decreto 2649/93 PUC
  // grupo 4175 (Devoluciones en ventas) — presentación neta obligatoria.
  // -----------------------------------------------------------------------
  /** Σ |saldo de cuentas 4175xx| en cents (devoluciones en ventas). */
  totalDevoluciones: bigint;
  /** Ingresos netos = |ingresos bruto Clase 4| − totalDevoluciones, en cents. */
  ingresosNetos: bigint;
  /**
   * Ingresos operacionales netos (grupo 41 salvo 4175 − devoluciones 4175)
   * en cents, exactos desde las hojas: misma cifra que
   * `ControlTotals.ingresosOperacionalesNetos` sin pasar por `number`. El
   * grupo 42 queda fuera (va debajo de la utilidad operacional). Opcional:
   * los constructores anteriores de ControlTotalsCents no lo traen y los
   * lectores caen al ancla en pesos.
   */
  ingresosOperacionalesNetos?: bigint;
  /**
   * Saldo a favor del impuesto de renta (niif-preproceso-19).
   * Créditos de renta − pasivo 2404, sólo si el resultado es positivo:
   *   - 1355: sólo 135505 (anticipo de renta), 135515 (retención en la
   *     fuente) y 135595 cuando el nombre es de renta. ICA, IVA retenido,
   *     sobrantes, contribuciones e impuestos descontables no cuentan.
   *   - 1805 ("Bienes de arte y cultura" en el PUC oficial) sólo cuando el
   *     nombre de la cuenta indica un crédito de impuesto (catálogo propio).
   *   0n cuando no hay saldo a favor identificable.
   * Why: el Art. 850 E.T. exige que un saldo a favor de renta se presente como
   * activo, nunca neteado contra el gasto (clase 54). V13 lee este campo para
   * validar que el reporte declara el saldo a favor en cuenta de activo y NO
   * compensa contra gasto en P&L.
   */
  saldoAFavorImpuesto: bigint;
}

export interface ControlTotalsRaw {
  /** String canónica del activo total leída del Excel/CSV. */
  activo: string;
  pasivo: string;
  patrimonio: string;
  ingresos: string;
  gastos: string;
  utilidadNeta: string;
  utilidadAntesImpuestos: string;
  impuestoCausado: string;
  efectivoCuenta11: string;
  /** String canónica del saldo a favor del impuesto de renta. */
  saldoAFavorImpuesto: string;
  /** Wave 2.F4 — Devoluciones 4175 en string canónica. */
  totalDevoluciones: string;
  /** Wave 2.F4 — Ingresos netos (bruto − devoluciones) en string canónica. */
  ingresosNetos: string;
}

/**
 * ITEM 2 — Sincronización Impuesto Renta (Elite Protocol Layer 2 + 3).
 * Resultado de la R16 (`r16-tax-anticipo-netting`): bruto del pasivo
 * (PUC 2404) − suma de créditos de renta (retenciones y anticipos de renta
 * 1355/1805, regla única de `@/lib/accounting/renta-credit`) = neto a pagar
 * a la DIAN.
 *
 * Sustento NIIF + fiscal:
 *   - NIC 12 §71 — compensación de impuestos corrientes cuando la entidad
 *     tiene derecho legal exigible.
 *   - Arts. 365, 373 y 807 E.T. — retenciones y anticipo imputables a renta.
 *   - Art. 850 E.T. — devolución / aplicación de saldos a favor.
 *   - Práctica revisoría fiscal Ley 43/1990 — el "Neto a Pagar" es la
 *     exposición real al fisco, no el bruto.
 *
 * Why: si la cuenta 2404 reporta $10M y los créditos de renta suman $3.8M,
 * el revisor fiscal espera ver "Impuesto Renta — Neto a Pagar = $6.2M" en
 * el Balance. Presentar sólo el bruto sobre-expone la posición fiscal del
 * usuario y desinforma al órgano social. R16 NO muta 2404 ni 1355/1805
 * (siguen en el detalle); sólo expone el neto como ancla vinculante.
 */
export interface ImpuestoRentaNeto {
  /** Saldo bruto del pasivo PUC 2404 (Impuesto de Renta por Pagar). */
  brutoPasivo2404: number;
  /**
   * Suma de créditos de renta (regla única): retenciones y anticipos de renta
   * en 1355/1805 según `filtrarCreditoRenta`. Conserva el nombre histórico
   * por contrato; NO es sólo la subcuenta 135515.
   */
  anticipoActivo135515: number;
  /** Neto = bruto − créditos de renta, presentación NIIF/NIC 12 §71. */
  netoAPagar: number;
  /** True si hay material netting (ambos saldos > 0 con tolerancia $1k). */
  applicable: boolean;
}

/**
 * Totales de control — contrato numerico vinculante para los agentes.
 * Todos los campos son requeridos (0 si ausentes en la entrada).
 */
export interface ControlTotals {
  activo: number;
  activoCorriente: number;
  activoNoCorriente: number;
  pasivo: number;
  pasivoCorriente: number;
  pasivoNoCorriente: number;
  patrimonio: number;
  ingresos: number;
  /** Gastos (Clase 5) + Costos (Clases 6 y 7) */
  gastos: number;
  /** Ingresos - Gastos */
  utilidadNeta: number;
  // -----------------------------------------------------------------------
  // Big Four Cash Flow — segregacion de cuentas PUC para el Strategy Director
  // -----------------------------------------------------------------------
  /** PUC 11 — Efectivo y equivalentes */
  efectivoCuenta11: number;
  /** PUC 13 — Deudores comerciales y otros */
  deudoresCuenta13: number;
  /** PUC 23 — Cuentas por pagar */
  cuentasPorPagar23: number;
  /** PUC 24 — Impuestos por pagar */
  impuestosCuenta24: number;
  /** PUC 25 — Obligaciones laborales */
  obligacionesLaborales25: number;
  // -----------------------------------------------------------------------
  // Pulido Diamante R6 — anclas de caja para validar EFE ↔ Balance al centavo.
  // Opcionales por ahora: la lógica que los popula la pondrá B1. Hacerlos
  // obligatorios hoy rompería tests/literales existentes que construyen
  // `ControlTotals` sin estos campos.
  // -----------------------------------------------------------------------
  /**
   * Saldo final de caja (= efectivoCuenta11) — alias semántico para validar
   * EFE↔Balance al centavo.
   */
  // TODO(B1): hacer obligatorio cuando R6 popule estos campos
  cashClose?: number;
  /** Saldo inicial de caja (PUC 11 del comparativo, 0 si single-period). */
  // TODO(B1): hacer obligatorio cuando R6 popule estos campos
  cashOpen?: number;
  // -----------------------------------------------------------------------
  // Pulido NIIF PYME Grupo 2 — anclas en BigInt centavos + string raw.
  // Opcionales por retrocompatibilidad: `buildSnapshotForPeriod` los popula
  // siempre, pero los tests/literales históricos que construyen
  // `ControlTotals` a mano no necesitan llenarlos.
  // -----------------------------------------------------------------------
  /** BigInt centavos — fuente única para validators del gate. */
  cents?: ControlTotalsCents;
  /** Strings canónicas leídas del archivo (auditoría del parser). */
  raw?: ControlTotalsRaw;
  /**
   * ITEM 2 — Neto del Impuesto de Renta (R16). Presente sólo cuando R16
   * detecta saldos materiales en PUC 2404 (pasivo) y/o 135515 (activo).
   * El NIIF Analyst lo cita literalmente en el Balance como "Impuesto Renta —
   * Neto a Pagar" debajo del rubro de Impuestos Corrientes (Pasivo).
   */
  impuestoRentaNeto?: ImpuestoRentaNeto;
  // -----------------------------------------------------------------------
  // Wave 2.F4 — Parte 1.3 spec v2.0: ingresos netos de devoluciones 4175 +
  // 14 KPIs deterministicos derivados (Parte 6 spec). Fuente única de verdad
  // que ELIMINA divergencia LLM vs valor.ts vs PDF compose. Opcionales por
  // retrocompatibilidad con tests/literales que construyen `ControlTotals` a
  // mano; `buildSnapshotForPeriod` SIEMPRE los popula.
  // -----------------------------------------------------------------------
  /** Σ |saldo cuentas 4175xx| — devoluciones en ventas (PUC 4175). */
  totalDevoluciones?: number;
  /** Ingresos netos = |ingresos bruto Clase 4| − totalDevoluciones. NIIF 15 §47. */
  ingresosNetos?: number;
  // -----------------------------------------------------------------------
  // Sub-bloque P&L de soporte para los KPIs (no expuesto antes; sin ellos
  // los ratios divergen entre LLM y renderers).
  // -----------------------------------------------------------------------
  /**
   * Ingresos operacionales netos = Σ grupo 41 (salvo 4175) − devoluciones 4175.
   * Enmienda spec v2.1 (2026-09-24): el grupo 42 queda fuera.
   */
  ingresosOperacionalesNetos?: number;
  /** Otros ingresos no operacionales = ingresosNetos − ingresosOperacionalesNetos (grupo 42 y demás). */
  otrosIngresosNoOperacionales?: number;
  /** Utilidad bruta = ingresosOperacionalesNetos − (clase 6 + clase 7). */
  utilidadBruta?: number;
  /**
   * EBIT = utilidadBruta − gastosOp51 − gastosAdmin52. Excluye impuesto, los
   * otros ingresos no operacionales (42) y los gastos no operacionales (53).
   */
  ebit?: number;
  /** Saldo cuenta 14 (Inventarios). */
  inventarios14?: number;
  /** Saldo cuenta 22 (Proveedores) — DIFERENCIADO de cuentasPorPagar23. */
  proveedores22?: number;
  /** Saldo cuenta 6 (Costo de Ventas — clase 6). */
  costoVentas6?: number;
  /** Saldo cuenta 7 (Costo de Producción — clase 7). */
  costoProduccion7?: number;
  /** Σ auxiliares 5305xx — gasto financiero (intereses). 0 si no hay 5305 (sin fallback al grupo 53). */
  gastoFinanciero5305?: number;
  /** Promedio patrimonial = (actual + comparativo) / 2 (= actual si no hay comparativo). */
  patrimonioPromedio?: number;
  /** Promedio del activo = (actual + comparativo) / 2 (= actual si no hay comparativo). */
  activoPromedio?: number;
  // -----------------------------------------------------------------------
  // 14 KPIs Wave 2.F4 — fuente única de verdad. Strings decimales o numéricos
  // según contrato (no centavos). `null` cuando el denominador es 0/anómalo
  // para que el renderer pinte 'ND' explícitamente, NUNCA un fallback silencioso.
  // -----------------------------------------------------------------------
  /**
   * Supuesto de presentación (niif-preproceso-21): la clasificación corriente /
   * no corriente es por grupo PUC, sin información de vencimientos. El bloque
   * vinculante y las notas deben revelarlo mientras no haya overrides.
   */
  clasificacionSupuesta?: string;
  /**
   * Cartera comercial neta = 1305 + 1310 − |1399| (niif-preproceso-25). `null`
   * si el balance no trae cuentas de clientes 1305/1310.
   */
  clientesNetos?: number | null;
  /**
   * Meses de resultados que cubre el periodo (ratios-kpis-18): 12 para una
   * etiqueta AAAA (cierre anual, convención del parser), MM para AAAA-MM
   * (P&G acumulado desde el 1 de enero), 3·n para AAAA-Qn y la duración de un
   * rango de meses completos. `null` si la etiqueta no la determina.
   */
  mesesPeriodo?: number | null;
  /** Días del periodo sobre base 365 (= 365 × meses / 12); `null` si no hay meses. */
  diasPeriodo?: number | null;
  /** Base (365 días), periodo y anualización aplicados a los KPIs de flujo / saldo. */
  kpiBaseNota?: string;
  /** Capital de trabajo = activoCorriente − pasivoCorriente. */
  capitalTrabajo?: number;
  /**
   * EBITDA con la definición ÚNICA de `src/lib/pillars/ebitda.ts`
   * (`computeEbitda`: EBIT + D&A 5160/5165/5260/5265/7360/7365). `null` sin
   * desglose del grupo 41 (motivo en `kpiNdMotivos.ebitda`).
   */
  ebitda?: number | null;
  /** Razón corriente = activoCorriente / pasivoCorriente. */
  razonCorriente?: number | null;
  /** Prueba ácida = (activoCorriente − inventarios14) / pasivoCorriente. */
  pruebaAcida?: number | null;
  /** Endeudamiento total = pasivo / activo × 100 (porcentaje). */
  endeudamientoTotal?: number | null;
  /** Apalancamiento financiero = pasivo / patrimonio. */
  apalancamientoFinanciero?: number | null;
  /** Cobertura de intereses = ebit / |gastoFinanciero5305|. null si sin gasto financiero. */
  coberturaIntereses?: number | null;
  /** Margen bruto = utilidadBruta / ingresosOperacionalesNetos × 100 (porcentaje). */
  margenBruto?: number | null;
  /** Margen operativo = ebit / ingresosOperacionalesNetos × 100 (porcentaje). */
  margenOperativo?: number | null;
  /** Margen neto = utilidadNeta / ingresosNetos × 100 (porcentaje). */
  margenNeto?: number | null;
  /** ROE = utilidadNeta anualizada / patrimonioPromedio × 100 (porcentaje). */
  roe?: number | null;
  /** ROA = utilidadNeta anualizada / activoPromedio × 100 (porcentaje). */
  roa?: number | null;
  /** Rotación de activos = ingresosOperacionalesNetos anualizados / activoPromedio. */
  rotacionActivos?: number | null;
  /**
   * Días de cartera = clientesNetos / ingresosOperacionalesNetos anualizados × 365.
   * null (con motivo) sin clientes 1305/1310, sin ingresos operacionales o sin
   * duración del periodo.
   */
  diasCartera?: number | null;
  /** Días de inventario = inventarios14 / (costos 6 + 7 anualizados) × 365. null si costos anómalos. */
  diasInventario?: number | null;
  /** Días de proveedores = proveedores22 / (costos 6 + 7 anualizados) × 365. null si costos anómalos. */
  diasProveedores?: number | null;
  /** Ciclo de conversión del efectivo = días cartera + días inventario − días proveedores. */
  cicloConversionEfectivo?: number | null;
  /**
   * Motivo de los KPIs publicados como N/D por base no interpretable (p. ej.
   * ROE con patrimonio promedio ≤ 0). Los renderizadores y el bloque
   * vinculante deben mostrar el motivo en lugar de recalcular el KPI.
   */
  kpiNdMotivos?: KpiNdMotivos;
}

// ---------------------------------------------------------------------------
// Hallazgos a nivel de snapshot (banderas determinísticas, no métricas)
// ---------------------------------------------------------------------------
// Los curator rules y el parser pueden marcar banderas en `snapshot.findings`
// que el gate `auditReportEmittable` lee para decidir si bloquea la emisión.
// Todos opcionales: ausencia equivale a `false`.
// ---------------------------------------------------------------------------
export interface SnapshotFindings {
  /** R12 — saldo neto P&L ≠ 0 y grupo 36/37 ≈ 0 (utilidad sin trasladar). */
  librosNoCerrados?: boolean;
  /** R10 — gasto impuesto en clase 54 sin causación correspondiente en 24. */
  missingTaxCausation?: boolean;
  /** R10 — saldo acreedor en cuenta 18 indica uso como gasto. */
  cuenta18UsadaComoGasto?: boolean;
  /** R14 — PPE bruto material sin depreciación correspondiente. */
  ppeWithoutDepreciation?: boolean;
  /** R15 — comercializadora con clase 7 sin descargue 6135. */
  costeoIncompleto?: boolean;
  /**
   * R16 — anticipo de renta material (PUC 135515) que debe netearse contra
   * el pasivo PUC 2404 para mostrar el "Neto a Pagar" al fisco.
   */
  anticipoRentaMaterial?: boolean;
}

// ---------------------------------------------------------------------------
// Metadata de la empresa extraída del archivo (vs. la del intake)
// ---------------------------------------------------------------------------
// `razonSocialFromFile` y `nitFromFile` provienen de los encabezados del
// balance de prueba (filas previas a las cuentas en el Excel). Si el parser
// no los pudo extraer, ambos son `null` y el gate los reporta como blocker
// V5. `niifGroup` y `tipoSocietario` provienen del intake del usuario.
// ---------------------------------------------------------------------------
export interface ExtractedCompanyMetadata {
  /** Razón social literal del Excel (NUNCA placeholder/fallback). */
  razonSocialFromFile: string | null;
  /** NIT literal del Excel con DV (formato canónico "NNN.NNN.NNN-D"). */
  nitFromFile: string | null;
  /** NIT sin DV (sólo dígitos del cuerpo, para validación contra DV DIAN). */
  nitBodyDigits: string | null;
  /** Dígito de verificación leído del archivo (string del char individual). */
  nitCheckDigit: string | null;
  /** Texto crudo del header donde se detectó la metadata (debug). */
  sourceLines: string[];
}

/**
 * Resultado de la validacion aritmetica del balance de prueba.
 */
export interface ValidationResult {
  /** Si true, el pipeline no debe generar un reporte. */
  blocking: boolean;
  /** Descripciones legibles de por que no cuadra la ecuacion patrimonial. */
  reasons: string[];
  /** Cuentas o grupos que el usuario deberia revisar en el archivo original. */
  suggestedAccounts: string[];
  /** Ajustes aplicados al vuelo (informativos, no bloquean). */
  adjustments: string[];
  /**
   * Subconjunto de `reasons` sobre la INTEGRIDAD de los datos leídos (importes
   * ilegibles, columnas de saldo ambiguas, filas con saldos desplazados,
   * códigos que no son cuentas PUC). A diferencia de un descuadre, ningún
   * ajuste del curador los resuelve: el Bridge de Cuadratura no debe
   * degradarlos a informativos. Opcional por retrocompatibilidad.
   */
  integrityReasons?: string[];
  /**
   * Subconjunto de `reasons` escrito por reglas del curator DESPUÉS de construir
   * el snapshot (R5, R8, R12). Son bloqueos que el cierre virtual no resuelve:
   * el "Bridge de Cuadratura" del orquestador NO debe degradarlos a
   * informativos. Ver `curator-rules/curator-blockers.ts`.
   */
  curatorBlockingReasons?: string[];
}

/**
 * Desglose del patrimonio (Clase 3), PUC Decreto 2650/1993. Se calcula sobre
 * las MISMAS hojas que el total de la clase 3, de modo que la suma de los
 * componentes (sin `capitalAutorizado`, que es informativo) es el patrimonio.
 */
export interface EquityBreakdown {
  /**
   * 310505 Capital autorizado. DATO INFORMATIVO: no suma al patrimonio, porque
   * la cuenta 3105 ya es el neto de autorizado − por suscribir − suscrito por
   * cobrar (310505 − 310510 − 310515).
   */
  capitalAutorizado?: number;
  /**
   * Grupo 31 — Capital social: 3105 Capital suscrito y pagado (neto),
   * 3115 Aportes sociales, 3120 Capital asignado y demás cuentas del grupo.
   */
  capitalSuscritoPagado?: number;
  /** Grupo 32 — Superávit de capital. */
  superavitCapital?: number;
  /** 3305 — Reserva legal. */
  reservaLegal?: number;
  /** Grupo 33 sin 3305 — reservas estatutarias y ocasionales. */
  otrasReservas?: number;
  /** Grupo 34 — Revalorización del patrimonio. */
  revalorizacionPatrimonio?: number;
  /** Grupo 35 — Dividendos o participaciones decretados en acciones/cuotas. */
  dividendosDecretadosEnAcciones?: number;
  /** Grupo 36 — Resultado del ejercicio (3605 utilidad + 3610 pérdida). */
  utilidadEjercicio?: number;
  /** Grupo 37 — Resultados de ejercicios anteriores (3705, 3710, …). */
  utilidadesAcumuladas?: number;
  /** Grupo 38 — Superávit por valorizaciones. */
  superavitValorizaciones?: number;
  /** Cuentas de la clase 3 fuera de los grupos 31-38 (catálogos propios). */
  otrasCuentasPatrimonio?: number;
  /** Gap absorbido por R5; 0 o ausente si Balance y ECP cuadraban. */
  convergenceAdjustment?: number;
}

/**
 * Snapshot de un periodo individual. Cada `PeriodSnapshot` corre su propia
 * validacion patrimonial, control totals y equity breakdown. La estructura
 * replica el contrato historico de `PreprocessedBalance` pero confinado al
 * periodo nombrado por `period`.
 */
export interface PeriodSnapshot {
  period: string;
  // -----------------------------------------------------------------------
  // Wave 2.F4 — Parte 2.1 VERIFICACIÓN 4 + Parte 3 ramificación R8.
  // Tipo de período fiscal:
  //   - 'cerrado'      → año fiscal completo Enero-Diciembre (Ene-Dic).
  //   - 'parcial'      → corte intermedio del año fiscal (e.g. Ene-Jun).
  //   - 'indeterminado' → no se pudo inferir desde el header (solo año).
  // R8 (Cierre Virtual) bifurca la nota OBLIGATORIA (cerrado) vs EXPLICATIVA
  // (parcial) según este campo. Opcional por retrocompatibilidad: tests/
  // literales legacy no lo necesitan. `buildSnapshotForPeriod` SIEMPRE lo
  // popula con 'indeterminado' como fallback seguro.
  // -----------------------------------------------------------------------
  periodoTipo?: 'cerrado' | 'parcial' | 'indeterminado';
  /**
   * Fecha de corte declarada en el archivo para este periodo (título "a junio
   * 30 de 2025", "De Enero 2025 a Diciembre 2025"). niif-preproceso-29 / P4-c:
   * decide `periodoTipo` cuando la etiqueta sólo trae el año y la nota de base
   * de los KPIs distingue el cierre anual declarado del supuesto. Ausente = el
   * archivo no declara la fecha de corte.
   */
  corteDeclarado?: { tipo: 'cerrado' | 'parcial'; meses: number; texto: string };
  /**
   * ICU-03: fecha que trae el archivo y que no se interpretó como corte de
   * este periodo (a mitad de mes, rango que no empieza en enero, etiqueta
   * impuesta por el llamador). Sólo con `corteDeclarado` ausente.
   */
  fechaSinInterpretar?: string;
  /**
   * Excepciones de vencimiento declaradas por el usuario que movieron saldo
   * entre corriente y no corriente en este periodo (P4-b). Ausente sin
   * excepciones: la clasificación es la del grupo PUC.
   */
  vencimientosAplicados?: VencimientoAplicado[];
  /**
   * ingesta-09 (parcial): el snapshot proviene de una columna de SALDO INICIAL
   * / ANTERIOR del archivo (`BalanceColumnKind` 'opening'), no de un cierre del
   * periodo anterior. Su ESF es el de apertura, pero su P&G NO es un P&G
   * comparativo: los KPIs de flujo salen N/D con motivo y los consumidores
   * deben presentar el P&G comparativo como N/D (no $0). Ausente = cierre.
   */
  saldosDeApertura?: boolean;
  classes: PUCClass[];
  controlTotals: ControlTotals;
  equityBreakdown: EquityBreakdown;
  summary: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    totalRevenue: number;
    totalExpenses: number;
    totalCosts: number;
    totalProduction: number;
    netIncome: number;
    equationBalance: number;
    equationBalanced: boolean;
  };
  validation: ValidationResult;
  discrepancies: Discrepancy[];
  missingExpectedAccounts: string[];
  /** Resultado del Curator NIIF middleware (R1–R4). Inyectado por
   *  `preprocessTrialBalance` después de construir el snapshot. */
  curator?: CuratorResult;
  /** Estado de Flujos de Efectivo método indirecto (NIC 7), generado por
   *  R2 cuando hay periodo comparativo. */
  cashFlowIndirecto?: CashFlowStatement;
  /** Reclasificaciones APLICADAS por R1 (con mutación efectiva). */
  reclassifications?: Reclassification[];
  /** Gap absorbido por R5 (mismo valor que equityBreakdown.convergenceAdjustment). */
  equityAnchorAdjustment?: number;
  /** Gap absorbido por R6. */
  cashFlowClosureAdjustment?: number;
  /** Callout R7 si margen > 85% Y inventario > 50% ingresos. */
  presumedCostWarning?: PresumedCostWarning;
  /** Ajuste de Cierre Virtual aplicado por R8 (siempre presente post-curator). */
  virtualCloseAdjustment?: VirtualCloseAdjustment;
  /** R9 audit — contrato cents + raw preservado al centavo. */
  precisionCentsAudit?: PrecisionCentsAudit;
  /** R10 audit — clasificación cuenta 18 + causación impuesto. */
  class18ClassificationAudit?: Class18ClassificationAudit;
  /** R12 audit — detector de cierre de libros. */
  closingDetectorAudit?: ClosingDetectorAudit;
  /** R14 audit — PPE sin depreciación. */
  ppeDepreciationAudit?: PpeDepreciationAudit;
  /** R15 audit — costeo incompleto en clase 7. */
  costClassificationAudit?: CostClassificationAudit;
  /**
   * Banderas determinísticas a nivel de snapshot (R10/R12/R14/R15 → gate).
   * Inicializado como `{}` por `buildSnapshotForPeriod`; las reglas escriben
   * banderas booleanas que `auditReportEmittable` lee. Optional para
   * retrocompatibilidad con tests legacy que construyen `PeriodSnapshot` a mano.
   */
  findings?: SnapshotFindings;
}

// ---------------------------------------------------------------------------
// Pulido NIIF PYME Grupo 2 — actividad inferida desde el balance.
// ---------------------------------------------------------------------------
// `sectorCIIU` es la **letra** del CIIU rev. 4 A.C. (DANE), NUNCA un código
// numérico. La inferencia es informativa, no autoritativa: el intake del
// usuario sigue siendo la fuente formal de actividad económica.
//
// Detector AMPLIADO (sector G — Comercio):
//   Dispara si CUALQUIERA se cumple:
//     (a) 1435 (Mercancías no fabricadas) material (>5% activo corriente) Y
//         clase 6 ausente o <1% de los ingresos.
//     (b) Clase 14 (Inventarios) > 30% del activo total.
//
// Why: en NIIF para PYMES Sec. 13 + Decreto 2650/93, una empresa con
// concentración fuerte en inventario de mercancías es comercializadora aunque
// no haya descargado el CMV en clase 6. V14 usa esta inferencia + margen bruto
// para detectar costeo incompleto enmascarado como rentabilidad alta.
// ---------------------------------------------------------------------------
export interface ActividadInferida {
  /** Letra CIIU rev. 4 (G, F, C, etc.). NUNCA código numérico. */
  sectorCIIU: string;
  /** Descripción legible del sector. */
  descripcion: string;
  /** Lista de criterios que dispararon la inferencia (auditable). */
  evidencia: string[];
}

/**
 * Reclasificación NIC 1 párr. 32 (no compensación) — contrato externo.
 *
 * Diferente del shape interno `Reclassification` (que vive en R1 con códigos
 * virtuales `2810ZZ-*` / `2895VC-*`). Aquí mapeamos al contrato PUC-aware
 * que los agentes del pipeline financiero y los renderers consumen:
 *
 *   - `cuenta_destino_pasivo='2895'` para clase 12 (Inversiones, NIC 28).
 *   - `cuenta_destino_pasivo='2105'` para clase 11 (sobregiros bancarios).
 *   - `cuenta_destino_pasivo='2805'` para clases 13/14 (anticipos recibidos).
 *   - `cuenta_destino_pasivo='2895'` para el resto del activo (diversos).
 *
 * Why: el LLM en producción debe citar códigos PUC reales, no códigos
 * virtuales internos. Este mapeo aísla el contrato externo del detalle de
 * implementación de R1.
 */
export interface ReclasificacionNoCompensacion {
  cuenta_origen: string;
  /** Magnitud absoluta del saldo invertido (en centavos, BigInt). */
  saldo_invertido_centavos: bigint;
  /** Cuenta PUC de destino: '2105' | '2805' | '2895'. */
  cuenta_destino_pasivo: string;
  /** Norma + justificación legible. */
  motivo_norma: string;
}

/**
 * Resultado del preprocesamiento multiperiodo. `periods` esta ordenado
 * ascendentemente (mas antiguo -> mas reciente). `primary` apunta siempre al
 * periodo mas reciente; `comparative` al inmediatamente anterior si existe.
 */
export interface PreprocessedBalance {
  /** No vacio. Ordenado ascendente. */
  periods: PeriodSnapshot[];
  /** = periods[periods.length - 1] */
  primary: PeriodSnapshot;
  /** = periods[periods.length - 2] o null */
  comparative: PeriodSnapshot | null;
  /** Cross-period: filas crudas con todos los saldos. */
  rawRows: RawAccountRow[];
  auxiliaryCount: number;
  /** CSV consolidado etiquetado por bloque `[period=YYYY]` */
  cleanData: string;
  /** Markdown human-readable que documenta TODOS los periodos. */
  validationReport: string;
  // -------------------------------------------------------------------------
  // Pulido NIIF PYME Grupo 2 — banderas y contratos a nivel cross-period.
  // -------------------------------------------------------------------------
  /**
   * `true` si NO existe periodo comparativo material (single-period import o
   * comparative con auxiliaryTotal ≈ 0 en TODAS las clases). `false` si hay
   * comparativo con saldos de cualquier clase.
   *
   * Why: NIIF para PYMES §3.14 + §10.21 exigen presentar comparativos. Cuando
   * son impracticables, la entidad debe declararlo explícitamente — NO
   * reconstruir cuentas individuales desde Utilidades Retenidas (§10.19 lo
   * prohíbe). V15 valida que el reporte declare la impracticabilidad cuando
   * este flag es `true`.
   */
  comparativos_impracticables: boolean;
  /**
   * Sector CIIU inferido del balance + criterios que lo soportan. Opcional:
   * sólo se popula cuando el detector tiene evidencia suficiente.
   */
  actividadInferida?: ActividadInferida;
  /**
   * Lista PUC-aware de reclasificaciones por no-compensación (NIC 1 párr. 32)
   * aplicadas por R1. Vacío `[]` si no hubo. Why: contrato externo estable
   * que los agentes citan; aísla códigos PUC reales del detalle interno R1.
   */
  reclasificacionesNoCompensacion: ReclasificacionNoCompensacion[];
}

/** Alias de compatibilidad hacia atras. */
export type PreprocessedBalanceData = PreprocessedBalance;

/** Saldo que una excepción de vencimiento movió entre corriente y no corriente. */
export interface VencimientoAplicado {
  /** Cuenta hoja del snapshot (o virtual de R1, clasificada por su origen). */
  codigo: string;
  seccion: 'activo' | 'pasivo';
  /** Clasificación que declaró el usuario. */
  vencimiento: Vencimiento;
  /** Saldo trasladado (pesos, convención natural). */
  saldo: number;
}

// ---------------------------------------------------------------------------
// PUC class names
// ---------------------------------------------------------------------------

const PUC_CLASS_NAMES: Record<number, string> = {
  1: 'Activo',
  2: 'Pasivo',
  3: 'Patrimonio',
  4: 'Ingresos',
  5: 'Gastos',
  6: 'Costos de Ventas',
  7: 'Costos de Produccion',
};

// ---------------------------------------------------------------------------
// PUC — clasificacion corriente / no corriente (Decreto 2650/1993 ajustado)
// ---------------------------------------------------------------------------
const ACTIVO_CORRIENTE_GROUPS = new Set(['11', '12', '13', '14']);
const ACTIVO_NO_CORRIENTE_GROUPS = new Set(['15', '16', '17', '18', '19']);
const PASIVO_CORRIENTE_GROUPS = new Set(['21', '22', '23', '24', '25', '26']);
const PASIVO_NO_CORRIENTE_GROUPS = new Set(['27', '28', '29']);

/**
 * Supuesto de clasificación corriente / no corriente (niif-preproceso-21). La
 * clasificación sigue siendo por grupo PUC (las excepciones a 4 dígitos y los
 * overrides de vencimiento requieren decisión de negocio); aquí sólo se
 * DECLARA el supuesto para que el informe lo revele.
 */
export const CLASIFICACION_CORRIENTE_SUPUESTA =
  'Clasificación corriente / no corriente por grupo PUC (activo corriente 11-14, no corriente ' +
  '15-19; pasivo corriente 21-26, no corriente 27-29), sin información de vencimientos del ' +
  'balance de prueba: es un supuesto no verificado (NIC 1 párr. 66-76 / NIIF para las PYMES ' +
  '4.5-4.8). Partidas con vencimiento distinto al del grupo (p. ej. obligaciones de largo ' +
  'plazo en el grupo 21 o inversiones de corto plazo en el 12) pueden quedar mal clasificadas.';

// ---------------------------------------------------------------------------
// Subcuentas importantes
// ---------------------------------------------------------------------------
const IMPORTANT_SUBCUENTAS: Record<string, { name: string; parentGroup: string }> = {
  '1105': { name: 'Caja', parentGroup: '11' },
  '1110': { name: 'Bancos', parentGroup: '11' },
  '1120': { name: 'Cuentas de ahorro', parentGroup: '11' },
  '1435': { name: 'Mercancias no fabricadas por la empresa', parentGroup: '14' },
  '2365': { name: 'Retencion en la fuente', parentGroup: '23' },
  '2408': { name: 'IVA por pagar', parentGroup: '24' },
  // PUC D. 2650/1993: 3105 Capital suscrito y pagado (310505 autorizado −
  // 310510 por suscribir − 310515 suscrito por cobrar); 3115 Aportes sociales.
  '3105': { name: 'Capital suscrito y pagado', parentGroup: '31' },
  '3115': { name: 'Aportes sociales', parentGroup: '31' },
  '3305': { name: 'Reserva legal', parentGroup: '33' },
  '3605': { name: 'Utilidad del ejercicio', parentGroup: '36' },
};

// ---------------------------------------------------------------------------
// Period detection helpers
// ---------------------------------------------------------------------------

/**
 * Etiqueta default para cuando no se detecta un año en headers ni en
 * `parseTrialBalanceCSV` options. Los consumers deberian preferir pasar
 * `fiscalPeriod` por `options` desde la upload route para evitarla.
 */
export const DEFAULT_PERIOD = 'current';

/** Regex para detectar un año tipo "2024" en cualquier string. */
const YEAR_REGEX = /\b(20\d{2})\b/;

/**
 * Mes (abreviado o completo) + año de dos dígitos con separador explícito:
 * "Dic-24", "dic/25", "Dic'24", "Diciembre-24". Sin separador ("Nov 30") no se
 * interpreta: podría ser un día del mes.
 */
const MONTH_SHORT_YEAR_REGEX =
  /\b(?:ene(?:ro)?|feb(?:rero|ruary)?|mar(?:zo|ch)?|abr(?:il)?|apr(?:il)?|may(?:o)?|jun(?:io|e)?|jul(?:io|y)?|ago(?:sto)?|aug(?:ust)?|sep(?:tiembre|tember)?|set(?:iembre)?|oct(?:ubre|ober)?|nov(?:iembre|ember)?|dic(?:iembre)?|dec(?:ember)?)\s?[-/.'’]\s?(\d{2})\b/i;

/** Fecha corta dd/mm/aa (o con guion / punto). */
const SHORT_DATE_YEAR_REGEX = /\b\d{1,2}[-/.]\d{1,2}[-/.](\d{2})\b/;

/**
 * Detecta el año embebido en un string (header de columna o nombre de hoja
 * Excel). Devuelve el año como string ("2024") o `null` si no hay año.
 * Acepta años de dos dígitos sólo junto a un mes o dentro de una fecha
 * ("Saldo Dic-24" → "2024", "31/12/24" → "2024"), ingesta-06.
 */
export function detectYearFromString(value: string | undefined | null): string | null {
  if (!value) return null;
  const s = String(value);
  const m = s.match(YEAR_REGEX);
  if (m) return m[1];
  const short = s.match(MONTH_SHORT_YEAR_REGEX) ?? s.match(SHORT_DATE_YEAR_REGEX);
  return short ? `20${short[1]}` : null;
}

// ---------------------------------------------------------------------------
// Wave 2.F4 — inferencia del tipo de período (Parte 2.1 VERIFICACIÓN 4) y
// meses cubiertos por el periodo: viven en `./periodo-meses` (módulo puro,
// sin dependencias) para que pilares, Sentinel, PDF y Âncora usen la MISMA
// función que anualiza los KPIs del preprocesador (normativa-metricas NM-01).
// ---------------------------------------------------------------------------
export { inferPeriodoTipo, mesesDelPeriodo };

// ---------------------------------------------------------------------------
// Normalización de encabezados (ingesta-07, ingesta-08)
// ---------------------------------------------------------------------------
// Los encabezados se comparan sin tildes, en minúsculas y con espacios/guiones
// bajos colapsados, como hace `normalizeHeader` del parser bancario. Un CSV
// Windows-1252 decodificado como UTF-8 llega con U+FFFD en lugar de la vocal
// acentuada ("C�digo"): se prueban las variantes con cada vocal (o ñ)
// en su lugar, así "C�digo" casa con "codigo" sin adivinar el archivo.
// ---------------------------------------------------------------------------

function normalizeHeaderText(header: string | undefined | null): string {
  return String(header ?? '')
    .replace(/^﻿/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

const REPLACEMENT_CHAR = '�';
const REPLACEMENT_GUESSES = ['o', 'e', 'i', 'a', 'u', 'n'];
const MAX_REPLACEMENT_CHARS = 3;

/** Variantes de un encabezado normalizado con cada U+FFFD sustituido. */
function headerVariants(normalized: string): string[] {
  const count = normalized.split(REPLACEMENT_CHAR).length - 1;
  if (count === 0) return [normalized];
  if (count > MAX_REPLACEMENT_CHARS) return [normalized.split(REPLACEMENT_CHAR).join('')];
  let out = [''];
  for (const ch of normalized) {
    out =
      ch === REPLACEMENT_CHAR
        ? out.flatMap((prefix) => REPLACEMENT_GUESSES.map((g) => prefix + g))
        : out.map((prefix) => prefix + ch);
  }
  return out;
}

const DEBIT_WORD = /\b(debitos?|debits?|debe|deb|db|deudor(?:es)?)\b/;
const CREDIT_WORD = /\b(creditos?|credits?|haber|cred|cr|acreedor(?:es)?)\b/;
const SALDO_WORD = /\bsaldos?\b/;
const BALANCE_WORD = /\b(saldos?|balance|neto)\b/;
/** "Movimiento neto" / "Variación" describen el periodo, no un saldo. */
const MOVEMENT_WORD = /\b(movimientos?|variacion(?:es)?)\b/;
/** Comparativo explícito del periodo anterior. */
const PRIOR_WORD = /\b(comparativo|previous|prior)\b/;
/** Saldo de apertura del periodo reportado. */
const OPENING_WORD = /\b(inicial(?:es)?|anterior(?:es)?|apertura|previo|opening|beginning|initial)\b/;
/** Saldo de cierre del periodo reportado. */
const CLOSING_WORD = /\b(final(?:es)?|actual(?:es)?|nuevo|cierre|closing|ending|current)\b/;

/** Tipo de una columna de saldo según su encabezado. */
export type BalanceColumnKind = 'closing' | 'opening' | 'prior' | 'neutral';

/**
 * Determina si un header pertenece a una columna de saldo (final, neto o
 * balance). Las columnas de movimiento (débito/crédito, "movimiento neto")
 * quedan fuera; el par "saldo débito / saldo crédito" se detecta aparte.
 */
function isBalanceHeader(header: string): boolean {
  return headerVariants(normalizeHeaderText(header)).some((h) => {
    if (DEBIT_WORD.test(h) || CREDIT_WORD.test(h)) return false;
    if (MOVEMENT_WORD.test(h) && !SALDO_WORD.test(h)) return false;
    return BALANCE_WORD.test(h);
  });
}

/**
 * Clasifica un encabezado de saldo: apertura ("saldo inicial", "saldo
 * anterior"), comparativo explícito, cierre ("saldo final", "nuevo saldo",
 * "saldo actual") o neutro ("saldo"). Apertura/comparativo se evalúan
 * primero: "saldo final año anterior" es el cierre del periodo previo.
 * (Sustituye al antiguo `isPreviousBalanceHeader`, que no reconocía "saldo
 * inicial" y dejaba la apertura como cifra del periodo — ingesta-06.)
 */
function classifyBalanceHeader(header: string): BalanceColumnKind {
  let kind: BalanceColumnKind = 'neutral';
  for (const h of headerVariants(normalizeHeaderText(header))) {
    if (PRIOR_WORD.test(h)) return 'prior';
    if (OPENING_WORD.test(h)) return 'opening';
    if (CLOSING_WORD.test(h)) kind = 'closing';
  }
  return kind;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Opciones del parser CSV. */
export interface ParseTrialBalanceOptions {
  /**
   * Periodo fiscal "actual" cuando los headers no traen año. Si los headers
   * tienen "saldo anterior" sin año explicito, el periodo anterior se infiere
   * como `Number(currentYear) - 1`.
   */
  currentYear?: string;
  /**
   * Si el caller ya sabe que toda la entrada (por ejemplo una hoja Excel
   * etiquetada con un año) corresponde a un solo periodo, lo pasa aqui y se
   * fuerza ese periodo en TODOS los rows, ignorando headers de año.
   */
  forcePeriod?: string;
  /**
   * Normaliza la convencion de signos del archivo a la convencion NATURAL que
   * asume el resto del sistema (activo/pasivo/patrimonio/ingresos como
   * magnitudes de su naturaleza). Default `true`.
   *
   * Los ERP que exportan en convencion ALGEBRAICA (debitos +, creditos -)
   * entregan las clases 2, 3 y 4 en negativo; sin normalizar, el preprocesador
   * lee un Pasivo negativo y R8 tapa la diferencia en la cuenta virtual 3710VC,
   * de modo que la ecuacion patrimonial cuadra contra si misma y ninguna
   * cuadratura del pipeline detecta el error. Ver `sign-convention.ts`.
   *
   * Se pone en `false` solo para medir el comportamiento previo (tests de
   * regresion) o cuando el caller ya normalizo por su cuenta.
   */
  normalizeSignConvention?: boolean;
  /**
   * Unidad de los importes CONFIRMADA por el usuario (P4-a). Sin ella, un
   * archivo que declara "en miles / millones" bloquea con motivo
   * (recalculo-final-03). Con ella cada importe se reexpresa a pesos desde su
   * texto decimal en centavos exactos (BigInt) y se deja una nota de ingesta.
   * `'pesos'` confirma que los importes ya están en pesos pese a la leyenda.
   */
  unidadConfirmada?: UnidadMonetaria;
}

interface BalanceColumn {
  /** Índice de la columna (o de la columna débito en un par saldo débito/crédito). */
  index: number;
  /** Índice de la columna crédito cuando el saldo viene partido por naturaleza. */
  creditIndex?: number;
  period: string;
  kind: BalanceColumnKind;
  /** Encabezado original, para los mensajes de validación. */
  header: string;
}

interface BalanceColumnDetection {
  columns: BalanceColumn[];
  /** Índices que forman pares "saldo débito / saldo crédito" (no son movimientos). */
  pairIndices: Set<number>;
  /** Problemas del archivo completo (columnas que no se pueden asignar sin adivinar). */
  issues: string[];
}

/** Resultado detallado del parser, para callers que necesitan los metadatos. */
export interface ParsedTrialBalance {
  rows: RawAccountRow[];
  /** Columnas de saldo usadas, en orden del archivo, con su periodo y tipo. */
  balanceColumns: Array<{ header: string; period: string; kind: BalanceColumnKind }>;
  /** Índice (sobre las líneas no vacías) de la fila de encabezados; -1 sin datos. */
  headerLineIndex: number;
  /** Convención de signos detectada; `null` si `normalizeSignConvention === false`. */
  signConvention: SignConventionDetection | null;
  /**
   * Unidad distinta de pesos que declara el archivo (encabezado, título o nota
   * al pie), con el texto donde se leyó; `null` si no declara ninguna.
   */
  unidadDeclarada: UnidadDeclaradaDetectada | null;
  /** Unidad confirmada que se aplicó (`options.unidadConfirmada`); `null` sin confirmación. */
  unidadAplicada: UnidadMonetaria | null;
  /**
   * Fecha de corte declarada en el preámbulo del archivo (título), si hay una
   * interpretable (P4-c / niif-preproceso-29).
   */
  corteDeclarado: CorteDeclarado | null;
}

/** Unidad distinta de pesos declarada por el archivo. */
export interface UnidadDeclaradaDetectada {
  unidad: 'miles' | 'millones';
  /** Texto (encabezado o línea) donde se declaró, recortado a 120 caracteres. */
  texto: string;
}

/** Fecha de corte declarada en el título del balance ("a junio 30 de 2025"). */
export interface CorteDeclarado {
  year: string;
  /** Mes final del corte, 1..12. */
  month: number;
  /** Texto de la línea donde se declaró (recortado). */
  texto: string;
}

/**
 * Parse raw CSV text into account rows.
 * Detecta multiples columnas de saldo y las distribuye en `balancesByPeriod`.
 */
export function parseTrialBalanceCSV(
  csvText: string,
  options: ParseTrialBalanceOptions = {},
): RawAccountRow[] {
  return parseTrialBalanceCSVWithMeta(csvText, options).rows;
}

/**
 * Filas de preámbulo (razón social, NIT, rango de fechas) que se revisan
 * buscando la cabecera. Los ERP colombianos anteponen 3 a 10 (ingesta-08).
 */
const MAX_HEADER_SCAN_LINES = 30;

/** Encabezados que describen la cuenta, nunca su código. */
const NAME_LIKE_HEADER = /\b(nombre|descripcion|name|description|detalle|concepto)\b/;

interface HeaderLayout {
  lineIndex: number;
  separator: string;
  rawHeaders: string[];
  codeIdx: number;
  nameIdx: number;
  levelIdx: number;
  transIdx: number;
  debitIdx: number;
  creditIdx: number;
  balance: BalanceColumnDetection;
}

/** Separador de la línea, ignorando lo que va entre comillas ("nombre; x"). */
function detectSeparator(line: string): string {
  const unquoted = line.replace(/"[^"]*"/g, '');
  return unquoted.includes('\t') ? '\t' : unquoted.includes(';') ? ';' : ',';
}

function detectHeaderLayout(
  line: string,
  lineIndex: number,
  options: ParseTrialBalanceOptions,
): HeaderLayout | null {
  const separator = detectSeparator(line);
  const rawHeaders = parseLine(line, separator).map((h) => h.trim());
  if (rawHeaders.length < 2) return null;
  const headers = rawHeaders.map((h) => headerVariants(normalizeHeaderText(h)));

  const balance = detectBalanceColumns(rawHeaders, options);
  const balanceIdx = new Set<number>(balance.pairIndices);
  rawHeaders.forEach((h, i) => {
    if (isBalanceHeader(h)) balanceIdx.add(i);
  });

  const codeIdx = findColumnIndex(
    headers,
    ['codigo', 'code', 'cuenta', 'account', 'cta', 'cod'],
    (i, h) => balanceIdx.has(i) || NAME_LIKE_HEADER.test(h),
  );
  const nameIdx = findColumnIndex(
    headers,
    ['nombre', 'name', 'descripcion', 'description', 'concepto', 'detalle'],
    (i) => i === codeIdx || balanceIdx.has(i),
  );
  // "Naturaleza" (D/C) no es el nivel de la cuenta: tomarla como nivel dejaba
  // todas las filas sin nivel reconocible (niif-preproceso-10).
  const levelIdx = findColumnIndex(
    headers,
    ['nivel', 'level', 'tipo', 'type'],
    (i) => i === codeIdx || i === nameIdx || balanceIdx.has(i),
  );
  const transIdx = findColumnIndex(
    headers,
    ['transaccional', 'transactional', 'auxiliar', 'movimiento'],
    (i, h) =>
      i === codeIdx ||
      i === nameIdx ||
      balanceIdx.has(i) ||
      DEBIT_WORD.test(h) ||
      CREDIT_WORD.test(h) ||
      BALANCE_WORD.test(h),
  );
  const debitIdx = findColumnIndex(
    headers,
    ['debito', 'debitos', 'debit', 'debe', 'db'],
    (i) => i === codeIdx || i === nameIdx || balanceIdx.has(i),
  );
  const creditIdx = findColumnIndex(
    headers,
    ['credito', 'creditos', 'credit', 'haber', 'cr'],
    (i) => i === codeIdx || i === nameIdx || balanceIdx.has(i),
  );

  return {
    lineIndex,
    separator,
    rawHeaders,
    codeIdx,
    nameIdx,
    levelIdx,
    transIdx,
    debitIdx,
    creditIdx,
    balance,
  };
}

function isUsableHeader(layout: HeaderLayout): boolean {
  return (
    layout.codeIdx !== -1 &&
    (layout.balance.columns.length > 0 || layout.debitIdx !== -1 || layout.creditIdx !== -1)
  );
}

/**
 * Línea de encabezado de columnas que usará `parseTrialBalanceCSVWithMeta`
 * (mismo criterio: primera de las 30 primeras con columna de código y de
 * saldo o débito/crédito), o `null` si ninguna califica. `raw-data` la usa
 * para decidir si el encabezado trae el periodo: un título "Balance a junio
 * 30 de 2025" antes del encabezado no es una columna de saldo (P4-c).
 */
export function findTrialBalanceHeaderLine(csvText: string): string | null {
  const lines = csvText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const scanLimit = Math.min(lines.length - 1, MAX_HEADER_SCAN_LINES);
  for (let i = 0; i < scanLimit; i++) {
    const candidate = detectHeaderLayout(lines[i], i, {});
    if (candidate && isUsableHeader(candidate)) return lines[i];
  }
  return null;
}

const CANONICAL_LEVELS = new Set(['Clase', 'Grupo', 'Cuenta', 'Subcuenta', 'Auxiliar']);

/**
 * Naturaleza PUC (Decreto 2650/1993) por clase y grupo (auditoría ingesta-29):
 *   - Clases 1, 5, 6, 7: deudoras.  Clases 2, 3, 4: acreedoras.
 *   - Clase 8 (orden deudoras): 81-83 deudoras; 84-86 "por contra" acreedoras.
 *   - Clase 9 (orden acreedoras): 91-93 acreedoras; 94-96 "por contra" deudoras.
 * Fuente única: la usan el parser de balances (saldo = débito − crédito en las
 * deudoras) y el importador de saldos de apertura (lado del asiento).
 */
export function isDebitNaturePuc(code: string): boolean {
  const cls = parseInt(code[0] ?? '', 10);
  const grp = parseInt(code.slice(0, 2), 10);
  if (cls === 8) return !(grp >= 84 && grp <= 86);
  if (cls === 9) return grp >= 94 && grp <= 96;
  return cls === 1 || cls === 5 || cls === 6 || cls === 7;
}

function natureBalance(code: string, debit: number, credit: number): number {
  const value = isDebitNaturePuc(code) ? debit - credit : credit - debit;
  return value === 0 ? 0 : value;
}

function readBalanceCell(
  cols: string[],
  col: BalanceColumn,
  code: string,
  unidad: LecturaUnidad = SIN_UNIDAD,
): AmountCell {
  const first = parseAmountCell(cols[col.index], unidad);
  if (col.creditIndex === undefined) return first;
  const credit = parseAmountCell(cols[col.creditIndex], unidad);
  if (first.kind === 'unreadable') return first;
  if (credit.kind === 'unreadable') return credit;
  if (first.kind === 'empty' && credit.kind === 'empty') return first;
  const d = first.kind === 'number' ? first.value : 0;
  const c = credit.kind === 'number' ? credit.value : 0;
  return { kind: 'number', value: natureBalance(code, d, c) };
}

function unreadableMessage(code: string, header: string, cell: UnreadableCell): string {
  const shown = cell.raw.length > 40 ? `${cell.raw.slice(0, 40)}…` : cell.raw;
  if (cell.ambiguoEn) {
    return (
      `Cuenta ${code}: el saldo "${shown}" de la columna "${header}" es ambiguo con la unidad ` +
      `confirmada (${cell.ambiguoEn} de pesos): con tres cifras tras el único separador puede ser ` +
      'un decimal o una agrupación de miles, y el archivo no permite deducir su separador decimal. ' +
      'Exporte los importes con separador de miles y decimal, o con un número de decimales distinto de tres.'
    );
  }
  if (cell.fueraDeRango) {
    return (
      `Cuenta ${code}: el saldo "${shown}" de la columna "${header}" está fuera del rango de ` +
      'precisión monetaria soportado (más de 2^53 centavos); se requiere ingestión decimal exacta ' +
      'antes de emitir el informe.'
    );
  }
  return cell.scientific
    ? `Cuenta ${code}: el saldo "${shown}" de la columna "${header}" está en notación científica ` +
        'y perdió precisión al exportarse; exporte el importe completo.'
    : `Cuenta ${code}: valor ilegible "${shown}" en la columna "${header}"; ` +
        'no se puede sumar sin adivinar el importe.';
}

/**
 * Variante detallada de `parseTrialBalanceCSV`: además de las filas devuelve
 * las columnas de saldo detectadas (periodo y tipo apertura/cierre), la fila
 * de encabezados y la convención de signos detectada.
 */
export function parseTrialBalanceCSVWithMeta(
  csvText: string,
  options: ParseTrialBalanceOptions = {},
): ParsedTrialBalance {
  const empty: ParsedTrialBalance = {
    rows: [],
    balanceColumns: [],
    headerLineIndex: -1,
    signConvention: null,
    unidadDeclarada: null,
    unidadAplicada: null,
    corteDeclarado: null,
  };
  const lines = csvText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return empty;

  // -------------------------------------------------------------------------
  // Cabecera: primera fila (de las primeras 30) con columna de código y
  // columna de saldo o débito/crédito. Sin candidata se conserva el contrato
  // previo (primera línea), que no produce filas.
  // -------------------------------------------------------------------------
  let layout: HeaderLayout | null = null;
  const scanLimit = Math.min(lines.length - 1, MAX_HEADER_SCAN_LINES);
  for (let i = 0; i < scanLimit; i++) {
    const candidate = detectHeaderLayout(lines[i], i, options);
    if (candidate && isUsableHeader(candidate)) {
      layout = candidate;
      break;
    }
  }
  layout ??= detectHeaderLayout(lines[0], 0, options);
  if (!layout || layout.codeIdx === -1) return empty;

  const { separator, rawHeaders, codeIdx, nameIdx, levelIdx, transIdx, debitIdx, creditIdx } = layout;
  const balanceColumns = layout.balance.columns;
  const dcPeriod = options.forcePeriod ?? options.currentYear ?? DEFAULT_PERIOD;

  const rows: RawAccountRow[] = [];
  const numericPeriods = new Set<string>();

  // -------------------------------------------------------------------------
  // Unidad y fecha de corte del archivo ANTES de leer importes: la unidad
  // confirmada reexpresa cada celda desde su texto decimal (P4-a), así que hay
  // que conocerla al parsear. Títulos y notas al pie son las líneas sin código.
  // -------------------------------------------------------------------------
  const codeOf = (cols: string[]) =>
    (cols[codeIdx] || '').trim().replace(/['"]/g, '').replace(/[.\-\s]/g, '');
  const preambulo = lines.slice(0, layout.lineIndex);
  const lineasSinCuenta: string[] = [];
  for (let i = layout.lineIndex + 1; i < lines.length; i++) {
    const code = codeOf(parseLine(lines[i], separator));
    if (!code || !/^\d/.test(code)) lineasSinCuenta.push(lines[i]);
  }
  const unidadDeclarada = detectUnidadDeclarada([...preambulo, ...lineasSinCuenta], rawHeaders);
  const unidadAplicada = options.unidadConfirmada ?? null;
  const exponente = unidadAplicada ? EXPONENTE_UNIDAD[unidadAplicada] : 0;
  // Con la unidad confirmada, '848,123' (tres cifras tras el único separador)
  // puede ser decimal (precisión al peso en miles) o agrupación: el separador
  // decimal se decide por archivo (recalculo-final2-02 / ICU-02).
  const lecturaUnidad: LecturaUnidad =
    unidadAplicada && exponente > 0
      ? {
          exponente,
          unidad: unidadAplicada,
          separadorDecimal: separadorDecimalDelArchivo(
            lines.slice(layout.lineIndex + 1).flatMap((line) => {
              const cols = parseLine(line, separator);
              const code = codeOf(cols);
              if (!code || !/^\d/.test(code)) return [];
              const idx = [
                ...balanceColumns.flatMap((c) => (c.creditIndex === undefined ? [c.index] : [c.index, c.creditIndex])),
                ...(balanceColumns.length === 0 ? [debitIdx, creditIdx] : []),
              ];
              return idx.filter((i) => i >= 0).map((i) => cols[i] ?? '');
            }),
            separator,
          ),
        }
      : SIN_UNIDAD;
  const corteDeclarado = detectCorteDeclarado(preambulo);

  for (let i = layout.lineIndex + 1; i < lines.length; i++) {
    const cols = parseLine(lines[i], separator);
    const code = codeOf(cols);
    if (!code || !/^\d/.test(code)) continue;

    let level = inferLevel(code);
    if (levelIdx !== -1) {
      const declared = normalizeLevel((cols[levelIdx] || '').trim());
      if (CANONICAL_LEVELS.has(declared)) level = declared;
    }

    let transactional = false;
    if (transIdx !== -1) {
      const val = normalizeHeaderText(cols[transIdx]);
      transactional = val === 'si' || val === 'yes' || val === '1' || val === 'true';
    } else {
      transactional = level === 'Auxiliar';
    }

    const balancesByPeriod: Record<string, number> = {};
    const rowIssues: RawRowParseIssue[] = [];
    const name = (cols[nameIdx] || '').trim().replace(/['"]/g, '');

    // Más celdas con contenido que encabezados: un separador sin comillas
    // (p. ej. "Retención en la fuente 2,5%" en un CSV con comas) desplazó los
    // saldos a la columna vecina, y la cifra leída es la de otra columna. Se
    // declara como problema bloqueante de todos los periodos; la corrección
    // de fondo es entrecomillar en el productor del CSV (ingesta-05).
    if (cols.slice(rawHeaders.length).some((c) => c.trim().length > 0)) {
      rowIssues.push({
        period: null,
        message:
          `Cuenta ${code}: la fila tiene ${cols.length} columnas y la cabecera ${rawHeaders.length}; ` +
          'un separador sin comillas (por ejemplo una coma en el nombre) desplazó los saldos y ' +
          'las cifras de esta fila no son confiables.',
      });
    }

    if (balanceColumns.length > 0) {
      // Caso normal: hay columnas de saldo identificadas. Cada columna
      // alimenta su periodo correspondiente.
      for (const col of balanceColumns) {
        const cell = readBalanceCell(cols, col, code, lecturaUnidad);
        if (cell.kind === 'number') {
          balancesByPeriod[col.period] = cell.value;
          numericPeriods.add(col.period);
        } else if (cell.kind === 'unreadable') {
          rowIssues.push({ period: col.period, message: unreadableMessage(code, col.header, cell) });
        }
      }
    } else if (debitIdx !== -1 || creditIdx !== -1) {
      // Solo hay debito/credito: derivamos el balance segun naturaleza PUC.
      // Un débito o crédito ilegible NO se vuelve 0 (niif-preproceso-05).
      const debit = debitIdx !== -1 ? parseAmountCell(cols[debitIdx], lecturaUnidad) : EMPTY_CELL;
      const credit = creditIdx !== -1 ? parseAmountCell(cols[creditIdx], lecturaUnidad) : EMPTY_CELL;
      if (debit.kind === 'unreadable') {
        rowIssues.push({ period: dcPeriod, message: unreadableMessage(code, rawHeaders[debitIdx], debit) });
      }
      if (credit.kind === 'unreadable') {
        rowIssues.push({ period: dcPeriod, message: unreadableMessage(code, rawHeaders[creditIdx], credit) });
      }
      if (debit.kind !== 'unreadable' && credit.kind !== 'unreadable') {
        balancesByPeriod[dcPeriod] = natureBalance(
          code,
          debit.kind === 'number' ? debit.value : 0,
          credit.kind === 'number' ? credit.value : 0,
        );
        numericPeriods.add(dcPeriod);
      }
    }

    // Sin saldo ni problema de lectura (celdas vacías): la fila no aporta.
    if (Object.keys(balancesByPeriod).length === 0 && rowIssues.length === 0) continue;

    const row: RawAccountRow = {
      code,
      name,
      level,
      transactional,
      balancesByPeriod,
    };
    if (rowIssues.length > 0) row.parseIssues = rowIssues;
    rows.push(row);
  }

  // Una columna sin ningún importe legible no genera snapshot propio: sus
  // problemas pasan a aplicar a todos los periodos para que no se pierdan.
  // Las ambigüedades de columnas afectan al archivo completo.
  const fileIssues: RawRowParseIssue[] = layout.balance.issues.map((message) => ({
    period: null,
    message,
  }));
  // Unidad declarada distinta de pesos (recalculo-final-03): motivo de
  // integridad de todo el archivo hasta que el usuario CONFIRME la unidad
  // (P4-a). Con la confirmación los importes ya se reexpresaron arriba y queda
  // una nota de ingesta visible en el informe.
  if (unidadDeclarada && !unidadAplicada) {
    fileIssues.push({ period: null, message: motivoUnidadDeclarada(unidadDeclarada) });
  }
  const notas: NotaIngesta[] = [];
  const notaUnidad = unidadAplicada ? notaUnidadConfirmada(unidadDeclarada, unidadAplicada) : null;
  if (notaUnidad) notas.push({ period: null, message: notaUnidad });
  for (const row of rows) {
    for (const issue of row.parseIssues ?? []) {
      if (issue.period !== null && !numericPeriods.has(issue.period)) issue.period = null;
    }
    if (fileIssues.length > 0) row.parseIssues = [...(row.parseIssues ?? []), ...fileIssues];
  }

  // Fecha de corte declarada en el título (P4-c / niif-preproceso-29). Una
  // columna rotulada sólo con el año del corte se reetiqueta `AAAA-MM` si el
  // corte es parcial (su P&G cubre MM meses y los KPIs se anualizan); si el
  // corte es a diciembre la etiqueta se conserva (convención de cierre anual)
  // y el periodo queda 'cerrado' con la evidencia del archivo. Bajo
  // `forcePeriod` (una hoja XLSX) decide `raw-data`, que conoce la hoja.
  let columnasFinales = balanceColumns.map((c) => ({ header: c.header, period: c.period, kind: c.kind }));
  if (corteDeclarado) {
    const year = corteDeclarado.year;
    // Sólo una columna cuyo encabezado trae ese año: una etiqueta impuesta por
    // el llamador (`forcePeriod` de la hoja, `currentYear` del API) no se toca.
    // Una columna que trae su propia fecha en el encabezado (ICU-03) ya tiene
    // su corte y no se re-rotula con el del título.
    const periodoDelAnio =
      !options.forcePeriod &&
      balanceColumns.some(
        (c) => c.period === year && explicitPeriodOf(c.header) === year && corteDeEncabezado(c.header) === null,
      );
    if (corteDeclarado.month !== 12 && periodoDelAnio) {
      const label = `${year}-${String(corteDeclarado.month).padStart(2, '0')}`;
      relabelPeriod(rows, year, label);
      numericPeriods.delete(year);
      numericPeriods.add(label);
      columnasFinales = columnasFinales.map((c) => (c.period === year ? { ...c, period: label } : c));
      notas.push({
        period: label,
        message:
          `Fecha de corte declarada en el archivo («${corteDeclarado.texto}»): la columna del año ` +
          `${year} se trata como corte ${label} (P&G de ${corteDeclarado.month} meses).`,
        corte: { tipo: 'parcial', meses: corteDeclarado.month, texto: corteDeclarado.texto },
      });
    } else if (
      corteDeclarado.month === 12 &&
      (numericPeriods.has(year) || options.forcePeriod === year)
    ) {
      notas.push({
        period: year,
        message:
          `Fecha de corte declarada en el archivo («${corteDeclarado.texto}»): periodo ${year} de ` +
          '12 meses (cierre anual).',
        corte: { tipo: 'cerrado', meses: 12, texto: corteDeclarado.texto },
      });
    }
  }
  // ICU-03: la fecha de corte del ENCABEZADO de la columna ya fijó su periodo
  // (`explicitPeriodOf`); aquí queda la nota que la cita, con el tipo de
  // periodo y los meses, igual que la del título.
  const periodosConCorte = new Set(notas.filter((n) => n.corte).map((n) => n.period));
  for (const col of columnasFinales) {
    if (col.kind === 'opening') continue;
    const c = corteDeEncabezado(col.header);
    if (!c) continue;
    const label = etiquetaDeCorte(c);
    if (col.period !== label || periodosConCorte.has(label) || !numericPeriods.has(label)) continue;
    periodosConCorte.add(label);
    const texto = textoDeLinea(col.header);
    notas.push({
      period: label,
      message:
        c.month === 12
          ? `Fecha de corte en el encabezado de la columna («${texto}»): periodo ${label} de 12 meses (cierre anual).`
          : `Fecha de corte en el encabezado de la columna («${texto}»): corte ${label} (P&G de ${c.month} meses).`,
      corte: { tipo: c.month === 12 ? 'cerrado' : 'parcial', meses: c.month, texto },
    });
  }
  // ICU-03: si el archivo trae una fecha que no fijó el corte de un periodo de
  // sólo año (a mitad de mes, un rango que no empieza en enero, o una etiqueta
  // impuesta por el llamador), la nota de base de los KPIs la cita en vez de
  // afirmar que el archivo no declara la fecha. Bajo `forcePeriod` el corte del
  // título lo aplica `raw-data`, que conoce la hoja.
  const tituloSinAplicar =
    corteDeclarado && !options.forcePeriod && !periodosConCorte.has(corteDeclarado.year)
      ? corteDeclarado.texto
      : null;
  const soloAnioSinCorte = columnasFinales.filter(
    (c) => c.kind !== 'opening' && /^\d{4}$/.test(c.period) && !periodosConCorte.has(c.period) && numericPeriods.has(c.period),
  );
  if (soloAnioSinCorte.length > 0) {
    const fechaSinInterpretar =
      tituloSinAplicar ??
      [...preambulo, ...soloAnioSinCorte.map((c) => c.header)]
        .filter((t) => tieneFecha(t) && corteDeLinea(t) === null && corteDeEncabezado(t) === null)
        .map(textoDeLinea)[0] ??
      null;
    if (fechaSinInterpretar) {
      for (const period of new Set(soloAnioSinCorte.map((c) => c.period))) {
        notas.push({
          period,
          message:
            `El archivo trae la fecha «${fechaSinInterpretar}», que no se interpretó como fecha de corte ` +
            `del periodo ${period} (sólo se leen cortes a fin de mes o rangos desde enero del año de la columna).`,
          fechaSinInterpretar,
        });
      }
    }
  }
  if (notas.length > 0 && rows.length > 0) {
    rows[0] = { ...rows[0], notasIngesta: [...(rows[0].notasIngesta ?? []), ...notas] };
  }

  const meta = {
    balanceColumns: columnasFinales,
    headerLineIndex: layout.lineIndex,
    unidadDeclarada: unidadDeclarada,
    unidadAplicada,
    corteDeclarado,
  };

  // -------------------------------------------------------------------------
  // Normalizacion de la convencion de signos (FASE 0, 2026-08).
  // -------------------------------------------------------------------------
  // La unica normalizacion por naturaleza PUC del parser vive en la rama
  // debito/credito de arriba, y esa rama es inalcanzable en cuanto el archivo
  // trae cualquier columna que `isBalanceHeader` reconozca — el caso de todos
  // los exports de ERP con columna de saldo. Aqui cubrimos ese hueco: si el
  // archivo viene en convencion algebraica (debitos +, creditos -), invertimos
  // las clases 2/3/4 para que el resto del pipeline reciba magnitudes de su
  // naturaleza, que es lo que `netIncome = totalRevenue - gastos` y
  // `equationBalance = activo - pasivo - patrimonio` asumen.
  if (options.normalizeSignConvention === false) {
    return { rows, ...meta, signConvention: null };
  }
  const normalized = normalizeSignConvention(rows);
  return { rows: normalized.rows, ...meta, signConvention: normalized.detection };
}

// ---------------------------------------------------------------------------
// Unidad monetaria declarada (recalculo-final-03, re-auditoría 2026-09-24)
// ---------------------------------------------------------------------------
// Un encabezado "Saldo 2025 (miles de pesos)" o un título "Cifras expresadas en
// miles de pesos colombianos" dicen que cada importe vale × 1.000. El parser
// lee pesos: publicar esas cifras tal cual es presentar el balance 1.000 veces
// más pequeño (y las bases en UVT, los umbrales y la materialidad con él). No
// se reescala en silencio: se bloquea con un motivo que pide confirmar la
// unidad y cargar los importes en pesos.
// ---------------------------------------------------------------------------
type UnidadDeclarada = 'miles' | 'millones';

/**
 * Texto legible de una línea del archivo para citarla en un motivo o nota: sin
 * separadores ni comillas, y sin las celdas repetidas que deja una celda
 * combinada de Excel ("De Enero 2025 a Diciembre 2025" copiada en cada
 * columna). Recortado a 120 caracteres.
 */
function textoDeLinea(linea: string): string {
  const celdas: string[] = [];
  for (const cell of linea.split(/[,;\t]+/)) {
    const t = cell.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
    if (t && !celdas.includes(t)) celdas.push(t);
  }
  return celdas.join(' ').slice(0, 120);
}

/** Potencia de 10 que lleva cada unidad confirmada a pesos. */
const EXPONENTE_UNIDAD: Record<UnidadMonetaria, 0 | 3 | 6> = { pesos: 0, miles: 3, millones: 6 };

const FACTOR_TEXTO: Record<UnidadMonetaria, string> = {
  pesos: '1',
  miles: '1.000',
  millones: '1.000.000',
};

/**
 * Nota visible de la unidad confirmada (P4-a). `null` cuando no hay nada que
 * revelar (el archivo no declara unidad y el usuario confirmó pesos).
 */
function notaUnidadConfirmada(
  declarada: UnidadDeclaradaDetectada | null,
  confirmada: UnidadMonetaria,
): string | null {
  const fuente = declarada
    ? `el archivo declara ${declarada.unidad} de pesos («${declarada.texto}»)`
    : 'el archivo no declara la unidad';
  if (confirmada === 'pesos') {
    if (!declarada) return null;
    return (
      `Nota de ingesta: ${fuente}, pero el usuario confirmó que los importes ya están en pesos; ` +
      'las cifras no se reexpresan.'
    );
  }
  return (
    `Nota de ingesta: cifras reexpresadas de ${confirmada} de pesos a pesos (× ${FACTOR_TEXTO[confirmada]}) ` +
    `por confirmación del usuario; ${fuente}. Cada importe se convirtió desde su texto decimal a ` +
    'centavos exactos.'
  );
}

/** Frases de unidad en títulos, notas o encabezados (texto normalizado). */
const UNIDAD_EN_TEXTO: RegExp[] = [
  /\b(?:en|expresad[oa]s?\s+en|cifras\s+en|valores\s+en)\s+(miles|millones)\b/,
  /\b(miles|millones)\s+de\s+(?:pesos|cop\b|\$)/,
  /\(\s*(miles|millones)\s*\)/,
  /\bin\s+(thousands|millions)\b/,
  /\b(thousands|millions)\s+of\s+(?:pesos|cop)\b/,
];
/** En una celda de encabezado basta la palabra ("Saldo miles 2025") o "(000)". */
const UNIDAD_EN_ENCABEZADO = /\b(miles|millones|thousands|millions)\b|\(\s*\$?\s*000\s*\)/;

function unidadDeCoincidencia(match: string): UnidadDeclarada {
  return /mill/.test(match) ? 'millones' : 'miles';
}

/**
 * Unidad distinta de pesos declarada en los encabezados, en el preámbulo o en
 * las filas que no son cuentas (títulos, notas al pie). `null` si no hay.
 */
function detectUnidadDeclarada(
  textos: string[],
  encabezados: string[],
): UnidadDeclaradaDetectada | null {
  const limpiar = textoDeLinea;
  for (const h of encabezados) {
    const m = normalizeHeaderText(h).match(UNIDAD_EN_ENCABEZADO);
    if (m) return { unidad: unidadDeCoincidencia(m[0]), texto: limpiar(h) };
  }
  for (const t of textos) {
    const norm = normalizeHeaderText(t);
    for (const re of UNIDAD_EN_TEXTO) {
      const m = norm.match(re);
      if (m) return { unidad: unidadDeCoincidencia(m[0]), texto: limpiar(t) };
    }
  }
  return null;
}

function motivoUnidadDeclarada(d: { unidad: UnidadDeclarada; texto: string }): string {
  const factor = d.unidad === 'miles' ? '1.000' : '1.000.000';
  return (
    `El archivo declara las cifras en ${d.unidad} de pesos («${d.texto}»). UtopIA lee cada ` +
    'importe como pesos colombianos: confirme la unidad (pesos / miles / millones) en el ' +
    'formulario del informe o con el parámetro `unit` del API v1, o cargue el balance con los ' +
    `importes en pesos (× ${factor}). Sin confirmación las cifras no se reexpresan ni se publican.`
  );
}

// ---------------------------------------------------------------------------
// Fecha de corte declarada en el título (P4-c, niif-preproceso-29)
// ---------------------------------------------------------------------------
// Un encabezado "Saldo 2025" deja la etiqueta en el año y el preprocesador la
// trata como 12 meses (convención de cierre anual). Si el título del archivo
// declara el corte ("Balance de prueba a junio 30 de 2025", "De Enero 2025 a
// Junio 2025", "Corte: 30/06/2025") esa convención es falsa: el P&G cubre 6
// meses. Se lee sólo el preámbulo (filas antes del encabezado de columnas) y
// sólo fechas que determinan meses completos: un corte a mitad de mes o un
// rango que no empieza en enero no se interpreta (queda el supuesto anual,
// revelado en la nota de base de los KPIs).
// ---------------------------------------------------------------------------
const MESES_CORTE: Array<[string, number]> = [
  ['enero|ene|january|jan', 1],
  ['febrero|feb|february', 2],
  ['marzo|mar|march', 3],
  ['abril|abr|april|apr', 4],
  ['mayo|may', 5],
  ['junio|jun|june', 6],
  ['julio|jul|july', 7],
  ['agosto|ago|august|aug', 8],
  ['septiembre|setiembre|sept|sep|set|september', 9],
  ['octubre|oct|october', 10],
  ['noviembre|nov|november', 11],
  ['diciembre|dic|december|dec', 12],
];
const MES_ALT = MESES_CORTE.map(([alts]) => alts).join('|');

function mesDeNombre(nombre: string): number | null {
  for (const [alts, n] of MESES_CORTE) {
    if (new RegExp(`^(?:${alts})$`).test(nombre)) return n;
  }
  return null;
}

const DIA = '(\\d{1,2})(?!\\d)';
/** "de enero [de] 2025 a junio 30 de 2025" / "enero 1 a junio 30 de 2025". */
const CORTE_RANGO_RE = new RegExp(
  `(?:^|\\s)(?:(?:de|desde|del)\\s+)?(?:${DIA}\\s+de\\s+)?(${MES_ALT})(?:\\s+${DIA})?(?:\\s+de)?(?:\\s+(20\\d{2}))?` +
    `\\s+(?:a|al|hasta(?:\\s+el)?)\\s+(?:${DIA}\\s+de\\s+)?(${MES_ALT})(?:\\s+${DIA})?(?:\\s+(?:de|del))?\\s+(20\\d{2})(?!\\d)`,
);
/** "a junio 30 de 2025" / "al 30 de junio de 2025" / "corte a diciembre de 2025". */
const CORTE_FECHA_RE = new RegExp(
  `(?:^|\\s)(?:a|al|corte(?:\\s+(?:a|al))?|cortado\\s+a|hasta(?:\\s+el)?|a\\s+la\\s+fecha(?:\\s+de)?)\\s+` +
    `(?:${DIA}\\s+de\\s+)?(${MES_ALT})(?:\\s+${DIA})?(?:\\s+(?:de|del))?\\s+(20\\d{2})(?!\\d)`,
);
/** "a 30/06/2025", "corte: 30-06-2025", "fecha de corte 2025-06-30". */
const CORTE_NUMERICO_RE =
  /(?:^|\s)(?:a|al|corte:?|fecha de corte:?|hasta(?:\s+el)?)\s+(?:(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})|(20\d{2})-(\d{1,2})-(\d{1,2}))(?!\d)/;

function ultimoDiaDelMes(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `true` si el día (cuando se indica) cierra el mes: el corte cubre meses completos. */
function cierraElMes(dia: string | undefined, year: number, month: number): boolean {
  if (!dia) return true;
  return parseInt(dia, 10) === ultimoDiaDelMes(year, month);
}

function corteDeLinea(linea: string): { year: number; month: number } | null {
  const t = normalizeHeaderText(linea)
    .replace(/[,;\t"'()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  const rango = CORTE_RANGO_RE.exec(t);
  if (rango) {
    const [, , mesIni, , anioIni, dia2a, mesFin, dia2b, anioFin] = rango;
    const inicio = mesDeNombre(mesIni);
    const fin = mesDeNombre(mesFin);
    const year = parseInt(anioFin, 10);
    // Sólo P&G acumulado desde enero del mismo año: otro inicio no determina
    // la duración con la convención de etiquetas `AAAA-MM`.
    if (inicio !== 1 || fin === null || (anioIni && parseInt(anioIni, 10) !== year)) return null;
    return cierraElMes(dia2a ?? dia2b, year, fin) ? { year, month: fin } : null;
  }
  const fecha = CORTE_FECHA_RE.exec(t);
  if (fecha) {
    const [, diaA, mes, diaB, anio] = fecha;
    const month = mesDeNombre(mes);
    const year = parseInt(anio, 10);
    if (month === null) return null;
    return cierraElMes(diaA ?? diaB, year, month) ? { year, month } : null;
  }
  const num = CORTE_NUMERICO_RE.exec(t);
  if (num) {
    const [, d1, m1, y1, y2, m2, d2] = num;
    const year = parseInt(y1 ?? y2, 10);
    const month = parseInt(m1 ?? m2, 10);
    if (!(month >= 1 && month <= 12)) return null;
    return cierraElMes(d1 ?? d2, year, month) ? { year, month } : null;
  }
  return null;
}

/**
 * Fecha de corte del preámbulo del archivo. Con varias fechas, manda la más
 * reciente; dos meses distintos para el mismo año son ambiguos (`null`).
 */
function detectCorteDeclarado(preambulo: string[]): CorteDeclarado | null {
  const encontrados: Array<{ year: number; month: number; texto: string }> = [];
  for (const linea of preambulo) {
    const c = corteDeLinea(linea);
    if (c) {
      const texto = textoDeLinea(linea);
      encontrados.push({ ...c, texto });
    }
  }
  if (encontrados.length === 0) return null;
  const maxYear = Math.max(...encontrados.map((e) => e.year));
  const delAnio = encontrados.filter((e) => e.year === maxYear);
  if (new Set(delAnio.map((e) => e.month)).size > 1) return null;
  const elegido = delAnio[0];
  return { year: String(elegido.year), month: elegido.month, texto: elegido.texto };
}

/** `AAAA-MM` de un corte parcial; `AAAA` a diciembre (convención de cierre anual). */
function etiquetaDeCorte(c: { year: number; month: number }): string {
  return c.month === 12 ? String(c.year) : `${c.year}-${String(c.month).padStart(2, '0')}`;
}

const NO_LETRA_ANTES = '(?<![a-z])';
const NO_LETRA_DESPUES = '(?![a-z])';
/** "junio 30 de 2025" (mes, día, año). */
const ENC_MES_DIA_ANIO_RE = new RegExp(
  `${NO_LETRA_ANTES}(${MES_ALT})${NO_LETRA_DESPUES}\\s+${DIA}\\s+(?:de\\s+|del\\s+)?(20\\d{2})(?!\\d)`,
);
/** "30 de junio de 2025" (día, mes, año). */
const ENC_DIA_MES_ANIO_RE = new RegExp(
  `(?<!\\d)${DIA}\\s+de\\s+(${MES_ALT})${NO_LETRA_DESPUES}\\s+(?:de\\s+|del\\s+)?(20\\d{2})(?!\\d)`,
);
/** "junio 2025", "jun-2025", "junio de 2025" (sin día delante: "1 de enero de 2025" es otra cosa). */
const ENC_MES_ANIO_RE = new RegExp(
  `(?<!\\d\\s*(?:de\\s+)?)${NO_LETRA_ANTES}(${MES_ALT})${NO_LETRA_DESPUES}\\s*[-/.]?\\s*(?:de\\s+|del\\s+)?(20\\d{2})(?!\\d)`,
);
/** "dic-24", "jun/25" (año de dos cifras pegado al mes). */
const ENC_MES_ANIO_CORTO_RE = new RegExp(`${NO_LETRA_ANTES}(${MES_ALT})[-/.](\\d{2})(?!\\d)`);
/** Fecha completa: "30/06/2025", "30-06-2025", "2025-06-30". */
const ENC_FECHA_NUM_RE = /(?<!\d)(?:(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})|(20\d{2})-(\d{1,2})-(\d{1,2}))(?!\d)/;
/** "2025-06" / "2025/06". */
const ENC_ANIO_MES_RE = /(?<![\d/.-])(20\d{2})[-/](0?[1-9]|1[0-2])(?![\d/.-])/;
/** "06/2025" / "6-2025". */
const ENC_MES_NUM_ANIO_RE = /(?<![\d/.-])(0?[1-9]|1[0-2])[-/](20\d{2})(?![\d/.-])/;

/**
 * Fecha de corte en el ENCABEZADO de una columna de saldo (ICU-03): "Saldo a
 * 30/06/2025", "Saldo final 30-06-2025", "Saldo a junio 30 de 2025", "Saldo
 * junio 2025", "Saldo Jun-2025", "Saldo 2025-06", "Saldo 06/2025". Igual que
 * en el título, sólo cuentan fechas que cierran el mes (un día intermedio no
 * determina meses completos). `null` si el encabezado no trae mes.
 */
function corteDeEncabezado(header: string): { year: number; month: number } | null {
  const enLinea = corteDeLinea(header);
  if (enLinea) return enLinea;
  const t = normalizeHeaderText(header)
    .replace(/[,;\t"'()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  const num = ENC_FECHA_NUM_RE.exec(t);
  if (num) {
    const [, d1, m1, y1, y2, m2, d2] = num;
    const year = parseInt(y1 ?? y2, 10);
    const month = parseInt(m1 ?? m2, 10);
    if (!(month >= 1 && month <= 12)) return null;
    return cierraElMes(d1 ?? d2, year, month) ? { year, month } : null;
  }
  const mda = ENC_MES_DIA_ANIO_RE.exec(t);
  if (mda) {
    const month = mesDeNombre(mda[1]);
    const year = parseInt(mda[3], 10);
    return month !== null && cierraElMes(mda[2], year, month) ? { year, month } : null;
  }
  const dma = ENC_DIA_MES_ANIO_RE.exec(t);
  if (dma) {
    const month = mesDeNombre(dma[2]);
    const year = parseInt(dma[3], 10);
    return month !== null && cierraElMes(dma[1], year, month) ? { year, month } : null;
  }
  const ma = ENC_MES_ANIO_RE.exec(t);
  if (ma) {
    const month = mesDeNombre(ma[1]);
    return month === null ? null : { year: parseInt(ma[2], 10), month };
  }
  const corto = ENC_MES_ANIO_CORTO_RE.exec(t);
  if (corto) {
    const month = mesDeNombre(corto[1]);
    return month === null ? null : { year: 2000 + parseInt(corto[2], 10), month };
  }
  const am = ENC_ANIO_MES_RE.exec(t);
  if (am) return { year: parseInt(am[1], 10), month: parseInt(am[2], 10) };
  const mna = ENC_MES_NUM_ANIO_RE.exec(t);
  if (mna) return { year: parseInt(mna[2], 10), month: parseInt(mna[1], 10) };
  return null;
}

/** Texto con una fecha (mes y año, o fecha numérica), interpretable o no. */
const FECHA_EN_TEXTO_RE = new RegExp(
  `${NO_LETRA_ANTES}(?:${MES_ALT})${NO_LETRA_DESPUES}[^\\n]{0,12}?20\\d{2}(?!\\d)` +
    `|(?<!\\d)\\d{1,2}[/.-]\\d{1,2}[/.-](?:20)?\\d{2}(?!\\d)` +
    `|(?<!\\d)20\\d{2}[-/]\\d{1,2}(?!\\d)` +
    `|(?<![\\d/.-])\\d{1,2}[-/]20\\d{2}(?!\\d)`,
);

function tieneFecha(texto: string): boolean {
  return FECHA_EN_TEXTO_RE.test(normalizeHeaderText(texto));
}

/** Reetiqueta el periodo `from` como `to` en saldos y problemas de lectura. */
function relabelPeriod(rows: RawAccountRow[], from: string, to: string): void {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!(from in r.balancesByPeriod) && !(r.parseIssues ?? []).some((p) => p.period === from)) continue;
    const balancesByPeriod: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.balancesByPeriod)) balancesByPeriod[k === from ? to : k] = v;
    rows[i] = {
      ...r,
      balancesByPeriod,
      ...(r.parseIssues
        ? { parseIssues: r.parseIssues.map((p) => (p.period === from ? { ...p, period: to } : p)) }
        : {}),
    };
  }
}

/** Periodo explícito del encabezado: `saldo [2025-06]` o un año reconocible. */
function explicitPeriodOf(header: string): string | null {
  const bracket = header
    .trim()
    .match(/^saldo\s*\[(\d{4}(?:-(?:0[1-9]|1[0-2]|Q[1-4]))?|\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2})\]$/i)?.[1];
  if (bracket) return bracket;
  // ICU-03: "Saldo a 30/06/2025", "Saldo junio 2025", "Saldo 2025-06" → corte
  // 2025-06; a diciembre la etiqueta queda en el año (cierre anual).
  const corte = corteDeEncabezado(header);
  if (corte) return etiquetaDeCorte(corte);
  return detectYearFromString(header);
}

const BALANCE_KIND_PRIORITY: Record<BalanceColumnKind, number> = {
  closing: 0,
  neutral: 1,
  prior: 2,
  opening: 3,
};

/**
 * Detecta las columnas de saldo del header y las mapea a periodos.
 *
 * Reglas (ingesta-06, ingesta-07, niif-preproceso-02):
 *  1. "Saldo débito / saldo crédito" (o deudor / acreedor) con el mismo resto
 *     de encabezado forman UNA columna neta por naturaleza PUC.
 *  2. Un encabezado con año (`20\d{2}`, "Dic-24", `saldo [2025-06]`) es de ese
 *     periodo, también bajo `forcePeriod`. Si la apertura y el cierre traen el
 *     mismo año ("Saldo Inicial 2025 | Saldo Final 2025"), la apertura es el
 *     cierre del año anterior.
 *  3. Sin año, el cierre ("saldo final", "nuevo saldo", "saldo actual") o el
 *     saldo neutro ("saldo") es el periodo actual (`forcePeriod`,
 *     `currentYear` o `DEFAULT_PERIOD`); la apertura ("saldo inicial", "saldo
 *     anterior") o el comparativo es el periodo previo (año − 1 o
 *     `current_anterior`). Bajo `forcePeriod` (una hoja = un periodo) la
 *     apertura sin año no crea un periodo nuevo.
 *  4. Dos columnas que caen en el mismo periodo NO se deduplican en silencio:
 *     se conserva la de cierre y se reporta un problema bloqueante. Ya no hay
 *     heurística posicional.
 */
function detectBalanceColumns(
  rawHeaders: string[],
  options: ParseTrialBalanceOptions,
): BalanceColumnDetection {
  type Candidate = {
    index: number;
    creditIndex?: number;
    header: string;
    kind: BalanceColumnKind;
    year: string | null;
  };
  const candidates: Candidate[] = [];
  const pairIndices = new Set<number>();

  // 1. Pares "saldo débito / saldo crédito".
  const debitSide = new Map<string, number>();
  const creditSide = new Map<string, number>();
  rawHeaders.forEach((raw, index) => {
    for (const h of headerVariants(normalizeHeaderText(raw))) {
      if (!SALDO_WORD.test(h)) continue;
      const isDebit = DEBIT_WORD.test(h);
      if (isDebit === CREDIT_WORD.test(h)) continue;
      const word = new RegExp((isDebit ? DEBIT_WORD : CREDIT_WORD).source, 'g');
      const key = h.replace(word, ' ').replace(/\s+/g, ' ').trim();
      const side = isDebit ? debitSide : creditSide;
      if (!side.has(key)) side.set(key, index);
      break;
    }
  });
  for (const [key, debitIndex] of debitSide) {
    const creditIndex = creditSide.get(key);
    if (creditIndex === undefined) continue;
    pairIndices.add(debitIndex);
    pairIndices.add(creditIndex);
    candidates.push({
      index: debitIndex,
      creditIndex,
      header: `${rawHeaders[debitIndex]} / ${rawHeaders[creditIndex]}`,
      kind: classifyBalanceHeader(key),
      year: explicitPeriodOf(rawHeaders[debitIndex]) ?? explicitPeriodOf(rawHeaders[creditIndex]),
    });
  }

  // 2. Columnas de saldo simples.
  rawHeaders.forEach((raw, index) => {
    if (pairIndices.has(index) || !isBalanceHeader(raw)) return;
    candidates.push({
      index,
      header: raw,
      kind: classifyBalanceHeader(raw),
      year: explicitPeriodOf(raw),
    });
  });
  candidates.sort((a, b) => a.index - b.index);
  if (candidates.length === 0) return { columns: [], pairIndices, issues: [] };

  // 3. Periodo de cada columna.
  const forced = options.forcePeriod;
  const isYear = (p: string | null | undefined): p is string => !!p && /^\d{4}$/.test(p);
  const isOpeningKind = (k: BalanceColumnKind) => k === 'opening' || k === 'prior';
  const explicitCurrentYears = candidates
    .filter((c) => isYear(c.year) && !isOpeningKind(c.kind))
    .map((c) => parseInt(c.year!, 10));
  const contextYear = parseInt(forced ?? options.currentYear ?? '', 10);
  const baseYear = !Number.isNaN(contextYear)
    ? contextYear
    : explicitCurrentYears.length > 0
      ? Math.max(...explicitCurrentYears)
      : NaN;
  const currentLabel = forced ?? options.currentYear ?? DEFAULT_PERIOD;
  const previousLabel = !Number.isNaN(baseYear)
    ? String(baseYear - 1)
    : `${forced ?? DEFAULT_PERIOD}_anterior`;
  const hasCurrentColumn = candidates.some((c) => c.year !== null || !isOpeningKind(c.kind));

  const resolved: BalanceColumn[] = [];
  for (const c of candidates) {
    let period: string;
    if (c.year) period = c.year;
    else if (!isOpeningKind(c.kind)) period = currentLabel;
    else if (forced && hasCurrentColumn) continue;
    else if (forced) period = forced;
    else period = previousLabel;
    resolved.push({ index: c.index, creditIndex: c.creditIndex, period, kind: c.kind, header: c.header });
  }

  // "Saldo Inicial 2025 | Saldo Final 2025": la apertura de 2025 es el cierre 2024.
  for (const r of resolved) {
    if (r.kind !== 'opening' || !isYear(r.period)) continue;
    const clash = resolved.some(
      (o) => o !== r && o.period === r.period && !isOpeningKind(o.kind),
    );
    if (clash) r.period = String(parseInt(r.period, 10) - 1);
  }

  // 4. Colisiones: una columna por periodo, y la ambigüedad se reporta.
  const byPeriod = new Map<string, BalanceColumn[]>();
  for (const r of resolved) byPeriod.set(r.period, [...(byPeriod.get(r.period) ?? []), r]);
  const columns: BalanceColumn[] = [];
  const issues: string[] = [];
  for (const [period, cols] of byPeriod) {
    const sorted = [...cols].sort(
      (a, b) => BALANCE_KIND_PRIORITY[a.kind] - BALANCE_KIND_PRIORITY[b.kind] || a.index - b.index,
    );
    columns.push(sorted[0]);
    if (cols.length > 1) {
      issues.push(
        `Las columnas de saldo ${cols.map((c) => `"${c.header}"`).join(', ')} corresponden al mismo ` +
          `periodo (${period}); no es posible determinar cuál es el saldo del periodo sin adivinar. ` +
          'Identifique cada columna con su año o como saldo inicial / saldo final.',
      );
    }
  }
  columns.sort((a, b) => a.index - b.index);
  return { columns, pairIndices, issues };
}

// ---------------------------------------------------------------------------
// Validation & Structuring
// ---------------------------------------------------------------------------

/** Opciones del preprocesador. */
export interface PreprocessTrialBalanceOptions {
  /**
   * Si la entrada solo tiene saldos sin año (todas con periodo `'current'`),
   * el caller puede pasar `defaultPeriod` para etiquetar el snapshot.
   */
  defaultPeriod?: string;
  /**
   * ingesta-09 (parcial): periodos cuyos saldos provienen de una columna de
   * saldo inicial / anterior (`parseTrialBalanceCSVWithMeta().balanceColumns`
   * con `kind === 'opening'`). Esos snapshots se marcan `saldosDeApertura` y
   * sus KPIs de flujo salen N/D: el P&G de una columna de apertura no es el
   * P&G del periodo anterior.
   */
  openingPeriods?: readonly string[];
}

/**
 * Process parsed account rows into a multi-period validated balance.
 */
export function preprocessTrialBalance(
  rows: RawAccountRow[],
  options: PreprocessTrialBalanceOptions = {},
): PreprocessedBalance {
  // -------------------------------------------------------------------------
  // 1. Inventario de periodos presentes.
  // -------------------------------------------------------------------------
  const periodSet = new Set<string>();
  for (const r of rows) {
    for (const p of Object.keys(r.balancesByPeriod)) periodSet.add(p);
  }
  if (periodSet.size === 0 && options.defaultPeriod) {
    // No deberia pasar normalmente — pero aseguramos al menos un periodo.
    periodSet.add(options.defaultPeriod);
  }
  if (periodSet.size === 0) {
    periodSet.add(DEFAULT_PERIOD);
  }

  const periods = sortPeriodsAscending([...periodSet]);

  // -------------------------------------------------------------------------
  // 2. Construir un PeriodSnapshot por cada periodo + ejecutar Curator (R1–R4).
  // -------------------------------------------------------------------------
  const snapshots: PeriodSnapshot[] = [];
  const openingPeriods = new Set(options.openingPeriods ?? []);
  // Excepciones de vencimiento declaradas (P4-b), por código exacto de fila.
  const vencimientoPorCodigo = new Map<string, Vencimiento>();
  for (const r of rows) if (r.vencimiento) vencimientoPorCodigo.set(r.code, r.vencimiento);
  for (let i = 0; i < periods.length; i++) {
    const snap = buildSnapshotForPeriod(rows, periods[i]);
    if (openingPeriods.has(periods[i])) snap.saldosDeApertura = true;
    const prev = i > 0 ? snapshots[i - 1] : null;
    const curatorResult = runCurator(snap, prev);
    snap.curator = curatorResult;
    // R1 / R8 recalculan corriente / no corriente por grupo PUC: las
    // excepciones declaradas se vuelven a aplicar sobre el snapshot curado.
    if (vencimientoPorCodigo.size > 0) reaplicarVencimientos(snap, vencimientoPorCodigo);
    if (curatorResult.cashFlowIndirecto) {
      snap.cashFlowIndirecto = curatorResult.cashFlowIndirecto;
    }
    // Inyectar findings del curator como discrepancies para que aparezcan en
    // el reporte multiperiodo y en el `bindingTotalsBlock` que reciben los
    // agentes LLM. Mantenemos shape `Discrepancy` (location/reported/calculated/
    // difference/description) — los findings del curator son cualitativos, así
    // que reported=0 y calculated=0 con el contenido en `description`.
    for (const f of curatorResult.findings) {
      snap.discrepancies.push(curatorFindingToDiscrepancy(f, snap));
    }
    snapshots.push(snap);
  }

  const primary = snapshots[snapshots.length - 1];
  const comparative = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;

  // -------------------------------------------------------------------------
  // 2.5. Wave 2.F4 — RECOMPUTAR KPIs post-curator.
  // Why: `buildSnapshotForPeriod` calcula KPIs sobre el snapshot CRUDO, pero
  // R8 (Cierre Virtual) muta patrimonio y deja el balance cuadrado al
  // centavo. Los ratios derivados del patrimonio (apalancamiento, ROE) y los
  // promedios cross-periodo (ROE/ROA/Rotación) son ESTALES hasta que se
  // recalculen aquí. También recomputamos los KPIs del comparativo con su
  // propio post-curator. Determinístico, sin LLM.
  // -------------------------------------------------------------------------
  for (let i = 0; i < snapshots.length; i++) {
    refreshDerivedKpis(snapshots[i], i > 0 ? snapshots[i - 1] : null);
  }

  // -------------------------------------------------------------------------
  // 3. Reportes y datos limpios consolidados (etiquetados por periodo).
  // -------------------------------------------------------------------------
  const cleanData = buildCleanDataMultiPeriod(snapshots);
  const validationReport = buildMultiPeriodValidationReport(snapshots, rows.length);

  const auxiliaryCount = primary.classes.reduce(
    (s, c) => s + c.accounts.length,
    0,
  );

  // -------------------------------------------------------------------------
  // 4. Pulido NIIF PYME Grupo 2 — banderas y contratos cross-period.
  // -------------------------------------------------------------------------
  const comparativos_impracticables = detectComparativosImpracticables(
    snapshots,
    comparative,
  );
  const actividadInferida = inferActividadFromSnapshot(primary);
  const reclasificacionesNoCompensacion =
    buildReclasificacionesNoCompensacion(primary);

  return {
    periods: snapshots,
    primary,
    comparative,
    rawRows: rows,
    auxiliaryCount,
    cleanData,
    validationReport,
    comparativos_impracticables,
    actividadInferida,
    reclasificacionesNoCompensacion,
  };
}

// ---------------------------------------------------------------------------
// Pulido NIIF PYME Grupo 2 — detectores cross-period
// ---------------------------------------------------------------------------

/**
 * Detector de comparativos impracticables (NIIF for SMEs §3.14, §10.21).
 *
 * `false` cuando:
 *   - Hay 2+ snapshots Y el comparative tiene saldos materiales en CUALQUIER
 *     clase (suma de auxiliaryTotal en valor absoluto > $1.000 COP).
 *
 * `true` cuando:
 *   - Sólo hay 1 snapshot (no hay opening balance), O
 *   - El comparative existe pero todas las clases tienen auxiliaryTotal ≈ 0.
 *
 * NUNCA inferir el flag desde Utilidades Retenidas — §10.19 prohíbe
 * reconstruir cuentas individuales desde Utilidades Retenidas.
 */
function detectComparativosImpracticables(
  snapshots: PeriodSnapshot[],
  comparative: PeriodSnapshot | null,
): boolean {
  if (snapshots.length < 2 || !comparative) return true;
  const TOL = 1_000;
  const totalAbs = comparative.classes.reduce(
    (s, c) => s + Math.abs(c.auxiliaryTotal),
    0,
  );
  return totalAbs <= TOL;
}

/**
 * Inferencia de sector CIIU (rev. 4 A.C., letra) desde el primary snapshot.
 *
 * Detector AMPLIADO sector G (Comercio):
 *   Dispara si CUALQUIERA se cumple:
 *     (a) 1435 (Mercancías no fabricadas) > 5% del activo corriente
 *         Y (clase 6 ausente o |clase6| < 1% de ingresos).
 *     (b) Clase 14 (Inventarios) > 30% del activo total.
 *
 * Why: el balance Grupo Empresarial 2 Tres SAS (fixture testigo) tiene
 * 1435 material y NO tiene 6135 — pero sí 7405 (clase 7 usada como costo).
 * El detector original (clase 6 obligatoria) lo perdía. Ampliado captura
 * comercializadoras que descargan costos a clase 7.
 *
 * Devuelve `undefined` si no hay evidencia suficiente.
 */
function inferActividadFromSnapshot(
  snap: PeriodSnapshot,
): ActividadInferida | undefined {
  const evidencia: string[] = [];
  const activoTotal = snap.controlTotals.activo;
  const activoCorriente = snap.controlTotals.activoCorriente;
  // Ingresos netos de devoluciones 4175 (no la Σ firmada de la clase 4, que
  // depende de la exportación del ERP — recalculo-final2-05).
  const ingresos = snap.controlTotals.ingresosNetos ?? Math.abs(snap.controlTotals.ingresos);

  if (activoTotal <= 0) return undefined;

  const class6 = snap.classes.find((c) => c.code === 6);
  const class14 = snap.classes.find((c) => c.code === 1)?.accounts ?? [];
  const inv1435 = class14
    .filter((a) => a.code.startsWith('1435'))
    .reduce((s, a) => s + a.balance, 0);
  const totalInventarios = class14
    .filter((a) => a.code.startsWith('14'))
    .reduce((s, a) => s + a.balance, 0);

  const class6Total = class6 ? Math.abs(class6.auxiliaryTotal) : 0;
  const class6Ausente = !class6 || class6.accounts.length === 0;
  const class6MenorThan1Pct =
    ingresos > 0 ? class6Total < ingresos * 0.01 : class6Ausente;

  // Criterio (a): 1435 material + clase 6 ausente o irrelevante.
  const inv1435PctAC =
    activoCorriente > 0 ? inv1435 / activoCorriente : 0;
  const triggerA = inv1435PctAC > 0.05 && (class6Ausente || class6MenorThan1Pct);

  if (triggerA) {
    evidencia.push(
      `Cuenta 1435 (Mercancías no fabricadas) = $${formatCOP(inv1435)} ` +
        `(${(inv1435PctAC * 100).toFixed(1)}% del activo corriente).`,
    );
    if (class6Ausente) {
      evidencia.push('Clase 6 (Costo de Ventas) ausente del balance.');
    } else {
      evidencia.push(
        `Clase 6 (Costo de Ventas) inmaterial: $${formatCOP(class6Total)} ` +
          `< 1% de los ingresos ($${formatCOP(ingresos)}).`,
      );
    }
  }

  // Criterio (b): clase 14 > 30% del activo total.
  const inv14PctActivo = totalInventarios / activoTotal;
  const triggerB = inv14PctActivo > 0.30;

  if (triggerB) {
    evidencia.push(
      `Inventarios totales (Clase 14) = $${formatCOP(totalInventarios)} ` +
        `(${(inv14PctActivo * 100).toFixed(1)}% del activo total).`,
    );
  }

  if (!triggerA && !triggerB) return undefined;

  return {
    sectorCIIU: 'G',
    descripcion:
      'Comercio al por mayor y al por menor (CIIU rev. 4, sección G). ' +
      'Inferencia automática del balance — el intake del usuario sigue siendo ' +
      'la fuente formal.',
    evidencia,
  };
}

/**
 * Mapea las reclasificaciones internas R1 al contrato externo PUC-aware.
 *
 * Reglas de mapeo (PUC D. 2650/1993):
 *   - Origen 11 (sobregiros)                 → '2105' Bancos nacionales (corriente).
 *   - Origen 12 (reajustes de inversiones)   → '2895' Diversos.
 *   - Origen 13/14 (anticipos recibidos …)   → '2805' Anticipos y avances recibidos.
 *   - Resto del activo                       → '2895' Diversos.
 *
 * Auditoría 2026-09 (niif-preproceso-22): el resto iba a '2810', que en el PUC
 * es "Depósitos recibidos", no "otros pasivos diversos".
 *
 * Why: el contrato externo cita códigos PUC reales que el LLM puede
 * referenciar. R1 internamente usa códigos virtuales `2810ZZ-*` / `2895VC-*`
 * para preservar trazabilidad — ese detalle NO viaja al prompt.
 */
function buildReclasificacionesNoCompensacion(
  snap: PeriodSnapshot,
): ReclasificacionNoCompensacion[] {
  const out: ReclasificacionNoCompensacion[] = [];
  const reclas = snap.reclassifications ?? [];
  for (const r of reclas) {
    if (!r.applied) continue;
    const origin = r.accountCode;
    let destino = '2895';
    if (origin.startsWith('11')) destino = '2105';
    else if (origin.startsWith('13') || origin.startsWith('14')) destino = '2805';

    const amountCents = BigInt(
      Math.round(Math.abs(r.effectiveTransferCop ?? r.amountCop) * 100),
    );

    out.push({
      cuenta_origen: origin,
      saldo_invertido_centavos: amountCents,
      cuenta_destino_pasivo: destino,
      motivo_norma:
        `NIC 1 párr. 32 (no compensación): saldo crédito en cuenta ${origin} ` +
        `(${r.accountName}) reclasificado a pasivo PUC ${destino}. ` +
        r.justification,
    });
  }
  return out;
}

/**
 * Construye un snapshot completo (clases, controlTotals, equityBreakdown,
 * summary, validation, discrepancies) para un periodo concreto. Trabaja sobre
 * la "vista" del periodo: cada row se proyecta a `balance = balancesByPeriod[period] ?? 0`.
 */
function buildSnapshotForPeriod(
  allRows: RawAccountRow[],
  period: string,
): PeriodSnapshot {
  // Vista plana: rows con balance del periodo.
  const view: ViewRow[] = allRows.map((r) => ({
    code: r.code,
    name: r.name,
    level: r.level,
    transactional: r.transactional,
    balance: r.balancesByPeriod[period] ?? 0,
    ...(r.vencimiento ? { vencimiento: r.vencimiento } : {}),
  }));
  // Notas de ingesta del archivo (unidad confirmada, vencimientos declarados,
  // fecha de corte): informativas, se publican en `validation.adjustments`.
  const notasIngesta = collectNotasIngesta(allRows, period);

  // -------------------------------------------------------------------------
  // 1. Leaf rows estructurales (recalculo-07) sin códigos que no son cuentas
  //    PUC (ingesta-11). Ver `selectLeafRows`.
  // -------------------------------------------------------------------------
  const leafSelection = selectLeafRows(view, period);
  const leafRows = leafSelection.leafRows;

  const classRows = view.filter((r) => r.level === 'Clase');

  // -------------------------------------------------------------------------
  // 2. Agrupar leafs por clase PUC (1..7)
  // -------------------------------------------------------------------------
  const classMap = new Map<number, { leaves: typeof view; reportedRow: typeof view[number] | null }>();
  for (let c = 1; c <= 7; c++) classMap.set(c, { leaves: [], reportedRow: null });

  for (const row of leafRows) {
    const classCode = parseInt(row.code[0], 10);
    if (classCode >= 1 && classCode <= 7) {
      classMap.get(classCode)!.leaves.push(row);
    }
  }

  for (const row of classRows) {
    const classCode = parseInt(row.code[0], 10);
    if (classMap.has(classCode)) classMap.get(classCode)!.reportedRow = row;
  }

  // -------------------------------------------------------------------------
  // 3. Construir PUCClass[] + discrepancias por clase
  // -------------------------------------------------------------------------
  const classes: PUCClass[] = [];
  const discrepancies: Discrepancy[] = [];

  for (const [classCode, data] of classMap) {
    // ITEM 1 — cent-exact: acumulamos en BigInt centavos para evitar drift
    // floating-point. La suma de auxiliares debe COINCIDIR al centavo con el
    // total reportado del balance crudo cuando este es correcto.
    const auxiliaryTotal = sumLeavesPrecise(data.leaves);
    const reportedTotal = data.reportedRow ? data.reportedRow.balance : null;
    const discrepancy = reportedTotal !== null ? Math.abs(auxiliaryTotal - reportedTotal) : 0;

    if (reportedTotal !== null && discrepancy > 1) {
      const missingDesc = findMissingAccountsForClass(view, classCode, data.leaves);
      discrepancies.push({
        location: `Clase ${classCode} (${PUC_CLASS_NAMES[classCode]})`,
        reported: reportedTotal,
        calculated: auxiliaryTotal,
        difference: auxiliaryTotal - reportedTotal,
        description: missingDesc || `Diferencia de $${formatCOP(discrepancy)} entre el total reportado y la suma de auxiliares.`,
      });
    }

    const accounts: ValidatedAccount[] = data.leaves.map((r) => ({
      code: r.code,
      name: r.name,
      level: r.level,
      balance: r.balance,
      isLeaf: true,
      ...(r.vencimiento ? { vencimiento: r.vencimiento } : {}),
    }));
    accounts.sort((a, b) => a.code.localeCompare(b.code));

    classes.push({
      code: classCode,
      name: PUC_CLASS_NAMES[classCode] || `Clase ${classCode}`,
      auxiliaryTotal,
      reportedTotal,
      discrepancy,
      accounts,
    });
  }

  // -------------------------------------------------------------------------
  // 4. Summary legacy (por periodo)
  // -------------------------------------------------------------------------
  const getClassTotal = (c: number) => classes.find((cl) => cl.code === c)?.auxiliaryTotal ?? 0;
  const totalAssets = getClassTotal(1);
  const totalLiabilities = getClassTotal(2);
  const totalEquityRaw = getClassTotal(3);
  const totalRevenue = getClassTotal(4);
  const totalExpenses = getClassTotal(5);
  const totalCosts = getClassTotal(6);
  const totalProduction = getClassTotal(7);

  // ---------------------------------------------------------------------------
  // Devoluciones 4175 → ingresos netos. Se calcula AQUI, antes que `netIncome`,
  // porque TODO el P&L tiene que colgar del neto y no de la Σ de la clase 4.
  //
  // La 4175 es correctora (naturaleza débito dentro de una clase de naturaleza
  // crédito) y cada ERP la exporta distinto. Si llega con signo CONTRARIO al de
  // los ingresos, la Σ clase 4 ya viene neta y volver a restarle las
  // devoluciones es una DOBLE RESTA. Si llega con el MISMO signo (el export
  // perdió el débito), la Σ clase 4 vale bruto + devoluciones, una magnitud sin
  // significado contable. Tomar como base las cuentas ORDINARIAS resuelve los
  // dos casos con una sola fórmula, sin ramificar por convención detectada
  // — ramificar así se midió y da $3.082.953.943,81 sobre el balance testigo.
  //
  // Y la magnitud sale del TOTAL firmado, nunca cuenta por cuenta: el grupo 4175
  // admite saldos de naturaleza contraria entre sí (en el balance real la
  // 41750503 vale +$494.568,88 frente a dos saldos crédito), y sumar valores
  // absolutos por cuenta los invierte — $989.137,76 de error extra.
  //
  // Fuente: spec v2 Parte 4.1 (ingresos netos = |Σ 41xx crédito| − |Σ 4175xx
  // débito|), NIIF 15 §47, PUC Decreto 2649/93 grupo 4175.
  // ---------------------------------------------------------------------------
  const {
    ingresosBrutoCents,
    totalDevolucionesCents,
    ingresosNetosCents,
    ingresosOperacionalesNetosCents,
  } = ingresosClase4Cents(leafRows);
  const totalDevoluciones = Number(totalDevolucionesCents) / 100;
  const ingresosNetos = Number(ingresosNetosCents) / 100;

  // `ingresosNetos`, NO `totalRevenue`. Bajo convención de magnitudes la Σ de la
  // clase vale bruto + devoluciones, y derivar de ahí infla la utilidad en
  // exactamente 2 × devoluciones — sobre un ANCLA DURA que E14 certifica con
  // tolerancia $0, hasta el punto de RECHAZAR la utilidad correcta si un humano
  // la corrige a mano. Medido: ventas $1.000M + devoluciones $100M + gastos
  // $650M publicaba $450.000.000 donde la verdad es $250.000.000.
  const netIncome = ingresosNetos - totalExpenses - totalCosts - totalProduction;

  // -------------------------------------------------------------------------
  // 4.1. Patrimonio crudo — la "Lógica de Cierre Virtual" (R8 del Curator)
  // sustituyó la auto-reparación condicional que vivía aquí.
  //
  // Razón: la auto-reparación previa sólo disparaba si `shortfall ≈ netIncome`
  // (frágil: balances con descuadres legítimos por otros motivos quedaban sin
  // utilidad, y balances post-cierre con saldo en 3605 ≠ utilidad dinámica
  // no se autocorregían). R8 (`curator-rules/r8-virtual-close.ts`) corre
  // SIEMPRE como primera regla del Curator y es autoritativo:
  //   - Inyecta cuenta virtual 3605VC con utilidad dinámica.
  //   - Reclasifica saldo histórico de 3605 a 3710VC (Resultados Acumulados)
  //     si difiere del cálculo dinámico.
  //   - Absorbe centavos de redondeo en 3710VC.
  // El renderer Excel pinta 3605VC como "Resultado del Ejercicio (Corte
  // Actual)" y los pilares Verdad/Valor leen `controlTotals.utilidadNeta`
  // y `equityBreakdown.utilidadEjercicio` (ambos sincronizados por R8).
  // -------------------------------------------------------------------------
  const adjustments: string[] = [...notasIngesta.mensajes];
  // niif-preproceso-32: la clase 7 se resta ÍNTEGRA del resultado (4 − 5 − 6
  // − 7). Es un supuesto: el PUC la acumula "para luego trasladar a
  // inventarios y costo de ventas"; lo que quedó en productos en proceso o
  // terminados no es gasto del periodo. Se revela; las cifras no cambian.
  const notaClase7 = notaSupuestoClase7(totalProduction, leafRows);
  if (notaClase7) adjustments.push(`[${period}] ${notaClase7}`);
  const integrityReasons = [
    ...leafSelection.reasons,
    ...collectParseIssueReasons(allRows, period),
  ];
  // The current input contract uses JS numbers. BigInt after rounding cannot
  // recover cents already lost by parsing or by an unsafe aggregate.
  // recalculo-final-04: es un motivo de INTEGRIDAD de los datos leídos (ningún
  // cierre virtual lo resuelve): va a `integrityReasons` para que el Bridge de
  // Cuadratura no lo degrade y el API v1 no publique 'balanced'.
  const monetaryValues = [
    ...leafRows.map(row => row.balance), totalAssets, totalLiabilities,
    totalEquityRaw, totalRevenue, totalExpenses, totalCosts, totalProduction, netIncome,
  ];
  if (monetaryValues.some((value) => !isSafeMoneyPesos(value))) {
    integrityReasons.push(
      `[${period}] Importe fuera del rango de precisión monetaria soportado. ` +
      'Se requiere ingestión decimal exacta antes de emitir el informe.',
    );
  }
  const validationReasons: string[] = [...integrityReasons];
  const suggestedAccounts: string[] = [];
  const totalEquity = totalEquityRaw;

  // -------------------------------------------------------------------------
  // 5. controlTotals
  // -------------------------------------------------------------------------
  // Clasificación corriente / no corriente por grupo PUC (supuesto revelado)
  // con las excepciones de vencimiento DECLARADAS por el usuario (P4-b). Sin
  // excepciones, `aplicarVencimientos` devuelve los totales por grupo intactos.
  const plazoActivo = aplicarVencimientos(
    leafRows.filter((r) => r.code.startsWith('1')),
    'activo',
    {
      corriente: sumLeavesByGroupPrefixes(leafRows, '1', ACTIVO_CORRIENTE_GROUPS),
      noCorriente: sumLeavesByGroupPrefixes(leafRows, '1', ACTIVO_NO_CORRIENTE_GROUPS),
    },
  );
  const plazoPasivo = aplicarVencimientos(
    leafRows.filter((r) => r.code.startsWith('2')),
    'pasivo',
    {
      corriente: sumLeavesByGroupPrefixes(leafRows, '2', PASIVO_CORRIENTE_GROUPS),
      noCorriente: sumLeavesByGroupPrefixes(leafRows, '2', PASIVO_NO_CORRIENTE_GROUPS),
    },
  );
  const activoCorriente = plazoActivo.corriente;
  const activoNoCorriente = plazoActivo.noCorriente;
  const pasivoCorriente = plazoPasivo.corriente;
  const pasivoNoCorriente = plazoPasivo.noCorriente;
  const vencimientosAplicados = [...plazoActivo.aplicados, ...plazoPasivo.aplicados];

  const efectivoCuenta11 = sumLeavesByGroupPrefixes(leafRows, '1', new Set(['11']));
  const deudoresCuenta13 = sumLeavesByGroupPrefixes(leafRows, '1', new Set(['13']));
  const cuentasPorPagar23 = sumLeavesByGroupPrefixes(leafRows, '2', new Set(['23']));
  const impuestosCuenta24 = sumLeavesByGroupPrefixes(leafRows, '2', new Set(['24']));
  const obligacionesLaborales25 = sumLeavesByGroupPrefixes(leafRows, '2', new Set(['25']));

  const equationBalance = totalAssets - totalLiabilities - totalEquity;
  const equationBalanced = Math.abs(equationBalance) < 100;

  // -------------------------------------------------------------------------
  // 5.1. Cálculos en BigInt centavos para anclas anti-alucinación.
  // El gate `auditReportEmittable` compara SIEMPRE en cents con tolerancia 0n.
  // -------------------------------------------------------------------------
  // Impuesto causado del periodo: grupo 54 (impuestos como gasto) dentro de
  // clase 5. PUC: 5405 De renta y complementarios, 5410 Industria y comercio.
  const impuestoCausadoPeriodo = sumLeavesByGroupPrefixes(
    leafRows,
    '5',
    new Set(['54']),
  );
  const gastosTotales = totalExpenses + totalCosts + totalProduction;
  // `ingresosNetos` por el mismo motivo que `netIncome`: la Σ de la clase 4 no
  // es una base válida bajo convención de magnitudes, y la UAI alimenta la
  // conciliación fiscal (Art. 26 E.T.).
  const utilidadAntesImpuestos = ingresosNetos - (gastosTotales - impuestoCausadoPeriodo);

  // -------------------------------------------------------------------------
  // Saldo a favor del impuesto de renta (niif-preproceso-19, decisión fase 3).
  //   Créditos de renta = 135505 (anticipo de renta) + 135515 (retención en
  //   la fuente) + 135595 con nombre de renta + 1805 cuyo NOMBRE indica un
  //   crédito de impuesto (en el PUC oficial 1805 es "Bienes de arte y
  //   cultura"). ICA, IVA retenido, sobrantes, contribuciones e impuestos
  //   descontables no son renta. 5404 no existe en el PUC (grupo 54 = 5405).
  //   Saldo a favor = créditos de renta − pasivo 2404, sólo si es positivo.
  // Why: el Art. 850 E.T. exige que un saldo a favor de renta se presente
  // como activo, nunca neteado contra el gasto (clase 54); presentar como
  // "saldo a favor" una obra de arte o un anticipo de ICA es una cifra falsa.
  // -------------------------------------------------------------------------
  // ITEM 1 — cent-exact: créditos y pasivo se netean en centavos.
  const creditosRentaCents = toCents(
    sumLeavesPrecise(leafRows.filter((r) => isRentaCreditAccount(r.code, r.name))),
  );
  const pasivoRenta2404Cents = toCents(
    sumLeavesPrecise(leafRows.filter((r) => r.code.startsWith('2404'))),
  );
  const saldoAFavorCents = creditosRentaCents - pasivoRenta2404Cents;
  const saldoAFavorImpuesto =
    saldoAFavorCents > BigInt(0) ? Number(saldoAFavorCents) / 100 : 0;

  // -------------------------------------------------------------------------
  // Wave 2.F4 — Devoluciones 4175 (Parte 1.3 spec v2.0).
  // Detecta cuentas auxiliares de Clase 4 cuyo código empieza por '4175'.
  // PUC 4175 (Devoluciones en ventas) tiene naturaleza débito — saldos
  // positivos representan ventas devueltas que RESTAN del bruto.
  // NIIF 15 §47: ingresos se presentan netos de devoluciones, descuentos
  // comerciales y rebajas. Decreto 2649/93 PUC grupo 4175.
  // -------------------------------------------------------------------------
  // `ingresosNetos`, `totalDevoluciones` y sus centavos se calculan arriba,
  // junto a `netIncome`, porque todo el P&L cuelga de ellos. Aquí sólo queda la
  // guarda, que necesita `validationReasons` (declarado más abajo que aquel
  // bloque).

  // Guarda NIA 240: la anomalía se DECLARA, no se maquilla. No se clampea a 0
  // ni se invierte el signo — se publica el neto negativo y se bloquea la
  // emisión, para que nadie firme un estado con un ingreso que no existe.
  if (totalDevolucionesCents > ingresosBrutoCents) {
    discrepancies.push({
      location: `Devoluciones 4175 [${period}]`,
      reported: Number(ingresosBrutoCents) / 100,
      calculated: totalDevoluciones,
      difference: ingresosNetos,
      description:
        `[${period}] Las Devoluciones 4175 ($${formatCOP(totalDevoluciones)}) superan los ingresos ` +
        `ordinarios de Clase 4 ($${formatCOP(Number(ingresosBrutoCents) / 100)}), lo que arroja un ` +
        `ingreso neto negativo de $${formatCOP(ingresosNetos)}. Revisar la clasificacion del grupo 4175.`,
    });
    validationReasons.push(
      `[${period}] Devoluciones 4175 (${formatCOP(totalDevoluciones)}) mayores que los ingresos ` +
        `ordinarios de Clase 4 (${formatCOP(Number(ingresosBrutoCents) / 100)}). ` +
        `El ingreso neto resultante es negativo: ${formatCOP(ingresosNetos)}.`,
    );
  }
  // -------------------------------------------------------------------------
  // Wave 2.F4 — Sub-bloque P&L de soporte para KPIs.
  //
  // Auditoría 2026-09 (niif-contrato-01 / niif-preproceso-24; decisión del
  // coordinador, enmienda spec v2.1 del 2026-09-24): el grupo PUC 42 (ingresos
  // NO operacionales — 4210 financieros, 4245 utilidad en venta de PPE, 4250
  // recuperaciones…) va DEBAJO de la utilidad operacional, igual que el 53.
  //   ingresosOperacionalesNetos = Σ 41 (salvo 4175) − devoluciones 4175
  //   utilidadBruta              = ingresosOperacionalesNetos − (clase 6 + 7)
  //   EBIT                       = utilidadBruta − grupo 51 − grupo 52
  //   otrosIngresos (42 y demás grupos de clase 4 distintos del 41)
  //                              = ingresosNetos − ingresosOperacionalesNetos
  // La orientación de signo del 41 es la misma del total ordinario de la
  // clase 4 (convención firmada o de magnitudes), y los otros ingresos se
  // obtienen por diferencia para que 41 + 42 = ingresosNetos al centavo.
  // Fuente: PUC Decreto 2650/1993 (grupo 42 NO OPERACIONALES); NIC 1.82(a) /
  // NIIF PYMES 5.5(a).
  // -------------------------------------------------------------------------
  const gastosOp51 = sumLeavesByGroupPrefixes(leafRows, '5', new Set(['51']));
  const gastosAdmin52 = sumLeavesByGroupPrefixes(leafRows, '5', new Set(['52']));
  const costoVentas6 = totalCosts;
  const costoProduccion7 = totalProduction;
  // `ingresosOperacionalesNetosCents` sale de `ingresosClase4Cents` (arriba).
  const otrosIngresosNoOperacionalesCents = ingresosNetosCents - ingresosOperacionalesNetosCents;
  const ingresosOperacionalesNetos = Number(ingresosOperacionalesNetosCents) / 100;
  const otrosIngresosNoOperacionales = Number(otrosIngresosNoOperacionalesCents) / 100;
  const utilidadBrutaForEbit = ingresosOperacionalesNetos - (costoVentas6 + costoProduccion7);
  const ebit = utilidadBrutaForEbit - gastosOp51 - gastosAdmin52;
  const inventarios14 = sumLeavesByGroupPrefixes(leafRows, '1', new Set(['14']));
  const proveedores22 = sumLeavesByGroupPrefixes(leafRows, '2', new Set(['22']));
  // Gasto financiero = cuenta 5305 (Financieros). Sin 5305 NO se toma el
  // grupo 53 entero: incluiría 5310 pérdida en venta de bienes y 5315
  // extraordinarios, que no son intereses (spec v2 Parte 6: "COBERTURA =
  // EBIT/|5305| solo si 5305 > 0"). 0 ⇒ la cobertura sale N/D (null).
  const saldo5305 = sumLeavesPrecise(
    leafRows.filter((r) => r.code.startsWith('5305')),
  );
  const gastoFinanciero5305 = saldo5305;

  // KPIs averages: en single-period, promedio = actual. preprocessTrialBalance
  // (cuando hay comparative) patchea estos campos con el verdadero promedio.
  const patrimonioPromedio = totalEquity;
  const activoPromedio = totalAssets;
  // Cartera comercial neta (niif-preproceso-25): clientes 1305 + cuentas
  // corrientes comerciales 1310 − deterioro 1399 (contra-activo; se resta su
  // magnitud en cualquier convención). Sin 1305/1310 no hay cartera comercial.
  const clientesNetos = clientesNetosDeHojas(leafRows);
  const mesesPeriodo = mesesDelPeriodo(period);
  const kpis = computeDerivedKpis({
    activoCorriente,
    pasivoCorriente,
    inventarios14,
    pasivo: totalLiabilities,
    activo: totalAssets,
    patrimonio: totalEquity,
    ebit,
    gastoFinanciero5305,
    ingresosNetos,
    ingresosOperacionalesNetos,
    utilidadBruta: utilidadBrutaForEbit,
    utilidadNeta: netIncome,
    patrimonioPromedio,
    activoPromedio,
    clientesNetos,
    costoVentas6,
    costoProduccion7,
    proveedores22,
    mesesPeriodo,
    periodo: period,
    corteDeclarado: notasIngesta.corte,
    fechaSinInterpretar: notasIngesta.fechaSinInterpretar,
  });

  const cents: ControlTotalsCents = {
    activo: toCents(totalAssets),
    pasivo: toCents(totalLiabilities),
    patrimonio: toCents(totalEquity),
    ingresos: toCents(totalRevenue),
    gastos: toCents(gastosTotales),
    utilidadNeta: toCents(netIncome),
    utilidadAntesImpuestos: toCents(utilidadAntesImpuestos),
    impuestoCausado: toCents(impuestoCausadoPeriodo),
    efectivoCuenta11: toCents(efectivoCuenta11),
    saldoAFavorImpuesto: toCents(saldoAFavorImpuesto),
    totalDevoluciones: totalDevolucionesCents,
    // Directo desde el BigInt: `toCents(ingresosNetos)` volvía a pasar por
    // `number` un valor que ya era exacto en centavos.
    ingresosNetos: ingresosNetosCents,
    ingresosOperacionalesNetos: ingresosOperacionalesNetosCents,
  };

  const raw: ControlTotalsRaw = {
    activo: toRawString(totalAssets),
    pasivo: toRawString(totalLiabilities),
    patrimonio: toRawString(totalEquity),
    ingresos: toRawString(totalRevenue),
    gastos: toRawString(gastosTotales),
    utilidadNeta: toRawString(netIncome),
    utilidadAntesImpuestos: toRawString(utilidadAntesImpuestos),
    impuestoCausado: toRawString(impuestoCausadoPeriodo),
    efectivoCuenta11: toRawString(efectivoCuenta11),
    saldoAFavorImpuesto: toRawString(saldoAFavorImpuesto),
    totalDevoluciones: toRawString(totalDevoluciones),
    ingresosNetos: toRawString(ingresosNetos),
  };

  const controlTotals: ControlTotals = {
    activo: totalAssets,
    activoCorriente,
    activoNoCorriente,
    pasivo: totalLiabilities,
    pasivoCorriente,
    pasivoNoCorriente,
    patrimonio: totalEquity,
    ingresos: totalRevenue,
    gastos: gastosTotales,
    utilidadNeta: netIncome,
    efectivoCuenta11,
    deudoresCuenta13,
    cuentasPorPagar23,
    impuestosCuenta24,
    obligacionesLaborales25,
    cents,
    raw,
    // Wave 2.F4 — campos nuevos para fuente única de KPIs.
    totalDevoluciones,
    ingresosNetos,
    ingresosOperacionalesNetos,
    otrosIngresosNoOperacionales,
    utilidadBruta: utilidadBrutaForEbit,
    ebit,
    inventarios14,
    proveedores22,
    costoVentas6,
    costoProduccion7,
    gastoFinanciero5305,
    patrimonioPromedio,
    activoPromedio,
    clientesNetos,
    mesesPeriodo,
    clasificacionSupuesta: textoClasificacionCorriente(vencimientosAplicados),
    ...kpis,
  };

  // -------------------------------------------------------------------------
  // 6. equityBreakdown
  // -------------------------------------------------------------------------
  const equityBreakdown = extractEquityBreakdownForView(view, discrepancies, leafRows);

  // -------------------------------------------------------------------------
  // 7. Cross-checks (riesgo liquidez, ecuacion patrimonial, etc.)
  // -------------------------------------------------------------------------
  const LIQUIDEZ_TOL = Math.max(Math.abs(controlTotals.activo) * 0.01, 100_000);
  const liquidezGap = controlTotals.activoCorriente - controlTotals.pasivoCorriente;
  const hasLiquidezRisk =
    controlTotals.pasivoCorriente > 0 &&
    liquidezGap < 0 &&
    Math.abs(liquidezGap) > LIQUIDEZ_TOL;

  if (hasLiquidezRisk) {
    // recalculo-final-07: AC < PC es un HALLAZGO financiero del cliente, no un
    // error de los datos. Antes era motivo bloqueante: un ESF cuadrado sin P&G
    // (R8 no actúa, el Bridge no degrada) recibía 422, y el mismo caso con P&G
    // pasaba como informativo. Ahora el trato es igual con o sin P&G: ajuste
    // informativo + discrepancia "Riesgo de Liquidez" para el análisis.
    adjustments.push(
      `[${period}] Riesgo de liquidez (hallazgo informativo, no bloqueante): Activo Corriente ` +
        `($${formatCOP(controlTotals.activoCorriente)}) < Pasivo Corriente ` +
        `($${formatCOP(controlTotals.pasivoCorriente)}). Brecha: $${formatCOP(Math.abs(liquidezGap))}.`,
    );
    discrepancies.push({
      location: `Riesgo de Liquidez (Big Four) [${period}]`,
      reported: controlTotals.pasivoCorriente,
      calculated: controlTotals.activoCorriente,
      difference: liquidezGap,
      description:
        `AC ($${formatCOP(controlTotals.activoCorriente)}) < PC ` +
        `($${formatCOP(controlTotals.pasivoCorriente)}).`,
    });
  }

  const ECUACION_TOL = 1000;
  const BLOCKING_TOL = Math.max(Math.abs(controlTotals.activo) * 0.01, 100_000);
  const equationDiff = controlTotals.activo - (controlTotals.pasivo + controlTotals.patrimonio);

  if (Math.abs(equationDiff) > ECUACION_TOL) {
    discrepancies.push({
      location: `Ecuacion Patrimonial [${period}]`,
      reported: controlTotals.pasivo + controlTotals.patrimonio,
      calculated: controlTotals.activo,
      difference: equationDiff,
      description: `[${period}] Ecuacion patrimonial descuadrada: Activo $${formatCOP(controlTotals.activo)} != Pasivo $${formatCOP(controlTotals.pasivo)} + Patrimonio $${formatCOP(controlTotals.patrimonio)} (diferencia $${formatCOP(equationDiff)})`,
    });

    if (Math.abs(equationDiff) > BLOCKING_TOL) {
      validationReasons.push(
        `[${period}] La ecuacion contable no cuadra: Activo (${formatCOP(controlTotals.activo)}) ` +
          `!= Pasivo (${formatCOP(controlTotals.pasivo)}) + Patrimonio (${formatCOP(controlTotals.patrimonio)}). ` +
          `Diferencia: ${formatCOP(equationDiff)}.`,
      );

      if (netIncome !== 0 && Math.abs(equationDiff - netIncome) < BLOCKING_TOL * 0.5) {
        validationReasons.push(
          `[${period}] El descuadre coincide aproximadamente con la utilidad del ejercicio. ` +
            `Posiblemente el balance fue exportado antes del cierre (3605 sin trasladar).`,
        );
        suggestedAccounts.push('3605 — Utilidad del ejercicio (Clase 3)');
      }

      if (Math.abs(controlTotals.patrimonio) < Math.abs(controlTotals.activo) * 0.01) {
        validationReasons.push(
          `[${period}] Total Patrimonio (${formatCOP(controlTotals.patrimonio)}) < 1% del Activo. ` +
            `Revisa si faltan cuentas 31xx/33xx/37xx.`,
        );
        suggestedAccounts.push(
          '3105 — Capital suscrito y pagado',
          '3115 — Aportes sociales',
          '3305 — Reserva legal',
          '3705 — Utilidades acumuladas',
        );
      }
    }
  } else if (!equationBalanced) {
    discrepancies.push({
      location: `Ecuacion Patrimonial (tolerancia fina) [${period}]`,
      reported: 0,
      calculated: equationBalance,
      difference: equationBalance,
      description: `[${period}] Activo - Pasivo - Patrimonio = $${formatCOP(equationBalance)} (posible redondeo).`,
    });
  }

  const UTIL_TOL = 1000;
  if (equityBreakdown.utilidadEjercicio !== undefined) {
    const diffUtil = controlTotals.utilidadNeta - equityBreakdown.utilidadEjercicio;
    if (Math.abs(diffUtil) > UTIL_TOL) {
      discrepancies.push({
        location: `Consistencia Utilidad [${period}]`,
        reported: equityBreakdown.utilidadEjercicio,
        calculated: controlTotals.utilidadNeta,
        difference: diffUtil,
        description: `[${period}] Utilidad neta P&L $${formatCOP(controlTotals.utilidadNeta)} difiere de Utilidad del ejercicio en patrimonio $${formatCOP(equityBreakdown.utilidadEjercicio)}.`,
      });
    }
  }

  for (let c = 1; c <= 6; c++) {
    const classData = classMap.get(c);
    const classTotal = getClassTotal(c);
    const hasClassRows = view.some((r) => r.code.startsWith(String(c)));
    if (classTotal === 0 && hasClassRows && classData && classData.leaves.length === 0) {
      discrepancies.push({
        location: `Clase ${c} (${PUC_CLASS_NAMES[c]}) [${period}]`,
        reported: 0,
        calculated: 0,
        difference: 0,
        description: `[${period}] Total de Clase ${c} es $0 pero existen filas con codigo ${c}xxx. Posible fallo de parseo.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 8. missingExpectedAccounts
  // -------------------------------------------------------------------------
  const missingExpectedAccounts = buildMissingAccountsForView(view, leafRows, classes);

  const summary = {
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalRevenue,
    totalExpenses,
    totalCosts,
    totalProduction,
    netIncome,
    equationBalance,
    equationBalanced,
  };

  const validation: ValidationResult = {
    blocking: validationReasons.length > 0,
    reasons: validationReasons,
    suggestedAccounts: Array.from(new Set(suggestedAccounts)),
    adjustments,
    integrityReasons,
  };

  return {
    period,
    // Wave 2.F4 — Parte 2.1 VERIFICACIÓN 4: tipo de período inferido del label.
    // niif-preproceso-29: la fecha de corte declarada en el archivo prevalece
    // sobre una etiqueta que sólo trae el año ("2025" → 'cerrado' si el título
    // dice "De Enero 2025 a Diciembre 2025").
    periodoTipo: notasIngesta.corte?.tipo ?? inferPeriodoTipo(period),
    ...(notasIngesta.corte ? { corteDeclarado: notasIngesta.corte } : {}),
    ...(notasIngesta.fechaSinInterpretar ? { fechaSinInterpretar: notasIngesta.fechaSinInterpretar } : {}),
    ...(vencimientosAplicados.length > 0 ? { vencimientosAplicados } : {}),
    classes,
    controlTotals,
    equityBreakdown,
    summary,
    validation,
    discrepancies,
    missingExpectedAccounts,
    findings: {},
  };
}

// ---------------------------------------------------------------------------
// equityBreakdown helpers (refactor: trabajan sobre la "vista" de un periodo)
// ---------------------------------------------------------------------------

interface ViewRow {
  code: string;
  name: string;
  level: string;
  transactional: boolean;
  balance: number;
  vencimiento?: Vencimiento;
}

/**
 * Filas hoja de una vista, con la MISMA regla que `buildSnapshotForPeriod`
 * (auxiliares + subcuentas sin auxiliares). Sólo se usa cuando el llamador no
 * entrega las hojas (wrapper deprecado `extractEquityBreakdown`).
 */
function selectLeafRowsForEquity(view: ViewRow[]): ViewRow[] {
  const auxiliarRows = view.filter((r) => r.transactional || r.level === 'Auxiliar');
  const auxiliarCodes = new Set(auxiliarRows.map((r) => r.code));
  const orphanSubcuentas = view.filter(
    (r) =>
      r.level === 'Subcuenta' &&
      !auxiliarCodes.has(r.code) &&
      !auxiliarRows.some((aux) => aux.code !== r.code && aux.code.startsWith(r.code)),
  );
  return [...auxiliarRows, ...orphanSubcuentas];
}

/**
 * Desglose del patrimonio por grupo PUC (Decreto 2650/1993).
 *
 * Auditoría 2026-09:
 *   - niif-preproceso-13: 3105 es "Capital suscrito y pagado" (neto de 310510
 *     por suscribir y 310515 suscrito por cobrar), no "capital autorizado".
 *     Se publicaba como `capitalAutorizado` y `capitalSuscritoPagado` quedaba
 *     vacío en SAS y S.A.; el tope de reserva legal (Art. 452 C.Co.) no era
 *     evaluable. `capitalSuscritoPagado` = grupo 31 completo; 310505 queda
 *     como dato informativo en `capitalAutorizado`.
 *   - recalculo-08: el desglose sólo mapeaba 31/33/36/37 parcial y R5 anclaba
 *     el patrimonio a esa suma, borrando 32/34/35/38 y otras 37xx. Ahora cada
 *     grupo tiene su componente y todo se calcula sobre las MISMAS hojas que
 *     el total de la clase 3, así la suma de componentes ES el patrimonio.
 *   - niif-preproceso-12: 3610 (Pérdida del ejercicio) es resultado del
 *     ejercicio, no "utilidades acumuladas".
 *
 * Si una cuenta agregada (nivel Cuenta) no coincide con la suma de sus hojas,
 * se registra la discrepancia y se usa la suma de hojas: es la base del total
 * de la clase 3 y del gate.
 */
function extractEquityBreakdownForView(
  view: ViewRow[],
  discrepancies: Discrepancy[],
  leafRows?: ViewRow[],
): EquityBreakdown {
  const breakdown: EquityBreakdown = {};
  const leaves = (leafRows ?? selectLeafRowsForEquity(view)).filter((r) =>
    r.code.startsWith('3'),
  );

  const sumLeaves = (predicate: (code: string) => boolean): number | undefined => {
    const rows = leaves.filter((r) => predicate(r.code));
    if (!rows.some((r) => r.balance !== 0)) return undefined;
    return sumLeavesPrecise(rows);
  };
  const inGroup = (group: string) => (code: string) => code.startsWith(group);

  // Discrepancia agregado ↔ hojas por cada Cuenta (4 dígitos) de la clase 3.
  for (const cuenta of view) {
    if (cuenta.level !== 'Cuenta' || !cuenta.code.startsWith('3') || cuenta.balance === 0) continue;
    const hojas = leaves.filter((r) => r.code !== cuenta.code && r.code.startsWith(cuenta.code));
    if (hojas.length === 0) continue;
    const suma = sumLeavesPrecise(hojas);
    if (Math.abs(suma - cuenta.balance) > 1) {
      discrepancies.push({
        location: `Patrimonio ${cuenta.code} ${cuenta.name}`,
        reported: cuenta.balance,
        calculated: suma,
        difference: suma - cuenta.balance,
        description:
          `Saldo agregado (${cuenta.code}) $${formatCOP(cuenta.balance)} difiere de la suma de ` +
          `sus auxiliares $${formatCOP(suma)}. El desglose del patrimonio usa la suma de ` +
          `auxiliares (misma base que el total de la clase 3).`,
      });
    }
  }

  const capitalAutorizado = sumLeaves(inGroup('310505'));
  if (capitalAutorizado !== undefined) breakdown.capitalAutorizado = capitalAutorizado;

  const capitalSocial = sumLeaves(inGroup('31'));
  if (capitalSocial !== undefined) breakdown.capitalSuscritoPagado = capitalSocial;

  const superavitCapital = sumLeaves(inGroup('32'));
  if (superavitCapital !== undefined) breakdown.superavitCapital = superavitCapital;

  const reservaLegal = sumLeaves(inGroup('3305'));
  if (reservaLegal !== undefined) breakdown.reservaLegal = reservaLegal;

  const otrasReservas = sumLeaves((c) => c.startsWith('33') && !c.startsWith('3305'));
  if (otrasReservas !== undefined) breakdown.otrasReservas = otrasReservas;

  const revalorizacion = sumLeaves(inGroup('34'));
  if (revalorizacion !== undefined) breakdown.revalorizacionPatrimonio = revalorizacion;

  const dividendosEnAcciones = sumLeaves(inGroup('35'));
  if (dividendosEnAcciones !== undefined) breakdown.dividendosDecretadosEnAcciones = dividendosEnAcciones;

  // Grupo 36 — Resultados del ejercicio: 3605 utilidad y 3610 PÉRDIDA. Si R8
  // (cierre virtual) encuentra que el grupo 36 guarda un resultado ANTERIOR,
  // lo reclasifica a `utilidadesAcumuladas` (Art. 151 C.Co.).
  const resultadoEjercicio = sumLeaves(inGroup('36'));
  if (resultadoEjercicio !== undefined) breakdown.utilidadEjercicio = resultadoEjercicio;

  const resultadosAnteriores = sumLeaves(inGroup('37'));
  if (resultadosAnteriores !== undefined) breakdown.utilidadesAcumuladas = resultadosAnteriores;

  const superavitValorizaciones = sumLeaves(inGroup('38'));
  if (superavitValorizaciones !== undefined) breakdown.superavitValorizaciones = superavitValorizaciones;

  const MAPPED_GROUPS = ['31', '32', '33', '34', '35', '36', '37', '38'];
  const otras = sumLeaves((c) => !MAPPED_GROUPS.some((g) => c.startsWith(g)));
  if (otras !== undefined) breakdown.otrasCuentasPatrimonio = otras;

  return breakdown;
}

/**
 * @deprecated Wrapper para retrocompatibilidad. Usa
 * `extractEquityBreakdownForView` internamente. Espera filas con `.balance`.
 */
export function extractEquityBreakdown(
  rows: { code: string; name: string; level: string; transactional?: boolean; balance: number }[],
  discrepancies: Discrepancy[],
): EquityBreakdown {
  const view: ViewRow[] = rows.map((r) => ({
    code: r.code,
    name: r.name,
    level: r.level,
    transactional: !!r.transactional,
    balance: r.balance,
  }));
  return extractEquityBreakdownForView(view, discrepancies);
}

// ---------------------------------------------------------------------------
// extractCompanyMetadata — Pulido NIIF PYME Grupo 2
// ---------------------------------------------------------------------------
// Extrae razón social y NIT de los encabezados del balance de prueba (filas
// previas a la cabecera de columnas en el Excel/CSV).
//
// Reglas:
//   1. NIT: cualquier secuencia "NIT" + separadores + 8-10 dígitos. El último
//      dígito posterior a un guión o punto se interpreta como DV.
//   2. Razón social: línea que matchee "Razón Social" / "RAZON SOCIAL" /
//      "Empresa" / "Compañía" / "Nombre" o el texto inmediatamente posterior
//      a NIT en archivos que ponen NIT primero, sin labels (heurística).
//   3. Si no se detecta NIT o razón social en el texto, se devuelve `null`
//      en cada campo respectivo. NUNCA un fallback / placeholder.
//
// La función NO valida el DV — la verificación DV vive en
// `src/lib/validation/nit-validator.ts` y la corre el gate
// `auditReportEmittable` (V6).
// ---------------------------------------------------------------------------

const NIT_REGEX = /\bNIT[\.: \t-]*([0-9](?:[0-9.,\s]*[0-9])?)\s*[-.]\s*(\d)\b/i;
const NIT_FALLBACK_REGEX = /\bNIT[\.: \t-]*([0-9][0-9.,\s]{6,14}[0-9])\b/i;
/**
 * Línea que empieza con un patrón "NNNNNNNNN-D" (NIT canónico) sin label
 * "NIT". Típico cuando el balance Excel pone el NIT en una fila propia
 * separada del label. Acepta puntos miles opcionales.
 */
const NIT_BARE_LINE_REGEX =
  /^\s*([0-9][0-9.]{6,14}[0-9])\s*-\s*(\d)\s*(?:,|$)/;
const RAZON_SOCIAL_REGEX =
  /(?:raz[oó]n\s+social|empresa|compa[ñn][ií]a|nombre)\s*[:.\t-]+\s*([^\n,;|]+)/i;

export function extractCompanyMetadata(rawText: string): ExtractedCompanyMetadata {
  const result: ExtractedCompanyMetadata = {
    razonSocialFromFile: null,
    nitFromFile: null,
    nitBodyDigits: null,
    nitCheckDigit: null,
    sourceLines: [],
  };

  if (!rawText || typeof rawText !== 'string') return result;

  // Sólo escaneamos las primeras 50 líneas no vacías — el header del balance
  // de prueba siempre vive en las primeras filas.
  const allLines = rawText.split(/\r?\n/);
  const headerLines = allLines
    .slice(0, 100)
    .filter((l) => l.trim().length > 0)
    .slice(0, 50);

  // Buscar NIT con DV (formato preferido).
  for (const line of headerLines) {
    const m = line.match(NIT_REGEX);
    if (m) {
      const body = m[1].replace(/[\s.,]/g, '');
      const dv = m[2].trim();
      if (body.length >= 6 && body.length <= 12 && /^\d+$/.test(body) && /^\d$/.test(dv)) {
        result.nitBodyDigits = body;
        result.nitCheckDigit = dv;
        result.nitFromFile = `${formatNitWithDots(body)}-${dv}`;
        result.sourceLines.push(line.trim());
        break;
      }
    }
  }

  // Fallback adicional: NIT en línea propia sin label "NIT" (típico
  // cuando el Excel separa el NIT en una fila dedicada).
  if (!result.nitFromFile) {
    for (const line of headerLines) {
      const m = line.match(NIT_BARE_LINE_REGEX);
      if (m) {
        const body = m[1].replace(/[\s.,]/g, '');
        const dv = m[2].trim();
        if (body.length >= 6 && body.length <= 12 && /^\d+$/.test(body) && /^\d$/.test(dv)) {
          result.nitBodyDigits = body;
          result.nitCheckDigit = dv;
          result.nitFromFile = `${formatNitWithDots(body)}-${dv}`;
          result.sourceLines.push(line.trim());
          break;
        }
      }
    }
  }

  // Fallback: NIT sin DV explícito (sólo dígitos consecutivos).
  if (!result.nitFromFile) {
    for (const line of headerLines) {
      const m = line.match(NIT_FALLBACK_REGEX);
      if (m) {
        const digits = m[1].replace(/[\s.,]/g, '');
        if (digits.length >= 8 && digits.length <= 11 && /^\d+$/.test(digits)) {
          // Asumimos que el último dígito es DV si la longitud es típica
          // (9-11 dígitos sugiere body+DV).
          if (digits.length >= 9) {
            result.nitBodyDigits = digits.slice(0, -1);
            result.nitCheckDigit = digits.slice(-1);
            result.nitFromFile = `${formatNitWithDots(result.nitBodyDigits)}-${result.nitCheckDigit}`;
          } else {
            result.nitBodyDigits = digits;
            result.nitCheckDigit = null;
            result.nitFromFile = formatNitWithDots(digits);
          }
          result.sourceLines.push(line.trim());
          break;
        }
      }
    }
  }

  // Razón social explícita por label.
  for (const line of headerLines) {
    const m = line.match(RAZON_SOCIAL_REGEX);
    if (m) {
      const candidate = sanitizeRazonSocial(m[1]);
      if (candidate.length >= 3) {
        result.razonSocialFromFile = candidate;
        result.sourceLines.push(line.trim());
        break;
      }
    }
  }

  // Heurística adicional: si encontramos NIT pero no razón social, buscar
  // una línea adyacente (anterior o siguiente) que parezca contener el
  // nombre de la empresa (todo en MAYÚSCULAS, sin código de cuenta, sin
  // labels conocidos, con sufijo societario tipo SAS / S.A. / LTDA / E.U.).
  if (result.nitFromFile && !result.razonSocialFromFile) {
    const SOCIETARIO_REGEX = /\b(S\.?A\.?S\.?|S\.?A\.?|LTDA\.?|E\.?U\.?|S\.?C\.?S\.?)\b/i;
    for (const line of headerLines) {
      const trimmed = line.trim();
      // Tope generoso: archivos exportados con Excel pueden repetir el mismo
      // valor 6+ veces a lo largo de las columnas (celda fusionada → CSV
      // produce "Empresa,Empresa,Empresa,...,Empresa"). El sanitize posterior
      // corta en la primera coma, así que importa cubrir la longitud cruda.
      if (trimmed.length < 5 || trimmed.length > 500) continue;
      // Saltamos líneas con códigos PUC (números > 5 dígitos consecutivos).
      if (/\b\d{5,}\b/.test(trimmed)) continue;
      // Saltamos líneas con labels conocidos.
      if (/\b(NIT|raz[oó]n|empresa|compa[ñn][ií]a|nombre|fecha|periodo|cierre)\b/i.test(trimmed)) {
        // permitido si la línea contiene además sufijo societario
        if (!SOCIETARIO_REGEX.test(trimmed)) continue;
      }
      if (SOCIETARIO_REGEX.test(trimmed)) {
        const candidate = sanitizeRazonSocial(trimmed);
        if (candidate.length >= 5) {
          result.razonSocialFromFile = candidate;
          result.sourceLines.push(trimmed);
          break;
        }
      }
    }
  }

  return result;
}

function formatNitWithDots(body: string): string {
  // 9 dígitos → "NNN.NNN.NNN"; ajustar para casos cortos preservando agrupación de 3.
  const reversed = body.split('').reverse().join('');
  const grouped = reversed.match(/.{1,3}/g) ?? [];
  return grouped.map((g) => g.split('').reverse().join('')).reverse().join('.');
}

function sanitizeRazonSocial(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[,;|].*$/, '')
    .trim();
}

/**
 * Convierte un monto en pesos colombianos a BigInt centavos.
 * `Math.round(value * 100)` corrige el floating-point drift al redondear al
 * centavo más cercano. Para enteros (típico en balances PUC sin decimales),
 * el resultado es exacto.
 */
function toCents(value: number): bigint {
  if (!Number.isFinite(value)) return BigInt(0);
  // Math.round corrige drift floating-point al redondear al centavo.
  return BigInt(Math.round(value * 100));
}

// ---------------------------------------------------------------------------
// Wave 2.F4 — KPIs deterministicos derivados (Parte 6 spec v2.0).
// ---------------------------------------------------------------------------
// 14 ratios calculados desde controlTotals como fuente única de verdad. Cuando
// el denominador es 0 o anómalo, el KPI devuelve `null` para que el renderer
// pinte 'ND' explícitamente — nunca un fallback silencioso (NIA 240 §A1-A6:
// la ausencia de información se DECLARA, no se enmascara).
// ---------------------------------------------------------------------------

/** Tolerancia para considerar un denominador "anómalo" (< 1% ingresos netos). */
const KPI_ANOMALY_TOL_PCT = 0.01;

interface DerivedKpiInputs {
  activoCorriente: number;
  pasivoCorriente: number;
  inventarios14: number;
  pasivo: number;
  activo: number;
  patrimonio: number;
  ebit: number;
  gastoFinanciero5305: number;
  /** Ingresos netos totales de la clase 4 (base del margen neto). */
  ingresosNetos: number;
  /** Grupo 41 − 4175: base de márgenes bruto/operativo, rotación y días de cartera. */
  ingresosOperacionalesNetos: number;
  utilidadBruta: number;
  utilidadNeta: number;
  patrimonioPromedio: number;
  activoPromedio: number;
  /** 1305 + 1310 − |1399|; `null` sin cuentas de clientes. */
  clientesNetos: number | null;
  costoVentas6: number;
  costoProduccion7: number;
  proveedores22: number;
  /** Meses de resultados del periodo (`mesesDelPeriodo`); `null` si no se derivan. */
  mesesPeriodo: number | null;
  /** Etiqueta del periodo, para la nota de base y los motivos. */
  periodo: string;
  /**
   * `false` cuando el snapshot es un saldo de apertura (ingesta-09): sin P&G
   * del periodo, todo KPI que use flujos es N/D con motivo.
   */
  pygDisponible?: boolean;
  /** Fecha de corte declarada en el archivo (P4-c): la nota de base la cita. */
  corteDeclarado?: NotaIngesta['corte'];
  /** ICU-03: fecha del archivo que no se interpretó como corte (se cita). */
  fechaSinInterpretar?: string;
}

interface DerivedKpis {
  razonCorriente: number | null;
  pruebaAcida: number | null;
  endeudamientoTotal: number | null;
  apalancamientoFinanciero: number | null;
  coberturaIntereses: number | null;
  margenBruto: number | null;
  margenOperativo: number | null;
  margenNeto: number | null;
  roe: number | null;
  roa: number | null;
  rotacionActivos: number | null;
  diasCartera: number | null;
  diasInventario: number | null;
  diasProveedores: number | null;
  cicloConversionEfectivo: number | null;
  capitalTrabajo: number;
  diasPeriodo: number | null;
  kpiBaseNota: string;
  /** Motivo por KPI cuando el valor es `null` por una base no interpretable. */
  kpiNdMotivos: KpiNdMotivos;
}

/** KPIs que pueden publicarse N/D con motivo. */
export type KpiNdKey =
  | 'roe'
  | 'roa'
  | 'apalancamientoFinanciero'
  | 'rotacionActivos'
  | 'margenBruto'
  | 'margenOperativo'
  | 'diasCartera'
  | 'diasInventario'
  | 'diasProveedores'
  | 'cicloConversionEfectivo'
  | 'ebitda';

/** Motivo legible (es) de un KPI publicado como N/D. */
export type KpiNdMotivos = Partial<Record<KpiNdKey, string>>;

const MOTIVO_PATRIMONIO_PROMEDIO_NO_POSITIVO =
  'N/D — patrimonio promedio ≤ 0 (patrimonio negativo o nulo): el ROE no es interpretable';
const MOTIVO_PATRIMONIO_NO_POSITIVO =
  'N/D — patrimonio ≤ 0 (insolvencia técnica): el apalancamiento no es interpretable';
const MOTIVO_INGRESOS_OPERACIONALES_NO_POSITIVOS =
  'N/D — ingresos operacionales netos (grupo 41 − devoluciones 4175) ≤ 0: sin base para el indicador';
const MOTIVO_SIN_CLIENTES =
  'N/D — el balance no trae cuentas de clientes (1305 / 1310): sin cartera comercial para los días de cartera';
const MOTIVO_COSTOS_ANOMALOS =
  'N/D — base de costos insuficiente (clases 6 + 7 < 1 % de los ingresos): ciclo operativo no confiable';
const MOTIVO_CICLO_INCOMPLETO =
  'N/D — el ciclo de conversión requiere días de cartera, inventario y proveedores calculables';
const MOTIVO_PYG_APERTURA =
  'N/D — el periodo proviene de una columna de saldo inicial/anterior: no hay P&G del periodo ' +
  'para este indicador';

function motivoPeriodoNoAnualizado(periodo: string): string {
  return (
    `N/D — periodo parcial no anualizado: la etiqueta "${periodo}" no permite derivar los ` +
    'meses del periodo y el indicador compara un flujo del periodo con un saldo (base 365 días)'
  );
}


/** Hoja mínima (código + saldo del periodo) para los helpers de agregación. */
interface HojaSaldo {
  code: string;
  balance: number;
}

/** Totales de la clase 4 en centavos (ver `ingresosClase4Cents`). */
export interface IngresosClase4Cents {
  /** |Σ firmada de las ordinarias (clase 4 sin 4175)|. */
  ingresosBrutoCents: bigint;
  /** |Σ firmada de las devoluciones 4175|. */
  totalDevolucionesCents: bigint;
  /** Ingresos netos de devoluciones (base de la utilidad neta). */
  ingresosNetosCents: bigint;
  /** Grupo 41 (sin 4175) − devoluciones 4175 (base de la utilidad bruta). */
  ingresosOperacionalesNetosCents: bigint;
}

/**
 * Ingresos de la clase 4 en centavos, con la regla del preprocesador: la
 * magnitud sale del TOTAL firmado de cada bloque (ordinarias, devoluciones
 * 4175), nunca cuenta por cuenta, y el grupo 41 se orienta con el signo del
 * total ordinario (convención firmada o de magnitudes). Fuente única para
 * `buildSnapshotForPeriod` y el Doctor de Datos (`repair/adjustments.ts`).
 */
export function ingresosClase4Cents(leaves: readonly HojaSaldo[]): IngresosClase4Cents {
  const ZERO = BigInt(0);
  const abs = (v: bigint): bigint => (v < ZERO ? -v : v);
  let ordinarias = ZERO;
  let grupo41 = ZERO;
  let devoluciones = ZERO;
  for (const r of leaves) {
    if (!r.code.startsWith('4')) continue;
    const cents = toCents(r.balance);
    if (r.code.startsWith('4175')) {
      devoluciones += cents;
      continue;
    }
    ordinarias += cents;
    if (r.code.startsWith('41')) grupo41 += cents;
  }
  const ingresosBrutoCents = abs(ordinarias);
  const totalDevolucionesCents = abs(devoluciones);
  const signoOrdinarias = ordinarias < ZERO ? BigInt(-1) : BigInt(1);
  return {
    ingresosBrutoCents,
    totalDevolucionesCents,
    ingresosNetosCents: ingresosBrutoCents - totalDevolucionesCents,
    ingresosOperacionalesNetosCents: grupo41 * signoOrdinarias - totalDevolucionesCents,
  };
}

/**
 * Cartera comercial neta (niif-preproceso-25): clientes 1305 + cuentas
 * corrientes comerciales 1310 − deterioro 1399 (contra-activo: se resta su
 * magnitud en cualquier convención). `null` sin cuentas 1305/1310.
 */
export function clientesNetosDeHojas(leaves: readonly HojaSaldo[]): number | null {
  const clientes = leaves.filter((r) => r.code.startsWith('1305') || r.code.startsWith('1310'));
  if (clientes.length === 0) return null;
  const deterioro = leaves.filter((r) => r.code.startsWith('1399'));
  return sumLeavesPrecise(clientes) - Math.abs(sumLeavesPrecise(deterioro));
}

/**
 * Recalcula los KPIs derivados de un snapshot (post-curator): promedios con
 * el periodo anterior, ratios de `computeDerivedKpis` y EBITDA con la
 * definición única de `pillars/ebitda.ts`. Lo usan `preprocessTrialBalance` y
 * el Doctor de Datos tras aplicar ajustes, para que ambos publiquen lo mismo.
 */
export function refreshDerivedKpis(snap: PeriodSnapshot, prev: PeriodSnapshot | null): void {
  const ct = snap.controlTotals;
  const patrimonioPromedio =
    prev !== null ? (ct.patrimonio + prev.controlTotals.patrimonio) / 2 : ct.patrimonio;
  const activoPromedio = prev !== null ? (ct.activo + prev.controlTotals.activo) / 2 : ct.activo;
  ct.patrimonioPromedio = patrimonioPromedio;
  ct.activoPromedio = activoPromedio;
  Object.assign(
    ct,
    computeDerivedKpis({
      ...kpiInputsFromTotals(ct, snap.period, patrimonioPromedio, activoPromedio),
      pygDisponible: snap.saldosDeApertura !== true,
      corteDeclarado: snap.corteDeclarado,
      fechaSinInterpretar: snap.fechaSinInterpretar,
    }),
  );
  // EBITDA con la definición ÚNICA de `pillars/ebitda.ts` (ratios-kpis-05 /
  // ratios-kpis-24): EBIT + D&A sobre las hojas del snapshot, sin las cuentas
  // virtuales del curator. Sin grupo 41 (o en un saldo de apertura) es N/D.
  if (snap.saldosDeApertura === true) {
    ct.ebitda = null;
    ct.kpiNdMotivos = { ...ct.kpiNdMotivos, ebitda: MOTIVO_PYG_APERTURA };
    return;
  }
  const ebitda = computeEbitda(snap);
  ct.ebitda = ebitda.ebitda;
  if (ebitda.ebitda === null && ebitda.reason) {
    ct.kpiNdMotivos = { ...ct.kpiNdMotivos, ebitda: `N/D — ${ebitda.reason}` };
  }
}

/** Entradas de `computeDerivedKpis` desde un `controlTotals` ya construido. */
function kpiInputsFromTotals(
  ct: ControlTotals,
  periodo: string,
  patrimonioPromedio: number,
  activoPromedio: number,
): DerivedKpiInputs {
  const ingresosNetos = ct.ingresosNetos ?? Math.abs(ct.ingresos);
  return {
    activoCorriente: ct.activoCorriente,
    pasivoCorriente: ct.pasivoCorriente,
    inventarios14: ct.inventarios14 ?? 0,
    pasivo: ct.pasivo,
    activo: ct.activo,
    patrimonio: ct.patrimonio,
    ebit: ct.ebit ?? 0,
    gastoFinanciero5305: ct.gastoFinanciero5305 ?? 0,
    ingresosNetos,
    ingresosOperacionalesNetos: ct.ingresosOperacionalesNetos ?? ingresosNetos,
    utilidadBruta: ct.utilidadBruta ?? 0,
    utilidadNeta: ct.utilidadNeta,
    patrimonioPromedio,
    activoPromedio,
    clientesNetos: ct.clientesNetos ?? null,
    costoVentas6: ct.costoVentas6 ?? 0,
    costoProduccion7: ct.costoProduccion7 ?? 0,
    proveedores22: ct.proveedores22 ?? 0,
    mesesPeriodo: ct.mesesPeriodo === undefined ? mesesDelPeriodo(periodo) : ct.mesesPeriodo,
    periodo,
  };
}

/** KPIs que dependen de un flujo del periodo (P&G). */
const KPIS_DE_FLUJO = [
  'margenBruto',
  'margenOperativo',
  'roe',
  'roa',
  'rotacionActivos',
  'diasCartera',
  'diasInventario',
  'diasProveedores',
  'cicloConversionEfectivo',
] as const satisfies readonly KpiNdKey[];

function computeDerivedKpis(inputs: DerivedKpiInputs): DerivedKpis {
  const safeDiv = (num: number, den: number): number | null => {
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    return num / den;
  };
  const pct = (r: number | null): number | null => (r === null ? null : r * 100);

  // Auditoría 2026-09 (ratios-kpis-07): con patrimonio negativo el ROE y el
  // apalancamiento cambian de signo y dejan de medir lo que dicen — una
  // pérdida sobre patrimonio promedio negativo publicaba ROE +451 % como KPI
  // VINCULANTE. Sin base interpretable, el KPI es N/D con motivo.
  const kpiNdMotivos: KpiNdMotivos = {};
  const nd = (key: KpiNdKey, motivo: string): null => {
    kpiNdMotivos[key] = motivo;
    return null;
  };
  const patrimonioPromedioNoPositivo = !(inputs.patrimonioPromedio > 0);
  const patrimonioNoPositivo = !(inputs.patrimonio > 0);

  // Auditoría 2026-09 (niif-preproceso-24, enmienda spec v2.1): los márgenes
  // bruto/operativo, la rotación y los días de cartera se miden sobre los
  // ingresos OPERACIONALES netos (41 − 4175); el grupo 42 queda debajo de la
  // utilidad operacional. El margen neto conserva los ingresos netos totales.
  const ingresosBase = Math.abs(inputs.ingresosNetos);
  const ingresosOp = inputs.ingresosOperacionalesNetos;
  const ingresosOpValidos = Number.isFinite(ingresosOp) && ingresosOp > 0;

  // Auditoría 2026-09 (ratios-kpis-18, niif-preproceso-25): los KPIs que
  // comparan un flujo del periodo con un saldo se anualizan × 12/meses sobre
  // base 365 días. Sin meses derivables el KPI es N/D con motivo: un corte a
  // junio publicaba ROE y días de cartera de medio año como anuales.
  const meses = inputs.mesesPeriodo;
  const factorAnual = meses !== null && meses > 0 ? 12 / meses : null;
  const motivoPeriodo = motivoPeriodoNoAnualizado(inputs.periodo);

  const costoTotalForRotation = inputs.costoVentas6 + inputs.costoProduccion7;
  const rotationAnomalyFloor = Math.max(ingresosBase * KPI_ANOMALY_TOL_PCT, 0);
  // Why: rotación de inventario/proveedores con costos < 1% de ingresos da
  // resultados absurdos (días >> 1000) que el LLM cita literalmente y rompe
  // el reporte. Marcamos ND para forzar al especialista a investigar antes
  // de citar (NIA 240 §A1-A6 fraude por subregistro de costos).
  const costsAnomalous =
    Math.abs(costoTotalForRotation) < rotationAnomalyFloor || costoTotalForRotation === 0;

  const apalancamientoFinanciero = patrimonioNoPositivo
    ? nd('apalancamientoFinanciero', MOTIVO_PATRIMONIO_NO_POSITIVO)
    : safeDiv(inputs.pasivo, inputs.patrimonio);

  const margenBruto = ingresosOpValidos
    ? pct(safeDiv(inputs.utilidadBruta, ingresosOp))
    : nd('margenBruto', MOTIVO_INGRESOS_OPERACIONALES_NO_POSITIVOS);
  const margenOperativo = ingresosOpValidos
    ? pct(safeDiv(inputs.ebit, ingresosOp))
    : nd('margenOperativo', MOTIVO_INGRESOS_OPERACIONALES_NO_POSITIVOS);

  const roe = patrimonioPromedioNoPositivo
    ? nd('roe', MOTIVO_PATRIMONIO_PROMEDIO_NO_POSITIVO)
    : factorAnual === null
      ? nd('roe', motivoPeriodo)
      : pct(safeDiv(inputs.utilidadNeta * factorAnual, inputs.patrimonioPromedio));
  const roa =
    factorAnual === null
      ? nd('roa', motivoPeriodo)
      : pct(safeDiv(inputs.utilidadNeta * factorAnual, inputs.activoPromedio));
  const rotacionActivos =
    factorAnual === null
      ? nd('rotacionActivos', motivoPeriodo)
      : !ingresosOpValidos
        ? nd('rotacionActivos', MOTIVO_INGRESOS_OPERACIONALES_NO_POSITIVOS)
        : safeDiv(ingresosOp * factorAnual, inputs.activoPromedio);

  const diasCartera =
    factorAnual === null
      ? nd('diasCartera', motivoPeriodo)
      : !ingresosOpValidos
        ? nd('diasCartera', MOTIVO_INGRESOS_OPERACIONALES_NO_POSITIVOS)
        : inputs.clientesNetos === null
          ? nd('diasCartera', MOTIVO_SIN_CLIENTES)
          : (inputs.clientesNetos / (ingresosOp * factorAnual)) * 365;
  const diasSobreCostos = (
    key: 'diasInventario' | 'diasProveedores',
    saldo: number,
  ): number | null =>
    factorAnual === null
      ? nd(key, motivoPeriodo)
      : costsAnomalous
        ? nd(key, MOTIVO_COSTOS_ANOMALOS)
        : (saldo / (costoTotalForRotation * factorAnual)) * 365;
  const diasInventario = diasSobreCostos('diasInventario', inputs.inventarios14);
  const diasProveedores = diasSobreCostos('diasProveedores', inputs.proveedores22);
  const cicloConversionEfectivo =
    diasCartera === null || diasInventario === null || diasProveedores === null
      ? nd('cicloConversionEfectivo', MOTIVO_CICLO_INCOMPLETO)
      : diasCartera + diasInventario - diasProveedores;

  // P4-c: una etiqueta de sólo año ("2025") es 12 meses por CONVENCIÓN de
  // cierre anual. Si el archivo declara la fecha de corte se cita; si no, la
  // nota revela que es un supuesto (un corte a junio rotulado "2025" publicaría
  // ROE y días de medio año como anuales).
  const corte = inputs.corteDeclarado;
  const citaCorte = corte ? ` (corte declarado en el archivo: «${corte.texto}»)` : '';
  const soloAnio = /^20\d{2}$/.test(inputs.periodo);
  const kpiBaseNota =
    meses === null
      ? `Base 365 días. Periodo "${inputs.periodo}" sin duración determinable: ROE, ROA, ` +
        'rotación de activos y días de cartera/inventario/proveedores se publican N/D ' +
        '(periodo parcial no anualizado).'
      : meses === 12
        ? soloAnio && !corte
          ? `Base 365 días. Periodo ${inputs.periodo}: 12 meses por SUPUESTO de cierre anual (la ` +
            (inputs.fechaSinInterpretar
              ? `etiqueta sólo trae el año y la fecha del archivo «${inputs.fechaSinInterpretar}» no se ` +
                'interpretó como fecha de corte de meses completos); ROE, ROA, '
              : 'etiqueta sólo trae el año y el archivo no declara la fecha de corte); ROE, ROA, ') +
            'rotación de activos y días de cartera/inventario/proveedores sin anualizar. Si el ' +
            'balance es un corte intermedio, declare la fecha de corte (p. ej. «a junio 30 de ' +
            '2025») o rotule el periodo con el mes (AAAA-MM) para anualizarlos.'
          : `Base 365 días. Periodo ${inputs.periodo}: 12 meses (cierre anual)${citaCorte}; ROE, ROA, ` +
            'rotación de activos y días de cartera/inventario/proveedores sin anualizar.'
        : `Base 365 días. Periodo ${inputs.periodo}: P&G de ${meses} meses${citaCorte}; ROE, ROA, ` +
          `rotación de activos y días de cartera/inventario/proveedores anualizados × 12/${meses}.`;

  const out: DerivedKpis = {
    razonCorriente: safeDiv(inputs.activoCorriente, inputs.pasivoCorriente),
    pruebaAcida: safeDiv(
      inputs.activoCorriente - inputs.inventarios14,
      inputs.pasivoCorriente,
    ),
    endeudamientoTotal: pct(safeDiv(inputs.pasivo, inputs.activo)),
    apalancamientoFinanciero,
    coberturaIntereses: (() => {
      const den = Math.abs(inputs.gastoFinanciero5305);
      if (den === 0) return null;
      return inputs.ebit / den;
    })(),
    margenBruto,
    margenOperativo,
    margenNeto: pct(safeDiv(inputs.utilidadNeta, ingresosBase)),
    roe,
    roa,
    rotacionActivos,
    diasCartera,
    diasInventario,
    diasProveedores,
    cicloConversionEfectivo,
    capitalTrabajo: inputs.activoCorriente - inputs.pasivoCorriente,
    diasPeriodo: meses === null ? null : Math.round((365 * meses) / 12),
    kpiBaseNota,
    kpiNdMotivos,
  };

  // ingesta-09 (parcial): un saldo de apertura no trae P&G del periodo. Los
  // KPIs de flujo (y el margen neto y la cobertura, que también son P&G) se
  // publican N/D con motivo; los de saldo (liquidez, endeudamiento) valen.
  if (inputs.pygDisponible === false) {
    for (const key of KPIS_DE_FLUJO) {
      out[key] = null;
      kpiNdMotivos[key] = MOTIVO_PYG_APERTURA;
    }
    out.margenNeto = null;
    out.coberturaIntereses = null;
    out.kpiBaseNota =
      `Periodo ${inputs.periodo}: saldos de apertura (columna de saldo inicial/anterior); ` +
      'sin P&G del periodo, los indicadores de resultados se publican N/D.';
  }
  return out;
}

/**
 * Convierte el monto a string canónico con dos decimales y punto decimal
 * (formato "1968104173.17"). Usado como evidencia de auditoría del parser.
 */
function toRawString(value: number): string {
  if (!Number.isFinite(value)) return '0.00';
  // Math.round preserva el centavo entero antes de toFixed para evitar
  // drift en valores como 1234.005 → 1234.01 en lugar de 1234.00.
  const cents = Math.round(value * 100);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const integer = Math.floor(abs / 100);
  const fraction = (abs % 100).toString().padStart(2, '0');
  return `${sign}${integer}.${fraction}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseLine(line: string, separator: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === separator && !inQuotes) {
      result.push(current);
      current = '';
    } else current += ch;
  }
  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// Importes (ingesta-02, niif-preproceso-05)
// ---------------------------------------------------------------------------
// Regla MORFOLÓGICA, no posicional (misma idea que `parseMoneyAmount` del
// parser bancario):
//   - Un único tipo de separador es de MILES sólo si la cadena casa
//     ^[1-9]\d{0,2}([.,]\d{3})+$ — "1.234" = 1234, "1.234.567", "1,234,567".
//     En formato CO el primer grupo tiene 1-3 dígitos y no empieza por 0, así
//     que "1234.567" o "0.125" no pueden ser miles.
//   - Un único separador que no casa la agrupación es DECIMAL: "1234.567",
//     "300.29999999999995" (valor crudo de una fórmula de Excel), "1234,5".
//   - Con ambos separadores el último es el decimal y la parte entera debe
//     estar bien agrupada ("1.234.567,89", "1,234,567.89").
//   - Varios separadores iguales sin agrupación válida ("1.23.456") o una
//     parte entera mal agrupada son ambiguos → ilegible.
//   - Notación científica: el ruido sub-centavo de una resta en Excel
//     (String(n) de |n| < 1e-6, p. ej. "1.4551915228366852e-11") vale 0; una
//     magnitud material ("1.23457E+11") perdió precisión al exportar desde
//     Excel → ilegible, nunca un importe aproximado.
//   - U+2212 y los guiones tipográficos son signo menos; el guion solo ("-")
//     es el cero del formato contable de Excel y cuenta como celda vacía.
// Ambigüedad residual irreducible EN PESOS: String(1.234) === "1.234" (un
// valor < 1.000 con exactamente 3 decimales) se lee como mil doscientos
// treinta y cuatro. Se resuelve en el PRODUCTOR del CSV (nunca más de 2
// decimales), no aquí.
// Con la unidad CONFIRMADA en miles / millones tres decimales son la precisión
// al peso ('848,123' miles = $848.123): ahí esa forma se lee con el separador
// decimal del archivo (`separadorDecimalDelArchivo`) y, sin evidencia, es un
// importe ambiguo que bloquea con motivo (recalculo-final2-02 / ICU-02).
// ---------------------------------------------------------------------------

type UnreadableCell = {
  kind: 'unreadable';
  raw: string;
  scientific: boolean;
  fueraDeRango?: boolean;
  /** Unidad confirmada con la que el importe es ambiguo (recalculo-final2-02). */
  ambiguoEn?: UnidadMonetaria;
};
type AmountCell = { kind: 'empty' } | { kind: 'number'; value: number } | UnreadableCell;

const EMPTY_CELL: AmountCell = { kind: 'empty' };
const SUB_CENT = 0.005;
const GROUPED_DOT = /^[1-9]\d{0,2}(\.\d{3})+$/;
const GROUPED_COMMA = /^[1-9]\d{0,2}(,\d{3})+$/;
/** Un único separador seguido de exactamente 3 cifras: '848,123', '1.234'. */
const UN_GRUPO_DE_TRES = /^[1-9]\d{0,2}[.,]\d{3}$/;

type SeparadorDecimal = '.' | ',';

/**
 * Cómo leer los importes de un archivo: sin unidad (pesos, regla morfológica)
 * o con la unidad confirmada (P4-a), su exponente y el separador decimal del
 * archivo (`null` = el archivo no da evidencia).
 */
interface LecturaUnidad {
  exponente: number;
  unidad: UnidadMonetaria | null;
  separadorDecimal: SeparadorDecimal | null;
}
const SIN_UNIDAD: LecturaUnidad = { exponente: 0, unidad: null, separadorDecimal: null };

/**
 * Separador decimal de un archivo con la unidad confirmada (recalculo-final2-02
 * / ICU-02). En miles, la precisión al peso son tres decimales ('848,123' =
 * $848.123), la misma forma que una agrupación de miles. Evidencia, por
 * celda de importe: los dos separadores (el último es el decimal), un
 * separador repetido con grupos de tres (es de miles: el decimal es el otro),
 * o un único separador que no puede ser de miles ('5,5', '0,125',
 * '1234,567'). Sin evidencia en las celdas, un archivo separado por ';' usa
 * coma decimal (exportación es-CO de Excel). Evidencia contradictoria o
 * ninguna: `null` (los importes '848,123' quedan ambiguos y bloquean).
 */
function separadorDecimalDelArchivo(celdas: string[], separadorDeCampos: string): SeparadorDecimal | null {
  const votos = new Set<SeparadorDecimal>();
  for (const celda of celdas) {
    const limpia = limpiarCeldaImporte(celda);
    if (limpia.kind !== 'text' || !/^[\d.,]+$/.test(limpia.s)) continue;
    const s = limpia.s;
    const dots = (s.match(/\./g) ?? []).length;
    const commas = (s.match(/,/g) ?? []).length;
    if (dots > 0 && commas > 0) {
      votos.add(s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.');
    } else if (dots + commas > 1) {
      const sep: SeparadorDecimal = dots > 0 ? '.' : ',';
      if ((sep === '.' ? GROUPED_DOT : GROUPED_COMMA).test(s)) votos.add(sep === '.' ? ',' : '.');
    } else if (dots + commas === 1 && !UN_GRUPO_DE_TRES.test(s)) {
      votos.add(dots > 0 ? '.' : ',');
    }
  }
  if (votos.size === 1) return [...votos][0];
  if (votos.size === 0 && separadorDeCampos === ';') return ',';
  return null;
}

type CeldaLimpia = { kind: 'empty' } | { kind: 'text'; s: string; negative: boolean };

/**
 * Normaliza el texto de una celda de importe: moneda, espacios, prefijo de
 * texto de Excel, apóstrofo de millones y signo (paréntesis, menos al inicio o
 * al final, guiones tipográficos). El guion solo es el cero del formato
 * contable (celda vacía).
 */
function limpiarCeldaImporte(original: string): CeldaLimpia {
  let s = original
    .replace(/[−‒–—﹣－]/g, '-')
    .replace(/\b(COP|USD|EUR)\b/gi, '')
    .replace(/[$€£"\s]/g, '')
    // Apóstrofo inicial = prefijo de texto de Excel; interior = separador de
    // millones latinoamericano ("1'234.567"), equivalente al punto de miles.
    .replace(/^['’`´]/, '')
    .replace(/['’`´]/g, '.');
  if (s.length === 0 || /^-+$/.test(s)) return { kind: 'empty' };

  let negative = false;
  const paren = s.match(/^\((.*)\)$/);
  if (paren) {
    negative = true;
    s = paren[1];
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  if (s.length === 0) return { kind: 'empty' };
  return { kind: 'text', s, negative };
}

/**
 * `true` si el importe (pesos) se representa al centavo en el contrato actual
 * (`Math.round(pesos × 100)` es un entero seguro, < 2^53 centavos ≈ $90
 * billones). Es el mismo criterio que aplica la ruta ERP
 * (`trial-balance-serialization.ts`, que rechaza el informe) y el que usa el
 * preprocesador sobre hojas y totales para CSV, XLSX y filas del API v1
 * (motivo de integridad bloqueante, ingesta-30 / recalculo-final-04), y el
 * parser sobre cada importe reexpresado por unidad confirmada (P4-a).
 */
export function isSafeMoneyPesos(value: number): boolean {
  return Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100));
}

/**
 * Centavos EXACTOS de un decimal sin signo (`"12345.678"`) multiplicado por
 * 10^exponente (P4-a: unidad confirmada). Aritmética entera BigInt desde el
 * texto: `12345.678 × 1000` en coma flotante da 12345677.999999998. Las cifras
 * por debajo del centavo se redondean al centavo más cercano (mitad hacia
 * arriba en magnitud).
 */
function decimalACentavosEscalados(normalized: string, exponente: number): bigint {
  const [intPart, frac = ''] = normalized.split('.');
  const digits = BigInt(`${intPart || '0'}${frac}` || '0');
  const shift = exponente + 2 - frac.length;
  if (shift >= 0) return digits * BigInt(10) ** BigInt(shift);
  const divisor = BigInt(10) ** BigInt(-shift);
  const q = digits / divisor;
  const r = digits % divisor;
  return r * BigInt(2) >= divisor ? q + BigInt(1) : q;
}

/**
 * Texto decimal exacto de un número JS (`Number#toString` da la representación
 * decimal más corta que vuelve al mismo `number`, la que envió el cliente en
 * JSON), sin notación exponencial: `1.5e-7` → `0.00000015`, `1e+21` → `1` + 21
 * ceros. Sin signo.
 */
function decimalDeNumero(value: number): string {
  const text = Math.abs(value).toString();
  const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (!m) return text;
  const digits = m[1] + (m[2] ?? '');
  const pointPos = m[1].length + parseInt(m[3], 10);
  if (pointPos <= 0) return `0.${'0'.repeat(-pointPos)}${digits}`;
  if (pointPos >= digits.length) return digits + '0'.repeat(pointPos - digits.length);
  return `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
}

/**
 * Reexpresa a pesos las filas estructuradas del API v1 (`rows` con
 * `unit`, P4-a): cada saldo se multiplica por 10^3 / 10^6 desde su texto
 * decimal en centavos exactos (BigInt), igual que el parser con
 * `unidadConfirmada`, y la primera fila lleva la nota de ingesta visible.
 * Un saldo que tras reexpresarlo excede el rango de 2^53 centavos no se
 * convierte: se devuelve como error de validación (nunca se publica
 * aproximado). `'pesos'` o `null` devuelven las filas tal cual.
 */
export function reexpresarFilasPorUnidad(
  rows: RawAccountRow[],
  unidad: UnidadMonetaria | null | undefined,
): { rows: RawAccountRow[]; errores: Array<{ index: number; period: string; message: string }> } {
  if (!unidad || unidad === 'pesos') return { rows, errores: [] };
  const exponente = EXPONENTE_UNIDAD[unidad];
  const errores: Array<{ index: number; period: string; message: string }> = [];
  const out = rows.map((row, index) => {
    const balancesByPeriod: Record<string, number> = {};
    for (const [period, value] of Object.entries(row.balancesByPeriod)) {
      const cents = Number.isFinite(value) ? decimalACentavosEscalados(decimalDeNumero(value), exponente) : null;
      if (cents === null || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
        errores.push({
          index,
          period,
          message:
            `Cuenta ${row.code}: el saldo ${value} (${unidad} de pesos) del periodo ${period} queda fuera ` +
            'del rango de precisión monetaria soportado (más de 2^53 centavos) al reexpresarlo a pesos.',
        });
        balancesByPeriod[period] = value;
        continue;
      }
      const pesos = Number(cents) / 100;
      balancesByPeriod[period] = cents === BigInt(0) ? 0 : value < 0 ? -pesos : pesos;
    }
    return { ...row, balancesByPeriod };
  });
  const nota = notaUnidadConfirmada(null, unidad);
  if (nota && out.length > 0) {
    out[0] = { ...out[0], notasIngesta: [...(out[0].notasIngesta ?? []), { period: null, message: nota }] };
  }
  return { rows: out, errores };
}

function parseAmountCell(val: string | undefined | null, lectura: LecturaUnidad = SIN_UNIDAD): AmountCell {
  if (val === undefined || val === null) return EMPTY_CELL;
  const original = String(val).trim();
  const unreadable = (scientific = false): AmountCell => ({ kind: 'unreadable', raw: original, scientific });
  const exponente = lectura.exponente;

  const limpia = limpiarCeldaImporte(original);
  if (limpia.kind === 'empty') return EMPTY_CELL;
  const { s, negative } = limpia;

  const sci = s.match(/^(\d+(?:[.,]\d+)?)[eE]([-+]?\d+)$/);
  if (sci) {
    const value = Number(`${sci[1].replace(',', '.')}e${sci[2]}`);
    return Number.isFinite(value) && Math.abs(value) < SUB_CENT
      ? { kind: 'number', value: 0 }
      : unreadable(true);
  }

  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return unreadable();

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let normalized: string;
  if (dots > 0 && commas > 0) {
    const decimalSep = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const parts = s.split(decimalSep);
    if (parts.length !== 2) return unreadable();
    const [intPart, fraction] = parts;
    const grouped = decimalSep === ',' ? GROUPED_DOT : GROUPED_COMMA;
    if (!grouped.test(intPart) || !/^\d*$/.test(fraction)) return unreadable();
    normalized = `${intPart.replace(/[.,]/g, '')}.${fraction}`;
  } else if (dots === 0 && commas === 0) {
    normalized = s;
  } else {
    const sep = dots > 0 ? '.' : ',';
    if (exponente > 0 && UN_GRUPO_DE_TRES.test(s)) {
      // Unidad confirmada: '848,123' es decimal o agrupación según el
      // separador decimal del archivo; sin evidencia es ambiguo (bloquea).
      if (lectura.separadorDecimal === null) {
        return { kind: 'unreadable', raw: original, scientific: false, ambiguoEn: lectura.unidad ?? undefined };
      }
      normalized = lectura.separadorDecimal === sep ? s.replace(sep, '.') : s.replace(sep, '');
    } else if ((sep === '.' ? GROUPED_DOT : GROUPED_COMMA).test(s)) {
      normalized = s.split(sep).join('');
    } else if (dots + commas === 1) {
      normalized = s.replace(sep, '.');
    } else {
      return unreadable();
    }
  }

  const n = Number(normalized);
  if (!Number.isFinite(n) || !/\d/.test(normalized)) return unreadable();
  const fueraDeRango: AmountCell = { kind: 'unreadable', raw: original, scientific: false, fueraDeRango: true };
  if (exponente > 0) {
    // Unidad confirmada (P4-a): reexpresión exacta desde el texto decimal.
    const cents = decimalACentavosEscalados(normalized, exponente);
    if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return fueraDeRango;
    if (cents === BigInt(0)) return { kind: 'number', value: 0 };
    const value = Number(cents) / 100;
    return { kind: 'number', value: negative ? -value : value };
  }
  if (n === 0) return { kind: 'number', value: 0 };
  // Sin reexpresión el importe se conserva: un valor fuera del rango seguro
  // (`isSafeMoneyPesos`) lo bloquea el preprocesador como motivo de integridad
  // en todas las superficies (recalculo-final-04 / ingesta-30), y las anclas
  // BigInt de un importe entero siguen siendo exactas.
  return { kind: 'number', value: negative ? -n : n };
}

/**
 * parseNumber — importe de un balance en formato CO, EN-US o `String(number)`
 * de JS. Devuelve `NaN` para celdas vacías y para cadenas ambiguas o
 * ilegibles; el parser del balance distingue ambos casos y registra las
 * ilegibles como motivo de validación.
 */
export function parseNumber(val: string | undefined): number {
  const cell = parseAmountCell(val, SIN_UNIDAD);
  return cell.kind === 'number' ? cell.value : NaN;
}

/**
 * Busca la columna cuyo encabezado (normalizado, con sus variantes U+FFFD)
 * coincide con un candidato. Primero coincidencia exacta; después contención
 * para candidatos de más de 3 letras y palabra completa para los cortos
 * ("cr", "db", "cod", "cta"): "descripcion" ya no casa con "cr".
 */
function findColumnIndex(
  headers: string[][],
  candidates: string[],
  exclude: (index: number, header: string) => boolean = () => false,
): number {
  const allowed = (i: number) => !headers[i].some((h) => exclude(i, h));
  for (const candidate of candidates) {
    const idx = headers.findIndex((variants, i) => allowed(i) && variants.includes(candidate));
    if (idx !== -1) return idx;
  }
  for (const candidate of candidates) {
    const idx = headers.findIndex(
      (variants, i) =>
        allowed(i) &&
        variants.some((h) =>
          candidate.length > 3 ? h.includes(candidate) : h.split(/[^a-z0-9]+/).includes(candidate),
        ),
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

function inferLevel(code: string): string {
  const len = code.length;
  if (len === 1) return 'Clase';
  if (len === 2 || len === 3) return 'Grupo';
  if (len === 4 || len === 5) return 'Cuenta';
  if (len === 6 || len === 7) return 'Subcuenta';
  return 'Auxiliar';
}

function normalizeLevel(level: string): string {
  const l = level.toLowerCase().trim();
  if (l.includes('clase') || l === 'class') return 'Clase';
  if (l.includes('grupo') || l === 'group') return 'Grupo';
  if (l.includes('sub')) return 'Subcuenta';
  if (l.includes('auxiliar') || l.includes('aux') || l.includes('detalle')) return 'Auxiliar';
  if (l.includes('cuenta') || l === 'account') return 'Cuenta';
  return level;
}

// ---------------------------------------------------------------------------
// Selección de hojas (recalculo-07) y códigos que no son cuentas (ingesta-11)
// ---------------------------------------------------------------------------
// Hoja = fila cuyo código no es prefijo de ningún otro código del archivo,
// cualquiera que sea el nivel declarado. Antes sólo eran hoja las filas
// Auxiliar/transaccionales y las Subcuenta sin auxiliares: un balance
// exportado a nivel Cuenta (4 dígitos) quedaba en $0 y una cuenta sin
// descendientes en un archivo mixto se omitía; una fila marcada transaccional
// con subcuentas se sumaba dos veces.
//
// Identificaciones de tercero en la columna código (cédula 79123456, NIT
// 1020304050) no son cuentas: sin cuenta padre en el archivo y con un grupo
// que no existe en el PUC (x0, 0x, 63-69, 75-79) se excluyen de los totales y
// bloquean. En un archivo jerárquico, un código largo sin ninguna cuenta padre
// también bloquea (se conserva: puede ser una cuenta sin mayor exportado).
// ---------------------------------------------------------------------------

interface LeafCandidate {
  code: string;
  name: string;
  level: string;
  transactional: boolean;
  balance: number;
}

const MAX_LISTED_CODES = 10;
/** Fracción mínima de códigos largos con cuenta padre para tratar el archivo como jerárquico. */
const HIERARCHICAL_MIN_SHARE = 0.8;
const HIERARCHICAL_MIN_LONG_CODES = 5;

function isImplausiblePucGroup(code: string): boolean {
  const cls = code[0];
  const grp = code[1];
  if (cls === '0' || grp === '0') return true;
  if (cls === '6' && grp >= '3') return true;
  if (cls === '7' && grp >= '5') return true;
  return false;
}

function listCodes(rows: LeafCandidate[]): string {
  const shown = rows
    .slice(0, MAX_LISTED_CODES)
    .map((r) => `${r.code} ${r.name} ($${formatCOP(r.balance)})`)
    .join(', ');
  return rows.length > MAX_LISTED_CODES ? `${shown} y ${rows.length - MAX_LISTED_CODES} más` : shown;
}

function selectLeafRows<T extends LeafCandidate>(
  view: T[],
  period: string,
): { leafRows: T[]; reasons: string[] } {
  const codeSet = new Set(view.map((r) => r.code));
  const hasAncestor = (code: string): boolean => {
    for (let k = code.length - 1; k >= 4; k--) {
      if (codeSet.has(code.slice(0, k))) return true;
    }
    return false;
  };

  const notAccounts = view.filter(
    (r) => r.code.length >= 8 && !hasAncestor(r.code) && isImplausiblePucGroup(r.code),
  );
  const excluded = new Set<T>(notAccounts);
  const accounts = view.filter((r) => !excluded.has(r));

  const prefixes = new Set<string>();
  for (const r of accounts) {
    for (let k = 1; k < r.code.length; k++) prefixes.add(r.code.slice(0, k));
  }
  const structural = accounts.filter((r) => !prefixes.has(r.code));

  // Código repetido con niveles distintos (fila de mayor + fila auxiliar con
  // el mismo código): se suman sólo las auxiliares/transaccionales, como antes.
  const isAux = (r: T) => r.transactional || r.level === 'Auxiliar';
  const codesWithAux = new Set(structural.filter(isAux).map((r) => r.code));
  const leafRows = structural.filter((r) => isAux(r) || !codesWithAux.has(r.code));

  const reasons: string[] = [];
  const flaggedNotAccounts = notAccounts.filter((r) => r.balance !== 0);
  if (flaggedNotAccounts.length > 0) {
    reasons.push(
      `[${period}] Códigos que no corresponden a un grupo PUC ni tienen cuenta padre en el archivo ` +
        `(posible NIT o cédula de tercero en la columna código): ${listCodes(flaggedNotAccounts)}. ` +
        'Se excluyeron de los totales; revise el archivo.',
    );
  }

  const longCodes = accounts.filter((r) => r.code.length >= 8);
  const uniqueLong = new Set(longCodes.map((r) => r.code));
  const withAncestor = [...uniqueLong].filter(hasAncestor).length;
  if (
    uniqueLong.size >= HIERARCHICAL_MIN_LONG_CODES &&
    withAncestor / uniqueLong.size >= HIERARCHICAL_MIN_SHARE
  ) {
    const orphans = longCodes.filter((r) => !hasAncestor(r.code) && r.balance !== 0);
    if (orphans.length > 0) {
      reasons.push(
        `[${period}] Códigos sin cuenta padre en un archivo jerárquico (posible identificación de ` +
          `tercero o cuenta sin mayor exportado): ${listCodes(orphans)}. Se sumaron como auxiliares; ` +
          'confirme que son cuentas del catálogo.',
      );
    }
  }

  return { leafRows, reasons };
}

/** Máximo de valores ilegibles citados uno a uno por periodo. */
const MAX_PARSE_ISSUE_REASONS = 10;

/**
 * Motivos de validación del periodo a partir de los problemas de lectura del
 * parser (niif-preproceso-05, ingesta-06). `period === null` aplica a todos.
 */
function collectParseIssueReasons(rows: RawAccountRow[], period: string): string[] {
  const messages = new Set<string>();
  for (const row of rows) {
    for (const issue of row.parseIssues ?? []) {
      if (issue.period === null || issue.period === period) messages.add(issue.message);
    }
  }
  const all = [...messages];
  const reasons = all.slice(0, MAX_PARSE_ISSUE_REASONS).map((m) => `[${period}] ${m}`);
  if (all.length > MAX_PARSE_ISSUE_REASONS) {
    reasons.push(
      `[${period}] … y ${all.length - MAX_PARSE_ISSUE_REASONS} problemas de lectura más en el archivo.`,
    );
  }
  return reasons;
}

/**
 * Supuesto revelado de la clase 7 (niif-preproceso-32), o `null` sin saldo de
 * clase 7. Cita los inventarios de producción del periodo (1405 materias
 * primas, 1410 productos en proceso, 1430 productos terminados) cuando existen:
 * son el destino alternativo del traslado.
 */
function notaSupuestoClase7(
  totalProduction: number,
  leafRows: ReadonlyArray<{ code: string; balance: number }>,
): string | null {
  if (toCents(totalProduction) === BigInt(0)) return null;
  const inventarios = ['1405', '1410', '1430']
    .map((prefijo) => {
      let cents = BigInt(0);
      for (const r of leafRows) if (r.code.startsWith(prefijo)) cents += toCents(r.balance);
      return { prefijo, cents };
    })
    .filter((i) => i.cents !== BigInt(0))
    .map((i) => `${i.prefijo} $${formatCOP(Number(i.cents) / 100)}`);
  return (
    `Supuesto de la clase 7 (costos de producción u operación, $${formatCOP(totalProduction)}): se ` +
    'resta íntegra del resultado del periodo, como si todo se hubiera trasladado al costo de ventas ' +
    '(grupo 61). El PUC la acumula para luego trasladarla a inventarios y costo de ventas ' +
    '(src/data/tax_docs/puc_pymes_2026.json, clase 7; referencia Decreto 2650 de 1993): si parte ' +
    'quedó en materias primas, productos en proceso o terminados sin vender (1405 / 1410 / 1430), la ' +
    'utilidad del periodo queda subestimada y el traslado requiere el asiento de cierre del contador.' +
    (inventarios.length > 0 ? ` Inventarios de producción en el balance: ${inventarios.join('; ')}.` : '')
  );
}

/**
 * Notas de ingesta del periodo (`RawAccountRow.notasIngesta`, `period === null`
 * aplica a todos), sin duplicados, y la fecha de corte declarada del periodo.
 */
function collectNotasIngesta(
  rows: RawAccountRow[],
  period: string,
): { mensajes: string[]; corte: NotaIngesta['corte'] | undefined; fechaSinInterpretar: string | undefined } {
  const mensajes = new Set<string>();
  let corte: NotaIngesta['corte'] | undefined;
  let fechaSinInterpretar: string | undefined;
  for (const row of rows) {
    for (const nota of row.notasIngesta ?? []) {
      if (nota.period !== null && nota.period !== period) continue;
      mensajes.add(nota.message);
      if (nota.corte && nota.period === period) corte ??= nota.corte;
      if (nota.fechaSinInterpretar && nota.period === period) fechaSinInterpretar ??= nota.fechaSinInterpretar;
    }
  }
  return {
    mensajes: [...mensajes].map((m) => `[${period}] ${m}`),
    corte,
    fechaSinInterpretar: corte ? undefined : fechaSinInterpretar,
  };
}

// ---------------------------------------------------------------------------
// Excepciones de vencimiento declaradas por el usuario (P4-b)
// ---------------------------------------------------------------------------
// La clasificación corriente / no corriente sigue siendo por grupo PUC (activo
// 11-14 / 15-19; pasivo 21-26 / 27-29) y se revela como supuesto
// (`CLASIFICACION_CORRIENTE_SUPUESTA`, NIC 1 párr. 66-76 / NIIF PYMES 4.5-4.8).
// El usuario puede declarar el vencimiento real de una cuenta (`1205` → no
// corriente, `2105` → no corriente) y la excepción se aplica de forma
// determinista: la cuenta más específica gana, el saldo se traslada completo
// entre corriente y no corriente, y el informe lo revela con el monto. Sin
// excepciones, las cifras son idénticas a la clasificación por grupo.
// ---------------------------------------------------------------------------

/** Plazo por grupo PUC de una cuenta (o de la virtual de R1 por su origen); `null` fuera de 11-19 / 21-29. */
function plazoPorGrupo(code: string, seccion: 'activo' | 'pasivo'): Vencimiento | null {
  const grupo = code.slice(0, 2);
  if (seccion === 'activo') {
    if (ACTIVO_CORRIENTE_GROUPS.has(grupo)) return 'corriente';
    if (ACTIVO_NO_CORRIENTE_GROUPS.has(grupo)) return 'no_corriente';
    return null;
  }
  if (isCurrentLiabilityCode(code)) return 'corriente';
  if (isNonCurrentLiabilityCode(code)) return 'no_corriente';
  return null;
}

/**
 * Totales corriente / no corriente de una sección con las excepciones de
 * vencimiento de sus cuentas. `base` son los totales por grupo PUC; se
 * trasladan en centavos exactos los saldos cuyo vencimiento declarado difiere
 * del de su grupo. Sin excepciones devuelve `base` tal cual.
 */
function aplicarVencimientos(
  cuentas: ReadonlyArray<{ code: string; balance: number; vencimiento?: Vencimiento }>,
  seccion: 'activo' | 'pasivo',
  base: { corriente: number; noCorriente: number },
  vencimientoDeOrigen?: (code: string) => Vencimiento | undefined,
): { corriente: number; noCorriente: number; aplicados: VencimientoAplicado[] } {
  let aCorriente = BigInt(0);
  let aNoCorriente = BigInt(0);
  const aplicados: VencimientoAplicado[] = [];
  for (const c of cuentas) {
    const declarado = c.vencimiento ?? vencimientoDeOrigen?.(c.code);
    if (!declarado) continue;
    const porGrupo = plazoPorGrupo(c.code, seccion);
    if (porGrupo === null || porGrupo === declarado) continue;
    const cents = toCents(c.balance);
    if (cents === BigInt(0)) continue;
    if (declarado === 'corriente') aCorriente += cents;
    else aNoCorriente += cents;
    aplicados.push({ codigo: c.code, seccion, vencimiento: declarado, saldo: c.balance });
  }
  if (aplicados.length === 0) return { ...base, aplicados };
  return {
    corriente: Number(toCents(base.corriente) + aCorriente - aNoCorriente) / 100,
    noCorriente: Number(toCents(base.noCorriente) + aNoCorriente - aCorriente) / 100,
    aplicados,
  };
}

/** Supuesto de clasificación revelado, con las excepciones aplicadas y su monto. */
function textoClasificacionCorriente(aplicados: readonly VencimientoAplicado[]): string {
  if (aplicados.length === 0) return CLASIFICACION_CORRIENTE_SUPUESTA;
  const detalle = aplicados
    .map(
      (a) =>
        `${a.codigo} (${a.seccion}) → ${a.vencimiento === 'corriente' ? 'corriente' : 'no corriente'} ` +
        `$${formatCOP(a.saldo)}`,
    )
    .join('; ');
  return (
    `${CLASIFICACION_CORRIENTE_SUPUESTA} Excepciones por vencimiento DECLARADAS por el usuario y ` +
    `aplicadas de forma determinista (prevalece el código más específico): ${detalle}.`
  );
}

/**
 * Marca en las filas el vencimiento declarado por el usuario (P4-b): cada
 * cuenta de clase 1 o 2 toma la excepción del código más específico que la
 * contiene (`1205` cubre `120505`). Devuelve filas nuevas (no muta la entrada),
 * los errores de validación (códigos que no son de activo o pasivo) y los
 * códigos sin cuentas en el balance, que se revelan en la nota de ingesta.
 * Sin excepciones devuelve las mismas filas.
 */
export function aplicarVencimientosDeclarados(
  rows: RawAccountRow[],
  vencimientos: Readonly<Record<string, Vencimiento>> | null | undefined,
): { rows: RawAccountRow[]; errores: string[]; sinCuentas: string[] } {
  const entradas = Object.entries(vencimientos ?? {});
  if (entradas.length === 0) return { rows, errores: [], sinCuentas: [] };
  const errores: string[] = [];
  const validas: Array<[string, Vencimiento]> = [];
  for (const [codigo, plazo] of entradas) {
    const motivo = motivoCodigoVencimientoInvalido(codigo);
    if (motivo) errores.push(`Excepción de vencimiento inválida: ${motivo}`);
    else if (plazo !== 'corriente' && plazo !== 'no_corriente') {
      errores.push(`Excepción de vencimiento inválida para ${codigo}: use corriente o no_corriente.`);
    } else validas.push([codigo, plazo]);
  }
  if (errores.length > 0) return { rows, errores, sinCuentas: [] };
  // El código más largo primero: la excepción más específica prevalece.
  validas.sort(([a], [b]) => b.length - a.length || a.localeCompare(b));
  const usados = new Set<string>();
  const out = rows.map((row) => {
    if (row.code[0] !== '1' && row.code[0] !== '2') return row;
    const hit = validas.find(([codigo]) => row.code.startsWith(codigo));
    if (!hit) return row;
    usados.add(hit[0]);
    return { ...row, vencimiento: hit[1] };
  });
  const sinCuentas = validas.map(([c]) => c).filter((c) => !usados.has(c)).sort();
  const lista = [...validas]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, p]) => `${c} → ${p === 'corriente' ? 'corriente' : 'no corriente'}`)
    .join('; ');
  const nota: NotaIngesta = {
    period: null,
    message:
      `Nota de ingesta: excepciones de vencimiento declaradas por el usuario (prevalece el código ` +
      `más específico; el resto sigue la clasificación por grupo PUC): ${lista}.` +
      (sinCuentas.length > 0 ? ` Sin cuentas en el balance: ${sinCuentas.join(', ')}.` : ''),
  };
  if (out.length > 0) out[0] = { ...out[0], notasIngesta: [...(out[0].notasIngesta ?? []), nota] };
  return { rows: out, errores: [], sinCuentas };
}

/**
 * Re-aplica las excepciones de vencimiento después del Curator: R1 y R8
 * recalculan corriente / no corriente por grupo PUC sobre las cuentas del
 * snapshot. Se recalculan aquí desde las cuentas (centavos exactos) con las
 * excepciones; las virtuales de R1 (`2810ZZ-130505`) siguen a su cuenta de
 * origen. Sólo se llama cuando hay excepciones declaradas.
 */
function reaplicarVencimientos(snap: PeriodSnapshot, porCodigo: ReadonlyMap<string, Vencimiento>): void {
  const activo = snap.classes.find((c) => c.code === 1)?.accounts ?? [];
  const pasivo = snap.classes.find((c) => c.code === 2)?.accounts ?? [];
  const sumaPor = (cuentas: ValidatedAccount[], seccion: 'activo' | 'pasivo', plazo: Vencimiento) => {
    let acc = BigInt(0);
    for (const c of cuentas) if (plazoPorGrupo(c.code, seccion) === plazo) acc += toCents(c.balance);
    return Number(acc) / 100;
  };
  const deOrigen = (code: string): Vencimiento | undefined => {
    const origen = r1OriginGroup(code) !== null ? code.split('-')[1] : undefined;
    return origen ? porCodigo.get(origen) : undefined;
  };
  const a = aplicarVencimientos(
    activo,
    'activo',
    { corriente: sumaPor(activo, 'activo', 'corriente'), noCorriente: sumaPor(activo, 'activo', 'no_corriente') },
    deOrigen,
  );
  const p = aplicarVencimientos(
    pasivo,
    'pasivo',
    { corriente: sumaPor(pasivo, 'pasivo', 'corriente'), noCorriente: sumaPor(pasivo, 'pasivo', 'no_corriente') },
    deOrigen,
  );
  const ct = snap.controlTotals;
  ct.activoCorriente = a.corriente;
  ct.activoNoCorriente = a.noCorriente;
  ct.pasivoCorriente = p.corriente;
  ct.pasivoNoCorriente = p.noCorriente;
  const aplicados = [...a.aplicados, ...p.aplicados];
  ct.clasificacionSupuesta = textoClasificacionCorriente(aplicados);
  if (aplicados.length > 0) snap.vencimientosAplicados = aplicados;
  else delete snap.vencimientosAplicados;
}

// ---------------------------------------------------------------------------
// Créditos del impuesto de renta (niif-preproceso-19, decisión fase 3)
// ---------------------------------------------------------------------------

/**
 * ¿La cuenta es un crédito del impuesto de renta (anticipo, retención en la
 * fuente, autorretención)? Delega en la regla ÚNICA de
 * `@/lib/accounting/renta-credit`, la misma del Âncora Fiscal (F03) y del
 * Âncora NIIF (auditoría 2026-09, integración W3-B): 135505/135515 salvo
 * nombre de IVA/ICA/predial/timbre/GMF/contribuciones; 135595 y 1805 sólo con
 * nombre de renta; el resto de 1355 no.
 * Exportada para que otros detectores (p. ej. `repair/adjustments.ts`) usen
 * la misma regla en lugar de duplicarla.
 */
export function isRentaCreditAccount(code: string, name: string): boolean {
  return esCreditoRenta(code, [name]);
}

function findMissingAccountsForClass(
  allRows: ViewRow[],
  classCode: number,
  leafRows: ViewRow[],
): string {
  const classPrefix = String(classCode);
  const groupRows = allRows.filter(
    (r) => r.code.startsWith(classPrefix) && (r.level === 'Grupo' || r.level === 'Cuenta') && r.balance !== 0,
  );

  const missing: string[] = [];
  for (const group of groupRows) {
    const hasChildren = leafRows.some((l) => l.code.startsWith(group.code) && l.code !== group.code);
    if (!hasChildren && group.balance !== 0) {
      missing.push(`${group.code} ${group.name} ($${formatCOP(group.balance)})`);
    }
  }

  if (missing.length > 0) {
    return `Posibles cuentas omitidas de los auxiliares: ${missing.join(', ')}. PRIORIZAR la suma de auxiliares.`;
  }
  return '';
}

function buildMissingAccountsForView(
  view: ViewRow[],
  leafRows: ViewRow[],
  classes: PUCClass[],
): string[] {
  const out: string[] = [];

  const groupTotals = new Map<string, number>();
  for (const r of leafRows) {
    if (r.code.length >= 2) {
      const grp = r.code.slice(0, 2);
      groupTotals.set(grp, (groupTotals.get(grp) ?? 0) + r.balance);
    }
  }

  for (const [subCode, meta] of Object.entries(IMPORTANT_SUBCUENTAS)) {
    const parentTotal = groupTotals.get(meta.parentGroup) ?? 0;
    if (Math.abs(parentTotal) <= 1) continue;

    const hasHere = leafRows.some((l) => l.code === subCode);
    const hasBelow = leafRows.some((l) => l.code.startsWith(subCode) && l.code !== subCode);
    const rowAtSub = view.find((r) => r.code === subCode);
    const subBalance = rowAtSub?.balance ?? 0;

    if (!hasHere && !hasBelow) {
      out.push(
        `Subcuenta PUC esperada ausente: ${subCode} ${meta.name} (grupo ${meta.parentGroup} tiene saldo $${formatCOP(parentTotal)}).`,
      );
    } else if (hasHere && Math.abs(subBalance) < 1 && !hasBelow) {
      out.push(
        `Subcuenta PUC ${subCode} ${meta.name} presente pero con saldo $0 (grupo ${meta.parentGroup} = $${formatCOP(parentTotal)}).`,
      );
    }
  }

  for (const cl of classes) {
    const classPrefix = String(cl.code);
    const groupsAndAccounts = view.filter(
      (r) =>
        r.code.startsWith(classPrefix) &&
        (r.level === 'Grupo' || r.level === 'Cuenta') &&
        r.balance !== 0,
    );
    for (const g of groupsAndAccounts) {
      const hasLeafBelow = leafRows.some(
        (l) => l.code.startsWith(g.code) && l.code !== g.code,
      );
      if (!hasLeafBelow) {
        out.push(
          `${g.level} ${g.code} ${g.name} con saldo $${formatCOP(g.balance)} sin hojas debajo.`,
        );
      }
    }
  }

  return out;
}

/**
 * Suma auxiliares filtrados por clase + grupo PUC con precisión al centavo.
 *
 * ITEM 1 — Aritmética cent-exacta (Elite Protocol Layer 1): la acumulación
 * naïve en `number` introduce drift de centavos cuando se suman saldos con
 * 2 decimales (típico balance NIIF). Acumulamos en BigInt centavos y
 * convertimos al final dividiendo por 100. Resultado: la suma de los
 * auxiliares coincide al centavo con el TOTAL ACTIVO reportado.
 *
 * Why: Johan exige que la SUMA DE AUXILIARES de Clase 1 (Efectivo, Inversiones,
 * Deudores, Inventarios, Impuestos) cuadre exactamente con TOTAL ACTIVO al
 * centavo. Sin acumulación en cents, `0.10 + 0.20 = 0.30000000000000004`
 * propaga error por todo el balance.
 */
function sumLeavesByGroupPrefixes(
  leafRows: ViewRow[],
  classDigit: string,
  groupSet: Set<string>,
): number {
  let acc = BigInt(0);
  for (const r of leafRows) {
    if (!r.code.startsWith(classDigit)) continue;
    const grp = r.code.length >= 2 ? r.code.slice(0, 2) : r.code;
    if (groupSet.has(grp)) acc += toCents(r.balance);
  }
  // Conversión BigInt → number: centavos → pesos. Para magnitudes <
  // 2^53 / 100 ≈ $90 billones COP, no hay pérdida (suficiente para
  // cualquier balance comercial colombiano realista).
  return Number(acc) / 100;
}

/**
 * Suma un subconjunto de leafRows con precisión al centavo. Helper común
 * para R16 (anticipo netting) y otros consumers que necesitan precisión cents
 * sin filtrar por grupo PUC.
 */
function sumLeavesPrecise(leafRows: ReadonlyArray<{ balance: number }>): number {
  let acc = BigInt(0);
  for (const r of leafRows) acc += toCents(r.balance);
  return Number(acc) / 100;
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-${formatted}` : formatted;
}

/**
 * Convierte un CuratorFinding en el shape `Discrepancy` que ya consume el
 * resto del pipeline. Los findings cualitativos del curator no llevan
 * montos numéricos en sí mismos (esos viven en sus subobjetos: reclassifications,
 * balanceGapAttribution, taxProvisionRisk), así que aquí solo proyectamos
 * la severidad + texto en `description`.
 */
export function curatorFindingToDiscrepancy(
  f: CuratorFinding,
  snap: PeriodSnapshot,
): Discrepancy {
  const sev = f.severity.toUpperCase();
  return {
    location: `[CURATOR ${f.code} · ${sev}] ${f.title} [${snap.period}]`,
    reported: 0,
    calculated: 0,
    difference: 0,
    description: `${f.description} | Norma: ${f.normReference} | Recomendación: ${f.recommendation}`,
  };
}

/**
 * Clave cronológica (AAAAMM) de una etiqueta de periodo: "2025" es el cierre
 * 2025-12, "2025-06" junio, "2025-Q2" el cierre del trimestre y un rango
 * "AAAA-MM-DD..AAAA-MM-DD" su fecha final. `null` si no es una fecha.
 */
function periodSortKey(period: string): number | null {
  let m = period.match(/^(20\d{2})$/);
  if (m) return parseInt(m[1], 10) * 100 + 12;
  m = period.match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if (m) return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
  m = period.match(/^(20\d{2})-Q([1-4])$/i);
  if (m) return parseInt(m[1], 10) * 100 + parseInt(m[2], 10) * 3;
  m = period.match(/^\d{4}-\d{2}-\d{2}\.\.(20\d{2})-(0[1-9]|1[0-2])-\d{2}$/);
  if (m) return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
  return null;
}

/**
 * Ordena periodos ascendentemente. Etiquetas con fecha ("2024", "2025-06",
 * "2025-Q2", rangos) se ordenan cronológicamente entre sí; etiquetas sin
 * fecha (DEFAULT_PERIOD, nombres de hoja) van al final.
 */
function sortPeriodsAscending(periods: string[]): string[] {
  return [...periods].sort((a, b) => {
    const ay = periodSortKey(a);
    const by = periodSortKey(b);
    if (ay !== null && by !== null) return ay - by || a.localeCompare(b);
    if (ay !== null) return -1;
    if (by !== null) return 1;
    // Heuristica: "*_anterior" < "current"
    if (a.endsWith('_anterior') && !b.endsWith('_anterior')) return -1;
    if (b.endsWith('_anterior') && !a.endsWith('_anterior')) return 1;
    return a.localeCompare(b);
  });
}

// ---------------------------------------------------------------------------
// Reporting helpers (multi-period)
// ---------------------------------------------------------------------------

function buildCleanDataMultiPeriod(snapshots: PeriodSnapshot[]): string {
  const blocks: string[] = [];
  for (const snap of snapshots) {
    const lines: string[] = [];
    lines.push(`[period=${snap.period}]`);
    lines.push('codigo,nombre,nivel,saldo');
    for (const c of snap.classes) {
      for (const acc of c.accounts) {
        lines.push(`${acc.code},"${acc.name}",${acc.level},${acc.balance.toFixed(2)}`);
      }
    }
    lines.push(`[/period]`);
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

function buildMultiPeriodValidationReport(
  snapshots: PeriodSnapshot[],
  totalRowCount: number,
): string {
  const lines: string[] = [];
  lines.push('# INFORME DE VALIDACION ARITMETICA DEL BALANCE DE PRUEBA');
  lines.push('');
  lines.push(
    `**Periodos detectados:** ${snapshots.map((s) => s.period).join(', ')} | **Filas crudas:** ${totalRowCount}`,
  );
  lines.push('');

  for (const snap of snapshots) {
    lines.push(`## Periodo ${snap.period}`);
    lines.push('');
    lines.push('### Resumen por Clase PUC');
    lines.push('');
    lines.push('| Clase | Nombre | Total Hojas | Total Reportado | Discrepancia |');
    lines.push('|-------|--------|-------------|-----------------|--------------|');
    for (const c of snap.classes) {
      const reported = c.reportedTotal !== null ? `$${formatCOP(c.reportedTotal)}` : 'N/A';
      const disc = c.discrepancy > 1 ? `$${formatCOP(c.discrepancy)}` : 'OK';
      const flag = c.discrepancy > 1 ? ' !!' : '';
      lines.push(`| ${c.code} | ${c.name} | $${formatCOP(c.auxiliaryTotal)} | ${reported} | ${disc}${flag} |`);
    }
    lines.push('');
    lines.push('### Totales de Control');
    lines.push('');
    lines.push(`- **Activo Total:** $${formatCOP(snap.controlTotals.activo)} (corriente $${formatCOP(snap.controlTotals.activoCorriente)} + no corriente $${formatCOP(snap.controlTotals.activoNoCorriente)})`);
    lines.push(`- **Pasivo Total:** $${formatCOP(snap.controlTotals.pasivo)} (corriente $${formatCOP(snap.controlTotals.pasivoCorriente)} + no corriente $${formatCOP(snap.controlTotals.pasivoNoCorriente)})`);
    lines.push(`- **Patrimonio Total:** $${formatCOP(snap.controlTotals.patrimonio)}`);
    // Ingresos canónicos (recalculo-final2-05): la Σ firmada de la clase 4
    // (`controlTotals.ingresos`) depende de cómo el ERP exporta la 4175.
    const ctR = snap.controlTotals;
    const ingresosNetosR = ctR.ingresosNetos ?? Math.abs(ctR.ingresos);
    lines.push(
      `- **Ingresos operacionales netos (grupo 41 − devoluciones 4175):** ` +
        `$${formatCOP(ctR.ingresosOperacionalesNetos ?? ingresosNetosR)}`,
    );
    lines.push(`- **Ingresos netos (clase 4 neta de devoluciones 4175):** $${formatCOP(ingresosNetosR)}`);
    lines.push(`- **Gastos+Costos:** $${formatCOP(snap.controlTotals.gastos)}`);
    lines.push(`- **Utilidad Neta:** $${formatCOP(snap.controlTotals.utilidadNeta)}`);
    lines.push('');
    lines.push('### Ecuacion Patrimonial');
    lines.push('');
    lines.push(`- Activo - (Pasivo + Patrimonio) = $${formatCOP(snap.summary.equationBalance)}`);
    lines.push(`- Estado: **${snap.summary.equationBalanced ? 'CUADRA' : 'NO CUADRA'}**`);

    const eb = snap.equityBreakdown;
    if (Object.keys(eb).length > 0) {
      lines.push('');
      lines.push('### Desglose de Patrimonio');
      lines.push('');
      if (eb.capitalSuscritoPagado !== undefined) lines.push(`- Capital suscrito y pagado (grupo 31: 3105 neto, 3115, 3120…): $${formatCOP(eb.capitalSuscritoPagado)}`);
      if (eb.capitalAutorizado !== undefined) lines.push(`- Capital autorizado (310505, informativo — no suma): $${formatCOP(eb.capitalAutorizado)}`);
      if (eb.superavitCapital !== undefined) lines.push(`- Superávit de capital (grupo 32): $${formatCOP(eb.superavitCapital)}`);
      if (eb.reservaLegal !== undefined) lines.push(`- Reserva legal (3305): $${formatCOP(eb.reservaLegal)}`);
      if (eb.otrasReservas !== undefined) lines.push(`- Otras reservas (3310-3395): $${formatCOP(eb.otrasReservas)}`);
      if (eb.revalorizacionPatrimonio !== undefined) lines.push(`- Revalorización del patrimonio (grupo 34): $${formatCOP(eb.revalorizacionPatrimonio)}`);
      if (eb.dividendosDecretadosEnAcciones !== undefined) lines.push(`- Dividendos decretados en acciones/cuotas (grupo 35): $${formatCOP(eb.dividendosDecretadosEnAcciones)}`);
      if (eb.utilidadEjercicio !== undefined) lines.push(`- Resultado del ejercicio (3605+3610): $${formatCOP(eb.utilidadEjercicio)}`);
      if (eb.utilidadesAcumuladas !== undefined) lines.push(`- Resultados de ejercicios anteriores (grupo 37): $${formatCOP(eb.utilidadesAcumuladas)}`);
      if (eb.superavitValorizaciones !== undefined) lines.push(`- Superávit por valorizaciones (grupo 38): $${formatCOP(eb.superavitValorizaciones)}`);
      if (eb.otrasCuentasPatrimonio !== undefined) lines.push(`- Otras cuentas de patrimonio: $${formatCOP(eb.otrasCuentasPatrimonio)}`);
    }

    if (snap.discrepancies.length > 0) {
      lines.push('');
      lines.push('### Discrepancias Detectadas');
      lines.push('');
      for (const d of snap.discrepancies) {
        lines.push(`#### ${d.location}`);
        lines.push(`- Reportado: $${formatCOP(d.reported)}`);
        lines.push(`- Calculado: $${formatCOP(d.calculated)}`);
        lines.push(`- Diferencia: $${formatCOP(d.difference)}`);
        lines.push(`- Nota: ${d.description}`);
        lines.push('');
      }
    }

    if (snap.missingExpectedAccounts.length > 0) {
      lines.push('');
      lines.push('### Cuentas PUC Importantes Faltantes o Con Saldo 0');
      lines.push('');
      for (const m of snap.missingExpectedAccounts) lines.push(`- ${m}`);
    }

    if (snap.validation.adjustments.length > 0) {
      lines.push('');
      lines.push('### Ajustes Automaticos Aplicados');
      lines.push('');
      for (const a of snap.validation.adjustments) lines.push(`- ${a}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
