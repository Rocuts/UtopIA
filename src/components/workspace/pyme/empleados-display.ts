/**
 * Mis Empleados — decisiones puras de la vista (Art. 114-1 E.T. y salario
 * integral). Auditoría 2026-09 (contab-nomina-19):
 *   - la exoneración de salud/SENA/ICBF depende de la condición del EMPLEADOR,
 *     que el workspace declara en /api/pyme/empleador (true / false / null);
 *   - sin declararla se liquida sin exoneración y se informa el ahorro
 *     potencial; la etiqueta «exonerado 114-1» sólo con estado 'aplicada';
 *   - el salario integral exige ≥ 13 SMMLV (CST art. 132).
 */

import {
  SALARIO_INTEGRAL_MIN_SMMLV,
  type EstadoExoneracion114_1,
} from '@/lib/payroll/prestaciones';
import { SMMLV_2026 } from '@/lib/tax/taxCalculator';

export type EmployerSelectValue = 'unset' | 'yes' | 'no';

export function employerSelectValue(v: boolean | null | undefined): EmployerSelectValue {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  return 'unset';
}

export function parseEmployerSelect(v: string): boolean | null {
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return null;
}

export interface Estado114Labels {
  estadoAplicada: string;
  estadoNoAplicaSalario: string;
  estadoNoBeneficiario: string;
  estadoSinConfirmar: string;
}

/** Texto del estado de la exoneración para la tarjeta del empleado. */
export function estado114Text(
  estado: EstadoExoneracion114_1,
  ahorroPotencialCop: number,
  labels: Estado114Labels,
  formatCop: (n: number) => string,
): string {
  switch (estado) {
    case 'aplicada':
      return labels.estadoAplicada;
    case 'no_aplica_salario':
      return labels.estadoNoAplicaSalario;
    case 'empleador_no_beneficiario':
      return labels.estadoNoBeneficiario;
    case 'sin_confirmar':
    default:
      return labels.estadoSinConfirmar.replace('{cop}', formatCop(ahorroPotencialCop));
  }
}

/** Salario integral mínimo en COP (13 SMMLV). */
export const SALARIO_INTEGRAL_MIN_COP = SALARIO_INTEGRAL_MIN_SMMLV * SMMLV_2026;

/** true si la casilla de salario integral no es válida para ese salario. */
export function salarioIntegralInvalido(
  tipo: 'empleado' | 'dueno',
  salarioCop: number,
  integral: boolean,
): boolean {
  if (!integral) return false;
  return tipo !== 'empleado' || salarioCop < SALARIO_INTEGRAL_MIN_COP;
}
