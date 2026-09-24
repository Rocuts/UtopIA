import { describe, expect, it } from 'vitest';
import {
  ARL_RATES,
  aporteIndependiente,
  aportePilaEmpleado,
  costoEmpleado,
} from '@/lib/payroll/prestaciones';
import { SMMLV_2026 } from '@/lib/tax/taxCalculator';

// contab-nomina-19: la exoneración 114-1 depende de la condición del EMPLEADOR
// (declarada en el workspace). Este bloque antes llamaba costoEmpleado(SMMLV)
// sin condición y esperaba exoneración incondicional; ahora el caso típico
// declara explícitamente al empleador como beneficiario.
describe('costoEmpleado — salario mínimo 2026 (empleador beneficiario 114-1)', () => {
  const b = costoEmpleado(SMMLV_2026, 1, { empleadorBeneficiario114_1: true });

  it('aplica la exoneración 114-1 (salud/SENA/ICBF = 0 bajo 10 SMMLV)', () => {
    expect(b.exoneracion114_1).toBe(true);
    expect(b.exoneracion114_1Estado).toBe('aplicada');
    expect(b.saludCop).toBe(0);
    expect(b.senaCop).toBe(0);
    expect(b.icbfCop).toBe(0);
  });

  it('pensión 12%, caja 4%, ARL clase I 0,522%', () => {
    expect(b.pensionCop).toBeCloseTo(SMMLV_2026 * 0.12, 2);
    expect(b.cajaCop).toBeCloseTo(SMMLV_2026 * 0.04, 2);
    expect(b.arlCop).toBeCloseTo(SMMLV_2026 * 0.00522, 2);
  });

  it('prestaciones: prima y cesantías 1/12, intereses 1% mensual, vacaciones 15/360', () => {
    expect(b.primaCop).toBeCloseTo(SMMLV_2026 / 12, 2);
    expect(b.cesantiasCop).toBeCloseTo(SMMLV_2026 / 12, 2);
    expect(b.interesesCesantiasCop).toBeCloseTo((SMMLV_2026 / 12) * 0.12, 2);
    expect(b.vacacionesCop).toBeCloseTo((SMMLV_2026 * 15) / 360, 2);
  });

  it('total = salario + cargas y carga ≈ 38,5% exonerado clase I', () => {
    const cargas =
      b.pensionCop + b.arlCop + b.cajaCop + b.primaCop + b.cesantiasCop +
      b.interesesCesantiasCop + b.vacacionesCop;
    expect(b.totalMensualCop).toBeCloseTo(SMMLV_2026 + cargas, 2);
    expect(b.cargaPct).toBeGreaterThan(0.37);
    expect(b.cargaPct).toBeLessThan(0.4);
  });
});

describe('costoEmpleado — salario alto (≥10 SMMLV, sin exoneración)', () => {
  const salario = SMMLV_2026 * 12;
  const b = costoEmpleado(salario, 3);

  it('cobra salud 8,5% + SENA 2% + ICBF 3%', () => {
    expect(b.exoneracion114_1).toBe(false);
    expect(b.saludCop).toBeCloseTo(salario * 0.085, 2);
    expect(b.senaCop).toBeCloseTo(salario * 0.02, 2);
    expect(b.icbfCop).toBeCloseTo(salario * 0.03, 2);
  });

  it('usa la tarifa ARL de la clase indicada (III = 2,436%)', () => {
    expect(b.arlCop).toBeCloseTo(salario * ARL_RATES[3], 2);
  });
});

describe('aporteIndependiente — dueño', () => {
  it('base = 40% del ingreso cuando supera 1 SMMLV; salud 12,5% + pensión 16%', () => {
    const ingreso = 6_000_000;
    const a = aporteIndependiente(ingreso);
    expect(a.baseCotizacionCop).toBeCloseTo(2_400_000, 2);
    expect(a.saludCop).toBeCloseTo(2_400_000 * 0.125, 2);
    expect(a.pensionCop).toBeCloseTo(2_400_000 * 0.16, 2);
    expect(a.totalMensualCop).toBeCloseTo(2_400_000 * 0.285, 2);
  });

  it('piso de base: 1 SMMLV cuando el 40% del ingreso queda por debajo', () => {
    const a = aporteIndependiente(2_000_000); // 40% = 800.000 < SMMLV
    expect(a.baseCotizacionCop).toBe(SMMLV_2026);
  });
});

describe('aportePilaEmpleado', () => {
  it('PILA = seguridad social + parafiscales, sin prestaciones provisionadas', () => {
    const b = costoEmpleado(SMMLV_2026, 1);
    const pila = aportePilaEmpleado(SMMLV_2026, 1);
    expect(pila).toBeCloseTo(
      b.pensionCop + b.saludCop + b.arlCop + b.cajaCop + b.senaCop + b.icbfCop,
      2,
    );
    expect(pila).toBeLessThan(b.totalMensualCop - b.salarioCop);
  });
});

describe('costoEmpleado — condición del empleador (contab-nomina-19)', () => {
  it('sin declarar: NO asume la exoneración y reporta el ahorro potencial', () => {
    const b = costoEmpleado(SMMLV_2026, 1);
    expect(b.exoneracion114_1).toBe(false);
    expect(b.exoneracion114_1Estado).toBe('sin_confirmar');
    expect(b.saludCop).toBeCloseTo(SMMLV_2026 * 0.085, 2);
    expect(b.ahorroPotencial114_1Cop).toBeCloseTo(SMMLV_2026 * 0.135, 2);
  });

  it('empleador no beneficiario (p. ej. persona natural con 1 trabajador): paga salud, SENA e ICBF', () => {
    const b = costoEmpleado(SMMLV_2026, 1, { empleadorBeneficiario114_1: false });
    expect(b.exoneracion114_1Estado).toBe('empleador_no_beneficiario');
    expect(b.senaCop + b.icbfCop).toBeCloseTo(SMMLV_2026 * 0.05, 2);
  });

  it('tope del IBC de seguridad social en 25 SMMLV (parafiscales sin tope)', () => {
    const salario = SMMLV_2026 * 30;
    const b = costoEmpleado(salario, 1, { empleadorBeneficiario114_1: true });
    expect(b.ibcCop).toBeCloseTo(SMMLV_2026 * 25, 2);
    expect(b.pensionCop).toBeCloseTo(SMMLV_2026 * 25 * 0.12, 2);
    expect(b.cajaCop).toBeCloseTo(salario * 0.04, 2);
  });

  it('salario integral: aportes sobre el 70 %, sin prima/cesantías/intereses, con vacaciones', () => {
    const salario = SMMLV_2026 * 15;
    const b = costoEmpleado(salario, 1, { salarioIntegral: true, empleadorBeneficiario114_1: true });
    expect(b.salarioIntegral).toBe(true);
    expect(b.ibcCop).toBeCloseTo(salario * 0.7, 2);
    expect(b.primaCop + b.cesantiasCop + b.interesesCesantiasCop).toBe(0);
    expect(b.vacacionesCop).toBeCloseTo((salario * 15) / 360, 2);
    expect(b.exoneracion114_1Estado).toBe('no_aplica_salario');
  });

  it('salario integral por debajo de 13 SMMLV se rechaza', () => {
    expect(() => costoEmpleado(SMMLV_2026 * 12, 1, { salarioIntegral: true })).toThrow(RangeError);
  });
});

describe('aporteIndependiente — Ley 2277/2022 art. 89 (contab-nomina-20)', () => {
  it('tope de base en 25 SMMLV (antes 40 % sin tope)', () => {
    const a = aporteIndependiente(200_000_000);
    expect(a.baseCotizacionCop).toBeCloseTo(SMMLV_2026 * 25, 2);
    expect(a.topeAplicado).toBe(true);
  });

  it('con costos imputados (Art. 107 E.T.) la base es 40 % del neto', () => {
    const a = aporteIndependiente(10_000_000, { costosImputadosCop: 4_000_000 });
    expect(a.baseCotizacionCop).toBeCloseTo(2_400_000, 2);
    expect(a.baseSinCostos).toBe(false);
  });

  it('sin costos la base se marca como cota superior; FSP N/D desde 4 SMMLV (no se inventa)', () => {
    const a = aporteIndependiente(SMMLV_2026 * 12);
    expect(a.baseSinCostos).toBe(true);
    expect(a.fondoSolidaridadCop).toBeNull();
    expect(a.totalIncompleto).toBe(true);
    expect(aporteIndependiente(6_000_000).fondoSolidaridadCop).toBe(0);
  });
});
