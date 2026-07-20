// ---------------------------------------------------------------------------
// Regression — "Hechos del negocio · Ola 2": inyección del bloque
// <hechos_empresa> en el <context> de cada prompt de reporte.
// ---------------------------------------------------------------------------
// TDD de comportamiento (test-only). Prueba que el bloque narrativo pre-
// renderizado (Ola 2) REALMENTE llega al <context> de cada builder cuando se
// provee, y está AUSENTE cuando no. Si algún caso va RED, es un gap real de
// cableado — NO se debe debilitar la aserción para pasarlo.
//
// NOTA (Pass-3): Pass-1 y Pass-2 ya ejercitan el mecanismo compartido
// `buildSharedContext` → `ctx.hechosEmpresa` que Pass-3 reutiliza de forma
// idéntica (misma línea `${ctx.hechosEmpresa}` dentro del <context>). Aun así,
// aquí se prueban los TRES pases explícitamente para blindaje total.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import type { CompanyInfo } from '@/lib/agents/financial/types';
import type { HtmlEditorInput } from '@/lib/agents/financial/contracts/html-editor';
import {
  buildNiifAnalystPass1Prompt,
  buildNiifAnalystPass2Prompt,
  buildNiifAnalystPass3Prompt,
  type PreviouslyComputedPass1Anchors,
  type PreviouslyComputedPass2Anchors,
} from '@/lib/agents/financial/prompts/niif-analyst.prompt';
import { buildStrategyDirectorPrompt } from '@/lib/agents/financial/prompts/strategy-director.prompt';
import { buildGovernancePrompt } from '@/lib/agents/financial/prompts/governance-specialist.prompt';
import { buildHtmlEditorUserContent } from '@/lib/agents/financial/prompts/html-editor.prompt';
import { buildTaxOptimizerPrompt } from '@/lib/agents/financial/tax-planning/prompts/tax-optimizer.prompt';

// Sentinela — cadena única e improbable de aparecer en cualquier otro lugar del
// prompt. Lleva el propio tag `<hechos_empresa>` para poder afirmar tanto su
// presencia literal como su ubicación dentro de la región <context>.
const BLOCK = '<hechos_empresa>\nGUARD\n- Donación: a la fundación X\n</hechos_empresa>';

// CompanyInfo mínimo: solo los campos REQUERIDOS del tipo (name, nit,
// fiscalPeriod) + niifGroup (elegido por el marco NIIF). Ningún builder
// desreferencia más allá de esto de forma que lance.
const company = {
  name: 'Acme',
  nit: '900123',
  fiscalPeriod: '2026',
  niifGroup: 2,
} as CompanyInfo;

// Anchors mínimos válidos para Pass-2/Pass-3 (MoneyCop strings en centavos +
// curatorFlags booleanos en false → ningún activador Élite ruidoso). El renderer
// de anchors solo interpola estos campos; no hace validación semántica.
const pass1Anchors: PreviouslyComputedPass1Anchors = {
  totalAssetsPrimary: '100000',
  totalLiabilitiesPrimary: '40000',
  totalEquityPrimary: '60000',
  netIncomePrimary: '20000',
  oriPrimary: '0',
  totalAssetsComparative: null,
  totalLiabilitiesComparative: null,
  totalEquityComparative: null,
  grossProfitComparative: null,
  operatingProfitComparative: null,
  netIncomeComparative: null,
  oriComparative: null,
  curatorFlags: {
    equityConvergenceApplied: false,
    cashFlowClosureForced: false,
    negativeAssetReclassified: false,
    presumedCostWarning: false,
    reclassifiedAmountCop: '0',
  },
};

const pass2Anchors: PreviouslyComputedPass2Anchors = {
  cashOpening: '5000',
  cashClosing: '7000',
  netChange: '2000',
  ecpClosingTotal: '60000',
};

/**
 * Afirma que BLOCK aparece dentro de la región <context>…</context> del prompt:
 * después de la ÚLTIMA apertura `<context>` y antes del primer cierre
 * `</context>`. Los builders NIIF tienen un solo bloque <context> (precedido en
 * Pass-2/3 por <previously_computed>, que no contiene el tag <context>).
 */
function expectBlockInsideContext(out: string): void {
  const idx = out.indexOf(BLOCK);
  expect(idx).toBeGreaterThan(-1);
  expect(idx).toBeGreaterThan(out.lastIndexOf('<context>'));
  expect(idx).toBeLessThan(out.indexOf('</context>'));
}

describe('Ola 2 — <hechos_empresa> reaches each report prompt <context>', () => {
  describe('NIIF Analyst Pass-1', () => {
    it('injects the block inside <context> when hechosEmpresa is provided', () => {
      const out = buildNiifAnalystPass1Prompt(company, 'es', 'COMPARATIVO_COMPLETO', undefined, {
        hechosEmpresa: BLOCK,
      });
      expect(out).toContain(BLOCK);
      expectBlockInsideContext(out);
    });

    it('omits the block entirely when hechosEmpresa is not provided', () => {
      const out = buildNiifAnalystPass1Prompt(company, 'es', 'COMPARATIVO_COMPLETO');
      expect(out).not.toContain('<hechos_empresa>');
    });
  });

  describe('NIIF Analyst Pass-2', () => {
    it('injects the block inside <context> when hechosEmpresa is provided', () => {
      const out = buildNiifAnalystPass2Prompt(
        company,
        'es',
        'COMPARATIVO_COMPLETO',
        pass1Anchors,
        undefined,
        { hechosEmpresa: BLOCK },
      );
      expect(out).toContain(BLOCK);
      expectBlockInsideContext(out);
    });

    it('omits the block entirely when hechosEmpresa is not provided', () => {
      const out = buildNiifAnalystPass2Prompt(company, 'es', 'COMPARATIVO_COMPLETO', pass1Anchors);
      expect(out).not.toContain('<hechos_empresa>');
    });
  });

  describe('NIIF Analyst Pass-3', () => {
    it('injects the block inside <context> when hechosEmpresa is provided', () => {
      const out = buildNiifAnalystPass3Prompt(
        company,
        'es',
        'COMPARATIVO_COMPLETO',
        pass1Anchors,
        pass2Anchors,
        undefined,
        { hechosEmpresa: BLOCK },
      );
      expect(out).toContain(BLOCK);
      expectBlockInsideContext(out);
    });

    it('omits the block entirely when hechosEmpresa is not provided', () => {
      const out = buildNiifAnalystPass3Prompt(
        company,
        'es',
        'COMPARATIVO_COMPLETO',
        pass1Anchors,
        pass2Anchors,
      );
      expect(out).not.toContain('<hechos_empresa>');
    });
  });

  describe('Strategy Director', () => {
    it('injects the block inside <context> when hechosEmpresa is provided', () => {
      const out = buildStrategyDirectorPrompt(company, 'es', undefined, { hechosEmpresa: BLOCK });
      expect(out).toContain(BLOCK);
      expectBlockInsideContext(out);
    });

    it('omits the block when elite arg is absent', () => {
      const out = buildStrategyDirectorPrompt(company, 'es');
      expect(out).not.toContain('<hechos_empresa>');
    });

    it('omits the block when elite arg is present but empty ({})', () => {
      const out = buildStrategyDirectorPrompt(company, 'es', undefined, {});
      expect(out).not.toContain('<hechos_empresa>');
    });
  });

  describe('Governance Specialist', () => {
    it('injects the block inside <context> when hechosEmpresa is provided', () => {
      const out = buildGovernancePrompt(company, 'es', undefined, { hechosEmpresa: BLOCK });
      expect(out).toContain(BLOCK);
      expectBlockInsideContext(out);
    });

    it('omits the block when elite arg is absent', () => {
      const out = buildGovernancePrompt(company, 'es');
      expect(out).not.toContain('<hechos_empresa>');
    });

    it('omits the block when elite arg is present but empty ({})', () => {
      const out = buildGovernancePrompt(company, 'es', undefined, {});
      expect(out).not.toContain('<hechos_empresa>');
    });
  });

  describe('HTML Editor user-content', () => {
    // El builder solo hace JSON.stringify de estos campos; el cast evita armar
    // los sub-schemas completos (irrelevantes para la inyección del bloque).
    const input = {
      metadata: {},
      niifReport: {},
      strategyReport: {},
      governanceReport: {},
      company,
      language: 'es',
    } as unknown as HtmlEditorInput;

    it('injects the block inside <context> when hechosEmpresa is provided', () => {
      const out = buildHtmlEditorUserContent(input, BLOCK);
      expect(out).toContain(BLOCK);
      expectBlockInsideContext(out);
    });

    it('omits the block when the 2nd arg is not provided', () => {
      const out = buildHtmlEditorUserContent(input);
      expect(out).not.toContain('<hechos_empresa>');
    });
  });

  describe('Tax Optimizer — defer-257 constraint (Ola 1C invariant)', () => {
    it('carries the deterministic-deferral instruction for Art. 257 donations', () => {
      const out = buildTaxOptimizerPrompt(company, 'es');
      // El bloque determinista (fuera del output del LLM) es el dueño de la cifra.
      expect(out).toContain('TOTAL VINCULANTE');
      expect(out).toMatch(/257/);
      // Substring estable de la prohibición explícita de emitir la cifra 257.
      expect(out).toContain('NEVER emitas una CIFRA de descuento 257');
    });
  });
});
