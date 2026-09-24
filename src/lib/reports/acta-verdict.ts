import type { CompanyInfo, GovernanceResult } from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { buildActaExpectedArithmetic } from '@/lib/agents/financial/prompts/governance-specialist.prompt';
import {
  describeActaQualifications,
  reconcileActaArithmetic,
} from '@/lib/agents/financial/contracts/base';
import { parseMoneyCop } from '@/lib/agents/financial/contracts/money';

// ---------------------------------------------------------------------------
// Veredicto del acta recalculado por el servidor al persistir la versión
// ---------------------------------------------------------------------------
// /consolidate recibe la Parte III (con su `actaQualifications`) del navegador.
// Un veredicto omitido o reescrito por el cliente no puede viajar a la versión
// persistida: /export sólo mira el flag y la versión sale sellada "procedencia
// verificada". Aquí se vuelve a cruzar el acta contra la aritmética
// determinista del balance re-derivado —la MISMA que usan /governance
// (`runGovernancePhase`) y /html (`partQualificationBlockers`)— y el resultado
// sólo puede ENDURECER el veredicto del cliente, nunca levantarlo.
// ---------------------------------------------------------------------------

export interface ActaVerdict {
  clean: boolean;
  motivos: string[];
}

type ActaJson = NonNullable<NonNullable<GovernanceResult['json']>['shareholderMinutes']>;

function isMoney(v: unknown): v is string {
  return typeof v === 'string' && /^-?\d+$/.test(v);
}

/**
 * Veredicto del acta según el servidor. `null` si la Parte III no trae acta
 * estructurada (no hay cifras que cruzar).
 */
export function serverActaVerdict(
  governance: GovernanceResult,
  company: CompanyInfo,
  preprocessed: PreprocessedBalance | undefined,
): ActaVerdict | null {
  const acta = governance.json?.shareholderMinutes as ActaJson | null | undefined;
  if (!acta || typeof acta !== 'object') return null;
  const expected = preprocessed ? buildActaExpectedArithmetic(company, preprocessed) : null;
  if (expected) {
    const devs = reconcileActaArithmetic(
      {
        netIncomeCop: acta.resultDistribution?.netIncomeCop ?? null,
        distributionApplies: acta.resultDistribution?.applies ?? false,
        distributionLines: (acta.resultDistribution?.lines ?? []).map((l) => ({
          label: l.label,
          amountCop: l.amountCop,
        })),
        capitalizationApplies: acta.capitalizationProposal?.applies ?? false,
        capitalizationBaseCop: acta.capitalizationProposal?.retainedEarningsBaseCop ?? null,
        capitalizationAmountCop: acta.capitalizationProposal?.capitalizationAmountCop ?? null,
      },
      expected,
    );
    return devs.length > 0
      ? { clean: false, motivos: describeActaQualifications(devs) }
      : { clean: true, motivos: [] };
  }
  // Sin aritmética esperada (sin balance preprocesado): una destinación o una
  // capitalización con monto no tiene ancla (pipeline-flujo-03, mismo criterio
  // que /html).
  const nonZero = (v: unknown) => isMoney(v) && parseMoneyCop(v) !== BigInt(0);
  const distributes =
    acta.resultDistribution?.applies === true ||
    (acta.resultDistribution?.lines ?? []).some((l) => nonZero(l.amountCop));
  const capitalizes =
    acta.capitalizationProposal?.applies === true ||
    nonZero(acta.capitalizationProposal?.capitalizationAmountCop);
  return distributes || capitalizes
    ? {
        clean: false,
        motivos: [
          'Acta — propone destinación de utilidades o capitalización sin el balance preprocesado: ' +
            'sus cifras no pueden reconciliarse con la aritmética determinista.',
        ],
      }
    : { clean: true, motivos: [] };
}

/**
 * Parte III con el veredicto del servidor aplicado: un `clean: false` del
 * cliente se conserva (con sus motivos) y uno del servidor lo añade; un
 * `clean: true` del servidor sólo se escribe si el cliente no traía veredicto.
 */
export function withServerActaVerdict(
  governance: GovernanceResult,
  verdict: ActaVerdict | null,
): GovernanceResult {
  if (!verdict) return governance;
  const client = governance.actaQualifications;
  if (verdict.clean) {
    return client ? governance : { ...governance, actaQualifications: { clean: true, motivos: [] } };
  }
  const clientMotivos = client?.clean === false && Array.isArray(client.motivos) ? client.motivos : [];
  return {
    ...governance,
    actaQualifications: {
      clean: false,
      motivos: Array.from(new Set([...clientMotivos, ...verdict.motivos])),
    },
  };
}
