// ─── Regla: Terceros nuevos sin verificar ────────────────────────────────────
//
// Detecta terceros que aparecen por primera vez en el libro y:
//   a) Tienen monto total > 5M COP → medium
//   b) No tienen verified_at en third_party_tax_profile → high
//
// Un tercero nuevo con monto significativo sin verificar es una señal de
// alerta de fraude (proveedor fantasma, desvío de fondos, etc.).

import type { ForensicRule, RuleInput, RuleResult, Anomaly } from '../types';
import { getNewThirdPartiesForPeriod } from '../repository';

const MIN_AMOUNT_HIGH = 5_000_000; // 5M COP → trigger

const newThirdPartyRule: ForensicRule = {
  kind: 'new_third_party_unverified',

  async run(input: RuleInput): Promise<RuleResult> {
    const newThirdParties = await getNewThirdPartiesForPeriod(
      input.workspaceId,
      input.periodId,
      MIN_AMOUNT_HIGH,
    );

    if (newThirdParties.length === 0) return { anomalies: [] };

    const anomalies: Anomaly[] = newThirdParties.map((tp) => {
      const severity = !tp.hasVerifiedProfile ? 'high' : 'medium';
      return {
        kind: 'new_third_party_unverified' as const,
        severity,
        description:
          `Tercero nuevo (primera aparición en el libro) con monto total ` +
          `$${tp.totalAmountCop.toLocaleString('es-CO', { maximumFractionDigits: 0 })} COP. ` +
          (!tp.hasVerifiedProfile
            ? 'Sin perfil tributario verificado (verified_at nulo). Revisar RUT y autenticidad del proveedor.'
            : 'Perfil tributario registrado pero primera transacción. Confirmar relación comercial.'),
        affectedEntryIds: tp.entryIds,
        affectedAmountCop: tp.totalAmountCop.toFixed(2),
        reviewUrl: `/workspace/contabilidad/terceros/${tp.thirdPartyId}`,
        evidence: {
          thirdPartyId: tp.thirdPartyId,
          totalAmountCop: tp.totalAmountCop,
          hasVerifiedProfile: tp.hasVerifiedProfile,
          entryCount: tp.entryIds.length,
        },
      };
    });

    return { anomalies };
  },
};

export default newThirdPartyRule;
