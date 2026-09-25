// ─── WS1 — Smart-Tax Engine: validador de integridad ────────────────────────
//
// validateLines: para líneas que tienen metadata.taxRuleId, verifica que
//   |tax_amount - base * rate| <= 1 centavo (tolerancia BigInt).
//
// Base de cada línea tributaria (fase 2 de la auditoría 2026-09-24,
// tributario-calc-21):
//   1. `dimensions.baseAmountCop` — la base que usó el motor al generar la
//      línea (line-generator la guarda).
//   2. Sin ella (asientos importados), el lado de la base según la operación:
//      compras → Σ débitos de las líneas sin taxRuleId (gasto / activo);
//      ventas  → Σ créditos de las líneas sin taxRuleId (ingreso).
// Antes se tomaba max(Σ débitos, Σ créditos) de todas las líneas sin
// taxRuleId: en un asiento completo la CxP / CxC pasaba a ser la base y el
// IVA y la ReteFuente correctos salían como violaciones.
//
// Útil para validar asientos ya construidos antes de persistirlos, y también
// para re-verificar asientos importados vía OCR.

import type { JournalLineInput } from '@/lib/accounting/types';
import type {
  IntegrityValidationResult,
  IntegrityViolation,
  TaxTransactionType,
} from './types';
import { getRules } from './repository';

const SCALE = BigInt(100); // centavos
const TOLERANCE_CENTAVOS = BigInt(1); // ±1 centavo

function parseCentavos(raw: string): bigint {
  const trimmed = (raw ?? '0').trim();
  const dot = trimmed.indexOf('.');
  let intPart: string;
  let fracPart: string;
  if (dot < 0) {
    intPart = trimmed || '0';
    fracPart = '';
  } else {
    intPart = trimmed.slice(0, dot) || '0';
    fracPart = trimmed.slice(dot + 1);
  }
  fracPart = fracPart.padEnd(2, '0').slice(0, 2);
  return BigInt(intPart || '0') * SCALE + BigInt(fracPart || '0');
}

function centavosToString(c: bigint): string {
  const neg = c < BigInt(0);
  const abs = neg ? -c : c;
  const intPart = abs / SCALE;
  const fracPart = abs % SCALE;
  return `${neg ? '-' : ''}${intPart}.${fracPart.toString().padStart(2, '0')}`;
}

function absDiff(a: bigint, b: bigint): bigint {
  const d = a - b;
  return d < BigInt(0) ? -d : d;
}

/**
 * Valida que las líneas con `dimensions.taxRuleId` cumplan:
 *   |tax_amount - base * rate| <= 1 centavo
 *
 * Estrategia:
 *   1. Base de la línea: `dimensions.baseAmountCop` o, si falta, la suma del
 *      lado de la base de las líneas sin taxRuleId (débitos en compras,
 *      créditos en ventas).
 *   2. Para cada línea con taxRuleId, cargar la regla y recalcular el importe
 *      esperado.
 *   3. Comparar con tolerancia BigInt ±1 centavo.
 *
 * Si no hay líneas con taxRuleId → resultado ok:true (no hay nada que validar).
 */
export async function validateLines(input: {
  workspaceId: string;
  lines: JournalLineInput[];
  transactionType: TaxTransactionType;
}): Promise<IntegrityValidationResult> {
  const violations: IntegrityViolation[] = [];

  // Separar líneas de impuesto (con metadata.taxRuleId)
  const taxLines = input.lines.filter(
    (l) =>
      l.dimensions &&
      typeof l.dimensions === 'object' &&
      'taxRuleId' in l.dimensions &&
      typeof l.dimensions['taxRuleId'] === 'string',
  );

  if (taxLines.length === 0) {
    return { ok: true, violations: [] };
  }

  // Líneas de base (sin taxRuleId). La base inferida va por el lado de la
  // operación: débitos en compras, créditos en ventas (nunca la CxP / CxC).
  const baseLines = input.lines.filter(
    (l) =>
      !l.dimensions ||
      typeof l.dimensions !== 'object' ||
      !('taxRuleId' in l.dimensions),
  );
  const esVenta = input.transactionType === 'sale' || input.transactionType === 'service_sale';
  let baseInferidaCentavos = BigInt(0);
  for (const l of baseLines) {
    baseInferidaCentavos += parseCentavos(esVenta ? l.credit : l.debit);
  }

  // Cargar todas las reglas (necesitamos el rate por ruleId)
  const allRules = await getRules(input.workspaceId, new Date());
  const ruleMap = new Map(allRules.map((r) => [r.id, r]));

  for (const line of taxLines) {
    const ruleId = (line.dimensions as Record<string, unknown>)['taxRuleId'] as string;
    const ruleCode = (line.dimensions as Record<string, unknown>)['taxRuleCode'] as string | undefined;

    const rule = ruleMap.get(ruleId);
    if (!rule) {
      // Regla no encontrada en el workspace — no podemos validar, emitir warning.
      violations.push({
        ruleCode: ruleCode ?? ruleId,
        expectedAmountCop: '??',
        actualAmountCop: '??',
        differenceCop: '??',
        toleranceCop: centavosToString(TOLERANCE_CENTAVOS),
        severity: 'warning',
      });
      continue;
    }

    const baseDeclarada = (line.dimensions as Record<string, unknown>)['baseAmountCop'];
    const baseCentavos =
      typeof baseDeclarada === 'string' && /^-?\d+(\.\d+)?$/.test(baseDeclarada.trim())
        ? parseCentavos(baseDeclarada)
        : baseInferidaCentavos;

    const rateFloat = parseFloat(rule.rate);
    const rateMillionths = BigInt(Math.round(rateFloat * 1_000_000));
    const expectedCentavos =
      (baseCentavos * rateMillionths) / BigInt(1_000_000);

    // El importe actual en la línea es debit OR credit (excluyentes)
    const lineDebit = parseCentavos(line.debit);
    const lineCredit = parseCentavos(line.credit);
    const actualCentavos =
      lineDebit > BigInt(0) ? lineDebit : lineCredit;

    const diff = absDiff(expectedCentavos, actualCentavos);

    if (diff > TOLERANCE_CENTAVOS) {
      violations.push({
        ruleCode: rule.code,
        expectedAmountCop: centavosToString(expectedCentavos),
        actualAmountCop: centavosToString(actualCentavos),
        differenceCop: centavosToString(diff),
        toleranceCop: centavosToString(TOLERANCE_CENTAVOS),
        severity: diff > BigInt(100) ? 'error' : 'warning', // >1 COP = error; <=100c = warning
      });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
