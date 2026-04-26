// ---------------------------------------------------------------------------
// Repair Chat — Tool definitions + executor
// ---------------------------------------------------------------------------
// Tools del agente "Doctor de Datos":
//   1. read_account(code)        — busqueda PUC sobre el preprocessed.
//   2. mark_provisional({reason}) — senal a la UI; no muta nada en el server.
//
// Convencion de la app: las tools NO traen `execute`, el loop manual del
// runner las despacha pasando un context per-call. Esto preserva la semantica
// del registry principal (BaseSpecialist) y permite pasar el preprocessed
// directamente sin closures globales.
// ---------------------------------------------------------------------------

import { tool } from 'ai';
import { z } from 'zod';
import type {
  PreprocessedBalance,
  ValidatedAccount,
} from '@/lib/preprocessing/trial-balance';
import type {
  MarkProvisionalOutput,
  ReadAccountOutput,
  RepairLanguage,
  RepairToolName,
} from './types';

// ---------------------------------------------------------------------------
// Schemas (publicos para el AI SDK)
// ---------------------------------------------------------------------------

const READ_ACCOUNT = tool({
  description:
    'Lee el saldo y descendientes de una cuenta PUC colombiana en el balance pre-procesado. ' +
    'Acepta codigo de Clase (1 digito), Grupo (2), Cuenta (4), Subcuenta (6) o Auxiliar (8+). ' +
    'Devuelve saldo, naturaleza, total de la clase padre y, cuando aplica, la lista de cuentas hijas. ' +
    'USA ESTA TOOL antes de afirmar cualquier saldo: nunca inventes numeros.',
  inputSchema: z.object({
    code: z
      .string()
      .min(1)
      .describe('Codigo PUC a inspeccionar. Ejemplos: "11", "1105", "110505".'),
  }),
});

const MARK_PROVISIONAL = tool({
  description:
    'Marca el reporte como BORRADOR (provisional) con una razon documentada por el usuario. ' +
    'Solo invoca esta tool cuando el usuario haya confirmado de manera EXPLICITA en su ultimo turno ' +
    'que quiere generar el reporte como borrador a pesar del error de validacion. ' +
    'No mutes nada por iniciativa propia: si el usuario duda, pidele que confirme con palabras claras.',
  inputSchema: z.object({
    reason: z
      .string()
      .min(10)
      .describe('Razon literal o parafraseada del usuario (>=10 caracteres). No inventes razones.'),
  }),
});

export const repairTools = {
  read_account: READ_ACCOUNT,
  mark_provisional: MARK_PROVISIONAL,
};

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface RepairToolContext {
  preprocessed: PreprocessedBalance | null;
  language: RepairLanguage;
}

interface AccountIndex {
  byCode: Map<string, AccountEntry>;
  /** Codigos ordenados — para busquedas por prefijo. */
  sortedCodes: string[];
}

interface AccountEntry {
  account: ValidatedAccount;
  classCode: string;
}

let cachedIndex: { source: PreprocessedBalance; index: AccountIndex } | null = null;

/**
 * Construye (o recupera de cache) un indice por codigo PUC sobre las cuentas
 * hoja del preprocesado. Cache invalida automaticamente cuando cambia el
 * `preprocessed` por identidad (cada request en el server route llama un
 * nuevo `preprocessTrialBalance`).
 */
function buildIndex(pp: PreprocessedBalance): AccountIndex {
  if (cachedIndex && cachedIndex.source === pp) return cachedIndex.index;

  const byCode = new Map<string, AccountEntry>();
  for (const cls of pp.classes) {
    for (const acc of cls.accounts) {
      byCode.set(acc.code, { account: acc, classCode: String(cls.code) });
    }
  }
  const sortedCodes = Array.from(byCode.keys()).sort();
  const idx: AccountIndex = { byCode, sortedCodes };
  cachedIndex = { source: pp, index: idx };
  return idx;
}

/**
 * Ejecuta una tool del Repair Chat por nombre. Devuelve el output estructurado
 * que sera serializado a JSON y enviado de vuelta al modelo y a la UI.
 */
export async function executeRepairTool(
  name: RepairToolName,
  args: Record<string, unknown>,
  ctx: RepairToolContext,
): Promise<unknown> {
  switch (name) {
    case 'read_account':
      return executeReadAccount(args, ctx);
    case 'mark_provisional':
      return executeMarkProvisional(args, ctx);
    default: {
      // exhaustive — typescript debe verificar que llegamos aqui solo si se
      // agrego un nombre nuevo sin caso. En runtime, ayuda al debugging.
      const _exhaustive: never = name;
      throw new Error(`Unknown repair tool: ${String(_exhaustive)}`);
    }
  }
}

function executeReadAccount(
  args: Record<string, unknown>,
  ctx: RepairToolContext,
): ReadAccountOutput {
  const codeRaw = typeof args.code === 'string' ? args.code : '';
  // Normalizamos como en parseTrialBalanceCSV: removemos puntos/guiones/espacios.
  const code = codeRaw.replace(/[.\-\s]/g, '');

  if (!code || !/^\d+$/.test(code)) {
    return {
      found: false,
      hint:
        ctx.language === 'es'
          ? 'El codigo debe ser numerico (ej. "11", "1105", "110505").'
          : 'The code must be numeric (e.g. "11", "1105", "110505").',
    };
  }

  if (!ctx.preprocessed) {
    return {
      found: false,
      hint:
        ctx.language === 'es'
          ? 'No hay balance pre-procesado disponible en esta sesion. Pidele al usuario que vuelva a subir el archivo.'
          : 'No preprocessed balance available in this session. Ask the user to re-upload the file.',
    };
  }

  const pp = ctx.preprocessed;
  const idx = buildIndex(pp);
  const classDigit = code[0];
  const classObj = pp.classes.find((c) => String(c.code) === classDigit);
  const classTotal = classObj?.auxiliaryTotal ?? 0;
  const classCodeStr = classDigit;

  // ---------------------------------------------------------------------------
  // Caso 1: match exacto contra una cuenta hoja
  // ---------------------------------------------------------------------------
  const exact = idx.byCode.get(code);
  if (exact) {
    return {
      found: true,
      account: {
        code: exact.account.code,
        name: exact.account.name,
        balance: exact.account.balance,
        previousBalance: exact.account.previousBalance ?? null,
        isLeaf: exact.account.isLeaf,
        level: parseLevelToNumber(exact.account.level),
        classCode: exact.classCode,
        classTotal: classObj?.auxiliaryTotal ?? 0,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Caso 2: el codigo es un agregado (Clase / Grupo / Cuenta / Subcuenta) que
  // no aparece como hoja, pero tiene descendientes. Sumamos los hijos directos
  // (un nivel mas profundo cuando es razonable, o todos los descendientes si
  // el nivel no es deducible).
  // ---------------------------------------------------------------------------
  const children = idx.sortedCodes
    .filter((c) => c.startsWith(code) && c !== code)
    .map((c) => idx.byCode.get(c)!.account);

  if (children.length > 0) {
    const aggregatedBalance = children.reduce((s, a) => s + a.balance, 0);
    const aggregatedPrev = children.reduce<number | null>((s, a) => {
      if (a.previousBalance === undefined) return s;
      return (s ?? 0) + a.previousBalance;
    }, null);

    // Para el listado de hijos preferimos mostrar el siguiente nivel jerarquico
    // (codigos cuya longitud sea la del codigo pedido + 2) si existen — eso
    // matchea el escalonamiento PUC clasico (1 -> 11 -> 1105 -> 110505 -> 8+).
    // Si no, devolvemos hasta 25 hojas para no inflar el output.
    const nextLevelLen = nextHierarchyLength(code.length);
    const groupedByNext = new Map<string, { code: string; name: string; balance: number; previousBalance: number | null; isLeaf: boolean }>();

    for (const child of children) {
      const groupKey =
        nextLevelLen !== null && child.code.length >= nextLevelLen
          ? child.code.slice(0, nextLevelLen)
          : child.code;
      const existing = groupedByNext.get(groupKey);
      if (existing) {
        existing.balance += child.balance;
        if (child.previousBalance !== undefined) {
          existing.previousBalance = (existing.previousBalance ?? 0) + child.previousBalance;
        }
        // Cuando agregamos varios codigos al mismo grupo, no es estrictamente
        // hoja — pero en el output devolvemos el codigo agregado.
        existing.isLeaf = existing.code === child.code && existing.isLeaf;
      } else {
        groupedByNext.set(groupKey, {
          code: groupKey === child.code ? child.code : groupKey,
          name: groupKey === child.code ? child.name : '',
          balance: child.balance,
          previousBalance: child.previousBalance ?? null,
          isLeaf: groupKey === child.code,
        });
      }
    }

    const childList = Array.from(groupedByNext.values())
      .sort((a, b) => a.code.localeCompare(b.code))
      .slice(0, 25);

    return {
      found: true,
      account: {
        code,
        name: '',
        balance: aggregatedBalance,
        previousBalance: aggregatedPrev,
        isLeaf: false,
        level: levelLabelFromLength(code.length),
        classCode: classCodeStr,
        classTotal,
        children: childList,
      },
      hint:
        ctx.language === 'es'
          ? `Codigo agregado: balance es la suma de ${children.length} hojas que comienzan por "${code}".`
          : `Aggregated code: balance is the sum of ${children.length} leaf accounts starting with "${code}".`,
    };
  }

  // ---------------------------------------------------------------------------
  // Caso 3: nada match — sugerencia por prefijo cercano
  // ---------------------------------------------------------------------------
  const fallbackPrefix = findFallbackPrefix(code, idx.sortedCodes);
  return {
    found: false,
    hint:
      fallbackPrefix !== null
        ? ctx.language === 'es'
          ? `No se encontro la cuenta "${code}". Codigos cercanos en el balance: ${fallbackPrefix}.`
          : `Account "${code}" not found. Nearby codes in the balance: ${fallbackPrefix}.`
        : ctx.language === 'es'
          ? `No se encontro la cuenta "${code}" ni codigos cercanos en el balance pre-procesado.`
          : `Account "${code}" not found, and no nearby codes exist in the preprocessed balance.`,
  };
}

function executeMarkProvisional(
  args: Record<string, unknown>,
  ctx: RepairToolContext,
): MarkProvisionalOutput {
  const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
  const safeReason = reason.length >= 10 ? reason : '(razon no documentada)';

  const watermark =
    ctx.language === 'es'
      ? `> ⚠️ **BORRADOR — VALIDACION PENDIENTE**\n> Razon declarada por el usuario: "${safeReason}"\n> NO debe firmarse por revisor fiscal en este estado.`
      : `> ⚠️ **DRAFT — VALIDATION PENDING**\n> User-stated reason: "${safeReason}"\n> Must NOT be signed by the statutory auditor in this state.`;

  return {
    acknowledged: true,
    watermark,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convierte la etiqueta de nivel ("Clase", "Grupo", "Cuenta", "Subcuenta",
 * "Auxiliar") a un numero 1..5 para el output. Si no matchea, cae en el
 * heuristico por longitud.
 */
function parseLevelToNumber(level: string): number {
  const l = level.toLowerCase().trim();
  if (l.includes('clase')) return 1;
  if (l.includes('grupo')) return 2;
  if (l.includes('sub')) return 4;
  if (l.includes('aux') || l.includes('detalle')) return 5;
  if (l.includes('cuenta')) return 3;
  return 0;
}

function levelLabelFromLength(len: number): number {
  if (len === 1) return 1;
  if (len === 2 || len === 3) return 2;
  if (len === 4 || len === 5) return 3;
  if (len === 6 || len === 7) return 4;
  return 5;
}

/**
 * Devuelve la siguiente longitud de codigo PUC en la jerarquia clasica.
 * 1 -> 2 -> 4 -> 6 -> 8. Para codigos atipicos devuelve null.
 */
function nextHierarchyLength(len: number): number | null {
  if (len === 1) return 2;
  if (len === 2) return 4;
  if (len === 4) return 6;
  if (len === 6) return 8;
  return null;
}

/**
 * Busca codigos cercanos: primero por prefijo decreciente (si pidio "1109"
 * pero no existe, intenta "110", "11", "1"); luego enumera hasta 5 codigos
 * que comparten prefijo de 2 digitos para sugerir.
 */
function findFallbackPrefix(code: string, sorted: string[]): string | null {
  for (let len = code.length - 1; len >= 1; len--) {
    const prefix = code.slice(0, len);
    const matches = sorted.filter((c) => c.startsWith(prefix));
    if (matches.length > 0) {
      return matches.slice(0, 5).join(', ');
    }
  }
  return null;
}
