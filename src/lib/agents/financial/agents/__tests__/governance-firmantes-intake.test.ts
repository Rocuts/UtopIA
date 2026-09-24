// ---------------------------------------------------------------------------
// procedencia-R2-04 — firmantes del acta desde el intake
// ---------------------------------------------------------------------------
// El acta imprimía nombre, identificación y T.P. de los firmantes tal como los
// escribía el modelo. `renderGovernanceResult` los toma ahora del intake
// (`company.signatories` o los campos legacy) y, sin dato, "a completar al
// firmar"; el JSON expuesto lleva la misma identidad.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { GovernanceReportSchema, type GovernanceReportJson } from '../../contracts/governance-report';
import { intakeSignatories, renderGovernanceResult } from '../governance-specialist';
import { coherentGovernanceJson } from '@/lib/reports/__tests__/coherent-parts';
import { makeCoherentNiifReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { CompanyInfo } from '../../types';

const NIIF = makeCoherentNiifReport();
const BASE: CompanyInfo = { name: NIIF.company.name, nit: NIIF.company.nit, fiscalPeriod: '2025', entityType: 'SAS' };

function foreignJson(): GovernanceReportJson {
  const g = coherentGovernanceJson(NIIF, BASE);
  g.shareholderMinutes.signatures = [
    { role: 'presidente_asamblea', name: 'Pedro Presidente', identification: 'C.C. 1' },
    { role: 'secretario_asamblea', name: 'Sara Secretaria', identification: 'C.C. 2' },
    { role: 'representante_legal', name: 'Rodrigo Impostor', identification: 'C.C. 9.999.999' },
    { role: 'contador_publico', name: 'Carlos Contador Ajeno', identification: 'T.P. 88888-T' },
  ];
  g.shareholderMinutes.fiscalReviewerOpinion = {
    ...g.shareholderMinutes.fiscalReviewerOpinion,
    applies: true,
    reviewerName: 'Rogelio Revisor Ajeno',
    reviewerTp: '99999-T',
    exemptionReason: null,
  };
  g.signatories = { representanteLegal: { nombre: 'Rodrigo Impostor' }, revisorFiscal: null, contadorPublico: null };
  return g;
}

describe('R2-04 — firmantes del acta desde el intake', () => {
  it('forma canónica `signatories`: nombre, C.C. y T.P. del intake; el JSON sigue cumpliendo el contrato', () => {
    const company: CompanyInfo = {
      ...BASE,
      signatories: {
        representanteLegal: { nombre: 'Luisa Legal', cedula: '52.111.222' },
        revisorFiscal: { nombre: 'Ana Revisora', tp: '12345-T' },
        contadorPublico: { nombre: 'Camilo Contador', tp: '67890-T' },
      },
    };
    const r = renderGovernanceResult(foreignJson(), company, null);
    expect(r.shareholderMinutes).toContain('| Representante Legal | Luisa Legal | C.C. 52.111.222 |');
    expect(r.shareholderMinutes).toContain('| Contador Público | Camilo Contador | T.P. 67890-T |');
    expect(r.shareholderMinutes).toContain('Ana Revisora — T.P. 12345-T, Revisor Fiscal de');
    expect(r.shareholderMinutes).toMatch(/\| Presidente de .* \| — \(a completar al firmar\) \|/);
    for (const foreign of ['Rodrigo', 'Rogelio', 'Carlos Contador', 'Pedro', 'Sara', '99999-T', '88888-T']) {
      expect(r.fullContent).not.toContain(foreign);
    }
    expect(GovernanceReportSchema.safeParse(r.json).success).toBe(true);
    expect(r.json?.signatories?.revisorFiscal).toEqual({ nombre: 'Ana Revisora', tp: '12345-T' });
  });

  it('campos legacy y T.P. con formato inválido: se imprime tal cual en el acta, el espejo del contrato queda en null', () => {
    const company: CompanyInfo = { ...BASE, fiscalAuditor: 'Ana Revisora', fiscalAuditorTp: 'TP-12' };
    expect(intakeSignatories(company).revisorFiscal).toEqual({ name: 'Ana Revisora', cedula: null, tp: 'TP-12' });
    const r = renderGovernanceResult(foreignJson(), company, null);
    expect(r.shareholderMinutes).toContain('Ana Revisora — T.P. TP-12');
    expect(r.json?.signatories).toBeNull();
    expect(GovernanceReportSchema.safeParse(r.json).success).toBe(true);
  });

  it('sin intake: todo "a completar al firmar" y ninguna identidad del modelo', () => {
    const r = renderGovernanceResult(foreignJson(), BASE, null);
    expect(r.shareholderMinutes).toContain('| Representante Legal | — (a completar al firmar) | ——————— |');
    expect(r.shareholderMinutes).toContain('— (a completar al firmar), Revisor Fiscal de');
    expect(r.fullContent).not.toMatch(/Rodrigo|Rogelio|Carlos Contador|9\.999\.999/);
    expect(r.json?.shareholderMinutes.signatures.every((s) => s.name === null && s.identification === null)).toBe(true);
  });
});
