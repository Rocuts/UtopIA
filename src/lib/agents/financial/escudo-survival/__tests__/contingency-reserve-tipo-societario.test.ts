// ---------------------------------------------------------------------------
// Reserva de contingencia — reserva legal según el tipo societario
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (tributario-calc-01, integración W3-B). El prompt del
// submódulo 4 declaraba la reserva legal del Art. 452 C.Co. «OBLIGATORIA» para
// toda sociedad y exigía citarla siempre. Es obligatoria en la S.A. (Art. 452
// C.Co.) y en la Ltda. (Art. 371 C.Co.); en la S.A.S. sólo existe si los
// estatutos la prevén (Supersociedades, Oficio 220-069664 de 2017). El
// optimizador de dividendos ya aplicaba esa regla; ahora también la reserva.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

const capturado: { system: string | null } = { system: null };
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { system: string }) => {
    capturado.system = opts.system;
    return {
      json: {
        markdown: 'reserva .............',
        warnings: [],
        data: { utilidadNeta: 1, reservaSugerida: 0.1, pctUtilidad: 0.1, cuentaSugerida: '11', reservaLegalActual: null, gapReservaLegal: null },
      },
      meta: {},
    };
  }),
}));

import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { buildContingencyReservePrompt } from '../prompts/contingency-reserve.prompt';
import { runContingencyReserve } from '../agents/contingency-reserve';

describe('buildContingencyReservePrompt — reserva legal condicionada al tipo societario', () => {
  const p = buildContingencyReservePrompt('es');

  it('no declara la reserva legal obligatoria para toda sociedad', () => {
    expect(p).not.toMatch(/Art\. 452 C\.Co\., obligatoria\)/);
    expect(p).not.toMatch(/capital suscrito\. OBLIGATORIA/);
    expect(p).not.toMatch(/ALWAYS cita "Art\. 452 C\.Co\." textualmente/);
  });

  it('S.A. y Ltda. obligatoria (Arts. 452 y 371 C.Co.); S.A.S. sólo por estatutos (220-069664/2017)', () => {
    expect(p).toMatch(/Art\. 452 C\.Co\./);
    expect(p).toMatch(/Art\. 371 C\.Co\./);
    expect(p).toMatch(/220-069664/);
    expect(p).toMatch(/S\.A\.S\..{0,80}NO es obligatoria/);
  });

  it('sin tipo societario el gap es una referencia y el supuesto va en warnings', () => {
    expect(p).toMatch(/If el tipo societario no consta then/);
    expect(p).toMatch(/referencia/);
  });

  it('con tipo societario declarado lo incluye en el contexto dinámico', () => {
    const sas = buildContingencyReservePrompt('es', undefined, undefined, {
      entityType: 'SAS',
      bylawsRequireLegalReserve: null,
    });
    expect(sas).toMatch(/Tipo societario declarado: SAS/);
    expect(sas).toMatch(/estatutos prev[eé]n la reserva legal: no consta/);
    // Sin tipo societario no se inventa uno.
    expect(p).not.toMatch(/Tipo societario declarado/);
  });
});

describe('runContingencyReserve — reenvía el tipo societario al prompt', () => {
  const CSV = `codigo,nombre,nivel,transaccional,Saldo 2025
110505,Caja general,Auxiliar,1,100000000
310505,Capital suscrito y pagado,Auxiliar,1,80000000
360505,Utilidad del ejercicio,Auxiliar,1,20000000
413550,Comercio,Auxiliar,1,120000000
510506,Sueldos,Auxiliar,1,100000000
`;

  it('company.entityType y bylawsRequireLegalReserve llegan al system prompt', async () => {
    await runContingencyReserve({
      preprocessed: preprocessTrialBalance(parseTrialBalanceCSV(CSV)),
      company: { name: 'X', nit: '900123456-1', entityType: 'Ltda.', bylawsRequireLegalReserve: null },
      language: 'es',
    });
    expect(capturado.system).toMatch(/Tipo societario declarado: Ltda\./);
  });
});
