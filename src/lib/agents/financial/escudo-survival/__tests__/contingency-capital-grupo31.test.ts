// NM-08 (re-auditoría normativa-metricas, 2026-09-24) — residuo del Escudo:
// el prompt de la reserva de contingencia ya dice «capital suscrito = grupo
// 31» y condiciona la reserva legal al tipo societario (W3-B), pero el bloque
// de TOTALES VINCULANTES que recibe el agente sólo traía la cuenta 3115,
// rotulada «Capital suscrito y pagado» (en el PUC, 3105 es capital suscrito y
// pagado y 3115 aportes sociales). En una S.A.S. con 310505 el agente recibía
// capital $0 y el tope del 50 % (Art. 452 C.Co.) no tenía base.
import { describe, expect, it } from 'vitest';

import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import {
  buildAnchorBlock,
  extractSurvivalAnchors,
} from '@/lib/agents/financial/escudo-survival/lib/extract-totals';

const CSV = [
  'codigo,nombre,nivel,transaccional,Saldo 2025',
  '110505,Caja,Auxiliar,1,500000000',
  '310505,Capital suscrito y pagado,Auxiliar,1,300000000',
  '311505,Aportes sociales,Auxiliar,1,20000000',
  '330505,Reserva legal,Auxiliar,1,30000000',
  '370505,Resultados de ejercicios anteriores,Auxiliar,1,150000000',
].join('\n');

describe('NM-08 — capital del grupo 31 como dato vinculante de la reserva legal', () => {
  const anchors = extractSurvivalAnchors(preprocessTrialBalance(parseTrialBalanceCSV(CSV)));

  it('el capital es el grupo 31 completo (3105 + 3115), no sólo la 3115', () => {
    expect(anchors.capitalGrupo31).toBe(320_000_000);
    expect(anchors.saldoCuenta3305).toBe(30_000_000);
  });

  it('el bloque vinculante rotula el grupo 31 y no llama «capital suscrito y pagado» a la 3115', () => {
    const block = buildAnchorBlock(anchors);
    expect(block).toMatch(/Capital social \(grupo 31[^\n]*\$320\.000\.000/);
    expect(block).not.toMatch(/3115 Capital suscrito y pagado/);
  });
});
