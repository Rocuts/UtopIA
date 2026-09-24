// ---------------------------------------------------------------------------
// Clasificación corriente / no corriente compartida por las reglas que mutan
// el balance (R1, R8).
// ---------------------------------------------------------------------------
// La clasificación base es por grupo PUC (Decreto 2650/1993). La excepción son
// las cuentas virtuales que inyecta R1 al reclasificar un saldo crédito de una
// cuenta de activo (`2105ZZ-111005`, `2805ZZ-130505`, …): su presentación
// depende del ORIGEN, no del prefijo. Un sobregiro (11) o un anticipo recibido
// registrado en deudores (13) son pasivos corrientes (NIC 1 párr. 69-71)
// aunque el prefijo de la virtual caiga en un grupo que el PUC trata como no
// corriente (28). Auditoría 2026-09, niif-preproceso-22.
// ---------------------------------------------------------------------------

import type { PUCClass } from '../trial-balance';

export const ACTIVO_CORRIENTE_GROUPS = new Set(['11', '12', '13', '14']);
export const ACTIVO_NO_CORRIENTE_GROUPS = new Set(['15', '16', '17', '18', '19']);
export const PASIVO_CORRIENTE_GROUPS = new Set(['21', '22', '23', '24', '25', '26']);
export const PASIVO_NO_CORRIENTE_GROUPS = new Set(['27', '28', '29']);

/** Código virtual de R1: `<4 dígitos><ZZ|VC>-<código de origen>`. */
const R1_VIRTUAL_RE = /^\d{4}(?:ZZ|VC)-(\d{2})/;

/** Grupo (2 dígitos) de la cuenta de ACTIVO de la que proviene una virtual de R1. */
export function r1OriginGroup(code: string): string | null {
  const m = R1_VIRTUAL_RE.exec(code);
  return m ? m[1] : null;
}

function groupOf(code: string): string {
  return code.length >= 2 ? code.slice(0, 2) : code;
}

/** True si la cuenta de pasivo se presenta como corriente. */
export function isCurrentLiabilityCode(code: string): boolean {
  const origin = r1OriginGroup(code);
  if (origin !== null) return ACTIVO_CORRIENTE_GROUPS.has(origin);
  return PASIVO_CORRIENTE_GROUPS.has(groupOf(code));
}

/** True si la cuenta de pasivo se presenta como no corriente. */
export function isNonCurrentLiabilityCode(code: string): boolean {
  const origin = r1OriginGroup(code);
  if (origin !== null) return ACTIVO_NO_CORRIENTE_GROUPS.has(origin);
  return PASIVO_NO_CORRIENTE_GROUPS.has(groupOf(code));
}

export function sumByGroups(cl: PUCClass | undefined, groups: Set<string>): number {
  if (!cl) return 0;
  let sum = 0;
  for (const acc of cl.accounts) {
    if (groups.has(groupOf(acc.code))) sum += acc.balance;
  }
  return sum;
}

export function sumCurrentLiabilities(cl: PUCClass | undefined): number {
  if (!cl) return 0;
  let sum = 0;
  for (const acc of cl.accounts) if (isCurrentLiabilityCode(acc.code)) sum += acc.balance;
  return sum;
}

export function sumNonCurrentLiabilities(cl: PUCClass | undefined): number {
  if (!cl) return 0;
  let sum = 0;
  for (const acc of cl.accounts) if (isNonCurrentLiabilityCode(acc.code)) sum += acc.balance;
  return sum;
}

/** Σ saldos de las cuentas de una clase cuyo código empieza por `prefix`. */
export function sumByPrefix(cl: PUCClass | undefined, prefix: string): number {
  if (!cl) return 0;
  let sum = 0;
  for (const acc of cl.accounts) if (acc.code.startsWith(prefix)) sum += acc.balance;
  return sum;
}
