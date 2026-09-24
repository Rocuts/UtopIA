// ---------------------------------------------------------------------------
// Balance de TRES cortes (2023, 2024, 2025) para los comparativos del EFE y
// del ECP (auditoría integral 2026-09-24, pendiente #3 — NIIF para las PYMES
// 3.14). Con el corte 2023 como apertura del periodo comparativo 2024, el EFE
// y el ECP de 2024 se calculan igual que los de 2025.
//
// CSV: src/lib/preprocessing/__fixtures__/tres-cortes-comparativo.csv
//
//            2023          2024          2025
// Activo     123.000.000   167.000.000   158.000.000
// Pasivo      50.000.000    65.000.000    47.000.000
// Patrimonio  73.000.000   102.000.000   111.000.000
// Utilidad    10.000.000    15.000.000    18.000.000
//
// EFE 2024: operación 11M (15 + dep 6 − clientes 10 − inventario 5 +
// proveedores 5), inversión −20M (equipo), financiación 24M (bancos 10 +
// aporte neto de socios 14: capital 20 − utilidades giradas 6); Δ caja 15M.
// EFE 2025: operación 19M (18 + dep 7 − clientes 5 + inventario 2 −
// proveedores 3), inversión 0, financiación −24M (bancos −15, distribuciones
// −9); Δ caja −5M.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import {
  attachComparativeStatements,
  buildComparativeStatementsBasis,
  buildDeterministicCashFlow,
  buildDeterministicEquityChanges,
} from '../contracts/deterministic-breakdown';
import type { NiifReportJson } from '../contracts/niif-report';
import { informeHonesto } from './perdida-comparativo-w4a';

export const CSV_TRES_CORTES_PATH = path.join(
  process.cwd(),
  'src/lib/preprocessing/__fixtures__/tres-cortes-comparativo.csv',
);

export function csvTresCortes(): string {
  return fs.readFileSync(CSV_TRES_CORTES_PATH, 'utf8');
}

/** El mismo balance sin el corte 2023: dos cortes, comparativo 2024 sin apertura. */
export function csvDosCortes(): string {
  return csvTresCortes()
    .split('\n')
    .map((line) => {
      const cells = line.split(',');
      if (cells.length < 7) return line;
      if (cells[4] === 'saldo 2023' || /^\d+$/.test(cells[0])) cells.splice(4, 1);
      return cells.join(',');
    })
    .join('\n');
}

export function preprocesarTresCortes(csv = csvTresCortes()): PreprocessedBalance {
  return preprocessTrialBalance(parseTrialBalanceCSV(csv));
}

/**
 * Informe NIIF honesto (anclas copiadas, ESF/ERI por grupo PUC, EFE = el
 * determinista, ECP = el determinista de los dos últimos cortes) con los
 * comparativos del EFE y del ECP adjuntos por el código, como los deja
 * `runNiifAnalyst`.
 */
export function informeTresCortes(pp: PreprocessedBalance): NiifReportJson {
  const base = informeHonesto(pp);
  const ecp = buildDeterministicEquityChanges(pp.comparative!, pp.primary);
  if (!('rows' in ecp)) throw new Error(`fixture: ECP no calculable — ${ecp.reason}`);
  const json: NiifReportJson = {
    ...base,
    company: { ...base.company, name: 'Demo Tres Cortes SAS', nit: '900765432-6' },
    equityChanges: { ...base.equityChanges, rows: ecp.rows },
  };
  return attachComparativeStatements(
    json,
    buildComparativeStatementsBasis(pp),
    buildDeterministicCashFlow(pp.primary, pp.comparative!),
  );
}
