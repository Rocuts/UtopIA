// ---------------------------------------------------------------------------
// I3-2 (cross-dep I1-6 / auditoria-calidad-31) — régimen de renta en el intake
// ---------------------------------------------------------------------------
// El gate de emitibilidad ya no exige V10 (TTD, par. 6 Art. 240 E.T.) al
// Régimen Simple (Art. 903 E.T.: "sustituye el impuesto sobre la renta") y
// `regimenTributarioParaGate` lo lee de la empresa. Pero el intake NIIF no lo
// capturaba y `companyInfoSchema` no lo declaraba: Zod lo quitaba en /niif y
// /consolidate y el SIMPLE seguía bloqueado por V10.
//
// Aquí, de punta a punta: selector del intake → cuerpo de /niif (helper real
// de PipelineWorkspace) → /niif real (LLM mockeado) → contexto → cuerpo de
// /consolidate (helper real) → /consolidate real → gate. Sin dato (null) el
// comportamiento sigue siendo el conservador: V10 exigido.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ db: null as unknown, language: 'es' as 'es' | 'en' }));

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));
vi.mock('@/lib/db/workspace', () => ({
  getCurrentWorkspaceId: vi.fn(async () => '11111111-1111-4111-8111-111111111111'),
}));
vi.mock('@/lib/db/activity-log', () => ({ logActivity: async () => {} }));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: async () => '' }));
vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: vi.fn(async () => null) }));
vi.mock('@/lib/db/telemetry', async (orig) => {
  const actual = await orig<typeof import('@/lib/db/telemetry')>();
  return { ...actual, resolveOwnedReportId: async () => null };
});
vi.mock('@/lib/agents/financial/agents/niif-analyst', () => ({ runNiifAnalyst: vi.fn() }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ language: state.language }) }));

import { POST as niif } from '@/app/api/financial-report/niif/route';
import { POST as consolidate } from '@/app/api/financial-report/consolidate/route';
import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import { toNiifAnalysisResult } from '@/lib/agents/financial/agents/renderer';
import {
  CSV_PERDIDA_COMPARATIVO,
  informeHonesto,
  preprocesarPerdidaComparativo,
} from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import type { CompanyInfo, FinancialReport, NiifAnalysisResult } from '@/lib/agents/financial/types';
import { companyInfoSchema } from '@/lib/validation/schemas';
import { dict } from '@/lib/i18n/dictionaries';
import type { NiifReportIntake, RegimenTributarioIntake } from '@/types/platform';
import { makeProvenanceParts, makeReportsTableFake } from '@/lib/reports/__tests__/provenance-fixture';
import { buildConsolidationRequestBody, buildNiifCompanyBody, buildNiifRequestBody } from '../../PipelineWorkspace';
import { normalizeRegimenTributario } from '../niifIntakeValidation';
import { RegimenTributarioSelector } from '../RegimenTributarioSelector';
import { IntakePreview } from '../IntakePreview';

const HONEST = preprocesarPerdidaComparativo();

function intake(regimenTributario?: RegimenTributarioIntake | null): NiifReportIntake {
  return {
    caseType: 'niif_report',
    company: {
      name: 'Demo Perdidas SAS',
      nit: '900123456-8',
      entityType: 'SAS',
      ...(regimenTributario !== undefined ? { regimenTributario } : {}),
    },
    niifGroup: 2,
    fiscalPeriod: '2025',
    comparativePeriod: '2024',
    rawData: CSV_PERDIDA_COMPARATIVO,
    outputOptions: {
      financialStatements: true,
      kpiDashboard: true,
      cashFlowProjection: true,
      breakevenAnalysis: true,
      notesToFinancialStatements: true,
      shareholdersMinutes: true,
      auditPipeline: false,
      metaAudit: false,
      excelExport: true,
      comparativeAnalysis: true,
    },
  };
}

const jsonReq = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  state.db = makeReportsTableFake().db;
  state.language = 'es';
  vi.mocked(runNiifAnalyst).mockResolvedValue({
    ...toNiifAnalysisResult(structuredClone(informeHonesto(HONEST))),
    reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false },
  });
});

/** Intake → /niif → /consolidate con una Parte II que NO aborda la TTD. */
async function correr(regimen?: RegimenTributarioIntake | null) {
  const niifRes = await niif(jsonReq('/api/financial-report/niif', buildNiifRequestBody({ intake: intake(regimen), language: 'es' })));
  const niifText = await niifRes.text();
  expect(niifRes.status, niifText).toBe(200);
  const phase = JSON.parse(niifText) as { niif: NiifAnalysisResult; context: { company: CompanyInfo } };

  const parts = makeProvenanceParts();
  parts.strategicAnalysis.fullContent = 'Análisis estratégico del periodo.';
  // Desde I3-markdown el servidor re-renderiza las Partes desde su JSON y
  // descarta el Markdown del navegador: la TTD se retira del JSON (nota de
  // impuestos de la Parte III), no sólo del texto.
  for (const note of parts.governance.json?.financialNotes ?? []) {
    if (/TTD|Tributaci[oó]n Depurada/i.test(note.body)) note.body = 'Impuesto de renta del ejercicio.';
  }
  const body = buildConsolidationRequestBody({
    rawData: CSV_PERDIDA_COMPARATIVO,
    company: phase.context.company,
    language: 'es',
    niifResult: phase.niif,
    strategyResult: parts.strategicAnalysis,
    governanceResult: parts.governance,
  });
  const res = await consolidate(jsonReq('/api/financial-report/consolidate', body));
  const text = await res.text();
  expect(res.status, text).toBe(200);
  const out = JSON.parse(text) as { report: FinancialReport };
  return {
    company: phase.context.company,
    v10: (out.report.emittability?.blockers ?? []).some((b) => b.code === 'V10'),
    persistedRegimen: out.report.company.regimenTributario,
  };
}

describe('régimen de renta del intake NIIF hasta el gate (auditoria-calidad-31)', () => {
  it('normaliza sólo "ordinario" / "simple"; cualquier otro valor es null (sin dato)', () => {
    expect(normalizeRegimenTributario('simple')).toBe('simple');
    expect(normalizeRegimenTributario('ordinario')).toBe('ordinario');
    for (const v of [undefined, null, '', 'SIMPLE', 'zomac', 3]) expect(normalizeRegimenTributario(v)).toBeNull();
  });

  it('companyInfoSchema declara el régimen: lo conserva, acepta null/ausente y rechaza valores ajenos', () => {
    const base = { name: 'X', nit: '900123456-8', fiscalPeriod: '2025' };
    expect(companyInfoSchema.parse({ ...base, regimenTributario: 'simple' }).regimenTributario).toBe('simple');
    expect(companyInfoSchema.parse({ ...base, regimenTributario: null }).regimenTributario).toBeNull();
    expect(companyInfoSchema.parse(base).regimenTributario).toBeUndefined();
    expect(companyInfoSchema.safeParse({ ...base, regimenTributario: 'zomac' }).success).toBe(false);
  });

  it('el cuerpo de /niif lleva el régimen del intake; sin dato viaja null', () => {
    expect(buildNiifCompanyBody(intake('simple')).regimenTributario).toBe('simple');
    expect(buildNiifCompanyBody(intake()).regimenTributario).toBeNull();
    expect(buildNiifCompanyBody(intake(null)).regimenTributario).toBeNull();
  });

  it('Régimen Simple: /niif lo conserva en el contexto y /consolidate no exige V10', async () => {
    const r = await correr('simple');
    expect(r.company.regimenTributario).toBe('simple');
    expect(r.persistedRegimen).toBe('simple');
    expect(r.v10).toBe(false);
  });

  it('ordinario o sin dato: V10 se sigue exigiendo (conservador)', async () => {
    expect((await correr('ordinario')).v10).toBe(true);
    const sinDato = await correr();
    expect(sinDato.company.regimenTributario).toBeNull();
    expect(sinDato.v10).toBe(true);
  });

  it('/niif rechaza un régimen ajeno con 400 (no se interpreta)', async () => {
    const body = buildNiifRequestBody({ intake: intake(), language: 'es' });
    (body.company as Record<string, unknown>).regimenTributario = 'zomac';
    const res = await niif(jsonReq('/api/financial-report/niif', body));
    expect(res.status).toBe(400);
  });
});

describe('UI del intake: selector y vista previa (es/en)', () => {
  it('el selector ofrece "Sin indicar" / Ordinario / Simple y marca la opción elegida', () => {
    for (const lang of ['es', 'en'] as const) {
      const t = dict[lang].niifIntake;
      const html = renderToStaticMarkup(<RegimenTributarioSelector value="simple" onChange={() => {}} t={t} />);
      expect(html).toContain(t.regimenTitle);
      expect(html).toContain(t.regimenNone);
      expect(html).toContain(t.regimenOrdinario);
      expect(html).toContain(t.regimenSimple);
      expect(html).toMatch(/aria-checked="true"[^>]*data-regimen="simple"/);
      expect(html).toMatch(/aria-checked="false"[^>]*data-regimen="none"/);
    }
    const none = renderToStaticMarkup(
      <RegimenTributarioSelector value={null} onChange={() => {}} t={dict.es.niifIntake} />,
    );
    expect(none).toMatch(/aria-checked="true"[^>]*data-regimen="none"/);
  });

  it('las claves existen en español e inglés y no se repiten entre idiomas', () => {
    const keys = ['regimenTitle', 'regimenHint', 'regimenNone', 'regimenOrdinario', 'regimenSimple'] as const;
    for (const k of keys) {
      expect(dict.es.niifIntake[k]).toBeTruthy();
      expect(dict.en.niifIntake[k]).toBeTruthy();
    }
    expect(dict.es.niifIntake.regimenHint).not.toBe(dict.en.niifIntake.regimenHint);
  });

  it('la vista previa muestra el régimen elegido o "Sin indicar"', () => {
    const render = (regimen?: RegimenTributarioIntake | null) =>
      renderToStaticMarkup(
        <IntakePreview caseType="niif_report" data={intake(regimen)} onBack={() => {}} onSubmit={() => {}} />,
      );
    expect(render('simple')).toContain(dict.es.niifIntake.regimenSimple);
    expect(render()).toContain(dict.es.niifIntake.regimenNone);
    state.language = 'en';
    expect(render('ordinario')).toContain(dict.en.niifIntake.regimenOrdinario);
  });
});
