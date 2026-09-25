// contab-nomina-19: validación de salario del empleado (jornada completa ≥
// SMMLV; salario integral ≥ 13 SMMLV y sólo para empleados).
import { describe, it, expect } from 'vitest';
import { createEmpleadoBodySchema, empleadoSalaryIssues } from '../pyme-schemas';
import { SMMLV_2026 } from '@/lib/tax/taxCalculator';

describe('createEmpleadoBodySchema — salario', () => {
  it('rechaza un empleado con salario inferior al SMMLV (antes lo aceptaba)', () => {
    const r = createEmpleadoBodySchema.safeParse({ nombre: 'Ana', tipo: 'empleado', salarioCop: SMMLV_2026 - 1 });
    expect(r.success).toBe(false);
  });

  it('acepta el SMMLV y al dueño con cualquier ingreso positivo', () => {
    expect(createEmpleadoBodySchema.safeParse({ nombre: 'Ana', salarioCop: SMMLV_2026 }).success).toBe(true);
    expect(createEmpleadoBodySchema.safeParse({ nombre: 'Dueño', tipo: 'dueno', salarioCop: 500_000 }).success).toBe(true);
  });

  it('salario integral exige ≥ 13 SMMLV y tipo empleado', () => {
    expect(
      createEmpleadoBodySchema.safeParse({ nombre: 'Gerente', salarioCop: SMMLV_2026 * 12, salarioIntegral: true }).success,
    ).toBe(false);
    expect(
      createEmpleadoBodySchema.safeParse({ nombre: 'Gerente', salarioCop: SMMLV_2026 * 13, salarioIntegral: true }).success,
    ).toBe(true);
    expect(empleadoSalaryIssues({ tipo: 'dueno', salarioCop: SMMLV_2026 * 20, salarioIntegral: true })).toHaveLength(1);
  });
});
