// ---------------------------------------------------------------------------
// Re-auditoría 2026-09-24 (NT-02, remanente de F-tributario): la Nota 9 del
// prompt de Gobierno pedía «renta 35% Art. 240 … TTD» también al Régimen
// Simple, cuyo impuesto unificado sustituye el de renta (Art. 903 E.T.).
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';
import { buildGovernancePrompt } from '../governance-specialist.prompt';
import type { CompanyInfo } from '../../types';

const base: CompanyInfo = { name: 'Demo SAS', nit: '900123456-8', entityType: 'SAS', fiscalPeriod: '2025', niifGroup: 2 } as CompanyInfo;

describe('Nota 9 del prompt de Gobierno según el régimen del intake', () => {
  it('Régimen Simple: impuesto unificado (Art. 903), sin tarifa del Art. 240 ni TTD', () => {
    const p = buildGovernancePrompt({ ...base, regimenTributario: 'simple' } as CompanyInfo, 'es');
    expect(p).toContain('9 Impuestos, Gravámenes y Tasas (Régimen Simple de Tributación, Arts. 903-916 E.T.');
    expect(p).not.toContain('renta 35% Art. 240 E.T., Tasa de Tributación Depurada');
  });

  it('ordinario o sin dato: se mantiene la nota del régimen ordinario', () => {
    for (const company of [{ ...base, regimenTributario: 'ordinario' }, base, { ...base, regimenTributario: null }]) {
      const p = buildGovernancePrompt(company as CompanyInfo, 'es');
      expect(p).toContain('9 Impuestos, Gravámenes y Tasas (renta 35% Art. 240 E.T., Tasa de Tributación Depurada');
      expect(p).not.toContain('Régimen Simple de Tributación, Arts. 903-916');
    }
  });
});
