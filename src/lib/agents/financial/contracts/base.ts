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
