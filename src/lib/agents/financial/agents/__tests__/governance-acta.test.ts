// ---------------------------------------------------------------------------
// Acta de asamblea (Governance Specialist) — regresiones auditoría 2026-09
// ---------------------------------------------------------------------------
// auditoria-calidad-01  pérdida impresa como "Utilidad Neta" positiva
// pipeline-flujo-18     encabezado de capitalización sobre "utilidades retenidas acumuladas"
// auditoria-calidad-18  el acta publicaba una opinión del RF redactada por Governance
// prompts-normativa-13  convocatoria citada siempre por el Art. 424 C.Co.
// prompts-normativa-04  nota IFRS 18 obligatoria para Grupo 2/3 (dispara V8)
// prompts-normativa-14  reparto de la Clase 25 por porcentajes fijos
// prompts-normativa-07  rail del Art. 36-3 E.T. descrito como vigente
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { __test_toGovernanceResult as toGovernanceResult } from '../governance-specialist';
import {
  buildGovernancePrompt,
  convocatoriaCitationFor,
  normalizeTipoSocietario,
} from '../../prompts/governance-specialist.prompt';
import { reportMencionaIFRS18 } from '@/lib/pillars/audit-report-emittable';
import type { GovernanceReportJson } from '../../contracts/governance-report';
import type { CompanyInfo } from '../../types';

function govJson(over: {
  netIncomeCop?: string;
  applies?: boolean;
  lines?: GovernanceReportJson['shareholderMinutes']['resultDistribution']['lines'];
  capitalization?: Partial<GovernanceReportJson['shareholderMinutes']['capitalizationProposal']>;
  notes?: GovernanceReportJson['financialNotes'];
  rfOpinion?: Partial<GovernanceReportJson['shareholderMinutes']['fiscalReviewerOpinion']>;
} = {}): GovernanceReportJson {
  return {
    company: {
      name: 'Perdidas SAS',
      nit: '900123456',
      entityType: 'SAS',
      sector: null,
      niifGroup: 2,
      fiscalPeriod: '2025',
      comparativePeriod: null,
      city: null,
      signatories: null,
    },
    reportMode: 'COMPARATIVO_COMPLETO',
    signatories: null,
    financialNotes: over.notes ?? [
      { number: 1, title: 'Entidad', body: 'Sociedad comercial.', normReference: null, materiality: 'material', confidence: null },
    ],
    shareholderMinutes: {
      assemblyType: 'Asamblea General de Accionistas',
      entityRegimeCitation: 'Ley 1258 de 2008 (SAS)',
      city: null,
      meetingDate: null,
      convocationStatement: 'Se convocó por comunicación escrita.',
      quorumStatement: 'Se verificó el quorum conforme a los estatutos sociales.',
      agenda: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ number: n, topic: `Punto ${n}` })),
      developments: [],
      resultDistribution: {
        netIncomeCop: over.netIncomeCop ?? '-25000000000',
        applies: over.applies ?? false,
        lines: over.lines ?? [],
        neutralProposalText: over.applies ? null : 'Los accionistas decidirán el cubrimiento de la pérdida.',
      },
      capitalizationProposal: {
        applies: false,
        retainedEarningsBaseCop: '0',
        capitalizationAmountCop: '0',
        legalReference: 'Ley 1258/2008 art. 29',
        body: 'Capitalización.',
        ...over.capitalization,
      },
      signatures: [
        { role: 'presidente_asamblea', name: null, identification: null },
        { role: 'secretario_asamblea', name: null, identification: null },
        { role: 'representante_legal', name: null, identification: null },
      ],
      fiscalReviewerOpinion: {
        applies: true,
        reviewerName: 'Ana Revisora',
        reviewerTp: '12345-T',
        opinionType: 'favorable',
        opinionBody: 'Los estados financieros presentan razonablemente la situación financiera.',
        exemptionReason: null,
        ...over.rfOpinion,
      },
      closingStatement: 'Se levanta la sesión.',
    },
    complianceChecklist: [],
    disclaimers: [],
    preparerNotes: [],
  };
}

const SAS: CompanyInfo = { name: 'Perdidas SAS', nit: '900123456', fiscalPeriod: '2025', entityType: 'SAS', niifGroup: 2 };

describe('Acta — signo del resultado del ejercicio (auditoria-calidad-01)', () => {
  it('pérdida de $250.000.000 se rotula "Pérdida neta del ejercicio" con paréntesis NIIF', () => {
    const res = toGovernanceResult(govJson({ netIncomeCop: '-25000000000' }), SAS);
    expect(res.shareholderMinutes).toContain('Pérdida neta del ejercicio: ($250.000.000,00)');
    expect(res.shareholderMinutes).not.toMatch(/Utilidad Neta del Ejercicio: \$250\.000\.000,00/i);
  });

  it('utilidad positiva se rotula "Utilidad neta del ejercicio" sin paréntesis', () => {
    const res = toGovernanceResult(govJson({ netIncomeCop: '25000000000' }), SAS);
    expect(res.shareholderMinutes).toContain('Utilidad neta del ejercicio: $250.000.000,00');
  });

  it('los renglones de destinación conservan el signo', () => {
    const res = toGovernanceResult(
      govJson({
        netIncomeCop: '1000000',
        applies: true,
        lines: [{ label: 'Ajuste', amountCop: '-500000', normReference: 'Art. 151 C.Co.' }],
      }),
      SAS,
    );
    expect(res.shareholderMinutes).toContain('| Ajuste | ($5.000,00) | Art. 151 C.Co. |');
  });
});

describe('Acta — capitalización sobre la utilidad del ejercicio (pipeline-flujo-18)', () => {
  it('el encabezado y la base describen la utilidad neta del ejercicio, no utilidades retenidas acumuladas', () => {
    const res = toGovernanceResult(
      govJson({
        netIncomeCop: '1000000000',
        capitalization: { applies: true, retainedEarningsBaseCop: '1000000000', capitalizationAmountCop: '400000000' },
      }),
      SAS,
    );
    expect(res.shareholderMinutes).toContain('Capitalización del 40% de la utilidad neta del ejercicio');
    expect(res.shareholderMinutes).toContain('_Base (utilidad neta del ejercicio):_ $10.000.000,00');
    expect(res.shareholderMinutes).not.toContain('utilidades retenidas acumuladas');
  });
});

describe('Acta — dictamen del Revisor Fiscal (auditoria-calidad-18)', () => {
  it('no publica la opinión redactada por Governance: la declara pendiente de emisión', () => {
    const res = toGovernanceResult(govJson(), SAS);
    expect(res.shareholderMinutes).toContain('dictamen pendiente de emisión por el Revisor Fiscal');
    expect(res.shareholderMinutes).not.toContain('emite dictamen favorable');
    expect(res.shareholderMinutes).not.toContain('presentan razonablemente');
    expect(res.json?.shareholderMinutes.fiscalReviewerOpinion.opinionType).toBeNull();
    expect(res.json?.shareholderMinutes.fiscalReviewerOpinion.opinionBody).toBeNull();
    expect(res.shareholderMinutes).toContain('Arts. 207-209 C.Co., Ley 43 de 1990');
  });

  it('el prompt ya no pide opinionType/opinionBody del Revisor Fiscal', () => {
    const p = buildGovernancePrompt(SAS, 'es');
    expect(p).toContain('opinionType=null y opinionBody=null');
    expect(p).not.toContain('opinionType y opinionBody (síntesis NIA 700/705/706');
  });
});

describe('Convocatoria por tipo societario (prompts-normativa-13)', () => {
  it('SAS cita estatutos + Art. 20 Ley 1258/2008, no el Art. 424 C.Co.', () => {
    const res = toGovernanceResult(govJson(), SAS);
    expect(res.shareholderMinutes).toContain('Art. 20 de la Ley 1258 de 2008');
    expect(res.shareholderMinutes).not.toContain('Art. 424');
    const p = buildGovernancePrompt(SAS, 'es');
    expect(p).not.toContain('Se hizo la convocatoria conforme al Art. 424 C.Co.');
    expect(p).toContain('Art. 20 de la Ley 1258 de 2008');
  });

  it('S.A. (con puntos) cita el Art. 424 C.Co.; Ltda. cita estatutos + Arts. 181-186 C.Co.', () => {
    const resSA = toGovernanceResult(govJson(), { ...SAS, entityType: 'S.A.' });
    expect(resSA.shareholderMinutes).toContain('Art. 424 C.Co.');
    const resLtda = toGovernanceResult(govJson(), { ...SAS, entityType: 'Ltda.' });
    expect(resLtda.shareholderMinutes).toContain('Arts. 181 a 186 C.Co.');
    expect(buildGovernancePrompt({ ...SAS, entityType: 'LTDA' }, 'es')).not.toContain('Art. 369 C.Co.');
  });

  it('normalizeTipoSocietario reconoce variantes con puntos y denominaciones largas', () => {
    expect(normalizeTipoSocietario('S.A.S.')).toBe('SAS');
    expect(normalizeTipoSocietario('S.A.')).toBe('SA');
    expect(normalizeTipoSocietario('Sociedad Anónima')).toBe('SA');
    expect(normalizeTipoSocietario('Ltda.')).toBe('LTDA');
    expect(normalizeTipoSocietario(undefined)).toBe('SAS');
    expect(convocatoriaCitationFor('SA')).toContain('Art. 424 C.Co.');
  });
});

describe('Nota IFRS 18 en Grupo 2/3 (prompts-normativa-04)', () => {
  const ifrs18Note = {
    number: 14 as const,
    title: 'Preparación IFRS 18',
    body: 'IFRS 18 no aplica directamente para Grupo 2 (NIIF PYMES); se informa como horizonte normativo del Grupo 1 (vigencia 2027).',
    normReference: 'IFRS 18',
    materiality: 'immaterial' as const,
    confidence: null,
  };

  it('el prompt de Grupo 2 no exige la nota literal y ordena no emitirla', () => {
    const p = buildGovernancePrompt(SAS, 'es');
    expect(p).not.toContain('IFRS 18 no aplica directamente para Grupo');
    expect(p).not.toContain('NUNCA omitir esta nota');
    expect(p).toContain('NO emitir ninguna nota sobre IFRS 18');
  });

  it('si el modelo la emite igual para Grupo 2, no llega al consolidado (sin V8)', () => {
    const notes = [
      { number: 1 as const, title: 'Entidad', body: 'Sociedad comercial.', normReference: null, materiality: 'material' as const, confidence: null },
      ifrs18Note,
    ];
    const res = toGovernanceResult(govJson({ notes }), SAS);
    expect(res.financialNotes).not.toContain('IFRS 18');
    expect(reportMencionaIFRS18(res.fullContent)).toBe(false);
  });

  it('para Grupo 1 la nota IFRS 18 se conserva', () => {
    const res = toGovernanceResult(govJson({ notes: [{ ...ifrs18Note, materiality: 'material' }] }), { ...SAS, niifGroup: 1 });
    expect(res.financialNotes).toContain('Preparación IFRS 18');
  });
});

describe('Rails normativos del prompt de Governance', () => {
  it('no reparte la Clase 25 por porcentajes fijos (prompts-normativa-14)', () => {
    const p = buildGovernancePrompt(SAS, 'es');
    expect(p).not.toContain('38,17');
    expect(p).not.toContain('19,08');
    expect(p).toContain('desglose por concepto no está disponible');
  });

  it('describe el Art. 36-3 E.T. como derogado por la Ley 2277/2022 y no lo cita en el cuerpo del acta', () => {
    const p = buildGovernancePrompt(SAS, 'es');
    expect(p).toContain('DEROGADO por el Art. 96 de la Ley 2277 de 2022');
    expect(p).not.toContain('su inciso primero cubre únicamente la capitalización');
  });
});
