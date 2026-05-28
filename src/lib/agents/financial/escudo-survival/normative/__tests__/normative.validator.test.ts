// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 2 Motor Normativo — Tests: normative.validator (orquestador)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { validateNormativeResponse } from '../validators/normative.validator';
import { buildSyntheticCatalogue } from '../__fixtures__/catalog-sintetico.fixture';
import {
  TEXT_RESPUESTA_VALIDA,
  TEXT_USANDO_ART_158_3_DEROGADO,
  TEXT_USANDO_DECRETO_1474,
  TEXT_PERIODO_IVA_ANUAL,
  TEXT_MULTIPLES_CITAS_OK,
  TEXT_MULTIPLES_BLACKLIST,
  TEXT_SOLO_BLACKLIST_CRITICA,
  TEXT_CITA_DESCONOCIDA,
  TEXT_VACIO,
  TEXT_USANDO_CONCEPTO_100208221,
} from '../__fixtures__/textos-prueba.fixture';

const CATALOGUE = buildSyntheticCatalogue();

describe('validateNormativeResponse — orquestador 3 capas', () => {
  describe('Veredicto válida', () => {
    it('respuesta con citas vigentes → válida', () => {
      const report = validateNormativeResponse(TEXT_RESPUESTA_VALIDA, CATALOGUE);
      expect(report.veredictoGlobal).toBe('valida');
      expect(report.resumen.citasValidas).toBe(report.resumen.totalCitas);
      expect(report.resumen.citasBloqueo).toBe(0);
      expect(report.resumen.violacionesBlacklist).toBe(0);
    });

    it('múltiples citas válidas → veredicto válida y resumen coherente', () => {
      const report = validateNormativeResponse(TEXT_MULTIPLES_CITAS_OK, CATALOGUE);
      expect(report.veredictoGlobal).toBe('valida');
      expect(report.resumen.citasValidas).toBeGreaterThanOrEqual(4);
      expect(report.resumen.citasAdvertencia).toBe(0);
      expect(report.resumen.citasBloqueo).toBe(0);
    });

    it('texto vacío → veredicto válida con totalCitas = 0', () => {
      const report = validateNormativeResponse(TEXT_VACIO, CATALOGUE);
      expect(report.veredictoGlobal).toBe('valida');
      expect(report.resumen.totalCitas).toBe(0);
      expect(report.resumen.violacionesBlacklist).toBe(0);
    });
  });

  describe('Veredicto bloqueo', () => {
    it('Art. 158-3 → bloqueo (cita derogada + blacklist CRITICA)', () => {
      const report = validateNormativeResponse(TEXT_USANDO_ART_158_3_DEROGADO, CATALOGUE);
      expect(report.veredictoGlobal).toBe('bloqueo');
      expect(report.resumen.citasBloqueo).toBeGreaterThanOrEqual(1);
      expect(report.resumen.violacionesCriticas).toBeGreaterThanOrEqual(1);
    });

    it('Decreto 1474 → bloqueo (inexequible + blacklist CRITICA)', () => {
      const report = validateNormativeResponse(TEXT_USANDO_DECRETO_1474, CATALOGUE);
      expect(report.veredictoGlobal).toBe('bloqueo');
      expect(report.resumen.violacionesCriticas).toBeGreaterThanOrEqual(1);
    });

    it('Concepto DIAN 1352 → bloqueo (no verificable)', () => {
      const report = validateNormativeResponse(TEXT_USANDO_CONCEPTO_100208221, CATALOGUE);
      expect(report.veredictoGlobal).toBe('bloqueo');
    });

    it('cita desconocida → bloqueo', () => {
      const report = validateNormativeResponse(TEXT_CITA_DESCONOCIDA, CATALOGUE);
      expect(report.veredictoGlobal).toBe('bloqueo');
      expect(report.resumen.citasBloqueo).toBeGreaterThanOrEqual(1);
    });

    it('múltiples violaciones → bloqueo y conteo agregado coherente', () => {
      const report = validateNormativeResponse(TEXT_MULTIPLES_BLACKLIST, CATALOGUE);
      expect(report.veredictoGlobal).toBe('bloqueo');
      expect(report.resumen.violacionesBlacklist).toBeGreaterThanOrEqual(3);
      expect(report.resumen.violacionesCriticas).toBeGreaterThanOrEqual(3);
    });

    it('texto solo con blacklist CRITICA (sin otras citas) → bloqueo', () => {
      // El texto "Aplica el Art. 158-3 al 40%" — sin "E.T." al final, el extractor
      // de citas NO lo detecta como articulo_et, pero la blacklist SÍ matchea.
      // Confirma que el bloqueo se dispara solo por blacklist crítica.
      const report = validateNormativeResponse(TEXT_SOLO_BLACKLIST_CRITICA, CATALOGUE);
      expect(report.veredictoGlobal).toBe('bloqueo');
      expect(report.resumen.violacionesCriticas).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Veredicto advertencia', () => {
    it('IVA anual (blacklist ALTA, no CRITICA → bloqueo por ALTA igualmente)', () => {
      // ALTA cuenta como crítica en el resumen → veredicto bloqueo
      const report = validateNormativeResponse(TEXT_PERIODO_IVA_ANUAL, CATALOGUE);
      expect(report.veredictoGlobal).toBe('bloqueo');
    });

    it('cita MODIFICADA en catálogo + sin blacklist → advertencia', () => {
      const cat = buildSyntheticCatalogue({
        articulosET: CATALOGUE.articulosET.map((a) =>
          a.id === 'ART_240_ET' ? { ...a, estado: 'MODIFICADO' as const } : a,
        ),
      });
      const text = 'Tarifa general según Art. 240 E.T.';
      const report = validateNormativeResponse(text, cat);
      expect(report.veredictoGlobal).toBe('advertencia');
      expect(report.resumen.citasAdvertencia).toBe(1);
      expect(report.resumen.citasBloqueo).toBe(0);
    });

    it('cita SUSPENDIDA → advertencia', () => {
      const cat = buildSyntheticCatalogue({
        articulosET: CATALOGUE.articulosET.map((a) =>
          a.id === 'ART_240_ET' ? { ...a, estado: 'SUSPENDIDO' as const } : a,
        ),
      });
      const text = 'Tarifa general según Art. 240 E.T.';
      const report = validateNormativeResponse(text, cat);
      expect(report.veredictoGlobal).toBe('advertencia');
    });

    it('blacklist MEDIA solo → advertencia', () => {
      // BL_IVA_BIENES_CAPITAL_ART_255 es severidad MEDIA
      const text = 'El descuento del IVA sobre bienes de capital aplica conforme al Art. 255.';
      const report = validateNormativeResponse(text, CATALOGUE);
      expect(report.veredictoGlobal).toBe('advertencia');
    });
  });

  describe('Resumen coherente', () => {
    it('citas + violaciones suman lo correcto', () => {
      const report = validateNormativeResponse(TEXT_MULTIPLES_BLACKLIST, CATALOGUE);
      expect(report.resumen.totalCitas).toBe(report.citations.length);
      expect(report.resumen.violacionesBlacklist).toBe(report.blacklistViolations.length);
      expect(
        report.resumen.citasValidas +
          report.resumen.citasAdvertencia +
          report.resumen.citasBloqueo,
      ).toBe(report.resumen.totalCitas);
    });

    it('echo del texto auditado se conserva', () => {
      const report = validateNormativeResponse(TEXT_RESPUESTA_VALIDA, CATALOGUE);
      expect(report.text).toBe(TEXT_RESPUESTA_VALIDA);
    });
  });
});
