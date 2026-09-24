/**
 * Montos de débito/crédito de un formulario de asiento.
 *
 * Auditoría 2026-09 (reportes-export-06): los formularios usaban `parseCOP`,
 * cuyo contrato legado devuelve "0" cuando la entrada no es interpretable
 * ("1,234,567", "12.3456"…). Un error de tecleo se convertía en un asiento por
 * otro valor o en una línea vacía sin aviso. Aquí se usa `parseCOPStrict`: una
 * entrada no interpretable o negativa es un error visible y bloquea el envío.
 */

import { parseCOPStrict } from '@/lib/format/cop';

/** Monto no negativo como NUMERIC string, o `null` si no es interpretable. */
export function parseLineAmount(input: string): string | null {
  const parsed = parseCOPStrict(input);
  if (parsed === null) return null;
  if (parsed.startsWith('-')) return null;
  return parsed;
}

export interface AmountIssue {
  /** Número de línea (1-based) como lo ve el usuario. */
  line: number;
  kind: 'invalid' | 'negative';
}

/** Primer problema de monto por línea (débito o crédito). */
export function findAmountIssues(
  lines: ReadonlyArray<{ debit: string; credit: string }>,
): AmountIssue[] {
  const issues: AmountIssue[] = [];
  lines.forEach((l, i) => {
    for (const raw of [l.debit, l.credit]) {
      const strict = parseCOPStrict(raw);
      if (strict === null) {
        issues.push({ line: i + 1, kind: 'invalid' });
        return;
      }
      if (strict.startsWith('-')) {
        issues.push({ line: i + 1, kind: 'negative' });
        return;
      }
    }
  });
  return issues;
}

/** Monto para totales en vivo: una entrada inválida no suma (y bloquea el envío). */
export function amountForTotals(input: string): string {
  return parseLineAmount(input) ?? '0';
}
