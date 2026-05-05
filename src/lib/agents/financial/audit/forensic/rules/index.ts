// ─── Registry de reglas forenses ─────────────────────────────────────────────
//
// Orden de ejecución: Benford → gaps → weekend → repeated → newTP → roundBias.
// Cada regla es independiente y capturada individualmente en el orchestrator.

import benfordRule from './benford';
import numerationGapsRule from './numeration-gaps';
import weekendPostingsRule from './weekend-postings';
import repeatedAmountsRule from './repeated-amounts';
import newThirdPartyRule from './new-third-party';
import roundNumberBiasRule from './round-number-bias';

import type { ForensicRule } from '../types';

export const ALL_RULES: ForensicRule[] = [
  benfordRule,
  numerationGapsRule,
  weekendPostingsRule,
  repeatedAmountsRule,
  newThirdPartyRule,
  roundNumberBiasRule,
];

export {
  benfordRule,
  numerationGapsRule,
  weekendPostingsRule,
  repeatedAmountsRule,
  newThirdPartyRule,
  roundNumberBiasRule,
};
