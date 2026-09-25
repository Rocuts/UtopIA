// ---------------------------------------------------------------------------
// runNiifPhase — el punto donde se valida y normaliza el JSON NIIF
// (re-auditoría 2026-09-24)
// ---------------------------------------------------------------------------
// - e2e-niif-05: un traslado 13 → 15 que conserva los totales salía con
//   `clean = true`; ahora E21 sella el informe en la fase NIIF.
// - e2e-niif-09: los rótulos de apertura/cierre del ECP fechados en otro año y
//   un grupo PUC mal rotulado llegaban al Markdown y a todo lo que se deriva de
//   él; se normalizan de forma determinista antes del re-render.
// - Cross-dep W3-A (ingesta-09): con un comparativo de saldos de apertura, E9
//   exigía el P&G comparativo; ahora se presenta N/D y no sella.
// Sin llamadas a OpenAI: el analista está mockeado.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/agents/financial/agents/niif-analyst', () => ({
  runNiifAnalyst: vi.fn(),
}));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));

import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import { runNiifPhase } from '@/lib/agents/financial/orchestrator';
import { toNiifAnalysisResult } from '@/lib/agents/financial/agents/renderer';
import {
  CSV_PERDIDA_COMPARATIVO,
  clonar,
  informeHonesto,
  preprocesarPerdidaComparativo,
} from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import type { CompanyInfo, NiifAnalysisResult } from '@/lib/agents/financial/types';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';

const COMPANY: CompanyInfo = {
  name: 'Demo Perdidas SAS',
  nit: '900123456-8',
  entityType: 'SAS',
  fiscalPeriod: '2025',
  niifGroup: 2,
};

function analista(json: NiifReportJson): NiifAnalysisResult {
  return {
    ...toNiifAnalysisResult(json),
    reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runNiifPhase — anclaje renglón a renglón y rótulos deterministas', () => {
  it('el informe honesto sale limpio', async () => {
    const pp = preprocesarPerdidaComparativo();
    vi.mocked(runNiifAnalyst).mockResolvedValue(analista(informeHonesto(pp)));
    const phase = await runNiifPhase(
      { rawData: CSV_PERDIDA_COMPARATIVO, company: COMPANY, language: 'es' },
      { preprocessed: pp },
    );
    expect(phase.niif.reconciliation?.clean).toBe(true);
  });

  it('A1: 13 → 15 con el total intacto sella el informe (E21)', async () => {
    const pp = preprocesarPerdidaComparativo();
    const j = clonar(informeHonesto(pp));
    const l13 = j.balanceSheet.assets.find((l) => l.account === '13')!;
    const l15 = j.balanceSheet.assets.find((l) => l.account === '15')!;
    l13.amountPrimary = (BigInt(l13.amountPrimary) - BigInt(100_000_000)).toString();
    l15.amountPrimary = (BigInt(l15.amountPrimary) + BigInt(100_000_000)).toString();
    vi.mocked(runNiifAnalyst).mockResolvedValue(analista(j));
    const phase = await runNiifPhase(
      { rawData: CSV_PERDIDA_COMPARATIVO, company: COMPANY, language: 'es' },
      { preprocessed: pp },
    );
    expect(phase.niif.reconciliation?.clean).toBe(false);
    expect(phase.niif.fullContent).toContain('E21. Estado de Situación Financiera');
  });

  it('rótulos del ECP fechados en 2023 y "13 — Inventarios" se normalizan en el JSON y el Markdown', async () => {
    const pp = preprocesarPerdidaComparativo();
    const j = clonar(informeHonesto(pp));
    j.balanceSheet.assets.find((l) => l.account === '13')!.label = 'Inventarios de mercancía';
    j.equityChanges.rows[0].label = 'Saldo al 1 de enero de 2023';
    j.equityChanges.rows[j.equityChanges.rows.length - 1].label = 'Saldo al 31 de diciembre de 2023';
    vi.mocked(runNiifAnalyst).mockResolvedValue(analista(j));
    const phase = await runNiifPhase(
      { rawData: CSV_PERDIDA_COMPARATIVO, company: COMPANY, language: 'es' },
      { preprocessed: pp },
    );
    const out = phase.niif.json!;
    expect(out.balanceSheet.assets.find((l) => l.account === '13')!.label).toBe(
      'Deudores comerciales y otras cuentas por cobrar',
    );
    expect(out.equityChanges.rows.map((r) => r.label).join(' | ')).not.toMatch(/2023/);
    expect(phase.niif.fullContent).not.toMatch(/2023|Inventarios de mercanc/);
    expect(phase.niif.reconciliation?.clean).toBe(true);
  });

  it('comparativo de saldos de apertura: el P&G comparativo se presenta N/D y no sella (E9)', async () => {
    const pp = preprocesarPerdidaComparativo();
    const j = informeHonesto(pp); // el modelo copió el P&G comparativo "por contrato"
    pp.comparative!.saldosDeApertura = true;
    vi.mocked(runNiifAnalyst).mockResolvedValue(analista(j));
    const phase = await runNiifPhase(
      { rawData: CSV_PERDIDA_COMPARATIVO, company: COMPANY, language: 'es' },
      { preprocessed: pp },
    );
    const is = phase.niif.json!.incomeStatement;
    expect(is.grossProfitComparative).toBeNull();
    expect(is.netIncomeComparative).toBeNull();
    expect(is.lines.every((l) => l.amountComparative === null)).toBe(true);
    expect(phase.niif.fullContent).not.toMatch(/E9\./);
    expect(phase.niif.incomeStatement).toContain('N/D');
  });
});
