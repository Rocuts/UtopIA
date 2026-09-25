// Integración IW5b (auditoría 2026-09-24) — contratos HTTP de schemas.ts.
//
// tributario-calc-02: `sanctionRequestSchema` de este módulo quedó desactualizado
// (sin saldoAFavor, netEquityPriorYear, correccionStage, reduccion640,
// mesesExtemporaneidadInicial ni el tipo extemporaneidad_post_emplazamiento).
// Debe ser el MISMO objeto que el contrato compartido de sanction-contract.
//
// valoracion-17: projectInfoSchema descartaba `startYear`, así que el calendario
// ZOMAC usaba siempre el supuesto «año siguiente a la evaluación».
//
// tributario-modulos-02: el agente fiscal no podía partir del saldo a favor
// declarado en el Formulario 110 (`saldoAFavorDeclaradoCents`, MoneyCop).
//
// tributario-modulos-13: el requerimiento especial (Art. 703 E.T.) faltaba en
// la lista de tipos de acto DIAN del request del agente fiscal.
import { describe, it, expect } from 'vitest';

import {
  fiscalAgentRequestSchema,
  projectInfoSchema,
  sanctionRequestSchema,
} from '../schemas';
import { sanctionRequestSchema as sanctionContract } from '@/lib/tools/sanction-contract';

const baseProject = {
  projectName: 'Planta de empaques',
  description: 'Proyecto de inversión en municipio ZOMAC',
  sector: 'Manufactura',
};

describe('sanctionRequestSchema — contrato único (tributario-calc-02)', () => {
  it('es el schema de sanction-contract, no una copia', () => {
    expect(sanctionRequestSchema).toBe(sanctionContract);
  });

  it('conserva los campos que cambian la cifra (saldo a favor, patrimonio, gradualidad)', () => {
    const parsed = sanctionRequestSchema.parse({
      type: 'extemporaneidad_post_emplazamiento',
      taxDue: 0,
      saldoAFavor: 1_000_000,
      netEquityPriorYear: 50_000_000,
      correccionStage: null,
      reduccion640: '50',
      mesesExtemporaneidadInicial: null,
      delayMonths: 2,
    });
    expect(parsed.saldoAFavor).toBe(1_000_000);
    expect(parsed.netEquityPriorYear).toBe(50_000_000);
    expect(parsed.reduccion640).toBe('50');
  });
});

describe('projectInfoSchema.startYear (valoracion-17)', () => {
  it('conserva el año de inicio declarado', () => {
    const parsed = projectInfoSchema.parse({ ...baseProject, startYear: 2027 });
    expect(parsed.startYear).toBe(2027);
  });

  it('rechaza años fuera de rango o no enteros', () => {
    expect(projectInfoSchema.safeParse({ ...baseProject, startYear: 2016 }).success).toBe(false);
    expect(projectInfoSchema.safeParse({ ...baseProject, startYear: 2027.5 }).success).toBe(false);
  });

  it('sigue siendo opcional', () => {
    expect(projectInfoSchema.parse(baseProject).startYear).toBeUndefined();
  });
});

describe('fiscalAgentRequestSchema (tributario-modulos-02 / -13)', () => {
  const base = { rawData: '1105,Caja,100,0' };

  it('conserva saldoAFavorDeclaradoCents como MoneyCop (centavos en string)', () => {
    const parsed = fiscalAgentRequestSchema.parse({ ...base, saldoAFavorDeclaradoCents: '150000000' });
    expect(parsed.saldoAFavorDeclaradoCents).toBe('150000000');
  });

  it('rechaza montos que no son centavos enteros en string', () => {
    for (const bad of [1500000, '1.500.000', '1500000.50', '-100', '']) {
      expect(
        fiscalAgentRequestSchema.safeParse({ ...base, saldoAFavorDeclaradoCents: bad }).success,
        `debe rechazar ${JSON.stringify(bad)}`,
      ).toBe(false);
    }
  });

  it('acepta el requerimiento especial (Art. 703 E.T.) como tipo de acto', () => {
    const parsed = fiscalAgentRequestSchema.parse({
      ...base,
      mode: 'defensa_dian',
      dianRequirementKind: 'requerimiento_especial',
    });
    expect(parsed.dianRequirementKind).toBe('requerimiento_especial');
  });
});
