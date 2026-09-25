// ---------------------------------------------------------------------------
// PUC helpers compartidos por los conectores ERP
// ---------------------------------------------------------------------------
// Antes cada conector colombiano tenía su copia de estas funciones y cinco de
// ellas invertían las clases 5 y 6. Referencia: Decreto 2650/1993 (PUC) —
// clase 5 = Gastos, clase 6 = Costos de ventas, clase 7 = Costos de producción
// o de operación (src/data/tax_docs/decreto_2650_1993_puc_referencia.md).
// ---------------------------------------------------------------------------

import type { ERPAccount } from './types';

/** Tipo normalizado según el primer dígito del código PUC. */
export function pucTypeFromCode(code: string): ERPAccount['type'] {
  switch (code.charAt(0)) {
    case '1': return 'asset';
    case '2': return 'liability';
    case '3': return 'equity';
    case '4': return 'revenue';
    case '5': return 'expense';
    case '6': return 'cost';
    case '7': return 'cost';
    default: return 'asset';
  }
}

/** Clase PUC (primer dígito); 0 si el código no empieza por dígito. */
export function pucClassFromCode(code: string): number {
  const n = parseInt(code.charAt(0), 10);
  return Number.isNaN(n) ? 0 : n;
}

/** Nivel jerárquico por longitud del código (1 clase … 5 auxiliar). */
export function accountLevelFromCode(code: string): number {
  const len = code.replace(/\D/g, '').length || code.length;
  if (len <= 1) return 1;
  if (len <= 2) return 2;
  if (len <= 4) return 3;
  if (len <= 6) return 4;
  return 5;
}

/** Código padre PUC recortando el último nivel de dígitos. */
export function deriveParentCode(code: string): string | undefined {
  if (code.length > 6) return code.slice(0, 6);
  if (code.length > 4) return code.slice(0, 4);
  if (code.length > 2) return code.slice(0, 2);
  if (code.length > 1) return code.slice(0, 1);
  return undefined;
}

/**
 * Hojas del informe: una cuenta es hoja si NINGUNA otra cuenta del mismo
 * conjunto es descendiente suya (su código la tiene como prefijo propio o la
 * declara como `parentCode`). La longitud del código no decide: en el PUC 6
 * dígitos es la subcuenta mínima de registro, pero un informe jerárquico trae
 * 110505 junto a 11050501/11050502 y sumar los tres duplica el saldo.
 */
export function leafCodes(accounts: ReadonlyArray<Pick<ERPAccount, 'code' | 'parentCode'>>): Set<string> {
  const hasDescendant = new Set<string>();
  for (const { code, parentCode } of accounts) {
    for (let i = 1; i < code.length; i++) hasDescendant.add(code.slice(0, i));
    if (parentCode && parentCode !== code) hasDescendant.add(parentCode);
  }
  const leaves = new Set<string>();
  for (const { code } of accounts) {
    if (!hasDescendant.has(code)) leaves.add(code);
  }
  return leaves;
}

/** Devuelve las cuentas con `isAuxiliary` recalculado por jerarquía real. */
export function markLeafAccounts<T extends Pick<ERPAccount, 'code' | 'parentCode' | 'isAuxiliary'>>(
  accounts: T[],
): T[] {
  const leaves = leafCodes(accounts);
  return accounts.map((a) => ({ ...a, isAuxiliary: leaves.has(a.code) }));
}

/**
 * Nivel textual para `RawAccountRow.level`: sólo las hojas son 'Auxiliar'
 * (transaccionales); una cuenta con descendientes en el informe recibe su
 * nivel de agrupación para que el preprocesador no la sume con sus hijas.
 */
export function rawLevelFor(code: string, isLeaf: boolean): string {
  if (isLeaf) return 'Auxiliar';
  const len = code.replace(/\D/g, '').length || code.length;
  if (len <= 1) return 'Clase';
  if (len <= 3) return 'Grupo';
  if (len <= 5) return 'Cuenta';
  return 'Subcuenta';
}

/** Naturaleza PUC: débito para clases 1, 5, 6, 7; crédito para 2, 3, 4. */
export function isDebitNature(code: string): boolean {
  return ['1', '5', '6', '7'].includes(code.charAt(0));
}

/**
 * Comprueba saldo final = saldo inicial + débitos − créditos (convención
 * algebraica) o saldo inicial − débitos + créditos para cuentas de naturaleza
 * crédito presentadas en magnitud natural. Tolerancia: medio centavo.
 */
export function closingBalanceMatches(
  code: string,
  opening: number,
  debit: number,
  credit: number,
  closing: number,
): boolean {
  const cents = (v: number) => Math.round(v * 100);
  const algebraic = cents(opening) + cents(debit) - cents(credit);
  if (algebraic === cents(closing)) return true;
  if (!isDebitNature(code)) {
    const natural = cents(opening) - cents(debit) + cents(credit);
    if (natural === cents(closing)) return true;
  }
  return false;
}
