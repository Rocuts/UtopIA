// ---------------------------------------------------------------------------
// niif-preproceso-33 sobre el balance real del repo — sin falsos positivos
// ---------------------------------------------------------------------------
// /export y /html re-derivan ahora el preprocesado que envía la UI (desde el
// `rawData` o desde sus propias `rawRows`, con el ledger confirmado) y
// responden 422 si los totales de control no casan. Las pruebas unitarias usan
// balances de juguete; aquí se fija que el único export de ERP real del repo
// (dos periodos, R8, curador, reclasificaciones) atraviesa el viaje JSON y la
// re-derivación sin diferencias, con y sin ajustes del Doctor de Datos. Si un
// cambio del preprocesador añade opciones que no quedan reflejadas en
// `rawRows` (p. ej. una unidad declarada), esta prueba lo delata antes de que
// la UI reciba un 422 sobre un informe honesto.
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import ExcelJS from 'exceljs';

import { preprocessTrialBalance, type PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import {
  parseUploadedTrialBalanceText,
  preprocessUploadedTrialBalanceText,
} from '@/lib/preprocessing/raw-data';
import {
  preprocessedAnchorMismatches,
  revivePreprocessedBalance,
  toJsonSafe,
} from '@/lib/preprocessing/json-safe';
import { applyAdjustments } from '@/lib/agents/repair/adjustments';
import type { Adjustment } from '@/lib/agents/repair/types';
import { rederivePreprocessedFromRows } from '../preprocessed-integrity';

const XLSX = path.resolve(process.cwd(), 'src/lib/preprocessing/__fixtures__/grupo-empresarial-2tres-sas.xlsx');

/** Mismo CSV fiel (RFC 4180, encabezado en la fila 8) que anclas-pyg-y-comparativo. */
async function realCsv(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);
  const lines: string[] = [];
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  wb.worksheets[0].eachRow((row) => {
    lines.push(
      (row.values as unknown[])
        .slice(1)
        .map((v) => {
          if (v === null || v === undefined) return '';
          if (typeof v === 'string') return cell(v);
          if (typeof v === 'number') return String(v);
          const o = v as { text?: string; result?: unknown };
          return cell(o.text ?? (o.result !== undefined ? String(o.result) : String(v)));
        })
        .join(','),
    );
  });
  return lines.slice(7).join('\n');
}

/** Lo que /niif calcula (Stage 0) y la UI reenvía tras el viaje JSON. */
function niifStage0(csv: string): PreprocessedBalance {
  const parsed = parseUploadedTrialBalanceText(csv);
  return preprocessTrialBalance(parsed.rows, { openingPeriods: parsed.openingPeriods });
}

function wire(pp: PreprocessedBalance): PreprocessedBalance {
  const revived = revivePreprocessedBalance(JSON.parse(JSON.stringify(toJsonSafe(pp))));
  if (!revived) throw new Error('el preprocesado real no revive');
  return revived;
}

const ADJ: Adjustment = {
  id: 'adj-real-1',
  accountCode: '110505',
  accountName: 'Caja general',
  amount: 1234.56,
  rationale: 'Ajuste confirmado de prueba',
  status: 'applied',
  proposedAt: '2026-09-24T00:00:00Z',
};

describe('re-derivación del preprocesado — balance real (sin falsos positivos)', () => {
  let csv: string;

  beforeAll(async () => {
    csv = await realCsv();
  }, 60_000);

  it('dos periodos: el preprocesado de /niif casa con sus propias filas y con el rawData', () => {
    const pp = niifStage0(csv);
    expect(pp.periods.length).toBeGreaterThanOrEqual(2);
    const own = rederivePreprocessedFromRows(wire(pp));
    expect(own.ok ? [] : own.details).toEqual([]);
    const fromRaw = preprocessUploadedTrialBalanceText(csv);
    expect(fromRaw.kind).toBe('ok');
    if (fromRaw.kind !== 'ok') return;
    expect(preprocessedAnchorMismatches(wire(pp), fromRaw.preprocessed)).toEqual([]);
  });

  it('con ajustes confirmados: casa con el mismo ledger y se rechaza sin él', () => {
    const adjusted = wire(applyAdjustments(niifStage0(csv), [ADJ]).balance);
    const withLedger = rederivePreprocessedFromRows(adjusted, [ADJ]);
    expect(withLedger.ok ? [] : withLedger.details).toEqual([]);
    expect(rederivePreprocessedFromRows(adjusted).ok).toBe(false);
  });
});
