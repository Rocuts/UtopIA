// ---------------------------------------------------------------------------
// Regression script — Elite Protocol Validator
// ---------------------------------------------------------------------------
// Ejecutar con:
//   npx tsx src/lib/agents/financial/escudo-survival/__fixtures__/run-validation.ts
//
// Cada caso carga un fixture de balance (PreprocessedBalance) y construye un
// mock de EscudoSurvivalReport que simula lo que los agentes LLM producirían
// con ese balance. El validator es determinístico y cero-LLM — los mocks son
// la fuente de verdad del test.
//
// Salida: PASS / FAIL por caso. Exit code 1 si algún caso falla.
// ---------------------------------------------------------------------------

import {
  validateSurvivalReport,
  type SurvivalValidationResult,
} from '../validators/survival-validators';
import type { EscudoSurvivalReport } from '../types';
import type { PreprocessedBalance, PeriodSnapshot } from '@/lib/preprocessing/trial-balance';

// ---------------------------------------------------------------------------
// Importar fixtures de balance
// ---------------------------------------------------------------------------
import balanceTetAltaRaw from './balance-pyme-tet-alta.json';
import balanceSaldoFavorRaw from './balance-pyme-saldo-favor.json';
import balanceBancarizacionRaw from './balance-pyme-bancarizacion-violada.json';
import balanceEliteCleanRaw from './balance-pyme-elite-clean.json';
import balanceArt647TrapRaw from './balance-pyme-art647-trap.json';

// ---------------------------------------------------------------------------
// Helper: reconstruir PreprocessedBalance desde JSON fixture
// ---------------------------------------------------------------------------
// El JSON tiene `periods[0]` con el snapshot completo.
// `primary` debe apuntar al mismo objeto. El campo `primary` en algunos
// fixtures tiene un string placeholder ("__REFERENCE_TO_periods[0]__") que
// ignoramos y simplemente usamos periods[0].
// ---------------------------------------------------------------------------
function buildBalance(raw: typeof balanceTetAltaRaw): PreprocessedBalance {
  const snapshot = raw.periods[0] as unknown as PeriodSnapshot;
  return {
    periods: [snapshot],
    primary: snapshot,
    comparative: null,
    rawRows: [],
    auxiliaryCount: raw.auxiliaryCount,
    cleanData: raw.cleanData,
    validationReport: raw.validationReport,
  };
}

// ---------------------------------------------------------------------------
// Helper: construir markdown mínimo correcto para las capas 2 y 3
// ---------------------------------------------------------------------------
function goodTetMarkdown(tet: number, uai: number, impuesto: number): string {
  return (
    `## Tasa Efectiva de Tributación (TET)\n\n` +
    `TET = ${(tet * 100).toFixed(2)}% (Art. 240 E.T. — tarifa general 35%)\n\n` +
    `- Utilidad Antes de Impuestos (UAI): $${uai.toLocaleString('es-CO')}\n` +
    `- Impuesto Proyectado: $${impuesto.toLocaleString('es-CO')}\n` +
    `- UVT 2026: $52.374 (Resolución DIAN 000238/2025)\n\n` +
    `Benchmark: TET media empresarial Colombia 25.5% (MinHacienda 2024).`
  );
}

function goodAntiDianMarkdown(): string {
  return (
    `## Anti-DIAN Preventivo\n\n` +
    `Medios de pago: Art. 771-5 E.T. — pagos en efectivo a un mismo beneficiario\n` +
    `que superen 100 UVT ($52.374 × 100 = $5.237.400) NO son deducibles.\n\n` +
    `UVT 2026: $52.374.\n\n` +
    `Se revisaron todos los pagos del periodo. No se detectaron violaciones individuales.`
  );
}

function goodDividendMarkdown(): string {
  return (
    `## Optimización de Dividendos\n\n` +
    `**Art. 242 E.T.** — Impuesto a dividendos personas naturales residentes:\n` +
    `- Utilidad ya gravada en la sociedad: +10% adicional al socio.\n\n` +
    `**Art. 36-3 E.T.** — Capitalización como INCRGNO:\n` +
    `- Capitalizar vía emisión de acciones = $0 impuesto al socio.\n` +
    `- UVT 2026: $52.374.\n\n` +
    `Recomendación: evaluar capitalización parcial para diferir tributación del socio.`
  );
}

function goodSynthesisMarkdown(): string {
  return (
    `## Dictamen Ejecutivo — Modo Supervivencia Élite\n\n` +
    `Análisis basado en el balance de prueba suministrado. Las cifras son una guía operativa.\n\n` +
    `**Nota importante**: este dictamen es una guía basada en el balance suministrado. ` +
    `Las decisiones tributarias finales requieren validación de revisor fiscal o ` +
    `contador público certificado.\n\n` +
    `UVT 2026: $52.374 (Resolución DIAN 000238/2025).`
  );
}

// ---------------------------------------------------------------------------
// CASO 1: TET alta (35%) → nivel alerta rojo → debe tener optimizaciones
// ---------------------------------------------------------------------------
// UAI = ingresos (500M) - gastos_sin_impuesto (330M) = 170M
// Impuesto = 35M → TET = 35M/170M = 20.6% — WAIT: spec dice TET = 35%.
// Para TET = 35%: impuesto/uai = 0.35 → uai = 100M, impuesto = 35M.
// El agente calcula UAI como utilidadAntesImpuestos = 100M (correcto).
// ---------------------------------------------------------------------------
function buildMockReportTetAlta(): EscudoSurvivalReport {
  const uai = 100_000_000; // utilidad antes de impuestos
  const impuesto = 35_000_000; // 35% × 100M
  const tet = impuesto / uai; // = 0.35 exacto

  return {
    tet: {
      markdown: goodTetMarkdown(tet, uai, impuesto),
      warnings: [],
      data: {
        tet,
        ttd: 0.22,
        nivelAlerta: 'rojo',
        impuestoProyectado: impuesto,
        uai,
        sugerenciasOptimizacion: [
          {
            norma: 'Art. 256 E.T. — Descuento inversión en CT&I (30%)',
            ahorroEstimado: 5_000_000,
            requisitos: ['Proyecto calificado por Minciencias', 'Inversión ejecutada en el periodo'],
            factibilidad: 'media',
          },
          {
            norma: 'Art. 115 E.T. — Deducción 100% impuestos pagados (ICA)',
            ahorroEstimado: 2_800_000,
            requisitos: ['Causalidad acreditada', 'Pago efectivo antes del cierre'],
            factibilidad: 'alta',
          },
        ],
      },
    },
    retentionShield: {
      markdown: '## Escudo de Retenciones\n\nRetenciones acumuladas (1355): $5.000.000.\nImpuesto proyectado: $35.000.000.\nSaldo a favor: $0 — empresa no genera saldo a favor este periodo.',
      warnings: [],
      data: {
        retencionesAcumuladas: 5_000_000, // coincide con 135505 en balance fixture
        impuestoProyectado: 35_000_000,
        saldoAFavorProyectado: 0,
        acciones: [],
      },
    },
    antiDian: {
      markdown: goodAntiDianMarkdown(),
      warnings: [],
      data: {
        pagosEfectivoTotal: 2_000_000, // saldo caja ($2M) — no supera 100 UVT
        pagosNoDeduciblesIndividuales: [],
        excesoNoDeducibleGeneral: 0,
        crucesExogenaSospechosos: [],
        mayorImpuestoEstimado: 0,
      },
    },
    contingencyReserve: {
      markdown: '## Reserva de Contingencia\n\nUtilidad neta: $70.000.000.\nReserva sugerida (10%): $7.000.000.\nCuenta sugerida: 3305 (Reservas).',
      warnings: [],
      data: {
        utilidadNeta: 70_000_000,
        reservaSugerida: 7_000_000, // exactamente 10% × 70M
        pctUtilidad: 0.1,
        cuentaSugerida: '3305',
        reservaLegalActual: 15_000_000,
        gapReservaLegal: 10_000_000,
      },
    },
    dividendOptimizer: {
      markdown: goodDividendMarkdown(),
      warnings: [],
      data: {
        utilidadDistribuible: 70_000_000,
        escenarios: {
          distribuirTotal: { ahorroSocio: 0, impuestoSocio: 7_000_000, netoSocio: 63_000_000 },
          capitalizarTotal: { ahorroSocio: 7_000_000, impuestoSocio: 0, netoSocio: 70_000_000 }, // INCRGNO → impuesto = 0
          hibrido50_50: { ahorroSocio: 3_500_000, impuestoSocio: 3_500_000, netoSocio: 66_500_000 },
        },
        recomendacion: 'Se recomienda capitalizar el 70% de las utilidades vía Art. 36-3 E.T. para diferir el impuesto al socio y fortalecer el patrimonio.',
        norma: 'Art. 36-3 E.T.',
      },
    },
    synthesis: {
      markdown: goodSynthesisMarkdown(),
      topRecommendations: [
        { orden: 1, titulo: 'Aplicar descuento CT&I Art. 256', impacto: 5_000_000, norma: 'Art. 256 E.T.' },
        { orden: 2, titulo: 'Capitalizar utilidades Art. 36-3', impacto: 7_000_000, norma: 'Art. 36-3 E.T.' },
      ],
    },
    metadata: {
      uvt: 52374,
      period: '2026',
      generatedAt: new Date().toISOString(),
      partial: false,
      durationMs: 15000,
    },
  };
}

// ---------------------------------------------------------------------------
// CASO 2: Saldo a favor ($20M) → acciones requeridas
// ---------------------------------------------------------------------------
function buildMockReportSaldoFavor(): EscudoSurvivalReport {
  const uai = 130_000_000; // 400M ingresos - 270M gastos sin impuesto
  const impuesto = 30_000_000;
  const tet = impuesto / uai; // ~23%

  return {
    tet: {
      markdown: goodTetMarkdown(tet, uai, impuesto),
      warnings: [],
      data: {
        tet,
        ttd: 0.18,
        nivelAlerta: 'verde',
        impuestoProyectado: impuesto,
        uai,
        sugerenciasOptimizacion: [],
      },
    },
    retentionShield: {
      markdown:
        '## Escudo de Retenciones\n\n' +
        'Retenciones acumuladas (1355): $50.000.000 (135505: $30M + 135510: $20M).\n' +
        'Impuesto proyectado: $30.000.000.\n' +
        'Saldo a favor proyectado: **$20.000.000**.\n\n' +
        'Art. 771-5 E.T. — se verificaron medios de pago.\n' +
        'UVT 2026: $52.374.',
      warnings: [],
      data: {
        retencionesAcumuladas: 50_000_000, // coincide con 135505 + 135510 en fixture
        impuestoProyectado: 30_000_000,
        saldoAFavorProyectado: 20_000_000,
        acciones: [
          {
            tipo: 'compensacion',
            norma: 'Art. 815 E.T. — Compensación de saldos a favor',
            dificultad: 'baja',
            riesgo: 'Bajo: compensación automática en la declaración de renta.',
          },
          {
            tipo: 'devolucion',
            norma: 'Art. 850 E.T. — Devolución de saldos a favor',
            dificultad: 'media',
            riesgo: 'Medio: proceso formal con DIAN; puede tomar 30-50 días hábiles.',
          },
        ],
      },
    },
    antiDian: {
      markdown: goodAntiDianMarkdown(),
      warnings: [],
      data: {
        pagosEfectivoTotal: 5_000_000, // saldo caja $5M — no supera tope
        pagosNoDeduciblesIndividuales: [],
        excesoNoDeducibleGeneral: 0,
        crucesExogenaSospechosos: [],
        mayorImpuestoEstimado: 0,
      },
    },
    contingencyReserve: {
      markdown: '## Reserva de Contingencia\n\nUtilidad neta: $90.000.000.\nReserva sugerida (10%): $9.000.000.',
      warnings: [],
      data: {
        utilidadNeta: 90_000_000,
        reservaSugerida: 9_000_000, // 10% × 90M
        pctUtilidad: 0.1,
        cuentaSugerida: '3305',
      },
    },
    dividendOptimizer: {
      markdown: goodDividendMarkdown(),
      warnings: [],
      data: {
        utilidadDistribuible: 90_000_000,
        escenarios: {
          distribuirTotal: { ahorroSocio: 0, impuestoSocio: 9_000_000, netoSocio: 81_000_000 },
          capitalizarTotal: { ahorroSocio: 9_000_000, impuestoSocio: 0, netoSocio: 90_000_000 },
          hibrido50_50: { ahorroSocio: 4_500_000, impuestoSocio: 4_500_000, netoSocio: 85_500_000 },
        },
        recomendacion: 'Con saldo a favor de $20M, se recomienda primero compensar el saldo antes de distribuir dividendos para mejorar el flujo de caja. Art. 242 E.T. aplica sobre lo distribuido.',
        norma: 'Art. 242 E.T.',
      },
    },
    synthesis: {
      markdown: goodSynthesisMarkdown(),
      topRecommendations: [
        { orden: 1, titulo: 'Compensar saldo a favor $20M', impacto: 20_000_000, norma: 'Art. 815 E.T.' },
      ],
    },
    metadata: {
      uvt: 52374,
      period: '2026',
      generatedAt: new Date().toISOString(),
      partial: false,
      durationMs: 12000,
    },
  };
}

// ---------------------------------------------------------------------------
// CASO 3: Bancarización violada — 3 pagos > 100 UVT
// ---------------------------------------------------------------------------
// Pagos en efectivo: $7M (NIT A), $6M (NIT B), $8M (NIT C)
// Tope individual 100 UVT = $5.237.400
// Total no deducible = $21M (los 3 superan el tope)
// Mayor impuesto = 35% × $21M = $7.350.000
// ---------------------------------------------------------------------------
function buildMockReportBancarizacion(): EscudoSurvivalReport {
  const uai = 75_000_000; // 350M - 275M gastos
  const impuesto = 20_000_000;
  const tet = impuesto / uai; // ~26.7%

  const pagosViolacion = [
    { beneficiarioNit: '900111222-1', beneficiarioNombre: 'Servicios Rápidos SAS', monto: 7_000_000, excesoUvt: 1.5, norma: 'Art. 771-5 §2 E.T.' as const },
    { beneficiarioNit: '800333444-5', beneficiarioNombre: 'Consultores Andinos Ltda', monto: 6_000_000, excesoUvt: 0.7, norma: 'Art. 771-5 §2 E.T.' as const },
    { beneficiarioNit: '700555666-9', beneficiarioNombre: 'Suministros del Norte SAS', monto: 8_000_000, excesoUvt: 2.6, norma: 'Art. 771-5 §2 E.T.' as const },
  ];

  const totalNoDeducible = pagosViolacion.reduce((s, p) => s + p.monto, 0); // 21M
  const mayorImpuesto = Math.round(0.35 * totalNoDeducible); // 7.350.000

  return {
    tet: {
      markdown: goodTetMarkdown(tet, uai, impuesto),
      warnings: [],
      data: {
        tet,
        ttd: 0.17,
        nivelAlerta: 'amarillo',
        impuestoProyectado: impuesto,
        uai,
        sugerenciasOptimizacion: [],
      },
    },
    retentionShield: {
      markdown: '## Escudo de Retenciones\n\nRetenciones (1355): $5.000.000. Impuesto: $20.000.000. Sin saldo a favor.\nArt. 771-5 E.T. revisado.\nUVT 2026: $52.374.',
      warnings: [],
      data: {
        retencionesAcumuladas: 5_000_000,
        impuestoProyectado: 20_000_000,
        saldoAFavorProyectado: 0,
        acciones: [],
      },
    },
    antiDian: {
      markdown:
        '## Anti-DIAN Preventivo\n\n' +
        '**Art. 771-5 §2 E.T.** — Pagos en efectivo a un mismo beneficiario > 100 UVT ($5.237.400) NO son deducibles:\n\n' +
        '| Beneficiario | NIT | Monto | Exceso UVT |\n' +
        '|---|---|---|---|\n' +
        '| Servicios Rápidos SAS | 900111222-1 | $7.000.000 | 1.5 UVT |\n' +
        '| Consultores Andinos Ltda | 800333444-5 | $6.000.000 | 0.7 UVT |\n' +
        '| Suministros del Norte SAS | 700555666-9 | $8.000.000 | 2.6 UVT |\n\n' +
        `**Total no deducible: $${totalNoDeducible.toLocaleString('es-CO')}**\n` +
        `**Mayor impuesto estimado: $${mayorImpuesto.toLocaleString('es-CO')}** (35% Art. 240 E.T.)\n\n` +
        'UVT 2026: $52.374.',
      warnings: [],
      data: {
        pagosEfectivoTotal: 21_000_000, // suma de los 3 pagos en efectivo
        pagosNoDeduciblesIndividuales: pagosViolacion,
        excesoNoDeducibleGeneral: 0,
        crucesExogenaSospechosos: [],
        mayorImpuestoEstimado: mayorImpuesto,
      },
    },
    contingencyReserve: {
      markdown: '## Reserva de Contingencia\n\nUtilidad neta: $55.000.000.\nReserva sugerida (10%): $5.500.000.',
      warnings: [],
      data: {
        utilidadNeta: 55_000_000,
        reservaSugerida: 5_500_000, // 10% × 55M
        pctUtilidad: 0.1,
        cuentaSugerida: '3305',
      },
    },
    dividendOptimizer: {
      markdown: goodDividendMarkdown(),
      warnings: [],
      data: {
        utilidadDistribuible: 55_000_000,
        escenarios: {
          distribuirTotal: { ahorroSocio: 0, impuestoSocio: 5_500_000, netoSocio: 49_500_000 },
          capitalizarTotal: { ahorroSocio: 5_500_000, impuestoSocio: 0, netoSocio: 55_000_000 },
          hibrido50_50: { ahorroSocio: 2_750_000, impuestoSocio: 2_750_000, netoSocio: 52_250_000 },
        },
        recomendacion: 'Con riesgo de mayor impuesto por bancarización ($7.350.000 estimado, Art. 771-5 §2 E.T.), capitalizar vía Art. 36-3 E.T. para preservar caja. Art. 242 E.T. aplica sobre distribución.',
        norma: 'Art. 242 E.T.',
      },
    },
    synthesis: {
      markdown: goodSynthesisMarkdown(),
      topRecommendations: [
        { orden: 1, titulo: 'Bancarizar pagos > 100 UVT (Art. 771-5)', impacto: 7_350_000, norma: 'Art. 771-5 §2 E.T.' },
      ],
    },
    metadata: {
      uvt: 52374,
      period: '2026',
      generatedAt: new Date().toISOString(),
      partial: false,
      durationMs: 14000,
    },
  };
}

// ---------------------------------------------------------------------------
// CASO 4: Élite clean — todo correcto, validator debe decir ok: true, sin errores ni warnings
// ---------------------------------------------------------------------------
// TET = 22M / (600M - 493M) = 22M / 107M = 20.56% (verde)
// retenciones 1355 = 8M < impuesto 22M → sin saldo a favor
// pagos efectivo: todos < 100 UVT individual
// reserva = 10% × 85M = 8.5M
// ---------------------------------------------------------------------------
function buildMockReportEliteClean(): EscudoSurvivalReport {
  const uai = 107_000_000; // 600M - 493M (gastos sin impuesto)
  const impuesto = 22_000_000;
  const tet = impuesto / uai; // ~20.56%

  return {
    tet: {
      markdown: goodTetMarkdown(tet, uai, impuesto),
      warnings: [],
      data: {
        tet,
        ttd: 0.16,
        nivelAlerta: 'verde',
        impuestoProyectado: impuesto,
        uai,
        sugerenciasOptimizacion: [],
      },
    },
    retentionShield: {
      markdown:
        '## Escudo de Retenciones\n\n' +
        'Retenciones acumuladas (1355): $8.000.000.\n' +
        'Impuesto proyectado: $22.000.000.\n' +
        'Saldo a favor: $0 — impuesto supera retenciones.\n' +
        'Art. 771-5 E.T. revisado. UVT 2026: $52.374.',
      warnings: [],
      data: {
        retencionesAcumuladas: 8_000_000, // coincide con 135505 en fixture elite-clean
        impuestoProyectado: 22_000_000,
        saldoAFavorProyectado: 0,
        acciones: [],
      },
    },
    antiDian: {
      markdown: goodAntiDianMarkdown(),
      warnings: [],
      data: {
        pagosEfectivoTotal: 3_000_000, // saldo caja parcial — no supera 100 UVT
        pagosNoDeduciblesIndividuales: [],
        excesoNoDeducibleGeneral: 0,
        crucesExogenaSospechosos: [],
        mayorImpuestoEstimado: 0,
      },
    },
    contingencyReserve: {
      markdown: '## Reserva de Contingencia\n\nUtilidad neta: $85.000.000.\nReserva sugerida (10%): $8.500.000.\nUVT 2026: $52.374.',
      warnings: [],
      data: {
        utilidadNeta: 85_000_000,
        reservaSugerida: 8_500_000, // exactamente 10% × 85M
        pctUtilidad: 0.1,
        cuentaSugerida: '3305',
        reservaLegalActual: 40_000_000,
        gapReservaLegal: 0,
      },
    },
    dividendOptimizer: {
      markdown: goodDividendMarkdown(),
      warnings: [],
      data: {
        utilidadDistribuible: 85_000_000,
        escenarios: {
          distribuirTotal: { ahorroSocio: 0, impuestoSocio: 8_500_000, netoSocio: 76_500_000 },
          capitalizarTotal: { ahorroSocio: 8_500_000, impuestoSocio: 0, netoSocio: 85_000_000 },
          hibrido50_50: { ahorroSocio: 4_250_000, impuestoSocio: 4_250_000, netoSocio: 80_750_000 },
        },
        recomendacion: 'Empresa en posición Élite (TET 20.56%, sin saldo a favor, sin riesgos de bancarización). Se recomienda capitalizar 60% de utilidades vía Art. 36-3 E.T. y distribuir el 40% restante con tributación reducida Art. 242 E.T.',
        norma: 'Art. 36-3 E.T.',
      },
    },
    synthesis: {
      markdown: goodSynthesisMarkdown(),
      topRecommendations: [],
    },
    metadata: {
      uvt: 52374,
      period: '2026',
      generatedAt: new Date().toISOString(),
      partial: false,
      durationMs: 11000,
    },
  };
}

// ---------------------------------------------------------------------------
// CASO 5: Trampa Art. 647 — el report cita Art. 130 E.T. sin marcarlo como derogado
// ---------------------------------------------------------------------------
// Balance correcto: TET 20%, sin saldo a favor, sin pagos problemáticos.
// El error está en el markdown del agente que cita Art. 130 E.T. sin disclaimer.
// Validator debe fallar capa 3 check 'descuentos_no_norma_derogada'.
// ---------------------------------------------------------------------------
function buildMockReportArt647Trap(): EscudoSurvivalReport {
  const uai = 92_000_000; // 450M - 358M
  const impuesto = 22_000_000;
  const tet = impuesto / uai; // ~23.9%

  return {
    tet: {
      // El agente inadvertidamente cita Art. 130 E.T. como una opción de deducción
      // de activos fijos. Ese artículo fue DEROGADO por Ley 1819/2016.
      markdown:
        '## Tasa Efectiva de Tributación (TET)\n\n' +
        `TET = ${(tet * 100).toFixed(2)}% (Art. 240 E.T. — tarifa general 35%)\n\n` +
        'UAI: $92.000.000. Impuesto: $22.000.000.\n\n' +
        '**Oportunidad de optimización**: La empresa puede aplicar la deducción especial del ' +
        '**Art. 130 E.T.** por activos fijos adquiridos en el periodo para reducir la base gravable. ' +
        'Esta deducción permite hasta el 40% del valor de activos productivos.\n\n' +
        // ^^ TRAMPA: Art. 130 fue derogado por Ley 1819/2016 art. 376
        'UVT 2026: $52.374 (Resolución DIAN 000238/2025).',
      warnings: [],
      data: {
        tet,
        ttd: 0.17,
        nivelAlerta: 'verde',
        impuestoProyectado: impuesto,
        uai,
        sugerenciasOptimizacion: [
          {
            // Incluso la sugerencia cita la norma derogada
            norma: 'Art. 130 E.T. — Deducción activos fijos (CUIDADO: derogado Ley 1819/2016)',
            ahorroEstimado: 3_000_000,
            requisitos: ['Activo adquirido en el periodo', 'Uso en la actividad productora de renta'],
            factibilidad: 'baja',
          },
        ],
      },
    },
    retentionShield: {
      markdown:
        '## Escudo de Retenciones\n\nRetenciones (1355): $4.000.000. Impuesto: $22.000.000. Sin saldo a favor.\nArt. 771-5 E.T. revisado. UVT 2026: $52.374.',
      warnings: [],
      data: {
        retencionesAcumuladas: 4_000_000,
        impuestoProyectado: 22_000_000,
        saldoAFavorProyectado: 0,
        acciones: [],
      },
    },
    antiDian: {
      markdown: goodAntiDianMarkdown(),
      warnings: [],
      data: {
        pagosEfectivoTotal: 3_000_000,
        pagosNoDeduciblesIndividuales: [],
        excesoNoDeducibleGeneral: 0,
        crucesExogenaSospechosos: [],
        mayorImpuestoEstimado: 0,
      },
    },
    contingencyReserve: {
      markdown: '## Reserva de Contingencia\n\nUtilidad neta: $70.000.000.\nReserva sugerida (10%): $7.000.000.\nUVT 2026: $52.374.',
      warnings: [],
      data: {
        utilidadNeta: 70_000_000,
        reservaSugerida: 7_000_000, // 10% × 70M
        pctUtilidad: 0.1,
        cuentaSugerida: '3305',
      },
    },
    dividendOptimizer: {
      markdown: goodDividendMarkdown(),
      warnings: [],
      data: {
        utilidadDistribuible: 70_000_000,
        escenarios: {
          distribuirTotal: { ahorroSocio: 0, impuestoSocio: 7_000_000, netoSocio: 63_000_000 },
          capitalizarTotal: { ahorroSocio: 7_000_000, impuestoSocio: 0, netoSocio: 70_000_000 },
          hibrido50_50: { ahorroSocio: 3_500_000, impuestoSocio: 3_500_000, netoSocio: 66_500_000 },
        },
        recomendacion: 'Capitalización vía Art. 36-3 E.T. es la opción preferida para diferir tributación. Art. 242 E.T. aplica sobre dividendos distribuidos.',
        norma: 'Art. 36-3 E.T.',
      },
    },
    synthesis: {
      markdown: goodSynthesisMarkdown(),
      topRecommendations: [],
    },
    metadata: {
      uvt: 52374,
      period: '2026',
      generatedAt: new Date().toISOString(),
      partial: false,
      durationMs: 13000,
    },
  };
}

// ---------------------------------------------------------------------------
// Ejecutar casos
// ---------------------------------------------------------------------------

interface TestCase {
  name: string;
  balance: PreprocessedBalance;
  report: EscudoSurvivalReport;
  expect: (r: SurvivalValidationResult) => boolean;
  expectDescription: string;
}

const cases: TestCase[] = [
  {
    name: 'tet-alta',
    balance: buildBalance(balanceTetAltaRaw),
    report: buildMockReportTetAlta(),
    expect: (r) => {
      const tetCheck = r.layers.logicaNegocio.checks.find((c) => c.name === 'tet_alta_genera_optimizaciones');
      return r.ok && (tetCheck?.passed ?? false);
    },
    expectDescription: 'ok:true, tet_alta_genera_optimizaciones passed',
  },
  {
    name: 'saldo-favor',
    balance: buildBalance(balanceSaldoFavorRaw as unknown as typeof balanceTetAltaRaw),
    report: buildMockReportSaldoFavor(),
    expect: (r) => {
      const sfCheck = r.layers.logicaNegocio.checks.find((c) => c.name === 'saldo_favor_genera_acciones');
      return r.ok && (sfCheck?.passed ?? false);
    },
    expectDescription: 'ok:true, saldo_favor_genera_acciones passed',
  },
  {
    name: 'bancarizacion-violada',
    balance: buildBalance(balanceBancarizacionRaw as unknown as typeof balanceTetAltaRaw),
    report: buildMockReportBancarizacion(),
    expect: (r) => {
      const banCheck = r.layers.logicaNegocio.checks.find((c) => c.name === 'bancarizacion_violada_listada');
      const mayorImpCheck = r.layers.aritmetica.checks.find((c) => c.name === 'mayorImpuesto_es_35pct_excedente');
      return r.ok && (banCheck?.passed ?? false) && (mayorImpCheck?.passed ?? false);
    },
    expectDescription: 'ok:true, bancarizacion_violada_listada passed, mayorImpuesto_es_35pct_excedente passed',
  },
  {
    name: 'elite-clean',
    balance: buildBalance(balanceEliteCleanRaw as unknown as typeof balanceTetAltaRaw),
    report: buildMockReportEliteClean(),
    expect: (r) => r.ok && r.errors.length === 0 && r.warnings.length === 0,
    expectDescription: 'ok:true, errors:[], warnings:[]',
  },
  {
    name: 'art647-trap',
    balance: buildBalance(balanceArt647TrapRaw as unknown as typeof balanceTetAltaRaw),
    report: buildMockReportArt647Trap(),
    expect: (r) => {
      const check = r.layers.defensaTributaria.checks.find(
        (c) => c.name === 'descuentos_no_norma_derogada',
      );
      // Debe fallar: capa 3 detecta Art. 130 sin marcar como derogado
      return !r.ok && check !== undefined && !check.passed;
    },
    expectDescription: 'ok:false, descuentos_no_norma_derogada:failed (Art. 130 E.T. sin marcar como derogado)',
  },
];

let exitCode = 0;
let passed = 0;
let failed = 0;

console.log('\n=== ESCUDO SURVIVAL — Regression Validator ===\n');

for (const tc of cases) {
  let result: SurvivalValidationResult;
  try {
    result = validateSurvivalReport(tc.report, tc.balance);
  } catch (e) {
    console.error(`ERROR: ${tc.name} — excepción en validator:`, e);
    exitCode = 1;
    failed++;
    continue;
  }

  const ok = tc.expect(result);

  if (ok) {
    console.log(`✓ PASS: ${tc.name}`);
    console.log(`  Esperado: ${tc.expectDescription}`);
    passed++;
  } else {
    console.log(`✗ FAIL: ${tc.name}`);
    console.log(`  Esperado: ${tc.expectDescription}`);
    console.log(`  ok=${result.ok}, errors=${result.errors.length}, warnings=${result.warnings.length}`);
    if (result.errors.length > 0) {
      console.log('  Errors:');
      result.errors.forEach((e) => console.log('    -', e));
    }
    if (result.warnings.length > 0) {
      console.log('  Warnings:');
      result.warnings.forEach((w) => console.log('    -', w));
    }

    // Mostrar checks fallidos por capa
    for (const [layer, lr] of Object.entries(result.layers)) {
      const failedChecks = (lr as import('../validators/survival-validators').LayerResult).checks.filter(
        (c) => !c.passed,
      );
      if (failedChecks.length > 0) {
        console.log(`  Capa ${layer} — checks fallidos:`);
        failedChecks.forEach((c) =>
          console.log(`    [${c.severity}] ${c.name}: ${c.detail ?? '(sin detail)'}`),
        );
      }
    }

    // Stress tests
    for (const [st, sr] of Object.entries(result.stressTests)) {
      const str = sr as import('../validators/survival-validators').StressTestResult;
      if (!str.passed) {
        console.log(`  Stress ${st}: ${str.detail}`);
      }
    }

    exitCode = 1;
    failed++;
  }
}

console.log(`\n=== Resultado: ${passed}/${passed + failed} casos PASS ===`);
if (exitCode !== 0) {
  console.log(`${failed} caso(s) FAIL — ver detalles arriba.`);
}
process.exit(exitCode);
