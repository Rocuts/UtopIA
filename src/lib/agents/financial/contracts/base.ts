// ---------------------------------------------------------------------------
// Contratos Zod compartidos por TODOS los pipelines financieros (post-GPT-5.4)
// ---------------------------------------------------------------------------
//
// Este archivo materializa el patrón "Output-Contract-First" (best practice
// OpenAI 2026 para reasoning models de la familia GPT-5):
//
//   1. Los agentes LLM devuelven JSON estricto validado por Zod, NO markdown.
//   2. El renderer determinístico (sin LLM) convierte JSON -> Markdown legacy
//      para los consumidores downstream que aún esperan strings (PDF Élite,
//      Excel, validators v1). En Fase 3 los renderers se migran a JSON puro
//      y el adapter Markdown desaparece.
//   3. Zod strict mode requiere `.nullable()` en lugar de `.optional()` —
//      regla del AI SDK v6 + OpenAI strict json_schema. Si necesitas un
//      campo opcional, usa `.nullable().describe("...")` y maneja `null`.
//   4. Cifras monetarias se serializan como STRING (`MoneyCop`) con dígitos
//      enteros en centavos (sin separador, con signo opcional). El motivo:
//          a) JSON no soporta BigInt nativo.
//          b) `number` JS pierde precisión por encima de 2^53 — un balance de
//             una multinacional colombiana puede exceder ese rango si se
//             expresa en pesos.
//          c) Strings preservan integridad exacta y son strict-schema friendly.
//
// Regla de uso: las funciones que consumen estos schemas DEBEN convertir las
// strings a `BigInt` antes de cualquier aritmética. Helpers en
// `contracts/money.ts`.
// ---------------------------------------------------------------------------

import { z } from 'zod';

import {
  parseMoneyCop,
  serializeMoneyCop,
  pctFloorMoneyCop,
  minMoneyCop,
  formatCopFromCents,
} from './money';

// ---------------------------------------------------------------------------
// Tipos primitivos
// ---------------------------------------------------------------------------

/**
 * Cantidad monetaria en centavos de peso colombiano, serializada como string
 * decimal con signo opcional. Ejemplos válidos: "0", "-1500000", "123456789".
 *
 * Por qué string y no number: ver header del archivo.
 */
export const MoneyCop = z
  .string()
  .regex(/^-?\d+$/, 'MoneyCop debe ser un entero (centavos) serializado como string')
  .describe('Cantidad monetaria en centavos COP. String decimal sin separadores. Ej: "1500000" = $15.000,00');

/** Periodo fiscal en formato YYYY (ej. "2025"). */
export const FiscalYear = z
  .string()
  .regex(/^\d{4}$/, 'FiscalYear debe ser YYYY')
  .describe('Año fiscal en formato YYYY (ej. "2025")');

/** Norma normativa colombiana citada — uso textual, no validable. */
export const NormaRef = z
  .string()
  .min(1)
  .describe('Referencia normativa exacta. Ej: "E.T. Art. 240", "NIIF for SMEs §17.5", "Decreto 2420/2015 Anexo 2"');

// ---------------------------------------------------------------------------
// Spec v8.1 — Modo del reporte, confianza, anomalías sectoriales
// ---------------------------------------------------------------------------
// Estos building blocks vienen del prompt "Editor Jefe HTML" (v8.1 §2, §1.3,
// §1.5). Se exponen aquí para que TODOS los agentes financieros (NIIF Analyst,
// Strategy Director, Governance Specialist, futuro Editor Jefe) compartan el
// mismo contrato vinculante:
//
//   - `ReportMode` controla absolutamente toda decisión narrativa (verbos,
//     layout de estados financieros, copy del resumen ejecutivo).
//   - `ConfidenceLevel` se marca a cada cifra crítica para que el renderer
//     pinte el dot visual (`.conf.medium` / `.conf.low`) junto al número.
//   - `AnomalyFlag` es el contrato del callout `△ Anomalía a validar` con
//     banda de benchmark sectorial CIIU.
//
// El árbol de decisión que deriva `ReportMode` desde un `PreprocessedBalance`
// vive en `src/lib/preprocessing/v8-helpers.ts` — `deriveReportMode()`.
// ---------------------------------------------------------------------------

/**
 * Modo del reporte — primer comentario HTML del documento final (v8.1 §2).
 *
 *   - `LINEA_BASE`: no hay periodo comparativo material, o el comparativo es
 *     primer NIIF adoption. Verbos prohibidos: "creció", "mejoró", "varió".
 *     Verbos permitidos: "establece", "documenta", "constituye".
 *   - `TRANSICION`: comparativo existe pero >=3 líneas materiales faltantes
 *     (o `partial_data == true`). Verbos: "reconcilia, donde es comparable".
 *   - `COMPARATIVO_COMPLETO`: comparativo robusto. Verbos: "varió, creció,
 *     se contrajo, mejoró, evolucionó".
 */
export const ReportModeSchema = z.enum([
  'LINEA_BASE',
  'TRANSICION',
  'COMPARATIVO_COMPLETO',
]);
export type ReportMode = z.infer<typeof ReportModeSchema>;

/**
 * Nivel de confianza de una cifra crítica (v8.1 §1.5). El renderer marca
 * `medium` y `low` con un dot visual al lado del número. `high` se omite
 * (default implícito) para no saturar el documento.
 */
export const ConfidenceLevelSchema = z.enum(['high', 'medium', 'low']);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

/**
 * Bandera de anomalía sectorial (v8.1 §1.3 + Slide 03 callout `.anomaly`).
 * Aplica cuando un margen, ratio o porcentaje cae a más de 2σ del benchmark
 * del CIIU correspondiente — el agente DEBE emitir la flag con la banda
 * sectorial visible para que el usuario contextualice el outlier antes de
 * presentarlo como logro.
 *
 *   - `severity: 'high'`   → callout `△ Anomalía a validar` (fondo amber).
 *   - `severity: 'medium'` → marca atención (dot ámbar).
 *   - `severity: 'low'`    → nota al pie sin callout visual.
 *
 * `benchmarkBand` es opcional porque algunas anomalías son cualitativas
 * (e.g. "saldo acreedor en cuenta de activo"). Cuando se provee, el renderer
 * pinta la barra horizontal con banda verde + dot ámbar para el observado.
 */
export const AnomalyFlagSchema = z.object({
  severity: ConfidenceLevelSchema,
  message: z.string().min(1).describe('Texto humano que explica la anomalía. Sin adjetivos prohibidos.'),
  normaRef: NormaRef.nullable().describe('Norma sectorial o NIIF que define el rango esperado.'),
  benchmarkBand: z
    .object({
      lowerBound: z.string().describe('Cota inferior sectorial. Ej: "5%"'),
      upperBound: z.string().describe('Cota superior sectorial. Ej: "15%"'),
      observed: z.string().describe('Valor observado en el reporte. Ej: "32%"'),
    })
    .nullable()
    .describe('Banda visual de benchmark CIIU. Null si la anomalía es cualitativa.'),
});
export type AnomalyFlag = z.infer<typeof AnomalyFlagSchema>;

// ---------------------------------------------------------------------------
// Company / Signatories — espejo Zod de los interfaces TS en `../types.ts`
// ---------------------------------------------------------------------------

export const SignatoriesSchema = z.object({
  representanteLegal: z
    .object({ nombre: z.string().min(1) })
    .nullable()
    .describe('Representante Legal (Ley 222/1995 art. 23)'),
  revisorFiscal: z
    .object({
      nombre: z.string().min(1),
      tp: z
        .string()
        .regex(/^\d+-T$/i, 'T.P. debe ir en formato "12345-T"')
        .describe('Tarjeta Profesional Junta Central de Contadores'),
    })
    .nullable()
    .describe('Revisor Fiscal (Ley 43/1990 art. 10)'),
  contadorPublico: z
    .object({
      nombre: z.string().min(1),
      tp: z.string().regex(/^\d+-T$/i, 'T.P. debe ir en formato "12345-T"'),
    })
    .nullable()
    .describe('Contador Público (Ley 43/1990 art. 13)'),
});

export type SignatoriesJson = z.infer<typeof SignatoriesSchema>;

export const CompanyInfoSchema = z.object({
  name: z.string().min(1),
  nit: z.string().min(1),
  entityType: z.string().nullable().describe('SAS, SA, LTDA, etc.'),
  sector: z.string().nullable(),
  niifGroup: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .nullable()
    .describe('1 = Plenas, 2 = PYMES, 3 = Simplificada'),
  fiscalPeriod: FiscalYear,
  comparativePeriod: FiscalYear.nullable(),
  city: z.string().nullable(),
  signatories: SignatoriesSchema.nullable(),
});

export type CompanyInfoJson = z.infer<typeof CompanyInfoSchema>;

// ---------------------------------------------------------------------------
// Building blocks de Estados Financieros
// ---------------------------------------------------------------------------

/**
 * Una línea de un Estado Financiero — código de cuenta opcional + descripción
 * legible + cifras por periodo. Sirve para Balance, P&G, EFE y ECP.
 *
 * `level` controla la jerarquía visual del renderer:
 *   0 = sección (e.g. "ACTIVOS")
 *   1 = subgrupo (e.g. "Activos corrientes")
 *   2 = línea de detalle
 *   3 = total intermedio
 *   4 = total final / TOTAL ACTIVOS
 */
export const StatementLineSchema = z.object({
  account: z
    .string()
    .nullable()
    .describe('Código PUC opcional (ej. "1105"). Null si es total/subtotal.'),
  label: z.string().min(1).describe('Etiqueta legible. Ej: "Efectivo y equivalentes"'),
  amountPrimary: MoneyCop.describe('Cifra del periodo actual en centavos'),
  amountComparative: MoneyCop.nullable().describe('Cifra del periodo comparativo en centavos. Null si N/A.'),
  level: z
    .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .describe('Jerarquía visual 0=sección 1=subgrupo 2=detalle 3=subtotal 4=total'),
  isAbsolute: z
    .boolean()
    .describe('Si true, las cifras ya vienen en valor absoluto (regla NIIF Analyst). False solo para deltas/ajustes.'),
});

export type StatementLineJson = z.infer<typeof StatementLineSchema>;

/**
 * Una nota técnica al pie de un EEFF. Cita norma + detalle.
 */
export const StatementNoteSchema = z.object({
  ref: z
    .string()
    .nullable()
    .describe('Referencia cruzada (ej. "Nota 3", "*"). Null si es nota libre.'),
  norma: NormaRef.nullable(),
  body: z.string().min(1).describe('Cuerpo de la nota'),
});

export type StatementNoteJson = z.infer<typeof StatementNoteSchema>;

// ---------------------------------------------------------------------------
// ARITMÉTICA VINCULANTE DEL ACTA SOCIETARIA (auditoría de cálculos 2026-08, §3)
// ---------------------------------------------------------------------------
//
// Por qué esto vive aquí y no en el prompt: el acta es el único documento del
// entregable que se FIRMA, se inscribe en Cámara de Comercio y REPARTE DINERO,
// y hasta hoy TODA su aritmética —reserva legal, capitalización y cada renglón
// de destinación— la autoraba el LLM sin un solo cruce. La auditoría lo midió:
// reserva del 10% calculada sobre el PATRIMONIO en vez de sobre la utilidad
// ($222.343.999,15 contra $222.849.678,97) y capitalización deslizada del 40%
// al 4% ($89.139.871,58 contra $891.398.715,89, un error de $802.258.844,31)
// atravesaron el sistema con `ok:true`, `emittable:true`, cero blockers y
// descarga habilitada.
//
// Ninguna de esas cifras es juicio contable: las tres son proyecciones
// deterministas de la utilidad neta, que el preprocesador ya conoce al centavo.
// Este módulo las calcula en BigInt de centavos (vía `pctFloorMoneyCop`), las
// entrega al prompt como tokens `[MoneyCop: N]` que el modelo COPIA, y expone
// el reconciliador que cruza lo emitido contra lo calculado con tolerancia $0.
//
// Base normativa de cada operación (verificada contra fuente oficial vigente):
//
//   Art. 151 C.Co.  — no hay destinación de utilidades mientras existan pérdidas
//                     de ejercicios anteriores sin enjugar. Es la PRIMERA línea
//                     de la tabla, no una nota al pie.
//   Art. 452 C.Co.  — la reserva legal se forma con el 10% de las utilidades
//                     líquidas de cada ejercicio HASTA alcanzar el 50% del
//                     capital suscrito. Ese TECHO es el que el sistema nunca
//                     evaluó: sin él, el acta ordena apropiar indefinidamente.
//   Art. 154 C.Co.  — reservas ocasionales: las decide la asamblea con
//                     destinación especial. NO son "Ley 222/1995 art. 187".
//   Art. 155 C.Co.  — (modificado por el Art. 240 de la Ley 222/1995) mínimo
//                     del 50% de las utilidades líquidas —o del saldo tras
//                     enjugar pérdidas— a repartir como dividendo, salvo
//                     decisión en contrario aprobada por el 78% de las acciones
//                     representadas.
//   Art. 454 C.Co.  — si la suma de reservas legal + estatutarias + ocasionales
//                     excede el 100% del capital suscrito, ese mínimo sube al 70%.
//   Art. 45 Ley 1258/2008 — remisión: la SAS se rige primero por sus estatutos.
//                     La reserva legal NO es obligatoria en la SAS salvo
//                     habilitación estatutaria (Supersociedades Oficios
//                     220-115333/2009 y 220-069664/2017).
//
// Convención de signos: todas las entradas viajan en centavos BigInt con el
// signo natural del preprocesador. `accumulatedLossesCents` es la MAGNITUD
// POSITIVA de la pérdida pendiente (el llamador ya la convirtió).
// ---------------------------------------------------------------------------

const ZERO_CENTS = BigInt(0);

/**
 * Tri-estado del interruptor estatutario que decide TODO el régimen de reserva
 * legal de una SAS.
 *
 * Por qué tri-estado y no booleano: `estatutosRequierenReservaLegal` no tiene
 * NINGÚN productor en el repositorio — llega siempre `undefined`. El código
 * anterior lo colapsaba con `=== true`, de modo que toda SAS declaraba en un
 * documento firmado por su representante legal que sus estatutos NO exigen
 * reserva legal: una afirmación sobre un documento que nadie leyó. `no_declarado`
 * existe para que el acta pueda callar en vez de mentir.
 */
export type EstatutosReservaLegal = 'exigida' | 'no_exigida' | 'no_declarado';

/** Normaliza el flag del intake (booleano legacy / string / ausente) al tri-estado. */
export function normalizeEstatutosReservaLegal(raw: unknown): EstatutosReservaLegal {
  if (raw === true) return 'exigida';
  if (raw === false) return 'no_exigida';
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    if (v === 'true' || v === 'si' || v === 'sí' || v === 'exigida') return 'exigida';
    if (v === 'false' || v === 'no' || v === 'no_exigida') return 'no_exigida';
  }
  return 'no_declarado';
}

/** Régimen de reserva legal efectivamente aplicable a la entidad. */
export type ActaReserveRegime =
  /** No-SAS: el Art. 452 C.Co. la impone por ley. */
  | 'obligatoria_ley'
  /** SAS cuyos estatutos la habilitan expresamente (Art. 45 Ley 1258/2008). */
  | 'obligatoria_estatutos'
  /** SAS cuyos estatutos se consultaron y NO la exigen. */
  | 'no_obligatoria'
  /** SAS sin declaración de estatutos: el acta NO puede afirmar régimen alguno. */
  | 'indeterminado';

/** Deriva el régimen desde el tipo societario + el tri-estado del intake. */
export function deriveActaReserveRegime(
  isSAS: boolean,
  estatutos: EstatutosReservaLegal,
): ActaReserveRegime {
  if (!isSAS) return 'obligatoria_ley';
  if (estatutos === 'exigida') return 'obligatoria_estatutos';
  if (estatutos === 'no_exigida') return 'no_obligatoria';
  return 'indeterminado';
}

/** `true` cuando el régimen obliga a apropiar reserva legal del ejercicio. */
export function regimeConstituyeReservaLegal(regime: ActaReserveRegime): boolean {
  return regime === 'obligatoria_ley' || regime === 'obligatoria_estatutos';
}

export interface ActaArithmeticInput {
  /** Utilidad neta del ejercicio (ancla `utilidadNeta` del preprocesador). */
  netIncomeCents: bigint;
  /** Pérdidas de ejercicios anteriores pendientes de enjugar, MAGNITUD POSITIVA (Art. 151 C.Co.). */
  accumulatedLossesCents: bigint;
  /** Capital suscrito y pagado (PUC 3115+3120). `null` si la Clase 3 no lo declara. */
  capitalSuscritoPagadoCents: bigint | null;
  /** Reserva legal ya acumulada (PUC 3305). `null` si no se identifica. */
  reservaLegalAcumuladaCents: bigint | null;
  /** Otras reservas (PUC 3310-3395). `null` si no se identifican. */
  otrasReservasCents: bigint | null;
  regime: ActaReserveRegime;
  /** Porcentaje de reserva ocasional que propone la política del acta (Art. 154 C.Co.). */
  reservaOcasionalPct: number;
  /** Porcentaje de capitalización propuesto (heurístico del producto, NO porcentaje legal). */
  capitalizationPct: number;
}

/** Un renglón de la tabla de destinación, ya calculado en centavos. */
export interface ActaDistributionLine {
  key: 'enjugar_perdidas' | 'reserva_legal' | 'reserva_ocasional' | 'distribuible';
  /** Etiqueta exacta que debe aparecer en `resultDistribution.lines[].label`. */
  label: string;
  /** MoneyCop en centavos — el modelo lo copia literalmente. */
  amountCop: string;
  /** Cita normativa exacta del renglón. */
  normReference: string;
}

export interface ActaArithmetic {
  regime: ActaReserveRegime;
  /** Utilidad neta del ejercicio — ancla dura, base del 10% del Art. 452 C.Co. */
  netIncomeCop: string;
  /** Pérdidas de ejercicios anteriores absorbidas en esta destinación (Art. 151 C.Co.). */
  enjugarPerdidasCop: string;
  /** Saldo tras enjugar pérdidas — base del mínimo del Art. 155 C.Co. */
  saldoDistribuibleCop: string;
  /** 10% de la utilidad líquida del ejercicio, SIN aplicar el techo. */
  apropiacionTeorica10Cop: string;
  /** Techo del Art. 452 C.Co. = 50% del capital suscrito. `null` si no se declara capital. */
  techoArt452Cop: string | null;
  /** Cuánto falta para alcanzar el techo. `null` si no se declara capital. */
  reservaLegalPendienteCop: string | null;
  /** Apropiación EFECTIVA del ejercicio, ya topada por el Art. 452 C.Co. */
  reservaLegalDelEjercicioCop: string;
  /** `true` cuando la reserva acumulada ya alcanzó el 50% del capital suscrito. */
  topeArt452Alcanzado: boolean;
  /** `false` cuando la Clase 3 no trae capital suscrito: el techo NO es evaluable. */
  capitalSuscritoDeclarado: boolean;
  /** `true` sólo cuando el acta puede proponer una tabla de destinación con cifras. */
  distributionApplies: boolean;
  /** Renglones de la tabla. Σ amountCop == netIncomeCop con tolerancia $0. */
  lines: ActaDistributionLine[];
  reservaOcasionalCop: string;
  distribuibleCop: string;
  /** Mínimo legal a repartir: 50% (Art. 155) o 70% (Art. 454) del saldo. */
  minimoArt155Cop: string;
  minimoArt155Pct: 50 | 70;
  /** Cuánto falta para llegar al mínimo. `"0"` cuando la propuesta ya lo cumple. */
  deficitArt155Cop: string;
  /** `true` cuando la propuesta queda por debajo del mínimo → mayoría del 78%. */
  requiereMayoria78: boolean;
  capitalizationApplies: boolean;
  capitalizationBaseCop: string;
  capitalizationAmountCop: string;
  /** `true` si la capitalización propuesta excede lo que la tabla deja disponible. */
  capitalizacionExcedeDestinable: boolean;
}

/** Umbral de materialidad de la utilidad para proponer capitalización: $1.000.000. */
const CAPITALIZACION_UMBRAL_CENTS = BigInt(100_000_000);

/**
 * Calcula, en centavos exactos, todas las cifras que el acta debe declarar.
 *
 * Invariante que el reconciliador exige: `Σ lines[].amountCop == netIncomeCop`
 * con tolerancia $0. La tabla de destinación de un acta que no suma la utilidad
 * aprobada es un reparto de dinero que no existe.
 */
export function buildActaArithmetic(input: ActaArithmeticInput): ActaArithmetic {
  const net = input.netIncomeCents;
  const netCop = serializeMoneyCop(net);
  const constituye = regimeConstituyeReservaLegal(input.regime);

  // Ejercicio en pérdida: no hay utilidad líquida que destinar. El acta no
  // reparte nada y la asamblea decide el cubrimiento de la pérdida.
  if (net <= ZERO_CENTS) {
    const zero = serializeMoneyCop(ZERO_CENTS);
    return {
      regime: input.regime,
      netIncomeCop: netCop,
      enjugarPerdidasCop: zero,
      saldoDistribuibleCop: zero,
      apropiacionTeorica10Cop: zero,
      techoArt452Cop: null,
      reservaLegalPendienteCop: null,
      reservaLegalDelEjercicioCop: zero,
      topeArt452Alcanzado: false,
      capitalSuscritoDeclarado: input.capitalSuscritoPagadoCents !== null,
      distributionApplies: false,
      lines: [],
      reservaOcasionalCop: zero,
      distribuibleCop: zero,
      minimoArt155Cop: zero,
      minimoArt155Pct: 50,
      deficitArt155Cop: zero,
      requiereMayoria78: false,
      capitalizationApplies: false,
      capitalizationBaseCop: netCop,
      capitalizationAmountCop: zero,
      capitalizacionExcedeDestinable: false,
    };
  }

  // Art. 151 C.Co. — primero se enjugan las pérdidas de ejercicios anteriores.
  const perdidas = input.accumulatedLossesCents > ZERO_CENTS ? input.accumulatedLossesCents : ZERO_CENTS;
  const enjugar = perdidas > net ? net : perdidas;
  const saldo = net - enjugar;

  // Art. 452 C.Co. — la base del 10% es la utilidad líquida DEL EJERCICIO
  // (utilidad neta después de impuestos), no el patrimonio ni el saldo tras
  // pérdidas. Es exactamente la cifra que la auditoría midió mal.
  const apropiacionTeorica = pctFloorMoneyCop(netCop, 10);

  const capitalDeclarado = input.capitalSuscritoPagadoCents !== null;
  const techo = capitalDeclarado
    ? pctFloorMoneyCop(serializeMoneyCop(input.capitalSuscritoPagadoCents as bigint), 50)
    : null;
  const acumulada = input.reservaLegalAcumuladaCents ?? ZERO_CENTS;
  const pendiente =
    techo !== null
      ? serializeMoneyCop(maxZero(parseMoneyCop(techo) - acumulada))
      : null;

  let reservaLegal = ZERO_CENTS;
  if (constituye) {
    // Sin techo evaluable (Clase 3 sin capital suscrito) se apropia el 10%
    // teórico: el acta declara el dato faltante en vez de inventar un techo.
    const topada = pendiente !== null ? minMoneyCop(apropiacionTeorica, pendiente) : apropiacionTeorica;
    // Nunca se apropia más de lo que queda tras enjugar pérdidas.
    reservaLegal = minBig(parseMoneyCop(topada), saldo);
    if (reservaLegal < ZERO_CENTS) reservaLegal = ZERO_CENTS;
  }
  const topeAlcanzado = pendiente !== null && parseMoneyCop(pendiente) <= ZERO_CENTS;

  const saldoCop = serializeMoneyCop(saldo);
  const ocasional = parseMoneyCop(pctFloorMoneyCop(saldoCop, clampPct(input.reservaOcasionalPct)));
  // El distribuible es el RESIDUO, nunca un porcentaje independiente: así la
  // tabla cierra contra la utilidad neta al centavo aunque los pisos trunquen.
  const distribuible = saldo - reservaLegal - ocasional;

  // Art. 454 C.Co. — reservas totales > 100% del capital suscrito eleva el
  // mínimo del Art. 155 del 50% al 70%.
  const otras = input.otrasReservasCents ?? ZERO_CENTS;
  const reservasTotales = acumulada + otras + reservaLegal;
  const minimoPct: 50 | 70 =
    capitalDeclarado && reservasTotales > (input.capitalSuscritoPagadoCents as bigint) ? 70 : 50;
  const minimoArt155 = pctFloorMoneyCop(saldoCop, minimoPct);
  const deficit = maxZero(parseMoneyCop(minimoArt155) - distribuible);

  const lines: ActaDistributionLine[] = [];
  if (enjugar > ZERO_CENTS) {
    lines.push({
      key: 'enjugar_perdidas',
      label: 'Enjugamiento de pérdidas de ejercicios anteriores',
      amountCop: serializeMoneyCop(enjugar),
      normReference: 'Art. 151 C.Co.',
    });
  }
  if (constituye) {
    lines.push({
      key: 'reserva_legal',
      label: 'Reserva legal (10% de la utilidad líquida del ejercicio)',
      amountCop: serializeMoneyCop(reservaLegal),
      normReference: 'Art. 452 C.Co.',
    });
  }
  lines.push({
    key: 'reserva_ocasional',
    label: `Reserva ocasional (${clampPct(input.reservaOcasionalPct)}% del saldo)`,
    amountCop: serializeMoneyCop(ocasional),
    normReference: 'Art. 154 C.Co.',
  });
  lines.push({
    key: 'distribuible',
    label: 'Saldo distribuible a los asociados',
    amountCop: serializeMoneyCop(distribuible),
    normReference: 'Art. 155 C.Co. (modificado por el Art. 240 de la Ley 222/1995)',
  });

  // El acta sólo propone tabla de destinación con cifras cuando el régimen
  // OBLIGA a constituir reserva legal. Con `no_obligatoria` la propuesta es
  // neutra —es lo que exige el gate societario para una SAS conforme— y con
  // `indeterminado` la asamblea decide con vista en unos estatutos que nadie
  // suministró: en ninguno de los dos casos el acta reparte cifras.
  const distributionApplies = constituye;

  const capitalizationApplies = net > CAPITALIZACION_UMBRAL_CENTS;
  const capitalizationAmount = capitalizationApplies
    ? pctFloorMoneyCop(netCop, clampPct(input.capitalizationPct))
    : serializeMoneyCop(ZERO_CENTS);
  // La capitalización es entrega de dividendo en especie: se imputa contra lo
  // que la tabla deja libre (reserva ocasional + distribuible), no se suma
  // encima. Si lo excediera, el acta estaría comprometiendo dos veces la misma
  // plata.
  const destinableLibre = ocasional + distribuible;
  const capitalizacionExcede = parseMoneyCop(capitalizationAmount) > destinableLibre;

  return {
    regime: input.regime,
    netIncomeCop: netCop,
    enjugarPerdidasCop: serializeMoneyCop(enjugar),
    saldoDistribuibleCop: saldoCop,
    apropiacionTeorica10Cop: apropiacionTeorica,
    techoArt452Cop: techo,
    reservaLegalPendienteCop: pendiente,
    reservaLegalDelEjercicioCop: serializeMoneyCop(reservaLegal),
    topeArt452Alcanzado: topeAlcanzado,
    capitalSuscritoDeclarado: capitalDeclarado,
    distributionApplies,
    lines,
    reservaOcasionalCop: serializeMoneyCop(ocasional),
    distribuibleCop: serializeMoneyCop(distribuible),
    minimoArt155Cop: minimoArt155,
    minimoArt155Pct: minimoPct,
    deficitArt155Cop: serializeMoneyCop(deficit),
    requiereMayoria78: deficit > ZERO_CENTS,
    capitalizationApplies,
    capitalizationBaseCop: netCop,
    capitalizationAmountCop: capitalizationAmount,
    capitalizacionExcedeDestinable: capitalizacionExcede,
  };
}

function maxZero(v: bigint): bigint {
  return v > ZERO_CENTS ? v : ZERO_CENTS;
}
function minBig(a: bigint, b: bigint): bigint {
  return a <= b ? a : b;
}
function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  const i = Math.trunc(pct);
  if (i < 0) return 0;
  if (i > 100) return 100;
  return i;
}

// ---------------------------------------------------------------------------
// Reconciliador del acta — cruza lo que emitió el LLM contra lo calculado
// ---------------------------------------------------------------------------

/** Sub-árbol del acta que el reconciliador necesita. Estructural, no nominal. */
export interface ActaEmittedFigures {
  netIncomeCop: string | null;
  distributionApplies: boolean;
  distributionLines: ReadonlyArray<{ label: string; amountCop: string }>;
  capitalizationApplies: boolean;
  capitalizationBaseCop: string | null;
  capitalizationAmountCop: string | null;
}

/**
 * Una cifra del acta que el modelo emitió distinta de la determinista.
 * Mismos campos que `AnchorDeviation` del reconciliador del NIIF (`field`,
 * `label`, `emitted`, `expected`, `gapCents`) para que el call-site pueda
 * mezclarlas en el mismo `ReconciliationOutcome` sin adaptador.
 */
export interface ActaDeviation {
  field: string;
  label: string;
  emitted: string;
  expected: string;
  /** `emitted − expected`, en centavos. */
  gapCents: string;
}

const MONEY_RE = /^-?\d+$/;

/**
 * Cruza el acta emitida contra la aritmética determinista, tolerancia $0.
 *
 * Detecta exactamente los dos errores que la auditoría midió pasando limpios:
 * reserva legal calculada sobre una base equivocada y capitalización con el
 * porcentaje deslizado. Devuelve `[]` cuando el acta cuadra al centavo.
 */
export function reconcileActaArithmetic(
  emitted: ActaEmittedFigures,
  expected: ActaArithmetic,
): ActaDeviation[] {
  const out: ActaDeviation[] = [];
  const push = (field: string, label: string, e: string, x: string) => {
    out.push({ field, label, emitted: e, expected: x, gapCents: serializeMoneyCop(parseMoneyCop(e) - parseMoneyCop(x)) });
  };
  const money = (v: string | null | undefined): string | null =>
    typeof v === 'string' && MONEY_RE.test(v) ? v : null;

  // 1. Utilidad neta del acta ≡ ancla del P&L.
  const net = money(emitted.netIncomeCop);
  if (net === null) {
    push('shareholderMinutes.resultDistribution.netIncomeCop', 'Utilidad Neta del acta', '0', expected.netIncomeCop);
  } else if (net !== expected.netIncomeCop && parseMoneyCop(net) !== parseMoneyCop(expected.netIncomeCop)) {
    push('shareholderMinutes.resultDistribution.netIncomeCop', 'Utilidad Neta del acta', net, expected.netIncomeCop);
  }

  // 2. El régimen: un acta que reparte cifras sin régimen resuelto declara
  //    sobre estatutos que nadie leyó.
  if (emitted.distributionApplies !== expected.distributionApplies) {
    out.push({
      field: 'shareholderMinutes.resultDistribution.applies',
      label: `Régimen de destinación (${expected.regime})`,
      emitted: emitted.distributionApplies ? 'true' : 'false',
      expected: expected.distributionApplies ? 'true' : 'false',
      gapCents: '0',
    });
  }

  if (expected.distributionApplies && emitted.distributionApplies) {
    // 3. Σ renglones == utilidad neta (tolerancia $0).
    let suma = ZERO_CENTS;
    for (const l of emitted.distributionLines) {
      const v = money(l?.amountCop);
      if (v !== null) suma += parseMoneyCop(v);
    }
    if (suma !== parseMoneyCop(expected.netIncomeCop)) {
      push(
        'shareholderMinutes.resultDistribution.lines[Σ]',
        'Σ de los renglones de destinación',
        serializeMoneyCop(suma),
        expected.netIncomeCop,
      );
    }

    // 4. Cada renglón determinista contra su homólogo emitido.
    for (const exp of expected.lines) {
      const hit = emitted.distributionLines.find((l) => matchesLineKey(l?.label ?? '', exp.key));
      if (!hit) {
        push(`shareholderMinutes.resultDistribution.lines[${exp.key}]`, exp.label, '0', exp.amountCop);
        continue;
      }
      const v = money(hit.amountCop);
      if (v === null || parseMoneyCop(v) !== parseMoneyCop(exp.amountCop)) {
        push(`shareholderMinutes.resultDistribution.lines[${exp.key}]`, exp.label, v ?? '0', exp.amountCop);
      }
    }
  }

  // 5. Reserva legal constituida bajo un régimen que no la exige: es el
  //    defecto societario, no aritmético — se reporta con gap $0 si el monto
  //    coincidiera, pero el renglón no debería existir.
  if (!regimeConstituyeReservaLegal(expected.regime)) {
    const rl = emitted.distributionLines.find((l) => matchesLineKey(l?.label ?? '', 'reserva_legal'));
    const v = rl ? money(rl.amountCop) : null;
    if (v !== null && parseMoneyCop(v) !== ZERO_CENTS) {
      push(
        'shareholderMinutes.resultDistribution.lines[reserva_legal]',
        `Reserva legal apropiada bajo régimen "${expected.regime}"`,
        v,
        '0',
      );
    }
  }

  // 6. Capitalización: base y monto.
  if (expected.capitalizationApplies) {
    const base = money(emitted.capitalizationBaseCop);
    if (base === null || parseMoneyCop(base) !== parseMoneyCop(expected.capitalizationBaseCop)) {
      push(
        'shareholderMinutes.capitalizationProposal.retainedEarningsBaseCop',
        'Base de la capitalización',
        base ?? '0',
        expected.capitalizationBaseCop,
      );
    }
    const amt = money(emitted.capitalizationAmountCop);
    if (amt === null || parseMoneyCop(amt) !== parseMoneyCop(expected.capitalizationAmountCop)) {
      push(
        'shareholderMinutes.capitalizationProposal.capitalizationAmountCop',
        'Monto a capitalizar',
        amt ?? '0',
        expected.capitalizationAmountCop,
      );
    }
  }

  return out;
}

/** Empareja la etiqueta libre del LLM con el renglón determinista. */
function matchesLineKey(label: string, key: ActaDistributionLine['key']): boolean {
  const l = label.toLowerCase();
  switch (key) {
    case 'reserva_legal':
      return /reserva\s+legal/.test(l);
    case 'reserva_ocasional':
      return /reserva\s+(ocasional|estatutaria|voluntaria)/.test(l);
    case 'enjugar_perdidas':
      return /(enjug|p[ée]rdida)/.test(l);
    case 'distribuible':
      return /(distribu|dividendo|participaci)/.test(l);
    default:
      return false;
  }
}

/**
 * Texto de las salvedades del acta, en el mismo formato que
 * `describeQualifications` del reconciliador del NIIF, para que el sello
 * "REPORTE CON SALVEDADES" pueda incorporarlas sin traducción.
 */
export function describeActaQualifications(devs: readonly ActaDeviation[]): string[] {
  return devs.map((d) => {
    if (d.gapCents === '0' && !MONEY_RE.test(d.emitted)) {
      return `Acta — ${d.label}: el especialista emitió "${d.emitted}" donde corresponde "${d.expected}".`;
    }
    return (
      `Acta — ${d.label}: el especialista emitió ${formatCopFromCents(parseMoneyCop(d.emitted))} ` +
      `frente a ${formatCopFromCents(parseMoneyCop(d.expected))} calculados de forma determinista ` +
      `sobre la utilidad neta del ejercicio (diferencia ${formatCopFromCents(parseMoneyCop(d.gapCents))}).`
    );
  });
}
