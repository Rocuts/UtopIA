// contab-nomina-18 / -06 / -08: el PUC sembrado sigue el Decreto 2650/1993 y
// las cuentas que usan tax-engine, provisiones y cierre existen en él con el
// significado esperado.
import { describe, it, expect } from 'vitest';

import { PUC_PYME_COLOMBIA } from '../puc-pyme-colombia';
import { PROVISIONS_CO_2026, accountMismatch } from '../provisions-config-co-2026';
import {
  CUENTA_IVA_DESCONTABLE,
  CUENTA_IVA_GENERADO,
} from '@/lib/accounting/tax-engine/constants';

const byCode = new Map(PUC_PYME_COLOMBIA.map((a) => [a.code, a]));
const PARENT_LEN: Record<number, number> = { 2: 1, 3: 2, 4: 4, 5: 6 };

describe('PUC sembrado — estructura', () => {
  it('códigos únicos', () => {
    expect(byCode.size).toBe(PUC_PYME_COLOMBIA.length);
  });

  it('el padre es el prefijo del código, existe y tiene el mismo tipo', () => {
    const bad: string[] = [];
    for (const a of PUC_PYME_COLOMBIA) {
      if (a.level === 1) {
        if (a.parentCode !== null) bad.push(`${a.code}: clase con padre`);
        continue;
      }
      const expectedParent = a.code.slice(0, PARENT_LEN[a.level]);
      if (a.parentCode !== expectedParent) bad.push(`${a.code}: padre ${a.parentCode} ≠ ${expectedParent}`);
      const parent = byCode.get(a.parentCode ?? '');
      if (!parent) bad.push(`${a.code}: padre ${a.parentCode} inexistente`);
      else if (parent.type !== a.type) bad.push(`${a.code}: tipo ${a.type} ≠ padre ${parent.type}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('PUC sembrado — Decreto 2650/1993 (grupos 23/24, 5160)', () => {
  it('2404 renta, 2408 IVA, 2412 ICA', () => {
    expect(byCode.get('2404')?.name).toMatch(/RENTA/);
    expect(byCode.get('2408')?.name).toMatch(/VENTAS|IVA/);
    expect(byCode.get('2412')?.name).toMatch(/INDUSTRIA Y COMERCIO/);
    expect(byCode.get('240405')?.name).toMatch(/Vigencia fiscal corriente/);
  });

  it('las cuentas de IVA del tax-engine existen bajo 2408 y significan IVA', () => {
    for (const code of [CUENTA_IVA_GENERADO, CUENTA_IVA_DESCONTABLE]) {
      const a = byCode.get(code);
      expect(a, code).toBeDefined();
      expect(a!.parentCode).toBe('2408');
      expect(a!.name).toMatch(/IVA/);
      expect(a!.isPostable).toBe(true);
    }
  });

  it('2365 retención en la fuente cuelga del grupo 23; honorarios = 236515', () => {
    expect(byCode.get('2365')?.parentCode).toBe('23');
    expect(byCode.get('236515')?.name).toBe('Honorarios');
    expect(byCode.has('236510')).toBe(false);
  });

  it('5160: 516010 maquinaria, 516015 oficina, 516020 computación', () => {
    expect(byCode.get('516010')?.name).toMatch(/Maquinaria/);
    expect(byCode.get('516015')?.name).toMatch(/oficina/);
    expect(byCode.get('516020')?.name).toMatch(/computacion/);
  });

  it('cuentas de cierre y apertura postables: 360505 / 361005 / 370505', () => {
    for (const code of ['360505', '361005', '370505']) {
      expect(byCode.get(code)?.isPostable, code).toBe(true);
    }
  });
});

describe('seed de provisiones coherente con el PUC sembrado (contab-nomina-06/-08)', () => {
  it('toda cuenta de gasto/pasivo existe en el PUC sembrado con el tipo y nombre esperados', () => {
    const problems: string[] = [];
    for (const def of PROVISIONS_CO_2026) {
      const exp = byCode.get(def.expenseCode);
      const liab = byCode.get(def.liabilityCode);
      if (exp?.type !== 'GASTO') problems.push(`${def.provisionType}: gasto ${def.expenseCode}`);
      if (liab?.type !== 'PASIVO') problems.push(`${def.provisionType}: pasivo ${def.liabilityCode}`);
      const m1 = accountMismatch(def.expenseCode, exp ? { ...exp, isPostable: exp.isPostable } : undefined);
      const m2 = accountMismatch(def.liabilityCode, liab ? { ...liab, isPostable: liab.isPostable } : undefined);
      if (m1) problems.push(m1);
      if (m2) problems.push(m2);
    }
    expect(problems).toEqual([]);
  });

  it('el pasivo de renta es 2404 (no IVA) y prima/cesantías no están cruzadas', () => {
    const get = (t: string) => PROVISIONS_CO_2026.find((d) => d.provisionType === t)!;
    expect(byCode.get(get('income_tax').liabilityCode)?.parentCode).toBe('2404');
    expect(byCode.get(get('prima').liabilityCode)?.name).toMatch(/Prima/);
    expect(byCode.get(get('prima').expenseCode)?.name).toMatch(/Prima/);
    expect(byCode.get(get('cesantias').liabilityCode)?.name).toBe('Cesantias');
    expect(byCode.get(get('intereses_cesantias').expenseCode)?.name).toMatch(/Intereses/);
    expect(byCode.get(get('arl').expenseCode)?.name).toMatch(/ARL/);
    expect(byCode.get(get('salud').expenseCode)?.name).toMatch(/EPS/);
  });

  it('la base laboral usa cuentas de nómina que existen (510506 sueldos) y no se incluye a sí misma', () => {
    for (const def of PROVISIONS_CO_2026) {
      if (def.provisionType === 'income_tax') continue;
      expect(def.baseAccountCodes, def.provisionType).toContain('510506');
      expect(def.baseAccountCodes.some((c) => def.expenseCode.startsWith(c)), def.provisionType).toBe(false);
    }
  });

  it('intereses sobre cesantías: 1% de la MISMA base de cesantías (12% × 8,33%), no el pasivo 2610', () => {
    const ces = PROVISIONS_CO_2026.find((d) => d.provisionType === 'cesantias')!;
    const int = PROVISIONS_CO_2026.find((d) => d.provisionType === 'intereses_cesantias')!;
    expect(int.baseAccountCodes).toEqual(ces.baseAccountCodes);
    expect(int.rate).toBe('0.010000');
  });

  it('aportes sobre salario SIN auxilio de transporte; Caja separada de SENA/ICBF', () => {
    const types = PROVISIONS_CO_2026.map((d) => d.provisionType);
    expect(types).toEqual(expect.arrayContaining(['caja', 'sena', 'icbf']));
    expect(types).not.toContain('parafiscales');
    for (const t of ['salud', 'pension', 'arl', 'caja', 'sena', 'icbf']) {
      const d = PROVISIONS_CO_2026.find((x) => x.provisionType === t)!;
      expect(d.baseAccountCodes, t).not.toContain('510527');
    }
  });

  it('una cuenta existente con otro nombre se rechaza en vez de reutilizarse', () => {
    expect(
      accountMismatch('240405', { name: 'IVA generado (debito)', type: 'PASIVO', isPostable: true }),
    ).toMatch(/otro significado/);
    expect(accountMismatch('510533', undefined)).toMatch(/no existe/);
  });
});
