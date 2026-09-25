// Integración IW5b (auditoría 2026-09-24): al montar el uploader real de saldos
// iniciales en /workspace/contabilidad/apertura apareció un desajuste de
// contrato con /api/accounting/opening-balance (ver opening-balance-response.ts).
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

import { normalizeOpeningBalanceResponse } from '../opening-balance-response';

describe('respuesta de /api/accounting/opening-balance', () => {
  it('lee linesInserted y warnings de `result`', () => {
    expect(
      normalizeOpeningBalanceResponse(true, {
        ok: true,
        result: { entryId: 'e', linesInserted: 37, warnings: ['cuenta 1805 sin nombre'], skippedRows: 0 },
      }),
    ).toEqual({ ok: true, inserted: 37, warnings: ['cuenta 1805 sin nombre'], error: null });
  });

  it('convierte el error estructurado en texto (nunca un objeto a la UI)', () => {
    const r = normalizeOpeningBalanceResponse(false, {
      ok: false,
      error: { code: 'PERIOD_CLOSED', message: 'El período está cerrado.' },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('El período está cerrado.');
  });

  it('sin conteo informado no inventa 0', () => {
    expect(normalizeOpeningBalanceResponse(true, { ok: true, result: {} }).inserted).toBeNull();
  });

  it('el uploader usa el normalizador', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/workspace/accounting/OpeningBalanceUploader.tsx'),
      'utf8',
    );
    expect(src).toMatch(/normalizeOpeningBalanceResponse\(/);
    expect(src).not.toMatch(/result\.inserted \?\? 0/);
  });
});
