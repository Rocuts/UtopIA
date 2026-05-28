// ---------------------------------------------------------------------------
// Fixture determinístico — Grupo Empresarial 2 Tres SAS · NIT 901714014-6 · 2025
// ---------------------------------------------------------------------------
// PreprocessedBalance que produce exactamente los F-values del contrato §9:
//   F01 = "222849678973"   UAI en centavos
//   F02 = "77997387641"    round(F01×35/100)
//   F03 = "4607340776"     Σ(Cta.1355) + Σ(Cta.1805)
//   F04 = "73390046865"    F02 − F03
//   F09 = 0               impuestoCausado = 0 → ratio 0%
//   F10 = 5.9             F03/F02×100 = 4607340776/77997387641×100 ≈ 5.9%
//
// Empresa de servicios empresariales (SAS, Grupo 2 NIIF).
// Sin periodo comparativo → Factor4 crecimiento = 0.
// F04 > 0 → Factor5 saldo_favor = 0.
//
// SCORE REAL computado sobre este fixture (buckets exactos del algoritmo):
//   Factor1 (TET=0%)       = 30   [f09 ≤ 0.01 → +30]
//   Factor2 (margen 92.9%) = 25   [> 90% → +25]
//   Factor3 (costos  7.1%) = 10   [1–10% → +10]
//   Factor4 (sin comp)     =  0
//   Factor5 (F04 > 0)      =  0
//   SCORE REAL = 65   →  nivel: muy_alto
//
// DIVERGENCIA RESPECTO AL DUEÑO:
//   El dueño esperaba scoreRiesgo=68 desde su pseudocódigo.
//   68 NO es alcanzable con el algoritmo real cuando:
//     - F09=0% fuerza Factor1=30 (fijo)
//     - Sin comparativo → Factor4=0 (fijo)
//     - F04>0 → Factor5=0 (fijo)
//   Con Factor1=30, Factor4=0, Factor5=0, los únicos valores posibles
//   de Factor2+Factor3 son: 0, 5, 10, 15, 20, 25, 30, 35, 40, 45.
//   Ninguno suma con 30 para llegar a 68.
//   El más cercano: 30+25+10 = 65. Desglose documentado para el dueño.
//
// VERIFICACIÓN ARITMÉTICA F-VALUES:
//   F01 = 222849678973 centavos (UAI)
//   F02 = Math.round(222849678973 × 35 / 100) = Math.round(77997387640.55) = 77997387641 ✔
//   F03 = 4607340776 centavos (Σ 135505)
//   F04 = 77997387641 − 4607340776 = 73390046865 ✔
//   F09 = 0/222849678973 × 100 = 0.0 ✔ (impuesto causado = 0)
//   F10 = round((4607340776/77997387641) × 1000) / 10 = round(59.07...) / 10 = 5.9 ✔
// ---------------------------------------------------------------------------

import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

/**
 * Balance preprocesado determinístico de Grupo Empresarial 2 Tres SAS.
 * Produce exactamente los F01-F10 del contrato Capa 5 §9.
 * Usar con buildFiscalAnchor + computeRiskScore para score=65 (muy_alto).
 */
export const GRUPO_2TRES_PREPROCESSED: PreprocessedBalance = {
  primary: {
    period: '2025',
    periodoTipo: 'cerrado',
    classes: [
      // -------------------------------------------------------------------
      // CLASE 1 — ACTIVO
      // Cta.135505 = 46.073.407,76 COP = 4607340776 centavos = F03 ✔
      // Caja PUC 11 = 250M COP = 25000000000 centavos
      // -------------------------------------------------------------------
      {
        code: 1,
        name: 'Activo',
        auxiliaryTotal: 2_578_496_789.73,
        reportedTotal: null,
        discrepancy: 0,
        accounts: [
          {
            code: '110505',
            name: 'Banco de Bogotá — CTA CTE',
            level: 'Subcuenta',
            balance: 250_000_000,          // 25000000000 centavos (caja)
            isLeaf: true,
          },
          {
            code: '135505',
            name: 'Retención en la fuente — clientes nacionales',
            level: 'Subcuenta',
            balance: 46_073_407.76,        // 4607340776 centavos = F03 exacto ✔
            isLeaf: true,
          },
        ],
      },
      // -------------------------------------------------------------------
      // CLASE 2 — PASIVO
      // Grupo 24 (pasivos fiscales):
      //   2408  IVA por pagar      → F05 = 10681325205 cts (106.813.252,05 COP)
      //   2365  Retefuente declar  → F06 = 2558361940 cts  (25.583.619,40 COP)
      //   2368  ICA               → F07 = 15511991 cts     (155.119,91 COP)
      //   Total grupo 24 (F08)    → 10553782441 cts (105.537.824,41 COP)
      //
      // Nota: F08 (10553782441) < F05+F06+F07 (13255199136).
      // Esto activa el check L1.3 como WARNING (saldo débito en subcuentas de
      // 2408 por IVA descontable — edge case real documentado).
      // El extractor usa absBigInt(sumLeavesByPrefix(['24'])) para F08,
      // por lo que si hay hojas con saldo positivo dentro de grupo 24,
      // la suma neta puede ser menor. Construimos F08 via una hoja resumen
      // con el saldo neto del grupo.
      // -------------------------------------------------------------------
      {
        code: 2,
        name: 'Pasivo',
        auxiliaryTotal: 137_537_824.41,
        reportedTotal: null,
        discrepancy: 0,
        accounts: [
          // Hoja 240801: IVA por pagar = F05
          {
            code: '240801',
            name: 'IVA generado bimestre vigente',
            level: 'Subcuenta',
            balance: -106_813_252.05,      // saldo crédito → negativo
            isLeaf: true,
          },
          // Hoja 236505: Retefuente por declarar = F06
          {
            code: '236505',
            name: 'Retefuente por declarar — dic 2025',
            level: 'Subcuenta',
            balance: -25_583_619.40,
            isLeaf: true,
          },
          // Hoja 236810: ICA por pagar = F07
          {
            code: '236810',
            name: 'ICA Bogotá — bimestre 5-6 2025',
            level: 'Subcuenta',
            balance: -1_551_199.10,        // ajustado para F07 exacto
            isLeaf: true,
          },
          // Hoja 240802: IVA descontable (débito en grupo 24) — genera F08 < F05
          // La suma de hojas 24xxxxx es:
          //   -106813252.05 + -25583619.40 + -1551199.10 + X = neto
          //   Para que absBigInt(neto) = 10553782441 cts = 105537824.41 COP:
          //   neto = -105537824.41
          //   X = -105537824.41 - (-106813252.05 - 25583619.40 - 1551199.10)
          //   X = -105537824.41 + 133948070.55 = 28410246.14 (débito, positivo)
          {
            code: '240802',
            name: 'IVA descontable acumulado',
            level: 'Subcuenta',
            balance: 28_410_246.14,        // débito (positivo) → reduce neto grupo 24
            isLeaf: true,
          },
        ],
      },
      // -------------------------------------------------------------------
      // CLASE 3 — PATRIMONIO
      // -------------------------------------------------------------------
      {
        code: 3,
        name: 'Patrimonio',
        auxiliaryTotal: 2_440_958_965.32,
        reportedTotal: null,
        discrepancy: 0,
        accounts: [
          {
            code: '310506',
            name: 'Capital suscrito y pagado',
            level: 'Subcuenta',
            balance: -10_000_000,
            isLeaf: true,
          },
          {
            code: '330505',
            name: 'Reserva legal',
            level: 'Subcuenta',
            balance: -8_000_000,
            isLeaf: true,
          },
        ],
      },
      // -------------------------------------------------------------------
      // CLASE 4 — INGRESOS
      // Total ingresos = 2.397.647.111,73 COP = 239764711173 centavos
      // Margen neto = utilidadNeta/ingresos = 222849678973/239764711173 = 92.95%
      //   > 90% → Factor2 = +25
      // -------------------------------------------------------------------
      {
        code: 4,
        name: 'Ingresos',
        auxiliaryTotal: 2_397_647_111.73,
        reportedTotal: null,
        discrepancy: 0,
        accounts: [
          {
            code: '413501',
            name: 'Honorarios asesoría empresarial',
            level: 'Subcuenta',
            balance: -2_397_647_111.73,    // saldo crédito → negativo
            isLeaf: true,
          },
        ],
      },
      // -------------------------------------------------------------------
      // CLASE 5 — GASTOS
      // Gastos operativos = 169.150.322,00 COP = 16915032200 centavos
      // costoOperativo = gastos − impuestoCausado = 16915032200 − 0 = 16915032200
      // ratio = 16915032200 / 239764711173 = 7.05% ∈ [1%, 10%) → Factor3 = +10
      //
      // Grupo 54 (impuesto causado) = 0 → F09 = 0.0 → Factor1 = +30
      // -------------------------------------------------------------------
      {
        code: 5,
        name: 'Gastos',
        auxiliaryTotal: 169_150_322.00,
        reportedTotal: null,
        discrepancy: 0,
        accounts: [
          {
            code: '510506',
            name: 'Sueldos y salarios — administración',
            level: 'Subcuenta',
            balance: 80_000_000.00,
            isLeaf: true,
          },
          {
            code: '510507',
            name: 'Prestaciones sociales',
            level: 'Subcuenta',
            balance: 45_000_000.00,
            isLeaf: true,
          },
          {
            code: '519505',
            name: 'Otros gastos administrativos',
            level: 'Subcuenta',
            balance: 44_150_322.00,
            isLeaf: true,
          },
          // SIN hojas 5404xx → impuestoCausado = 0n → F09 = 0.0 → Factor1 = +30 ✔
        ],
      },
      // -------------------------------------------------------------------
      // CLASE 6 — COSTOS DE VENTAS (empresa de servicios — ausente)
      // -------------------------------------------------------------------
      {
        code: 6,
        name: 'Costos de Ventas',
        auxiliaryTotal: 0,
        reportedTotal: null,
        discrepancy: 0,
        accounts: [],
      },
      // -------------------------------------------------------------------
      // CLASE 7 — COSTOS DE PRODUCCIÓN (empresa de servicios — ausente)
      // -------------------------------------------------------------------
      {
        code: 7,
        name: 'Costos de Producción',
        auxiliaryTotal: 0,
        reportedTotal: null,
        discrepancy: 0,
        accounts: [],
      },
    ],
    controlTotals: {
      activo: 2_578_496_789.73,
      activoCorriente: 296_073_407.76,
      activoNoCorriente: 2_282_423_381.97,
      pasivo: 137_537_824.41,
      pasivoCorriente: 137_537_824.41,
      pasivoNoCorriente: 0,
      patrimonio: 2_440_958_965.32,
      ingresos: 2_397_647_111.73,
      gastos: 169_150_322.00,
      utilidadNeta: 2_228_496_789.73,
      efectivoCuenta11: 250_000_000,
      deudoresCuenta13: 0,
      cuentasPorPagar23: 0,
      impuestosCuenta24: 105_537_824.41,
      obligacionesLaborales25: 0,
      // cents — fuente única para buildFiscalAnchor y computeRiskScore
      cents: {
        activo:                 BigInt('257849678973'),
        pasivo:                 BigInt('13753782441'),
        patrimonio:             BigInt('244095896532'),
        // ingresos exactos en cents: 239764711173
        ingresos:               BigInt('239764711173'),
        // gastos = costos operativos = 16915032200 cts (sin impuesto 0)
        gastos:                 BigInt('16915032200'),
        // utilidadNeta = ingresos − gastos = 239764711173 − 16915032200 = 222849678973
        utilidadNeta:           BigInt('222849678973'),
        // UAI = utilidadAntesImpuestos = utilidadNeta (impuesto=0)
        utilidadAntesImpuestos: BigInt('222849678973'),  // F01 exacto ✔
        // impuestoCausado = 0 → F09 = 0% → Factor1 = +30
        impuestoCausado:        BigInt('0'),
        // caja PUC 11 = 250M COP = 25000000000 cts
        efectivoCuenta11:       BigInt('25000000000'),
        totalDevoluciones:      BigInt('0'),
        ingresosNetos:          BigInt('239764711173'),
        saldoAFavorImpuesto:    BigInt('0'),
      },
    },
    equityBreakdown: {
      capitalAutorizado: 10_000_000,
      capitalSuscritoPagado: 10_000_000,
      reservaLegal: 8_000_000,
      utilidadEjercicio: 2_228_496_789.73,
    },
    summary: {
      totalAssets: 2_578_496_789.73,
      totalLiabilities: 137_537_824.41,
      totalEquity: 2_440_958_965.32,
      totalRevenue: 2_397_647_111.73,
      totalExpenses: 169_150_322.00,
      totalCosts: 0,
      totalProduction: 0,
      netIncome: 2_228_496_789.73,
      equationBalance: 0,
      equationBalanced: true,
    },
    validation: {
      blocking: false,
      reasons: [],
      suggestedAccounts: [],
      adjustments: [],
    },
    discrepancies: [],
    missingExpectedAccounts: [],
  },
  // Sin periodo comparativo → ingresosComparativoCents = null → Factor4 = 0
  comparative: null,
  // Campos obligatorios de PreprocessedBalance no usados por buildFiscalAnchor
  // ni computeRiskScore. Mínimos para satisfacer el tipo TypeScript.
  rawRows: [],
  auxiliaryCount: 8,
  cleanData: '# Grupo Empresarial 2 Tres SAS [period=2025]\n(fixture determinístico)',
  validationReport: '# Fixture · Grupo 2 Tres SAS 2025\nOK — balance cuadra.',
  comparativos_impracticables: true,
  reclasificacionesNoCompensacion: [],
} as unknown as PreprocessedBalance;

// Patch periods[] post-construcción para evitar auto-referencia circular
(GRUPO_2TRES_PREPROCESSED as unknown as Record<string, unknown>)['periods'] = [GRUPO_2TRES_PREPROCESSED.primary];

// ---------------------------------------------------------------------------
// CompanyContext para buildFiscalAnchor
// ---------------------------------------------------------------------------
export const GRUPO_2TRES_COMPANY = {
  name: 'Grupo Empresarial 2 Tres SAS',
  nit: '901714014-6',
} as const;

// ---------------------------------------------------------------------------
// Fecha fija para reproducibilidad determinística
// Elegida en Dic 2025 para que los vencimientos Feb-Apr 2026 tengan
// diasRestantes positivos y no activen VENCIMIENTO_15D.
// ---------------------------------------------------------------------------
export const GRUPO_2TRES_HOY = new Date('2025-12-29T00:00:00.000Z');
