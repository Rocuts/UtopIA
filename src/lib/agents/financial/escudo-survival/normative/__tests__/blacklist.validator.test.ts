// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 2 Motor Normativo — Tests: blacklist.validator
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import {
  checkBlacklist,
  summarizeBlacklistViolations,
} from '../validators/blacklist.validator';
import { buildSyntheticCatalogue } from '../__fixtures__/catalog-sintetico.fixture';
import {
  TEXT_USANDO_ART_158_3_DEROGADO,
  TEXT_USANDO_DECRETO_1474,
  TEXT_USANDO_CONCEPTO_100208221,
  TEXT_PERIODO_IVA_ANUAL,
  TEXT_RETEIVA_ART_381,
  TEXT_DIVIDENDOS_ART_243,
  TEXT_SOBRETASA_50,
  TEXT_MULTIPLES_BLACKLIST,
  TEXT_RESPUESTA_VALIDA,
  TEXT_VACIO,
} from '../__fixtures__/textos-prueba.fixture';

const CATALOGUE = buildSyntheticCatalogue();
const BLACKLIST = CATALOGUE.blacklist;

describe('checkBlacklist — Capa 3 defensa tributaria', () => {
  describe('Patrones críticos', () => {
    it('detecta Art. 158-3 (CRITICA, norma derogada)', () => {
      const violations = checkBlacklist(TEXT_USANDO_ART_158_3_DEROGADO, BLACKLIST);
      const v = violations.find((v) => v.entry.id === 'BL_ART_158_3_DEROGADO');
      expect(v).toBeDefined();
      expect(v?.entry.severidad).toBe('CRITICA');
      expect(v?.match.toLowerCase()).toContain('158-3');
    });

    it('detecta Decreto 1474 de 2025 (CRITICA, inexequible)', () => {
      const violations = checkBlacklist(TEXT_USANDO_DECRETO_1474, BLACKLIST);
      const v = violations.find((v) => v.entry.id === 'BL_DECRETO_1474_INEXEQUIBLE');
      expect(v).toBeDefined();
      expect(v?.entry.severidad).toBe('CRITICA');
    });

    it('detecta sobretasa financiera 50% (CRITICA, tarifa incorrecta)', () => {
      const violations = checkBlacklist(TEXT_SOBRETASA_50, BLACKLIST);
      const v = violations.find((v) => v.entry.id === 'BL_SOBRETASA_FINANCIERA_50PCT');
      expect(v).toBeDefined();
      expect(v?.entry.severidad).toBe('CRITICA');
    });

    it('detecta Concepto DIAN 100208221-1352 / Concepto 1352 (CRITICA, no verificable)', () => {
      const violations = checkBlacklist(TEXT_USANDO_CONCEPTO_100208221, BLACKLIST);
      const v = violations.find((v) => v.entry.id === 'BL_CONCEPTO_100208221_1352');
      expect(v).toBeDefined();
      expect(v?.entry.severidad).toBe('CRITICA');
    });
  });

  describe('Patrones de severidad ALTA', () => {
    it('detecta IVA anual (ALTA, periodicidad eliminada)', () => {
      const violations = checkBlacklist(TEXT_PERIODO_IVA_ANUAL, BLACKLIST);
      const v = violations.find((v) => v.entry.id === 'BL_PERIODO_IVA_ANUAL');
      expect(v).toBeDefined();
      expect(v?.entry.severidad).toBe('ALTA');
    });

    it('detecta ReteIVA con Art. 381 (ALTA, artículo confundido)', () => {
      const violations = checkBlacklist(TEXT_RETEIVA_ART_381, BLACKLIST);
      const v = violations.find((v) => v.entry.id === 'BL_RETEIVA_ART_381');
      expect(v).toBeDefined();
      expect(v?.entry.severidad).toBe('ALTA');
    });

    it('detecta dividendos exterior con Art. 243 (ALTA, artículo confundido)', () => {
      const violations = checkBlacklist(TEXT_DIVIDENDOS_ART_243, BLACKLIST);
      const v = violations.find((v) => v.entry.id === 'BL_DIVIDENDOS_EXTERIOR_ART_243');
      expect(v).toBeDefined();
      expect(v?.entry.severidad).toBe('ALTA');
    });
  });

  describe('Múltiples matches', () => {
    it('detecta varias violaciones en un solo texto', () => {
      const violations = checkBlacklist(TEXT_MULTIPLES_BLACKLIST, BLACKLIST);
      const ids = violations.map((v) => v.entry.id);
      expect(ids).toContain('BL_ART_158_3_DEROGADO');
      expect(ids).toContain('BL_DECRETO_1474_INEXEQUIBLE');
      expect(ids).toContain('BL_SOBRETASA_FINANCIERA_50PCT');
      expect(ids).toContain('BL_CONCEPTO_100208221_1352');
    });

    it('ordena las violaciones por posición ascendente', () => {
      const violations = checkBlacklist(TEXT_MULTIPLES_BLACKLIST, BLACKLIST);
      for (let i = 1; i < violations.length; i++) {
        expect(violations[i].position.start).toBeGreaterThanOrEqual(
          violations[i - 1].position.start,
        );
      }
    });
  });

  describe('Posición correcta (start/end offsets)', () => {
    it('reporta start/end consistentes con el texto fuente', () => {
      const text = '... Art. 158-3 ...';
      const violations = checkBlacklist(text, BLACKLIST);
      expect(violations.length).toBeGreaterThanOrEqual(1);
      const v = violations[0];
      const slice = text.slice(v.position.start, v.position.end);
      expect(slice).toBe(v.match);
    });
  });

  describe('Case-insensitive', () => {
    it('detecta variantes en mayúsculas y minúsculas', () => {
      const variants = [
        'art. 158-3 e.t.',
        'ART. 158-3 E.T.',
        'Art. 158-3 E.T.',
      ];
      for (const text of variants) {
        const violations = checkBlacklist(text, BLACKLIST);
        expect(violations.length).toBeGreaterThanOrEqual(1);
        expect(violations[0].entry.id).toBe('BL_ART_158_3_DEROGADO');
      }
    });
  });

  describe('Sin violaciones', () => {
    it('respuesta válida no produce violaciones', () => {
      const violations = checkBlacklist(TEXT_RESPUESTA_VALIDA, BLACKLIST);
      expect(violations).toEqual([]);
    });

    it('texto vacío no produce violaciones', () => {
      expect(checkBlacklist(TEXT_VACIO, BLACKLIST)).toEqual([]);
    });

    it('blacklist vacía no produce violaciones', () => {
      expect(checkBlacklist(TEXT_USANDO_ART_158_3_DEROGADO, [])).toEqual([]);
    });
  });

  describe('Dedup', () => {
    it('no reporta el mismo (entry, posición) dos veces aunque dos patrones de la misma entrada matcheen', () => {
      // El patrón BL_ART_158_3 tiene "\\bArt\\.?\\s*158-?3\\b" y
      // "\\bArt[íi]culo\\s+158-?3\\b" — el segundo no matchea "Art. 158-3" pero
      // si ambos matcheasen el mismo offset, solo debería reportarse una vez.
      const violations = checkBlacklist('Art. 158-3 y Art. 158-3', BLACKLIST);
      const sameEntry = violations.filter((v) => v.entry.id === 'BL_ART_158_3_DEROGADO');
      // Dos ocurrencias del texto → dos violaciones (distintas posiciones)
      expect(sameEntry.length).toBe(2);
      expect(sameEntry[0].position.start).not.toBe(sameEntry[1].position.start);
    });
  });
});

describe('summarizeBlacklistViolations', () => {
  it('cuenta correctamente por severidad', () => {
    const violations = checkBlacklist(TEXT_MULTIPLES_BLACKLIST, BLACKLIST);
    const summary = summarizeBlacklistViolations(violations);
    expect(summary.total).toBe(violations.length);
    expect(summary.critica + summary.alta + summary.media).toBe(summary.total);
    expect(summary.critica).toBeGreaterThanOrEqual(3);
  });

  it('zero counts para input vacío', () => {
    const summary = summarizeBlacklistViolations([]);
    expect(summary).toEqual({ total: 0, critica: 0, alta: 0, media: 0 });
  });
});
