// ---------------------------------------------------------------------------
// Devoluciones 4175 → ingresosNetos (Parte 1.3 spec v2.1 · NIIF 15 §47)
// ---------------------------------------------------------------------------
// La 4175 (Devoluciones en ventas) es una cuenta CORRECTORA de ingresos:
// naturaleza débito dentro de una clase 4 de naturaleza crédito. Según cómo
// exporte el ERP puede llegar con el signo CONTRARIO al de los ingresos
// ordinarios (la clase 4 ya viene NETA) o con el MISMO signo (el export perdió
// el débito y la clase 4 vale bruto + devoluciones). El motor no puede ramificar
// por "convención detectada": tiene que tomar como base las cuentas ORDINARIAS
// de clase 4 (las que NO son 4175) y restarles la Σ FIRMADA del grupo corrector.
//
// Estos fixtures existen para que las dos trampas queden atrapadas por un test:
//   Trampa 1 — restar las devoluciones a |Σ clase 4| (DOBLE RESTA cuando la
//              clase ya venía neta).
//   Trampa 2 — acumular |saldo| CUENTA POR CUENTA (invierte los saldos de
//              naturaleza contraria dentro del propio grupo 4175).
//
// Valores medidos con el código PREVIO al fix (evidencia de que los fixtures
// discriminan; ninguno de estos números debe volver a aparecer):
//   natural.csv        ingresosNetos $500.000.000  (correcto $450.000.000)
//   algebraica.csv     ingresosNetos $400.000.000  (correcto $450.000.000)
//   signos-mixtos.csv  ingresosNetos $389.000.000, devoluciones $61.000.000
//                                    (correcto $450.000.000 / $50.000.000)
//   sin-devoluciones   ingresosNetos $450.000.000  (idéntico — control)
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PeriodSnapshot,
} from '../trial-balance';

const FIXTURE_DIR = path.resolve(
  process.cwd(),
  'src/lib/preprocessing/__fixtures__/devoluciones-4175',
);

function loadFixture(name: string): PeriodSnapshot {
  const csv = fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
  return preprocessTrialBalance(parseTrialBalanceCSV(csv)).primary;
}

/** Hojas de clase 4 del snapshot, partidas en ordinarias vs correctoras 4175. */
function class4Split(snap: PeriodSnapshot) {
  const leaves = snap.classes.find((c) => c.code === 4)?.accounts ?? [];
  const toCents = (v: number) => BigInt(Math.round(v * 100));
  const sum = (rows: typeof leaves) =>
    rows.reduce<bigint>((acc, r) => acc + toCents(r.balance), BigInt(0));
  const devoluciones = leaves.filter((a) => a.code.startsWith('4175'));
  const ordinarias = leaves.filter((a) => !a.code.startsWith('4175'));
  return {
    devoluciones,
    ordinarias,
    sumOrdinariasCents: sum(ordinarias),
    sumDevolucionesCents: sum(devoluciones),
    sumClase4Cents: sum(leaves),
    /** Trampa 2: Σ |saldo| POR CUENTA — lo que hacía el código defectuoso. */
    sumAbsPorCuentaCents: devoluciones.reduce<bigint>((acc, r) => {
      const c = toCents(r.balance);
      return acc + (c < BigInt(0) ? -c : c);
    }, BigInt(0)),
  };
}

/**
 * Invariantes que la regla debe cumplir en TODOS los fixtures. Se comprueban en
 * centavos (tolerancia 0), que es como los compara el gate anti-alucinación.
 */
function expectInvariantes(snap: PeriodSnapshot) {
  const ct = snap.controlTotals;
  const split = class4Split(snap);
  const brutoCents =
    split.sumOrdinariasCents < BigInt(0) ? -split.sumOrdinariasCents : split.sumOrdinariasCents;
  const devCents = ct.cents!.totalDevoluciones;
  const netosCents = ct.cents!.ingresosNetos;

  // (1) bruto − devoluciones = netos, al centavo.
  expect(brutoCents - devCents).toBe(netosCents);
  // (2) las devoluciones son la MAGNITUD DEL TOTAL firmado, nunca la suma de
  //     magnitudes por cuenta.
  const firmadaAbs =
    split.sumDevolucionesCents < BigInt(0)
      ? -split.sumDevolucionesCents
      : split.sumDevolucionesCents;
  expect(devCents).toBe(firmadaAbs);
  // (3) los campos `number` y `cents` no divergen.
  expect(Number(devCents) / 100).toBe(ct.totalDevoluciones);
  expect(Number(netosCents) / 100).toBe(ct.ingresosNetos);
  // (4) el neto nunca supera al bruto.
  expect(netosCents <= brutoCents).toBe(true);
}

/** Lo que publicaba la fórmula defectuosa: |Σ clase 4| − Σ|4175| por cuenta. */
function formulaDefectuosa(snap: PeriodSnapshot): number {
  const split = class4Split(snap);
  const clase4Abs =
    split.sumClase4Cents < BigInt(0) ? -split.sumClase4Cents : split.sumClase4Cents;
  return Number(clase4Abs - split.sumAbsPorCuentaCents) / 100;
}

// ---------------------------------------------------------------------------

describe('Devoluciones 4175 — convención NATURAL (magnitudes)', () => {
  // El export perdió el signo débito: la 4175 llega con la MISMA polaridad que
  // las ventas, así que Σ clase 4 = bruto + devoluciones = $550M, una magnitud
  // sin significado contable. El neto son las ventas menos las devoluciones.
  it('ventas $500M (+) y devoluciones $50M (+) → bruto $500M, devoluciones $50M, netos $450M', () => {
    const snap = loadFixture('natural.csv');
    const ct = snap.controlTotals;
    const split = class4Split(snap);

    expect(split.sumOrdinariasCents).toBe(BigInt(50_000_000_000)); // +$500M
    expect(split.sumDevolucionesCents).toBe(BigInt(5_000_000_000)); // +$50M (mismo signo)
    expect(split.sumClase4Cents).toBe(BigInt(55_000_000_000)); // $550M: ni bruto ni neto

    expect(ct.totalDevoluciones).toBe(50_000_000);
    expect(ct.ingresosNetos).toBe(450_000_000);
    expect(ct.cents!.totalDevoluciones).toBe(BigInt(5_000_000_000));
    expect(ct.cents!.ingresosNetos).toBe(BigInt(45_000_000_000));
    expectInvariantes(snap);

    // Con el mismo signo, el neto queda 2 × devoluciones por debajo de Σ clase 4.
    expect(Number(split.sumClase4Cents) / 100 - ct.ingresosNetos!).toBe(2 * 50_000_000);
    // El fixture discrimina: la fórmula vieja daba $500M.
    expect(formulaDefectuosa(snap)).toBe(500_000_000);
  });

  it('la utilidad neta cuelga de ingresosNetos, no de Σ clase 4', () => {
    // Corolario del fix, aplicado tras la refutación adversarial: mientras
    // `netIncome = totalRevenue − gastos` usaba Σ clase 4, bajo convención de
    // magnitudes la utilidad quedaba inflada en exactamente 2 × devoluciones
    // ($290M donde la verdad son $190M). No era un residual tolerable: la
    // utilidad neta es ANCLA DURA y E14 la compara con tolerancia $0, así que
    // el gate llegaba a RECHAZAR la cifra correcta si un humano la corregía a
    // mano, y la brecha `utilidadNeta − EBIT` quedaba en 2 × devoluciones sin
    // una sola cuenta no operacional que la explicara.
    const snap = loadFixture('natural.csv');
    const ct = snap.controlTotals;
    const utilidadVerdadera = 450_000_000 - 200_000_000 - 60_000_000; // netos − costos − gastos
    expect(utilidadVerdadera).toBe(190_000_000);
    expect(ct.utilidadNeta).toBe(utilidadVerdadera);
    // Y sin devoluciones de por medio, EBIT y utilidad neta ya no se contradicen.
    expect(ct.utilidadNeta - utilidadVerdadera).toBe(0);
  });
});

describe('Devoluciones 4175 — convención ALGEBRAICA (partida doble literal)', () => {
  it('el archivo crudo trae clase 4 en negativo y la 4175 en positivo (débito)', () => {
    // Evidencia de que el fixture ES algebraico: se parsea desactivando la
    // normalización de signos y se leen los saldos tal cual vienen del ERP.
    const csv = fs.readFileSync(path.join(FIXTURE_DIR, 'algebraica.csv'), 'utf8');
    const crudo = parseTrialBalanceCSV(csv, { normalizeSignConvention: false });
    const ventas = crudo.find((r) => r.code === '410505')!;
    const devoluciones = crudo.find((r) => r.code === '417505')!;
    expect(ventas.balancesByPeriod['2025']).toBe(-500_000_000);
    expect(devoluciones.balancesByPeriod['2025']).toBe(50_000_000);
  });

  it('tras normalizar: ordinarias (+) y 4175 (−) → la clase 4 YA es el neto ($450M)', () => {
    const snap = loadFixture('algebraica.csv');
    const ct = snap.controlTotals;
    const split = class4Split(snap);

    expect(split.sumOrdinariasCents).toBe(BigInt(50_000_000_000)); // +$500M
    expect(split.sumDevolucionesCents).toBe(BigInt(-5_000_000_000)); // −$50M (signo contrario)

    expect(ct.totalDevoluciones).toBe(50_000_000);
    expect(ct.ingresosNetos).toBe(450_000_000);
    expectInvariantes(snap);

    // Signo contrario ⇒ el neto ES la Σ clase 4: restarle otra vez las
    // devoluciones sería la doble resta que este fix elimina.
    expect(ct.cents!.ingresosNetos).toBe(split.sumClase4Cents);
    expect(formulaDefectuosa(snap)).toBe(400_000_000);
  });
});

describe('Devoluciones 4175 — SIGNOS MIXTOS dentro del grupo corrector', () => {
  // Forma del único balance de cliente real del repo: dos devoluciones con
  // saldo crédito y una con saldo débito (anómala: en convención
  // crédito-positivo un débito ahí AUMENTA el ingreso). El grupo se netea
  // algebraicamente; el valor absoluto se toma del TOTAL, no de cada cuenta.
  it('4175 = −$55M, −$0,5M y +$5,5M → Σ firmada −$50M, devoluciones $50M, netos $450M', () => {
    const snap = loadFixture('signos-mixtos.csv');
    const ct = snap.controlTotals;
    const split = class4Split(snap);

    expect(split.devoluciones).toHaveLength(3);
    expect(split.sumDevolucionesCents).toBe(BigInt(-5_000_000_000)); // −$50M firmada
    // Trampa 2: sumar magnitudes por cuenta inflaría a $61M (2 × $5,5M de más).
    expect(split.sumAbsPorCuentaCents).toBe(BigInt(6_100_000_000));

    expect(ct.totalDevoluciones).toBe(50_000_000);
    expect(ct.ingresosNetos).toBe(450_000_000);
    expect(ct.cents!.ingresosNetos).toBe(split.sumClase4Cents);
    expectInvariantes(snap);

    expect(formulaDefectuosa(snap)).toBe(389_000_000);
  });

  it('un grupo 4175 que se netea a $0 no altera el ingreso', () => {
    const csv = [
      'codigo,nombre,nivel,transaccional,Saldo 2025',
      '110505,Caja general,Auxiliar,1,400000000',
      '410505,Ventas,Auxiliar,1,500000000',
      '41750501,Devolucion en ventas,Auxiliar,1,-5000000',
      '41750502,Devolucion en descuentos,Auxiliar,1,5000000',
    ].join('\n');
    const ct = preprocessTrialBalance(parseTrialBalanceCSV(csv)).primary.controlTotals;

    expect(ct.totalDevoluciones).toBe(0);
    expect(ct.ingresosNetos).toBe(500_000_000);
    // La fórmula vieja restaba $10M de devoluciones que se anulan entre sí.
    expect(ct.cents!.totalDevoluciones).toBe(BigInt(0));
  });
});

describe('Devoluciones 4175 — control SIN cuentas 4175', () => {
  it('sin grupo corrector el neto es la Σ ordinarias = Σ clase 4 ($450M)', () => {
    const snap = loadFixture('sin-devoluciones.csv');
    const ct = snap.controlTotals;
    const split = class4Split(snap);

    expect(split.devoluciones).toHaveLength(0);
    expect(ct.totalDevoluciones).toBe(0);
    expect(ct.ingresosNetos).toBe(450_000_000);
    expect(ct.cents!.ingresosNetos).toBe(split.sumClase4Cents);
    expectInvariantes(snap);
    // Control: la fórmula vieja y la nueva coinciden cuando no hay 4175.
    expect(formulaDefectuosa(snap)).toBe(ct.ingresosNetos!);
  });
});

describe('Devoluciones 4175 — guarda que declara, no maquilla (NIA 240)', () => {
  it('devoluciones > ingresos ordinarios → neto negativo publicado + emisión bloqueada', () => {
    const csv = [
      'codigo,nombre,nivel,transaccional,Saldo 2025',
      '110505,Caja general,Auxiliar,1,400000000',
      '410505,Ventas,Auxiliar,1,10000000',
      '417505,Devoluciones en ventas,Auxiliar,1,-50000000',
    ].join('\n');
    const snap = preprocessTrialBalance(parseTrialBalanceCSV(csv)).primary;
    const ct = snap.controlTotals;

    // NO se clampea a 0 ni se invierte el signo: se publica lo que resulta.
    expect(ct.totalDevoluciones).toBe(50_000_000);
    expect(ct.ingresosNetos).toBe(-40_000_000);
    expect(ct.cents!.ingresosNetos).toBe(BigInt(-4_000_000_000));

    expect(snap.validation.blocking).toBe(true);
    expect(
      snap.validation.reasons.some((r) => r.includes('Devoluciones 4175')),
    ).toBe(true);
    expect(
      snap.discrepancies.some((d) => d.location.includes('Devoluciones 4175')),
    ).toBe(true);
  });
});
