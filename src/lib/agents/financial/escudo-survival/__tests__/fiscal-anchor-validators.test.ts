// ---------------------------------------------------------------------------
// Tests Vitest — Fiscal Anchor Validators Elite Protocol
// ---------------------------------------------------------------------------
// Cero LLM. Cero red. Solo fixtures JSON + validators determinísticos.
// Comando: npx vitest run src/lib/agents/financial/escudo-survival/__tests__/fiscal-anchor-validators.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  validateFiscalAnchorL1,
  validateFiscalAnchorL2,
  validateFiscalAnchorL3,
  validateFiscalAnchorAll,
} from '../validators/fiscal-anchor-validators';
import type { L2Context, L3Context } from '../validators/fiscal-anchor-validators';
import type { FiscalAnchorBlock } from '../fiscal-anchor/types';

// ---------------------------------------------------------------------------
// Fixtures — importados directamente
// ---------------------------------------------------------------------------

import goldenRecord from '../__fixtures__/fiscal-anchor-grupo-2tres-sas.json';
import saldoAFavor from '../__fixtures__/fiscal-anchor-saldo-a-favor.json';
import clase54Presente from '../__fixtures__/fiscal-anchor-clase54-presente.json';
import f01Cero from '../__fixtures__/fiscal-anchor-f01-cero.json';

// Cast helpers — los JSON fixtures tienen el shape de FiscalAnchorBlock
function asBlock(fixture: Record<string, unknown>): FiscalAnchorBlock {
  return fixture as unknown as FiscalAnchorBlock;
}

// ---------------------------------------------------------------------------
// Contextos de test reutilizables
// ---------------------------------------------------------------------------

/** markdownBlock correcto que incluye la frase obligatoria Art. 240 E.T. */
const MARKDOWN_OK = [
  '## Bloque Ancora Fiscal F01-F10',
  '',
  '**F02 — Impuesto Referencia (Art. 240 E.T.):** calculado al 35% sobre UAI.',
  '',
  '> Referencia antes de depuraciones fiscales. El impuesto definitivo requiere conciliacion formal conforme al Articulo 240 del E.T.',
  '',
  'Las cifras anteriores corresponden a la extraccion del balance y son referencia operativa.',
].join('\n');

/** markdownBlock sin la frase obligatoria — debe hacer fallar L3.3 */
const MARKDOWN_SIN_FRASE = [
  '## Bloque Ancora Fiscal F01-F10',
  '',
  '**F02 — Impuesto de renta estimado:** $779.973.876,41',
  '',
  'Nota: usar estos valores para la declaracion de renta.',
].join('\n');

/** Contexto L2 estándar (empresa con cuentas 1355 y caja suficiente) */
function makeL2Ctx(opts: Partial<{
  clase54Cents: number;
  hasCta1355: boolean;
  hasCta1805: boolean;
  caja: number;
}> = {}): L2Context {
  return {
    clase54Cents: opts.clase54Cents !== undefined ? opts.clase54Cents : 1000000,
    rawBalance: {
      hasCta1355: opts.hasCta1355 !== undefined ? opts.hasCta1355 : true,
      hasCta1805: opts.hasCta1805 !== undefined ? opts.hasCta1805 : false,
      caja: opts.caja !== undefined ? opts.caja : 500000000,
    },
  };
}

/** Contexto L3 estándar */
function makeL3Ctx(opts: Partial<{
  clase54Cents: number;
  markdownBlock: string;
}> = {}): L3Context {
  return {
    clase54Cents: opts.clase54Cents !== undefined ? opts.clase54Cents : 1000000,
    markdownBlock: opts.markdownBlock !== undefined ? opts.markdownBlock : MARKDOWN_OK,
  };
}

// ---------------------------------------------------------------------------
// Test 1 — Golden record: cero errores, cero warnings
// Fixture: fiscal-anchor-grupo-2tres-sas.json
// Cubre: L1 aritmetica exacta, L2 coherencia, L3 defensa Art. 240/850/376
// ---------------------------------------------------------------------------
describe('Test 1 — Golden record Grupo 2 Tres SAS', () => {
  const block = asBlock(goldenRecord);

  it('L1: todos los checks de severity error pasan', () => {
    const checks = validateFiscalAnchorL1(block);
    const errors = checks.filter((c) => !c.passed && c.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('L2: todos los checks pasan (cero warnings)', () => {
    const ctx = makeL2Ctx({ clase54Cents: 5000000000, caja: 50000000000 });
    const checks = validateFiscalAnchorL2(block, ctx);
    const fails = checks.filter((c) => !c.passed);
    expect(fails).toHaveLength(0);
  });

  it('L3: todos los checks de severity error pasan', () => {
    const ctx = makeL3Ctx({ clase54Cents: 5000000000, markdownBlock: MARKDOWN_OK });
    const checks = validateFiscalAnchorL3(block, ctx);
    const errors = checks.filter((c) => !c.passed && c.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('ALL: cero errores y cero warnings con contextos correctos', () => {
    const all = validateFiscalAnchorAll(
      block,
      makeL2Ctx({ clase54Cents: 5000000000, caja: 50000000000 }),
      makeL3Ctx({ clase54Cents: 5000000000, markdownBlock: MARKDOWN_OK }),
    );
    const errors = all.filter((c) => !c.passed && c.severity === 'error');
    const warnings = all.filter((c) => !c.passed && c.severity === 'warning');
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Saldo a favor: alerta SALDO_A_FAVOR presente
// Fixture: fiscal-anchor-saldo-a-favor.json
// Cubre: L1.6, L3.4 (alerta presente -> pass); L2.3 (F10 > 100% -> warning)
// ---------------------------------------------------------------------------
describe('Test 2 — Saldo a favor', () => {
  const block = asBlock(saldoAFavor);

  it('L1.6: alerta SALDO_A_FAVOR presente cuando F04 < 0', () => {
    const checks = validateFiscalAnchorL1(block);
    const check = checks.find((c) => c.name === 'L1.6_saldo_favor_alerta');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it('L3.4: alerta SALDO_A_FAVOR satisface Art. 850 E.T.', () => {
    const ctx = makeL3Ctx({ clase54Cents: 0, markdownBlock: MARKDOWN_OK });
    const checks = validateFiscalAnchorL3(block, ctx);
    const check = checks.find((c) => c.name === 'L3.4_saldo_favor_art850');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it('L2.3: F10 > 100% genera warning de doble conteo', () => {
    const ctx = makeL2Ctx({ clase54Cents: 0 });
    const checks = validateFiscalAnchorL2(block, ctx);
    const check = checks.find((c) => c.name === 'L2.3_f10_doble_conteo');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.severity).toBe('warning');
    expect(check!.detail).toContain('142.9%');
    expect(check!.detail).toContain('doble conteo');
  });

  it('alerta SALDO_A_FAVOR esta en el array de alertas del fixture', () => {
    const tieneAlerta = block.alertas.some((a) => a.codigo === 'SALDO_A_FAVOR');
    expect(tieneAlerta).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Sin provision (clase54 = 0 y F01 > 0 sin alerta A5)
// Fixture: golden record (F01 > 0) + clase54Cents = 0
// Cubre: L3.1 -> 1 error con cita Art. 647 E.T.
// ---------------------------------------------------------------------------
describe('Test 3 — Sin provision renta (L3.1 Art. 647 E.T.)', () => {
  const block = asBlock(goldenRecord);

  it('L3.1: clase54=0 sin alerta A5 genera 1 error Art. 647', () => {
    const ctx = makeL3Ctx({
      clase54Cents: 0,
      markdownBlock: MARKDOWN_OK,
    });
    const checks = validateFiscalAnchorL3(block, ctx);
    const check = checks.find((c) => c.name === 'L3.1_sin_provision_renta');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.severity).toBe('error');
    expect(check!.norma).toContain('Art. 647 E.T.');
    expect(check!.detail).toContain('Provisionar impuesto renta');
    expect(check!.detail).toContain('Defensa Art. 647 E.T.');
  });

  it('L3.1: clase54=0 CON alerta A5_SIN_PROVISION pasa', () => {
    const blockConAlerta: FiscalAnchorBlock = {
      ...block,
      alertas: [
        {
          codigo: 'A5_SIN_PROVISION',
          severidad: 'warning',
          mensaje: 'Provisionar impuesto renta: $779.973.876,41. Defensa Art. 647 E.T. — diferencia de criterio.',
          norma: 'Art. 647 E.T.',
        },
      ],
    };
    const ctx = makeL3Ctx({ clase54Cents: 0, markdownBlock: MARKDOWN_OK });
    const checks = validateFiscalAnchorL3(blockConAlerta, ctx);
    const check = checks.find((c) => c.name === 'L3.1_sin_provision_renta');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — F01 cero: division por cero no explota; F10 = 0
// Fixture: fiscal-anchor-f01-cero.json
// Cubre: estabilidad numerica del validator con entradas degeneradas
// ---------------------------------------------------------------------------
describe('Test 4 — F01 = 0 (division por cero)', () => {
  const block = asBlock(f01Cero);

  it('L1.4: F10 = 0.0 cuando F02 = 0 (sin excepcion)', () => {
    expect(() => validateFiscalAnchorL1(block)).not.toThrow();
    const checks = validateFiscalAnchorL1(block);
    const check = checks.find((c) => c.name === 'L1.4_f10_cobertura_retenciones');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(block.f10).toBe(0.0);
  });

  it('L3.1: F01 = 0 -> check sin provision no aplica (passed: true)', () => {
    const ctx = makeL3Ctx({ clase54Cents: 0, markdownBlock: MARKDOWN_OK });
    const checks = validateFiscalAnchorL3(block, ctx);
    const check = checks.find((c) => c.name === 'L3.1_sin_provision_renta');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.detail).toContain('F01 ≤ 0');
  });

  it('L1.2: F04 = -50.000.000 (negativo), pasa aritmetica', () => {
    const checks = validateFiscalAnchorL1(block);
    const check = checks.find((c) => c.name === 'L1.2_f04_neto_pagar');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it('L1.6: alerta SALDO_A_FAVOR presente cuando F04 < 0', () => {
    const checks = validateFiscalAnchorL1(block);
    const check = checks.find((c) => c.name === 'L1.6_saldo_favor_alerta');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — NIT calendario: retefuente mensual en dias 8-17
// Cubre todos los 10 digitos posibles
// ---------------------------------------------------------------------------
describe('Test 5 — NIT calendario retefuente en rango [8..17]', () => {
  // Tabla de vencimientos retefuente por digito NIT (Art. 376 E.T.)
  // Fuente: Resolucion DIAN 2026 (dias para el mes siguiente)
  const TABLA: Record<number, number> = {
    0: 8, 1: 9, 2: 10, 3: 11, 4: 12,
    5: 12, 6: 13, 7: 14, 8: 15, 9: 17,
  };

  for (const [digito, dia] of Object.entries(TABLA)) {
    const d = parseInt(digito, 10);
    it(`digito ${d}: vencimiento dia ${dia} en [8..17]`, () => {
      const diaStr = dia.toString().padStart(2, '0');
      const block: FiscalAnchorBlock = {
        f01: '100000000',
        f02: '35000050',
        f03: '10000000',
        f04: '25000050',
        f05: '8000000',
        f06: '2000000',
        f07: '500000',
        f08: '15000000',
        f09: 0,
        f10: 28.6,
        calendarioDian: {
          nit: `90012345${d}-${d}`,
          ultimoDigito: d,
          periodo: '2025',
          vencimientos: [
            {
              obligacion: 'Retencion en la fuente',
              frecuencia: 'mensual',
              proximoVencimiento: `2026-02-${diaStr}`,
              diasRestantes: 30 + dia,
              estado: 'pendiente',
              baseCcv: 'F03',
              valorEstimado: '10000000',
              norma: `Art. 376 E.T. — ultimo digito ${d}`,
            },
          ],
          alertaAnticipacionDias: 15,
        },
        alertas: [],
        fuente: { periodo: '2025', balanceHash: `test-digito-${d}` },
      };

      const ctx = makeL3Ctx({ clase54Cents: 1000000, markdownBlock: MARKDOWN_OK });
      const checks = validateFiscalAnchorL3(block, ctx);
      const check = checks.find((c) => c.name === 'L3.5_retefuente_rango_dias');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.detail).toContain('[8..17]');
    });
  }
});

// ---------------------------------------------------------------------------
// Test 6 — Frase obligatoria Art. 240: sin ella L3.3 falla
// Cubre: L3.3_frase_obligatoria_art240
// ---------------------------------------------------------------------------
describe('Test 6 — Frase obligatoria "Referencia antes de depuraciones fiscales"', () => {
  const block = asBlock(clase54Presente);

  it('L3.3: markdown CON frase -> passed', () => {
    const ctx = makeL3Ctx({ clase54Cents: 700000000, markdownBlock: MARKDOWN_OK });
    const checks = validateFiscalAnchorL3(block, ctx);
    const check = checks.find((c) => c.name === 'L3.3_frase_obligatoria_art240');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it('L3.3: markdown SIN frase -> failed con severidad error', () => {
    const ctx = makeL3Ctx({
      clase54Cents: 700000000,
      markdownBlock: MARKDOWN_SIN_FRASE,
    });
    const checks = validateFiscalAnchorL3(block, ctx);
    const check = checks.find((c) => c.name === 'L3.3_frase_obligatoria_art240');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.severity).toBe('error');
    expect(check!.norma).toContain('Art. 240 E.T.');
    expect(check!.norma).toContain('Art. 647 E.T.');
    expect(check!.detail).toContain('OBLIGATORIO');
    expect(check!.detail).toContain('Artículo 240 del E.T.');
  });
});

// ---------------------------------------------------------------------------
// Test 7 — Drift de centavos: calculo correcto vs incorrecto
// Regression del bug clasico de floating-point en cifras grandes
// ---------------------------------------------------------------------------
describe('Test 7 — Anti-drift: aritmetica de F02', () => {
  it('F02 para F01 = 222849678973 (Grupo 2 Tres SAS): Math.round correcto', () => {
    // Verificacion manual: 222849678973 * 35 / 100 = 77997387640.55
    // Math.round(77997387640.55) = 77997387641 — coincide con el fixture
    const f01 = 222849678973;
    const f02Calc = Math.round(f01 * 35 / 100);
    expect(f02Calc).toBe(77997387641);
  });

  it('F02 no diverge entre calculo directo y el que el validator usa', () => {
    // Si el backend usara (f01 * 0.35) en lugar de (f01 * 35 / 100) con Math.round
    // puede haber drift de 1 centavo. Verificar que ambos dan el mismo resultado
    // para F01 del golden record.
    const f01 = 222849678973;
    const v1 = Math.round(f01 * 35 / 100);
    const v2 = Math.round(f01 * 0.35);
    // Deben ser iguales para este valor
    expect(Math.abs(v1 - v2)).toBeLessThanOrEqual(1);
    expect(v1).toBe(77997387641);
  });

  it('L1.1: validator detecta F02 incorrecto cuando se provee con drift de 2cts', () => {
    const block: FiscalAnchorBlock = {
      ...asBlock(goldenRecord),
      f02: '77997387643', // +2 centavos de drift
    };
    const checks = validateFiscalAnchorL1(block);
    const check = checks.find((c) => c.name === 'L1.1_f02_tarifa_35pct');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.detail).toContain('diff 2cts');
  });
});

// ---------------------------------------------------------------------------
// Test 8 — Anti-doble-conteo: F10 > 100% genera warning L2
// Fixture: saldo-a-favor tiene F10 = 142.9%
// ---------------------------------------------------------------------------
describe('Test 8 — Anti-doble-conteo F10 > 100%', () => {
  it('L2.3: F10 = 142.9% genera warning con mencion a doble conteo', () => {
    const block = asBlock(saldoAFavor);
    const ctx = makeL2Ctx({ clase54Cents: 0 });
    const checks = validateFiscalAnchorL2(block, ctx);
    const check = checks.find((c) => c.name === 'L2.3_f10_doble_conteo');

    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.severity).toBe('warning');
    expect(check!.detail).toMatch(/142\.9%/);
    expect(check!.detail).toContain('doble conteo');
  });

  it('L2.3: golden record F10 = 5.9% no genera warning', () => {
    const block = asBlock(goldenRecord);
    const ctx = makeL2Ctx({ clase54Cents: 5000000000 });
    const checks = validateFiscalAnchorL2(block, ctx);
    const check = checks.find((c) => c.name === 'L2.3_f10_doble_conteo');

    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test adicional — Clase 54 presente: L3.1 pasa
// Fixture: fiscal-anchor-clase54-presente.json
// ---------------------------------------------------------------------------
describe('Test adicional — Clase 54 presente (F09 > 0)', () => {
  const block = asBlock(clase54Presente);

  it('L3.1: con clase54Cents > 0 no hay error de provision', () => {
    const ctx = makeL3Ctx({ clase54Cents: 700000000, markdownBlock: MARKDOWN_OK });
    const checks = validateFiscalAnchorL3(block, ctx);
    const check = checks.find((c) => c.name === 'L3.1_sin_provision_renta');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.detail).toContain('Provisión de renta registrada');
  });

  it('L1: todos los checks de severity error pasan', () => {
    const checks = validateFiscalAnchorL1(block);
    const errors = checks.filter((c) => !c.passed && c.severity === 'error');
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test adicional — L1.7 calendario NIT: digito erroneo falla
// ---------------------------------------------------------------------------
// PREMISA CORREGIDA (auditoría normativa 2026-08). Estos tests daban por
// correcto `ultimoDigito = 6` para el NIT "901714014-6", es decir el DÍGITO DE
// VERIFICACIÓN. El Decreto 2229/2023 (art. 1.6.1.13.2.1 del DUR 1625/2016)
// determina los plazos "teniendo en cuenta el último o los dos últimos dígitos
// del Número de Identificación Tributaria (NIT) del contribuyente, SIN TENER EN
// CUENTA EL DÍGITO DE VERIFICACIÓN". Para 901714014-6 el dígito es 4.
// https://normograma.dian.gov.co/dian/compilacion/docs/decreto_2229_2023.htm
//
// El check pasaba porque el validador tenía su propia copia del extractor con
// el mismo defecto: sólo aprobaba el calendario cuando ambas implementaciones
// se equivocaban en el mismo sentido. Ahora delega en `extractCalendarDigit`.
describe('Test adicional — L1.7 NIT digito erroneo', () => {
  it('L1.7: ultimoDigito declarado != extraido del NIT -> error', () => {
    const block: FiscalAnchorBlock = {
      ...asBlock(goldenRecord),
      calendarioDian: {
        ...asBlock(goldenRecord).calendarioDian,
        nit: '901714014-6',
        ultimoDigito: 3, // incorrecto — el dígito de calendario es 4
      },
    };
    const checks = validateFiscalAnchorL1(block);
    const check = checks.find((c) => c.name === 'L1.7_calendario_digito_nit');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.detail).toContain('4');
    expect(check!.detail).toContain('3');
  });

  it('L1.7: tomar el dígito de VERIFICACIÓN también falla', () => {
    // Es el defecto concreto que se corrigió: sin esta aserción, volver a la
    // implementación vieja dejaría la suite en verde.
    const block: FiscalAnchorBlock = {
      ...asBlock(goldenRecord),
      calendarioDian: {
        ...asBlock(goldenRecord).calendarioDian,
        nit: '901714014-6',
        ultimoDigito: 6, // el DV, no el último dígito del NIT
      },
    };
    const checks = validateFiscalAnchorL1(block);
    const check = checks.find((c) => c.name === 'L1.7_calendario_digito_nit');
    expect(check!.passed).toBe(false);
  });

  it('L1.7: NIT "901714014-6" con ultimoDigito=4 (sin el DV) pasa', () => {
    const block = asBlock(goldenRecord);
    expect(block.calendarioDian.ultimoDigito).toBe(4);
    const checks = validateFiscalAnchorL1(block);
    const check = checks.find((c) => c.name === 'L1.7_calendario_digito_nit');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test adicional — L3.2 tarifa 35%: F02 con tarifa vieja falla
// ---------------------------------------------------------------------------
describe('Test adicional — L3.2 tarifa 35% Art. 240 E.T.', () => {
  it('L3.2: F02 calculado al 33% (tarifa vieja) genera error Art. 240', () => {
    const f01 = 222849678973;
    const f02Wrong = Math.round(f01 * 33 / 100); // 33% en lugar de 35%
    const block: FiscalAnchorBlock = {
      ...asBlock(goldenRecord),
      f02: f02Wrong.toString(),
      f04: (f02Wrong - 4607340776).toString(),
    };
    const ctx = makeL3Ctx({ clase54Cents: 5000000000, markdownBlock: MARKDOWN_OK });
    const checks = validateFiscalAnchorL3(block, ctx);
    const check = checks.find((c) => c.name === 'L3.2_tarifa_35pct_art240');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.norma).toContain('Art. 240 E.T.');
    expect(check!.detail).toContain('35%');
    expect(check!.detail).toContain('indefendible');
  });
});

// ---------------------------------------------------------------------------
// Test de integracion — validateFiscalAnchorAll: golden record completo
// ---------------------------------------------------------------------------
describe('Integracion — validateFiscalAnchorAll golden record', () => {
  it('Ningun check falla con los contextos correctos', () => {
    const block = asBlock(goldenRecord);
    const all = validateFiscalAnchorAll(
      block,
      makeL2Ctx({ clase54Cents: 5000000000, caja: 50000000000 }),
      makeL3Ctx({ clase54Cents: 5000000000, markdownBlock: MARKDOWN_OK }),
    );
    const errors = all.filter((c) => !c.passed && c.severity === 'error');
    const warnings = all.filter((c) => !c.passed && c.severity === 'warning');
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});
