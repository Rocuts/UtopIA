// ---------------------------------------------------------------------------
// Bloqueos POST-curator — registro idempotente en `snapshot.validation`
// ---------------------------------------------------------------------------
// `buildSnapshotForPeriod` arma `validation` ANTES de que corra el curator.
// Algunas reglas (R5, R8, R12) descubren después un defecto que impide emitir
// cifras confiables: un descuadre que el cierre virtual no puede explicar, un
// desglose patrimonial que no suma la clase 3, un P&G que puede ser acumulado.
// Esos casos se registran aquí con el código de la regla como prefijo:
//
//   - `validation.reasons`                → lo que el usuario ve (422).
//   - `validation.curatorBlockingReasons` → el subconjunto nacido en el
//     curator, para que el orquestador distinga estos bloqueos de las razones
//     pre-R8 que el "Bridge de Cuadratura" puede levantar.
//
// Idempotente: una regla que corre dos veces sobre el mismo snapshot limpia
// sus propias razones antes de volver a escribirlas.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '../trial-balance';
import type { CuratorRuleCode } from './types';

function tag(code: CuratorRuleCode): string {
  return `[${code}] `;
}

/** Elimina las razones bloqueantes que una regla escribió en una corrida previa. */
export function clearCuratorBlockers(snapshot: PeriodSnapshot, code: CuratorRuleCode): void {
  const v = snapshot.validation;
  if (!v) return;
  const prefix = tag(code);
  const hadAny =
    v.reasons.some((r) => r.startsWith(prefix)) ||
    (v.curatorBlockingReasons ?? []).some((r) => r.startsWith(prefix));
  if (!hadAny) return;
  v.reasons = v.reasons.filter((r) => !r.startsWith(prefix));
  if (v.curatorBlockingReasons) {
    v.curatorBlockingReasons = v.curatorBlockingReasons.filter((r) => !r.startsWith(prefix));
  }
  v.blocking = v.reasons.length > 0;
}

/**
 * Registra un bloqueo post-curator. `message` debe incluir el monto y la
 * acción concreta: es lo que el usuario lee en la respuesta 422.
 */
export function addCuratorBlocker(
  snapshot: PeriodSnapshot,
  code: CuratorRuleCode,
  message: string,
): void {
  const v = snapshot.validation;
  if (!v) return;
  const reason = `${tag(code)}${message}`;
  if (!v.reasons.includes(reason)) v.reasons.push(reason);
  const curatorReasons = v.curatorBlockingReasons ?? [];
  if (!curatorReasons.includes(reason)) curatorReasons.push(reason);
  v.curatorBlockingReasons = curatorReasons;
  v.blocking = true;
}
