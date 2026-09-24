// ---------------------------------------------------------------------------
// I5-niif 1 — Presentación de las reclasificaciones de R1 en el ESF
// ---------------------------------------------------------------------------
// El preprocesador (curator R1) saca de la clase 1 un saldo crédito material de
// una cuenta de activo y lo publica como pasivo (virtual `2810ZZ-<origen>`,
// corriente cuando el origen es de los grupos 11-14). `controlTotals`, E21
// (renglón con código contra sus hojas) y E27 (subtotales por plazo) cuentan
// ese saldo como PASIVO. El prompt del Pass-1, en cambio, pedía mantener la
// cuenta de activo con su saldo NEGATIVO dentro de `balanceSheet.assets`, y el
// bloque R4 nombraba como destino 2105/2805/2895: un renglón con esos códigos
// no suma la virtual del balance de prueba. Una salida que obedecía el prompt
// contradecía al preprocesador.
//
// Aquí: el prompt describe la presentación de R1 (grupo 28, plazo por el
// origen) y una salida que lo sigue, por la ruta real (runNiifPhase con el LLM
// simulado), sale sin E21 ni E27 y sin sello.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

const callFinancialAgentMock = vi.fn();
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: (opts: unknown) => callFinancialAgentMock(opts),
}));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));

import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { NiifReportJson } from '../contracts/niif-report';
import { CSV_R1, M, det, esfQueSigueElPrompt, preprocesarR1, sub } from '../__fixtures__/r1-anticipo-credito';
import { buildNiifValidatorOptions, runNiifPhase } from '../orchestrator';
import { buildNiifAnalystPass1Prompt } from '../prompts/niif-analyst.prompt';
import { validateNiifReportJson } from '../validators/niif-json-validator';

function mockPasses(json: NiifReportJson) {
  callFinancialAgentMock.mockImplementation(async (opts: { agentName: string }) => {
    if (opts.agentName.startsWith('niif-analyst-pass1')) {
      return {
        json: {
          company: json.company,
          balanceSheet: json.balanceSheet,
          incomeStatement: json.incomeStatement,
          curatorFlags: json.curatorFlags,
          reportMode: json.reportMode,
        },
        meta: {},
      };
    }
    if (opts.agentName === 'niif-analyst-pass2') {
      return { json: { cashFlow: json.cashFlow, equityChanges: { rows: json.equityChanges.rows, notes: [] } }, meta: {} };
    }
    return { json: { technicalNotes: [] }, meta: {} };
  });
}

const fase = (pp: PreprocessedBalance) =>
  runNiifPhase(
    {
      rawData: CSV_R1,
      company: { name: 'Demo Perdidas SAS', nit: '900123456-8', entityType: 'SAS', fiscalPeriod: '2025', niifGroup: 2 },
      language: 'es',
    },
    { preprocessed: pp },
  );

beforeEach(() => {
  callFinancialAgentMock.mockReset();
});

describe('R1 en el ESF — el prompt y el preprocesador dicen lo mismo', () => {
  it('el preprocesador publica el anticipo con saldo crédito como pasivo corriente del grupo 28', () => {
    const pp = preprocesarR1();
    const virtual = pp.primary.classes.find((c) => c.code === 2)!.accounts.find((a) => a.code.endsWith('-133005'));
    expect(virtual?.code).toBe('2810ZZ-133005');
    expect(virtual?.balance).toBe(5_000_000);
    expect(pp.primary.controlTotals.activo).toBe(105_000_000);
    expect(pp.primary.controlTotals.activoCorriente).toBe(25_000_000);
    expect(pp.primary.controlTotals.pasivoCorriente).toBe(75_000_000);
    expect(pp.primary.controlTotals.pasivoNoCorriente).toBe(0);
  });

  it('el Pass-1 ya no pide mantener el activo negativo: pide el renglón 28 con el plazo del origen', () => {
    const pp = preprocesarR1();
    const prompt = buildNiifAnalystPass1Prompt(
      { name: 'Demo Perdidas SAS', nit: '900123456-8', entityType: 'SAS', fiscalPeriod: '2025', niifGroup: 2 },
      'es',
      'COMPARATIVO_COMPLETO',
      pp,
    );
    expect(prompt).not.toMatch(/saldo absoluto NEGATIVO/);
    expect(prompt).not.toMatch(/dentro de balanceSheet\.assets, NO crear cuenta virtual/);
    const r1 = prompt.slice(prompt.indexOf('Reclasificaciones aplicadas (Curator R1)'));
    expect(r1).toMatch(/balanceSheet\.liabilities/);
    expect(r1).toMatch(/grupo PUC 28/);
    expect(r1).toMatch(/grupos 11 a 14/);
    // La cuenta de destino del bloque R4 es la naturaleza del pasivo para la
    // nota, no el código del renglón.
    expect(prompt).toMatch(/cuenta_destino_pasivo[^\n]*no es el código del renglón/);
    // Sin procedimiento numerado (patrón GPT-5.4).
    expect(r1.slice(0, 1500)).not.toMatch(/Paso \d/);
  });

  it('la salida que sigue el prompt pasa E21 y E27 en el validador', () => {
    const pp = preprocesarR1();
    const errors = validateNiifReportJson(esfQueSigueElPrompt(pp), buildNiifValidatorOptions(pp)).errors;
    expect(errors.filter((e) => /^E(21|27)\./.test(e))).toEqual([]);
  });

  it('la salida que seguía el prompt anterior (activo negativo y destino R4 como código) contradice E21/E27', () => {
    const pp = preprocesarR1();
    const json = esfQueSigueElPrompt(pp);
    // Prompt anterior: la cuenta de activo se queda en el activo con su saldo
    // negativo, y el pasivo del bloque R4 va con el código de destino 2805.
    json.balanceSheet.assets.splice(2, 0, det('1330', 'Anticipos (saldo contrario — ver Nota R1)', -5, null));
    json.balanceSheet.assets[3] = sub('Total activo corriente', 20, 50);
    json.balanceSheet.liabilities[2] = det('2805', 'Anticipos y avances recibidos (reclasificación R1)', 5, null);
    const errors = validateNiifReportJson(json, buildNiifValidatorOptions(pp)).errors;
    expect(errors.some((e) => e.startsWith('E21.') && e.includes('1330'))).toBe(true);
    expect(errors.some((e) => e.startsWith('E21.') && e.includes('2805'))).toBe(true);
    expect(errors.some((e) => e.startsWith('E27.') && e.includes('Total activo corriente'))).toBe(true);
  });
});

describe('ruta real — runNiifPhase con el LLM simulado sobre un balance con R1', () => {
  it('la salida que sigue el prompt sale limpia, sin E21 ni E27 y sin sello', async () => {
    const pp = preprocesarR1();
    mockPasses(esfQueSigueElPrompt(pp));
    const phase = await fase(pp);
    expect(phase.niif.fullContent).not.toMatch(/\[NIIF JSON validator\]|E2[17]\./);
    expect(phase.niif.fullContent).not.toMatch(/REPORTE CON SALVEDADES/);
    expect(phase.niif.reconciliation?.clean).toBe(true);
    const pasivo = phase.niif.json!.balanceSheet.liabilities;
    // El renglón 28 queda en el bloque corriente que cierra "Total pasivo corriente".
    const i28 = pasivo.findIndex((l) => l.account === '28');
    const iSub = pasivo.findIndex((l) => l.label === 'Total pasivo corriente');
    expect(i28).toBeGreaterThanOrEqual(0);
    expect(i28).toBeLessThan(iSub);
    expect(pasivo[iSub].amountPrimary).toBe(M(75));
  });

  it('la salida que seguía el prompt anterior (destino R4 2805 como código del renglón) salía sellada por E21', async () => {
    const pp = preprocesarR1();
    const json = esfQueSigueElPrompt(pp);
    json.balanceSheet.liabilities[2] = det('2805', 'Anticipos y avances recibidos (reclasificación R1)', 5, null);
    mockPasses(json);
    const phase = await fase(pp);
    expect(phase.niif.reconciliation?.clean).toBe(false);
    expect(phase.niif.fullContent).toMatch(/E21\. Estado de Situación Financiera — Pasivo \(periodo 2025\): "2805/);
  });
});
