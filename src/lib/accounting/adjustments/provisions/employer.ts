// ─── Condición del empleador frente al Art. 114-1 E.T. ───────────────────────
//
// La exoneración de salud del empleador (8,5 %), SENA (2 %) e ICBF (3 %) por
// trabajadores que devenguen menos de 10 SMMLV depende de QUIÉN es el
// empleador (sociedades/personas jurídicas declarantes de renta; personas
// naturales con 2+ trabajadores). El workspace la declara en
// `workspaces.empleador_beneficiario_114_1`; mientras sea null, provisiones y
// nómina NO asumen la exoneración (auditoría contab-nomina-07 / -19).

import 'server-only';

import { getEmpleador114_1 } from '@/lib/db/workspace-empleador';
import { SMMLV_2026 } from '@/lib/tax/taxCalculator';

/** true beneficiario · false no beneficiario · null no declarado. */
export function getEmployer114_1(workspaceId: string): Promise<boolean | null> {
  return getEmpleador114_1(workspaceId);
}

/**
 * SMMLV por año con fuente verificada en el repo (Decreto 1469/2025 para
 * 2026). Otros años → null: la exoneración por trabajador queda N/D en vez de
 * compararse contra un salario mínimo de otro año.
 */
const SMMLV_POR_ANIO: Record<number, number> = {
  2026: SMMLV_2026,
};

export function smmlvForYear(year: number): string | null {
  const v = SMMLV_POR_ANIO[year];
  return v === undefined ? null : v.toFixed(2);
}
