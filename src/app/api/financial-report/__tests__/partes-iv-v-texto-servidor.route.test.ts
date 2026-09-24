// ---------------------------------------------------------------------------
// I5-1 — las Partes IV/V auditan el texto que produce el servidor
// ---------------------------------------------------------------------------
// /api/financial-audit (Parte IV), /api/financial-quality (Parte V) y
// /api/fiscal-audit-opinion (dictamen) recibían el informe del cliente y
// pasaban su `consolidatedReport` —Markdown del navegador— a los LLM. Con un
// JSON honesto y una cifra falsa sólo en el Markdown, los auditores leían esa
// cifra como si fuera del informe. Desde I3 /consolidate y /export descartan
// ese texto y lo re-renderizan desde el JSON validado de cada Parte; ahora las
// Partes IV/V hacen lo mismo (`withServerRenderedClientReport`) con el
// preprocesado ya re-derivado, antes de construir el prompt.
//
// El LLM se simula en `callFinancialAgent` (captura el prompt y falla): lo que
// se prueba es el texto que llega a cada auditor, no su opinión.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prompts = vi.hoisted(() => [] as string[]);

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (args: { system?: string; userContent?: string }) => {
    prompts.push(`${args.system ?? ''}\n${args.userContent ?? ''}`);
    throw new Error('LLM simulado');
  }),
}));

import { POST as qualityPOST } from '../../financial-quality/route';
import { POST as auditPOST } from '../../financial-audit/route';
import { POST as opinionPOST } from '../../fiscal-audit-opinion/route';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { preprocessUploadedTrialBalanceText } from '@/lib/preprocessing/raw-data';
import { toJsonSafe } from '@/lib/preprocessing/json-safe';
import type { FinancialReport } from '@/lib/agents/financial/types';
import { withCoherentParts } from '@/lib/reports/__tests__/coherent-parts';
import { PROVENANCE_COMPANY, PROVENANCE_CSV } from '@/lib/reports/__tests__/provenance-fixture';

const read = preprocessUploadedTrialBalanceText(PROVENANCE_CSV);
if (read.kind !== 'ok') throw new Error('fixture sin balance');
const pp = read.preprocessed;
const company = { ...PROVENANCE_COMPANY, niifGroup: 2 as const };

const FAKE_AMOUNT = '987.654.321';
const FAKE = `La utilidad neta del ejercicio fue de $${FAKE_AMOUNT},00.`;

/** JSON honesto en las tres Partes; la cifra falsa sólo en el Markdown del cliente. */
function tampered(): FinancialReport {
  const r = withCoherentParts({ ...makeExportableReport(), company }, pp, { impracticable: true });
  r.niifAnalysis.fullContent = FAKE;
  r.strategicAnalysis.fullContent = FAKE;
  r.governance.shareholderMinutes = FAKE;
  r.governance.fullContent = FAKE;
  r.consolidatedReport = `# INFORME\n\n${FAKE}`;
  return r;
}

const req = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const body = (extra: Record<string, unknown> = {}) => ({
  report: tampered(),
  preprocessed: toJsonSafe(pp),
  language: 'es',
  ...extra,
});

function expectServerText() {
  expect(prompts.length).toBeGreaterThan(0);
  for (const p of prompts) {
    expect(p).not.toContain(FAKE_AMOUNT);
    // El consolidado que leen los auditores es el que arma el servidor desde el JSON.
    expect(p).toContain('# PARTE I: ESTADOS FINANCIEROS NIIF');
    expect(p).toContain('Comparativos impracticables');
  }
}

beforeEach(() => {
  prompts.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('I5-1 — una cifra falsa sólo en el Markdown del cliente no llega al prompt de las Partes IV/V', () => {
  it('Parte V (/api/financial-quality)', async () => {
    await qualityPOST(req('http://localhost/api/financial-quality', body()));
    expectServerText();
  });

  it('Parte IV (/api/financial-audit), con y sin streaming', async () => {
    await auditPOST(req('http://localhost/api/financial-audit', body()));
    expectServerText();
    prompts.length = 0;
    const res = await auditPOST(req('http://localhost/api/financial-audit', body(), { 'X-Stream': 'true' }));
    await res.text();
    expectServerText();
  });

  it('dictamen del Revisor Fiscal (/api/fiscal-audit-opinion)', async () => {
    await opinionPOST(req('http://localhost/api/fiscal-audit-opinion', body()));
    expectServerText();
  });

  it('en inglés el consolidado del servidor también sustituye al del cliente', async () => {
    await qualityPOST(req('http://localhost/api/financial-quality', body({ language: 'en' })));
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) expect(p).not.toContain(FAKE_AMOUNT);
  });

  it('sin las Partes I–III estructuradas la meta-auditoría no audita texto del cliente (422)', async () => {
    const res = await qualityPOST(
      req('http://localhost/api/financial-quality', {
        report: { company, consolidatedReport: `# INFORME\n\n${FAKE}` },
        language: 'es',
      }),
    );
    expect(res.status).toBe(422);
    expect(prompts).toHaveLength(0);
  });
});
