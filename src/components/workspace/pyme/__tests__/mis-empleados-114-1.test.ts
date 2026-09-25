// Auditoría 2026-09 (contab-nomina-19, integración IW5b) — Mis Empleados.
// La API ya calcula la exoneración del Art. 114-1 según la condición del
// empleador (GET/PUT /api/pyme/empleador) y el salario integral, pero la vista
// no permitía declararlos ni mostraba el estado: rotulaba «exonerado 114-1»
// por un booleano y no enseñaba al dueño las notas ni el total incompleto
// (Fondo de Solidaridad Pensional N/D, base sin costos).
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

import { dict } from '@/lib/i18n/dictionaries';
import {
  SALARIO_INTEGRAL_MIN_COP,
  employerSelectValue,
  estado114Text,
  parseEmployerSelect,
  salarioIntegralInvalido,
} from '../empleados-display';

const cop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

describe('condición del empleador (Art. 114-1 E.T.)', () => {
  it('ida y vuelta del selector de tres estados', () => {
    expect(employerSelectValue(true)).toBe('yes');
    expect(employerSelectValue(false)).toBe('no');
    expect(employerSelectValue(null)).toBe('unset');
    expect(parseEmployerSelect('yes')).toBe(true);
    expect(parseEmployerSelect('no')).toBe(false);
    expect(parseEmployerSelect('unset')).toBeNull();
  });

  it('el texto del estado informa el ahorro potencial sólo sin declarar', () => {
    const l = dict.es.pyme.empleados;
    expect(estado114Text('sin_confirmar', 250_000, l, cop)).toContain('$250.000');
    expect(estado114Text('aplicada', 0, l, cop)).toBe(l.estadoAplicada);
    expect(estado114Text('empleador_no_beneficiario', 0, l, cop)).toBe(l.estadoNoBeneficiario);
    expect(estado114Text('no_aplica_salario', 0, l, cop)).toBe(l.estadoNoAplicaSalario);
  });
});

describe('salario integral (CST art. 132)', () => {
  it('exige 13 SMMLV y sólo aplica a empleados', () => {
    expect(salarioIntegralInvalido('empleado', SALARIO_INTEGRAL_MIN_COP - 1, true)).toBe(true);
    expect(salarioIntegralInvalido('empleado', SALARIO_INTEGRAL_MIN_COP, true)).toBe(false);
    expect(salarioIntegralInvalido('dueno', SALARIO_INTEGRAL_MIN_COP * 2, true)).toBe(true);
    expect(salarioIntegralInvalido('empleado', 1_000, false)).toBe(false);
  });
});

describe('MisEmpleadosView', () => {
  const src = fs
    .readFileSync(path.resolve(process.cwd(), 'src/components/workspace/pyme/MisEmpleadosView.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('declara la condición del empleador con PUT /api/pyme/empleador', () => {
    expect(src).toMatch(/'\/api\/pyme\/empleador'/);
    expect(src).toMatch(/method: 'PUT'/);
    expect(src).toMatch(/beneficiario114_1/);
  });

  it('envía salarioIntegral al crear y lo permite editar (PATCH)', () => {
    expect(src).toMatch(/salarioIntegral: form\.tipo === 'empleado' \? form\.salarioIntegral : false/);
    expect(src).toMatch(/method: 'PATCH'/);
  });

  it('rotula «exonerado 114-1» sólo con estado aplicada y muestra el estado', () => {
    expect(src).toMatch(/exoneracion114_1Estado === 'aplicada'/);
    expect(src).toMatch(/estado114Text\(/);
    expect(src).not.toMatch(/d\.exoneracion114_1 \?/);
  });

  it('muestra al dueño las notas y el total incompleto', () => {
    expect(src).toMatch(/d\.notas/);
    expect(src).toMatch(/d\.totalIncompleto/);
    expect(src).toMatch(/fondoSolidaridadCop/);
  });
});
