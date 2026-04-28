// ---------------------------------------------------------------------------
// Repair Chat — Tool definitions + executor
// ---------------------------------------------------------------------------
// Tools del agente "Doctor de Datos":
//   1. read_account(code, period?)      — busqueda PUC sobre el snapshot indicado
//                                          (default: primary). Si hay comparative
//                                          y no se especifica period, devuelve
//                                          ambos saldos en una sola respuesta.
//   2. mark_provisional({reason})       — senal a la UI; no muta nada en el server.
//   Phase 2 (mutacion colaborativa con confirmacion humana):
//   3. propose_adjustment(...)          — propone un ajuste y devuelve preview.
//   4. apply_adjustment({id})           — emite senal `confirm_adjustment` a la UI.
//   5. recheck_validation({period?})    — re-valida con los ajustes ya aplicados.
//
// Multiperiodo (refactor T1+T5): el preprocessed expone `periods[]`, `primary`
// y `comparative`. Las tools resuelven el snapshot destino siguiendo la regla
// `arg.period > primary.period`. Si el usuario no especifica period y existe
// un comparativo, `read_account` devuelve los saldos de AMBOS para que el
// doctor pueda razonar comparativamente.
//
// Convencion de la app: las tools NO traen `execute`, el loop manual del
// runner las despacha pasando un context per-call. Esto preserva la semantica
// del registry principal (BaseSpecialist) y permite pasar el preprocessed +
// el ledger de ajustes directamente sin closures globales.
// ---------------------------------------------------------------------------

import { tool } from 'ai';
import { z } from 'zod';
import type {
  PreprocessedBalance,
  PeriodSnapshot,
  ValidatedAccount,
} from '@/lib/preprocessing/trial-balance';
import type {
  Adjustment,
  ApplyAdjustmentOutput,
  MarkProvisionalOutput,
  ProposeAdjustmentOutput,
  ReadAccountOutput,
  RecheckValidationOutput,
  RepairLanguage,
  RepairToolName,
} from './types';
import { applyAdjustments, revalidate } from './adjustments';

// ---------------------------------------------------------------------------
// Schemas (publicos para el AI SDK)
// ---------------------------------------------------------------------------

const READ_ACCOUNT = tool({
  description:
    'Lee el saldo y descendientes de una cuenta PUC colombiana en el balance pre-procesado. ' +
    'Acepta codigo de Clase (1 digito), Grupo (2), Cuenta (4), Subcuenta (6) o Auxiliar (8+). ' +
    'Devuelve saldo, naturaleza, total de la clase padre y, cuando aplica, la lista de cuentas hijas. ' +
    'Si el balance trae multiples periodos (comparativo), por defecto consulta el periodo primario; ' +
    'si NO especificas `period` y existe un comparativo, la tool devuelve TAMBIEN los saldos del ' +
    'comparativo en `comparative` para que puedas contrastar (ej. 2025 vs 2024) en una sola llamada. ' +
    'USA ESTA TOOL antes de afirmar cualquier saldo: nunca inventes numeros.',
  inputSchema: z.object({
    code: z
      .string()
      .min(1)
      .describe('Codigo PUC a inspeccionar. Ejemplos: "11", "1105", "110505".'),
    period: z
      .string()
      .min(1)
      .optional()
      .describe('Periodo opcional (ej. "2024", "2025"). Si se omite usa el periodo primario.'),
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

const PROPOSE_ADJUSTMENT = tool({
  description:
    'Propone un ajuste contable concreto: suma `amount` (signed COP) al saldo de la cuenta PUC indicada, ' +
    'en el periodo especificado (default: periodo primario). NO aplica el ajuste — solo devuelve un ' +
    'preview con los totales hipoteticos. REGLAS: invoca esta tool SOLO despues de que el usuario haya ' +
    'confirmado un valor numerico concreto y la cuenta destino. NUNCA propongas ajustes inventados ni ' +
    'asumas saldos que el usuario no haya declarado. Si el balance es comparativo y el ajuste pertenece ' +
    'a un periodo distinto al primario, especifica `period`.',
  inputSchema: z.object({
    accountCode: z
      .string()
      .min(1)
      .max(10)
      .describe('Codigo PUC destino (ej. "1120", "3605"). Si no existe, se creara como hoja en su clase.'),
    accountName: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Nombre opcional de la cuenta. Solo se usa si la cuenta no existe.'),
    amount: z
      .number()
      .refine(
        (n) => Number.isFinite(n) && n !== 0,
        'amount debe ser un numero finito distinto de cero (signed: + suma, - resta)',
      )
      .describe('Delta signed en COP. Positivo aumenta el saldo, negativo lo disminuye.'),
    rationale: z
      .string()
      .min(15)
      .max(500)
      .describe('Justificacion del ajuste basada en lo declarado por el usuario (15..500 chars).'),
    period: z
      .string()
      .min(1)
      .optional()
      .describe('Periodo opcional al que aplica el ajuste. Si se omite, usa el periodo primario.'),
  }),
});

const APPLY_ADJUSTMENT = tool({
  description:
    'Solicita aplicar un ajuste previamente propuesto, identificado por `id`. ' +
    'NO muta el server: dispara una solicitud de confirmacion al usuario via la UI. Solo cuando el usuario ' +
    'confirme inequivocamente "aplica el ajuste X", el cliente actualizara el ledger y reenviara la conversacion. ' +
    'Invoca esta tool unicamente cuando el usuario haya dicho explicitamente que quiere aplicar un ajuste especifico.',
  inputSchema: z.object({
    id: z
      .string()
      .min(1)
      .describe('Id devuelto por una llamada previa a propose_adjustment.'),
  }),
});

const RECHECK_VALIDATION = tool({
  description:
    'Re-corre la validacion aritmetica del balance con los ajustes ya APLICADOS (status === "applied"). ' +
    'Devuelve totales actualizados (activo, pasivo, patrimonio, utilidad) + estado de la ecuacion patrimonial. ' +
    'Si el balance es multi-periodo, por defecto valida el periodo primario; pasa `period` para validar otro. ' +
    'Util despues de aplicar uno o varios ajustes para confirmar al usuario que la ecuacion ya cuadra.',
  inputSchema: z.object({
    period: z
      .string()
      .min(1)
      .optional()
      .describe('Periodo opcional a re-validar. Si se omite, valida el primario.'),
  }),
});

export const repairTools = {
  read_account: READ_ACCOUNT,
  mark_provisional: MARK_PROVISIONAL,
  propose_adjustment: PROPOSE_ADJUSTMENT,
  apply_adjustment: APPLY_ADJUSTMENT,
  recheck_validation: RECHECK_VALIDATION,
};

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface RepairToolContext {
  preprocessed: PreprocessedBalance | null;
  language: RepairLanguage;
  /**
   * Phase 2: ledger replicado por el cliente. El server NO persiste — solo lee.
   * Los previews y rechecks aplican TODOS los ajustes con status === 'applied'
   * sobre el `preprocessed` reconstruido desde `rawCsv`.
   */
  adjustments: Adjustment[];
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

// Cache por snapshot (no por balance entero) — los snapshots son las unidades
// que indexamos. Multiperiodo: cuando se piden distintos periodos en el mismo
// turno, cada uno mantiene su propio indice.
const snapshotIndexCache = new WeakMap<PeriodSnapshot, AccountIndex>();

/**
 * Construye (o recupera de cache) un indice por codigo PUC sobre las cuentas
 * hoja del snapshot. La cache es WeakMap por identidad del snapshot, asi que
 * cada `applyAdjustments` (que clona) invalida automaticamente.
 */
function buildIndex(snap: PeriodSnapshot): AccountIndex {
  const cached = snapshotIndexCache.get(snap);
  if (cached) return cached;

  const byCode = new Map<string, AccountEntry>();
  for (const cls of snap.classes) {
    for (const acc of cls.accounts) {
      byCode.set(acc.code, { account: acc, classCode: String(cls.code) });
    }
  }
  const sortedCodes = Array.from(byCode.keys()).sort();
  const idx: AccountIndex = { byCode, sortedCodes };
  snapshotIndexCache.set(snap, idx);
  return idx;
}

/**
 * Resuelve el snapshot destino dado un balance + periodo opcional. Si `period`
 * matchea un snapshot, lo retorna; si no, retorna `null` (el caller debe
 * propagar el error al usuario). Si `period` es undefined, retorna `primary`.
 */
function resolveSnapshot(
  balance: PreprocessedBalance,
  period?: string,
): PeriodSnapshot | null {
  if (!period || !period.trim()) return balance.primary;
  return (
    balance.periods.find((s) => s.period === period.trim()) ?? null
  );
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
    case 'propose_adjustment':
      return executeProposeAdjustment(args, ctx);
    case 'apply_adjustment':
      return executeApplyAdjustment(args, ctx);
    case 'recheck_validation':
      return executeRecheckValidation(args, ctx);
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
  const periodArg = typeof args.period === 'string' ? args.period.trim() : '';
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

  // Phase 2: si hay ajustes 'applied', el agente debe ver el balance ajustado
  // — asi `read_account` refleja saldos coherentes con propose_adjustment.
  const baseBalance = applyLedgerForRead(ctx);
  if (!baseBalance) {
    return {
      found: false,
      // Coherente con buildRawTextFallback en prompt.ts: cuando no hay
      // balance pre-procesado, el agente DEBE usar el texto crudo + los
      // totales del error. NO repetimos "no tengo acceso" porque eso
      // contradice la directiva del system prompt de leer del raw text.
      hint:
        ctx.language === 'es'
          ? 'Las tools que dependen del balance pre-procesado estan deshabilitadas en esta sesion (el archivo subido no es CSV con headers). Lee el texto crudo del balance y los totales del error message directamente, como te indica el system prompt. Si necesitas calculos exactos, pidele al usuario que re-suba el archivo en formato CSV con headers (codigo, nombre, saldo).'
          : 'Tools that depend on the preprocessed balance are disabled in this session (the uploaded file is not CSV with headers). Read the raw balance text and error totals directly, as the system prompt instructs. If you need exact calculations, ask the user to re-upload the file as CSV with headers (code, name, balance).',
    };
  }

  // Resolver snapshot destino. Si el agente paso un period explicito y NO
  // existe, devolver hint con los periodos disponibles.
  const snap = resolveSnapshot(baseBalance, periodArg || undefined);
  if (!snap) {
    const known = baseBalance.periods.map((s) => s.period).join(', ');
    return {
      found: false,
      hint:
        ctx.language === 'es'
          ? `El periodo "${periodArg}" no existe en el balance. Periodos disponibles: ${known}.`
          : `Period "${periodArg}" does not exist in the balance. Available periods: ${known}.`,
    };
  }

  // Determinar si debemos incluir comparativo (solo cuando el agente NO
  // especifico period y existe `comparative`).
  const includeComparative =
    !periodArg && baseBalance.comparative !== null && baseBalance.comparative !== undefined;
  const compSnap = includeComparative ? baseBalance.comparative : null;

  const result = lookupInSnapshot(snap, code, ctx.language);
  result.period = snap.period;

  if (compSnap) {
    const compLookup = lookupInSnapshot(compSnap, code, ctx.language);
    result.comparative = {
      period: compSnap.period,
      balance: compLookup.account?.balance ?? 0,
      classTotal: compLookup.account?.classTotal ?? 0,
      found: compLookup.found,
    };
  }

  return result;
}

/**
 * Resuelve un codigo PUC dentro de UN snapshot. Es una refactorizacion del
 * caso original "lookup en preprocessed.classes" — ahora opera sobre
 * `snap.classes` y devuelve el shape ReadAccountOutput sin `period`/
 * `comparative` (los rellena el caller).
 */
function lookupInSnapshot(
  snap: PeriodSnapshot,
  code: string,
  language: RepairLanguage,
): ReadAccountOutput {
  const idx = buildIndex(snap);
  const classDigit = code[0];
  const classObj = snap.classes.find((c) => String(c.code) === classDigit);
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
        isLeaf: exact.account.isLeaf,
        level: parseLevelToNumber(exact.account.level),
        classCode: exact.classCode,
        classTotal,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Caso 2: el codigo es un agregado (Clase / Grupo / Cuenta / Subcuenta) que
  // no aparece como hoja, pero tiene descendientes.
  // ---------------------------------------------------------------------------
  const children = idx.sortedCodes
    .filter((c) => c.startsWith(code) && c !== code)
    .map((c) => idx.byCode.get(c)!.account);

  if (children.length > 0) {
    const aggregatedBalance = children.reduce((s, a) => s + a.balance, 0);

    const nextLevelLen = nextHierarchyLength(code.length);
    const groupedByNext = new Map<string, { code: string; name: string; balance: number; isLeaf: boolean }>();

    for (const child of children) {
      const groupKey =
        nextLevelLen !== null && child.code.length >= nextLevelLen
          ? child.code.slice(0, nextLevelLen)
          : child.code;
      const existing = groupedByNext.get(groupKey);
      if (existing) {
        existing.balance += child.balance;
        existing.isLeaf = existing.code === child.code && existing.isLeaf;
      } else {
        groupedByNext.set(groupKey, {
          code: groupKey === child.code ? child.code : groupKey,
          name: groupKey === child.code ? child.name : '',
          balance: child.balance,
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
        isLeaf: false,
        level: levelLabelFromLength(code.length),
        classCode: classCodeStr,
        classTotal,
        children: childList,
      },
      hint:
        language === 'es'
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
        ? language === 'es'
          ? `No se encontro la cuenta "${code}". Codigos cercanos en el balance: ${fallbackPrefix}.`
          : `Account "${code}" not found. Nearby codes in the balance: ${fallbackPrefix}.`
        : language === 'es'
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
// Phase 2 — propose / apply / recheck (multiperiodo)
// ---------------------------------------------------------------------------

function executeProposeAdjustment(
  args: Record<string, unknown>,
  ctx: RepairToolContext,
): ProposeAdjustmentOutput | { error: string } {
  if (!ctx.preprocessed) {
    return {
      error:
        ctx.language === 'es'
          ? 'No hay balance pre-procesado disponible. Pidele al usuario que vuelva a subir el archivo antes de proponer ajustes.'
          : 'No preprocessed balance available. Ask the user to re-upload the file before proposing adjustments.',
    };
  }

  const accountCodeRaw = typeof args.accountCode === 'string' ? args.accountCode : '';
  const accountCode = accountCodeRaw.replace(/[.\-\s]/g, '');
  const amount = typeof args.amount === 'number' ? args.amount : NaN;
  const rationale = typeof args.rationale === 'string' ? args.rationale.trim() : '';
  const accountNameRaw = typeof args.accountName === 'string' ? args.accountName.trim() : '';
  const periodArg = typeof args.period === 'string' ? args.period.trim() : '';

  if (!accountCode || !/^\d+$/.test(accountCode)) {
    return {
      error:
        ctx.language === 'es'
          ? 'accountCode debe ser numerico (ej. "1120", "3605").'
          : 'accountCode must be numeric (e.g. "1120", "3605").',
    };
  }
  if (!Number.isFinite(amount) || amount === 0) {
    return {
      error:
        ctx.language === 'es'
          ? 'amount debe ser un numero finito distinto de cero.'
          : 'amount must be a non-zero finite number.',
    };
  }
  if (rationale.length < 15) {
    return {
      error:
        ctx.language === 'es'
          ? 'rationale debe tener al menos 15 caracteres y reflejar lo que dijo el usuario.'
          : 'rationale must be at least 15 characters and reflect what the user stated.',
    };
  }

  // Resolver snapshot destino. Si el agente paso period y no existe, error.
  const targetSnap = resolveSnapshot(ctx.preprocessed, periodArg || undefined);
  if (!targetSnap) {
    const known = ctx.preprocessed.periods.map((s) => s.period).join(', ');
    return {
      error:
        ctx.language === 'es'
          ? `El periodo "${periodArg}" no existe en el balance. Periodos disponibles: ${known}.`
          : `Period "${periodArg}" does not exist in the balance. Available periods: ${known}.`,
    };
  }
  const resolvedPeriod = targetSnap.period;

  // Resolver nombre por defecto: usar el nombre de la cuenta hoja existente si
  // ya esta en el snapshot destino, sino usar `accountName` o fallback.
  let resolvedName = accountNameRaw || `Cuenta ${accountCode}`;
  for (const cls of targetSnap.classes) {
    const hit = cls.accounts.find((a) => a.code === accountCode);
    if (hit && hit.name) {
      resolvedName = accountNameRaw || hit.name;
      break;
    }
  }

  const id = generateId();
  const now = new Date().toISOString();

  // Construir balance hipotetico: aplicar TODOS los applied + este nuevo
  // (con status 'applied' temporalmente para preview).
  const appliedSoFar = ctx.adjustments.filter((a) => a.status === 'applied');
  const previewLedger: Adjustment[] = [
    ...appliedSoFar,
    {
      id,
      accountCode,
      accountName: resolvedName,
      amount,
      rationale,
      status: 'applied',
      proposedAt: now,
      appliedAt: now,
      period: resolvedPeriod,
    },
  ];

  // Balance "before" — solo applied previos, sin este nuevo.
  const beforeApplication = applyAdjustments(ctx.preprocessed, appliedSoFar);
  const afterApplication = applyAdjustments(ctx.preprocessed, previewLedger);

  // Localizar la cuenta en before / after dentro del snapshot afectado.
  const findLeafIn = (snap: PeriodSnapshot, code: string): ValidatedAccount | null => {
    for (const cls of snap.classes) {
      const hit = cls.accounts.find((a) => a.code === code);
      if (hit) return hit;
    }
    return null;
  };

  const beforeSnap = beforeApplication.balance.periods.find(
    (s) => s.period === resolvedPeriod,
  ) ?? beforeApplication.balance.primary;
  const afterSnap = afterApplication.balance.periods.find(
    (s) => s.period === resolvedPeriod,
  ) ?? afterApplication.balance.primary;

  const beforeLeaf = findLeafIn(beforeSnap, accountCode);
  const afterLeaf = findLeafIn(afterSnap, accountCode);
  const oldBalance = beforeLeaf ? Number(beforeLeaf.balance) || 0 : 0;
  const newBalance = afterLeaf ? Number(afterLeaf.balance) || 0 : amount;
  const isNewAccount = !beforeLeaf;
  const displayName = afterLeaf?.name || resolvedName;

  const ct = afterSnap.controlTotals;
  const ecuacionDiff = ct.activo - (ct.pasivo + ct.patrimonio);
  const ecuacionPct =
    Math.abs(ct.activo) > 0 ? (ecuacionDiff / ct.activo) * 100 : 0;
  const ecuacionOk = Math.abs(ecuacionDiff) < Math.max(Math.abs(ct.activo) * 0.01, 10_000);

  return {
    id,
    preview: {
      affectedAccount: {
        code: accountCode,
        name: displayName,
        oldBalance,
        newBalance,
        isNewAccount,
      },
      newControlTotals: {
        activo: ct.activo,
        pasivo: ct.pasivo,
        patrimonio: ct.patrimonio,
        ingresos: ct.ingresos,
        gastos: ct.gastos,
        utilidadNeta: ct.utilidadNeta,
        ecuacionDiff,
        ecuacionPct,
        ecuacionOk,
      },
    },
  };
}

function executeApplyAdjustment(
  args: Record<string, unknown>,
  ctx: RepairToolContext,
): ApplyAdjustmentOutput | { error: string } {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  if (!id) {
    return {
      error:
        ctx.language === 'es'
          ? 'Falta el id del ajuste a aplicar. Usa el id devuelto por propose_adjustment.'
          : 'Missing adjustment id. Use the id returned by propose_adjustment.',
    };
  }

  // Verificacion suave: si el id no esta en el ledger del cliente, devolvemos
  // un error para que el modelo entienda y reintente con un id valido. Si esta
  // pero ya fue aplicado/rechazado, igual devolvemos pending — la UI decide.
  const known = ctx.adjustments.find((a) => a.id === id);
  if (!known) {
    return {
      error:
        ctx.language === 'es'
          ? `No se encontro un ajuste con id "${id}" en el ledger. Verifica que primero hayas llamado propose_adjustment.`
          : `No adjustment with id "${id}" was found in the ledger. Make sure you called propose_adjustment first.`,
    };
  }

  return { status: 'pending_user_confirmation', id };
}

function executeRecheckValidation(
  args: Record<string, unknown>,
  ctx: RepairToolContext,
): RecheckValidationOutput | { error: string } {
  if (!ctx.preprocessed) {
    return {
      error:
        ctx.language === 'es'
          ? 'No hay balance pre-procesado disponible.'
          : 'No preprocessed balance available.',
    };
  }

  const periodArg = typeof args.period === 'string' ? args.period.trim() : '';
  const targetSnap = resolveSnapshot(ctx.preprocessed, periodArg || undefined);
  if (!targetSnap) {
    const known = ctx.preprocessed.periods.map((s) => s.period).join(', ');
    return {
      error:
        ctx.language === 'es'
          ? `El periodo "${periodArg}" no existe en el balance. Periodos disponibles: ${known}.`
          : `Period "${periodArg}" does not exist in the balance. Available periods: ${known}.`,
    };
  }

  const applied = ctx.adjustments.filter((a) => a.status === 'applied');
  const application = applyAdjustments(ctx.preprocessed, applied);
  const appliedSnap = application.balance.periods.find(
    (s) => s.period === targetSnap.period,
  ) ?? application.balance.primary;
  const v = revalidate(application.balance, appliedSnap);
  const ct = appliedSnap.controlTotals;
  const ecuacionDiff = ct.activo - (ct.pasivo + ct.patrimonio);
  const ecuacionPct =
    Math.abs(ct.activo) > 0 ? (ecuacionDiff / ct.activo) * 100 : 0;

  return {
    ok: v.ok,
    period: appliedSnap.period,
    errors: v.errors,
    warnings: v.warnings,
    controlTotals: {
      activo: ct.activo,
      pasivo: ct.pasivo,
      patrimonio: ct.patrimonio,
      ingresos: ct.ingresos,
      gastos: ct.gastos,
      utilidadNeta: ct.utilidadNeta,
      ecuacionDiff,
      ecuacionPct,
    },
    appliedAdjustmentsCount: applied.filter((a) => {
      // Contamos solo los applied que tocan este snapshot (period explicito o
      // default = primary). Los que apuntan a otro snapshot no afectan esta
      // ecuacion y no deberian inflar el conteo.
      const target = a.period ?? ctx.preprocessed!.primary.period;
      return target === appliedSnap.period;
    }).length,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Aplica el subset 'applied' del ledger sobre el preprocessed para read_account. */
function applyLedgerForRead(ctx: RepairToolContext): PreprocessedBalance | null {
  if (!ctx.preprocessed) return null;
  const applied = ctx.adjustments.filter((a) => a.status === 'applied');
  if (applied.length === 0) return ctx.preprocessed;
  return applyAdjustments(ctx.preprocessed, applied).balance;
}

function generateId(): string {
  // Disponible en Node 18+. Fallback robusto si por alguna razon no lo esta.
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `adj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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
