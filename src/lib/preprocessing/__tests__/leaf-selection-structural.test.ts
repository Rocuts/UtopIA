// ---------------------------------------------------------------------------
// Selección de hojas estructural (recalculo-07) y códigos que no son cuentas
// PUC (ingesta-11).
// ---------------------------------------------------------------------------
// Hoja = fila cuyo código no es prefijo de ningún otro código del archivo,
// cualquiera que sea el nivel declarado. Un balance exportado a nivel Cuenta
// (4 dígitos) ya no queda en $0, y una cuenta sin descendientes en un archivo
// mixto ya no se omite.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type RawAccountRow,
} from '@/lib/preprocessing/trial-balance';

const CUENTA_4: Array<[string, string, number]> = [
  ['1105', 'Caja', 150000],
  ['1110', 'Bancos', 250000],
  ['1305', 'Clientes', 100000],
  ['1520', 'Maquinaria', 500000],
  ['2205', 'Proveedores', 150000],
  ['2335', 'Costos y gastos por pagar', 100000],
  ['2505', 'Salarios por pagar', 50000],
  ['2408', 'IVA por pagar', 100000],
  ['3105', 'Capital suscrito', 400000],
  ['3305', 'Reserva legal', 200000],
  ['4135', 'Comercio', 300000],
  ['5105', 'Gastos de personal', 300000],
];

function row(code: string, name: string, balance: number, extra: Partial<RawAccountRow> = {}): RawAccountRow {
  return {
    code,
    name,
    level: extra.level ?? 'Auxiliar',
    transactional: extra.transactional ?? true,
    balancesByPeriod: { '2025': balance },
  };
}

describe('recalculo-07 — hojas estructurales', () => {
  it('balance exportado a nivel Cuenta (4 dígitos, sin columna nivel) no queda en $0', () => {
    const csv = ['codigo,nombre,saldo', ...CUENTA_4.map((r) => r.join(','))].join('\n');
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(csv));
    const ct = pp.primary.controlTotals;
    expect(ct.activo).toBe(1_000_000);
    expect(ct.pasivo).toBe(400_000);
    expect(ct.ingresos).toBe(300_000);
    expect(ct.utilidadNeta).toBe(0);
    // Hojas reales del archivo (sin las cuentas virtuales 3605VC/3710VC de R8).
    const leaves = pp.primary.classes.flatMap((c) => c.accounts).filter((a) => !a.code.endsWith('VC'));
    expect(leaves).toHaveLength(CUENTA_4.length);
  });

  it('nivel declarado "Cuenta" sin hijos también es hoja', () => {
    const rows = CUENTA_4.map(([c, n, b]) => row(c, n, b, { level: 'Cuenta', transactional: false }));
    const pp = preprocessTrialBalance(rows);
    expect(pp.primary.controlTotals.activo).toBe(1_000_000);
    expect(pp.primary.controlTotals.pasivo).toBe(400_000);
  });

  it('archivo mixto: la 2805 sin descendientes se suma al pasivo', () => {
    const rows: RawAccountRow[] = [
      row('1', 'ACTIVO', 1_050_000, { level: 'Clase', transactional: false }),
      row('11050501', 'Caja', 1_050_000),
      row('21050501', 'Obligaciones', 400_000),
      row('2805', 'Anticipos y avances recibidos', 50_000, { level: 'Cuenta', transactional: false }),
      row('31050501', 'Capital', 600_000),
    ];
    const pp = preprocessTrialBalance(rows);
    expect(pp.primary.controlTotals.pasivo).toBe(450_000);
    expect(pp.primary.controlTotals.activo).toBe(1_050_000);
    // La fila de Clase sigue siendo total reportado, no hoja.
    expect(pp.primary.classes.find((c) => c.code === 1)?.reportedTotal).toBe(1_050_000);
  });

  it('una fila marcada transaccional que tiene subcuentas no se suma dos veces', () => {
    const rows: RawAccountRow[] = [
      row('110505', 'Caja general', 1_000_000, { level: 'Subcuenta', transactional: true }),
      row('11050501', 'Caja principal', 600_000),
      row('11050502', 'Caja menor', 400_000),
      row('21050501', 'Obligaciones', 400_000),
      row('31050501', 'Capital', 600_000),
    ];
    const pp = preprocessTrialBalance(rows);
    expect(pp.primary.controlTotals.activo).toBe(1_000_000);
  });
});

describe('ingesta-11 — identificaciones de tercero en la columna código', () => {
  const base = [
    '1,ACTIVO,1000000',
    '11,DISPONIBLE,400000',
    '1105,CAJA,150000',
    '110505,CAJA GENERAL,150000',
    '11050501,Caja,150000',
    '1110,BANCOS,250000',
    '111005,MONEDA NACIONAL,250000',
    '11100501,Bancos,250000',
    '13,DEUDORES,100000',
    '1305,CLIENTES,100000',
    '130505,NACIONALES,100000',
    '13050501,Clientes,100000',
    '15,PPE,500000',
    '1520,MAQUINARIA,500000',
    '152001,MAQUINARIA,500000',
    '15200101,Maquinaria,500000',
    '2,PASIVO,400000',
    '22,PROVEEDORES,400000',
    '2205,NACIONALES,400000',
    '220501,NACIONALES,400000',
    '22050101,Proveedores,400000',
    '3,PATRIMONIO,600000',
    '31,CAPITAL,600000',
    '3105,CAPITAL SUSCRITO,600000',
    '310505,CAPITAL,600000',
    '31050501,Capital,600000',
  ];

  it('cédula/NIT sin grupo PUC válido se excluye de las hojas y bloquea con motivo', () => {
    const csv = [
      'codigo,nombre,saldo',
      ...base,
      '79123456,JUAN PEREZ (tercero de 13050501),60000',
      '1020304050,MARIA GOMEZ (tercero de 13050501),40000',
    ].join('\n');
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(csv));
    const ct = pp.primary.controlTotals;
    expect(ct.activo).toBe(1_000_000);
    expect(ct.costoProduccion7).toBe(0);
    expect(pp.primary.validation.blocking).toBe(true);
    const reasons = pp.primary.validation.reasons.join('\n');
    expect(reasons).toMatch(/79123456/);
    expect(reasons).toMatch(/1020304050/);
  });

  it('código con grupo válido pero sin cuenta padre en un archivo jerárquico → motivo bloqueante', () => {
    const csv = ['codigo,nombre,saldo', ...base, '52123456,PEDRO ROJAS,30000'].join('\n');
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(csv));
    expect(pp.primary.validation.blocking).toBe(true);
    expect(pp.primary.validation.reasons.join('\n')).toMatch(/52123456/);
  });

  it('control: el mismo archivo sin terceros no bloquea por códigos', () => {
    const csv = ['codigo,nombre,saldo', ...base].join('\n');
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(csv));
    expect(pp.primary.validation.reasons.join('\n')).not.toMatch(/PUC/);
    expect(pp.primary.controlTotals.activo).toBe(1_000_000);
  });
});
