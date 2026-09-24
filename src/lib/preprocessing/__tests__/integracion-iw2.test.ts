// ---------------------------------------------------------------------------
// Integración IW2 (auditoría 2026-09) — preprocesador de balances de prueba.
// ---------------------------------------------------------------------------
// Dependencias cruzadas de la ola 1 que caen en `trial-balance.ts`:
//   - ingesta-29: naturaleza PUC de las clases 8 y 9 compartida con el
//     importador de apertura (`isDebitNaturePuc`).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  isDebitNaturePuc,
  parseTrialBalanceCSV,
} from '@/lib/preprocessing/trial-balance';
import { isDebitNaturePuc as isDebitNaturePucApertura } from '@/lib/accounting/opening-balance/parser';

describe('ingesta-29 — naturaleza de las clases 8 y 9 en el parser (débito/crédito)', () => {
  const csv = [
    'codigo,nombre,debito,credito',
    '11050501,Caja,1000,0',
    '31050501,Capital,0,1000',
    '83050501,Bienes recibidos en custodia,5000,0',
    '86050501,Deudoras de control por contra,0,5000',
    '93050501,Acreedoras de control,0,7000',
    '94050501,Acreedoras de control por contra,7000,0',
  ].join('\n');

  it('clase 8 deudora (84-86 por contra acreedoras) y clase 9 acreedora (94-96 deudoras): saldo natural positivo', () => {
    const rows = parseTrialBalanceCSV(csv, { normalizeSignConvention: false });
    const saldo = (code: string) => rows.find((r) => r.code === code)?.balancesByPeriod.current;
    expect(saldo('83050501')).toBe(5000);
    expect(saldo('86050501')).toBe(5000);
    expect(saldo('93050501')).toBe(7000);
    expect(saldo('94050501')).toBe(7000);
  });

  it('el preprocesador y el importador de apertura comparten la misma regla', () => {
    expect(isDebitNaturePucApertura).toBe(isDebitNaturePuc);
  });
});
