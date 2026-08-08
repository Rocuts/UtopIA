// ---------------------------------------------------------------------------
// Regresión — el filtro PII no puede destruir cifras monetarias
// ---------------------------------------------------------------------------
// Auditoría 2026-08 (`pii-filter-destruye-cifras-monetarias`). El filtro no
// tenía ningún test.
//
// En un producto contable las cifras en pesos escritas SIN separadores chocan
// con los formatos de identificador:
//   - `3500000000`  ($3.500 millones) es exactamente un móvil colombiano:
//     diez dígitos que empiezan en 3.
//   - `6012345678`  ($6.012 millones) cae en el patrón de fijo (601-608).
//   - `1234567890123` (13 dígitos) cae en el patrón de tarjeta.
//
// El resultado era que el usuario preguntaba por sus ventas y el agente
// respondía sobre "[TELÉFONO REDACTADO]": una respuesta financiera construida
// sobre un dato que el propio sistema había borrado.
//
// La corrección NO afloja la protección: los formatos inequívocos (+57,
// tarjeta con separadores) y todos los identificadores con etiqueta (NIT:,
// CC:, cuenta de ahorros …) se siguen redactando siempre. Lo que cambia es que
// un número ambiguo necesita contexto que lo señale como dato de contacto.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { createPIIContext, redactPII } from '../pii-filter';

describe('redactPII — cifras monetarias sobreviven', () => {
  const CIFRAS = [
    ['ventas sin separadores', 'Mis ventas del año fueron 3500000000', '3500000000'],
    ['con marcador de moneda', 'El total es $6012345678 pesos', '6012345678'],
    ['13 dígitos (patrón tarjeta)', 'El patrimonio suma 1234567890123', '1234567890123'],
    ['ingresos', 'Los ingresos fueron 3999999999', '3999999999'],
    ['saldo', 'saldo 6081234567 al cierre', '6081234567'],
  ] as const;

  for (const [caso, texto, cifra] of CIFRAS) {
    it(`conserva la cifra — ${caso}`, () => {
      const out = redactPII(texto);
      expect(out, `la cifra ${cifra} fue destruida:\n  ${texto}\n→ ${out}`).toContain(cifra);
      expect(out).not.toContain('REDACTADO');
      expect(out).not.toContain('REDACTADA');
    });
  }

  it('una cifra con separadores nunca estuvo en riesgo, pero se verifica igual', () => {
    const out = redactPII('Las ventas fueron $3.500.000.000 COP');
    expect(out).toBe('Las ventas fueron $3.500.000.000 COP');
  });

  it('un balance completo pasa intacto', () => {
    const balance = [
      'Activo 4196558242',
      'Pasivo 1376000000',
      'Patrimonio 2820558242',
      'Utilidad neta 3150000000',
    ].join('\n');
    expect(redactPII(balance)).toBe(balance);
  });
});

describe('redactPII — el PII real se sigue redactando', () => {
  const PII: ReadonlyArray<readonly [string, string, string]> = [
    ['móvil con contexto', 'Mi celular es 3001234567', '[TELÉFONO REDACTADO]'],
    ['móvil con prefijo +57', 'Escríbeme al +573001234567', '[TELÉFONO REDACTADO]'],
    ['móvil por whatsapp', 'whatsapp 3109876543', '[TELÉFONO REDACTADO]'],
    ['fijo con contexto', 'teléfono 6013456789', '[TELÉFONO REDACTADO]'],
    ['tarjeta con separadores', 'Pagué con 4111-1111-1111-1111', '[TARJETA REDACTADA]'],
    ['tarjeta con contexto', 'mi tarjeta 4111111111111111', '[TARJETA REDACTADA]'],
    ['NIT etiquetado', 'NIT: 901714014', '[NIT REDACTADO]'],
    ['NIT con dígito de verificación', 'Somos 901714014-6', '[NIT REDACTADO]'],
    ['cédula', 'CC 1020304050', '[CC REDACTADO]'],
    ['correo', 'contacto en juan@empresa.com.co', '[EMAIL REDACTADO]'],
    ['cuenta bancaria', 'cuenta de ahorros 12345678901', '[CUENTA REDACTADA]'],
    ['cuenta con banco', 'Bancolombia 98765432100', '[CUENTA REDACTADA]'],
  ];

  for (const [caso, texto, esperado] of PII) {
    it(`redacta — ${caso}`, () => {
      const out = redactPII(texto);
      expect(out, `no se redactó:\n  ${texto}\n→ ${out}`).toContain(esperado);
    });
  }

  it('el marcador de moneda NO sirve para colar un teléfono etiquetado', () => {
    // Si el texto dice explícitamente "celular", gana el contexto de contacto.
    const out = redactPII('el valor es 100 y mi celular 3001234567');
    expect(out).toContain('[TELÉFONO REDACTADO]');
    expect(out).toContain('100');
  });
});

describe('tokenización bidireccional', () => {
  it('tokeniza el PII y lo devuelve intacto al rehidratar', () => {
    const ctx = createPIIContext();
    const original = 'NIT: 901714014 y mi celular es 3001234567';
    const safe = ctx.tokenize(original);

    expect(safe).not.toContain('901714014');
    expect(safe).not.toContain('3001234567');
    expect(safe).toMatch(/<NIT_\d{3}>/);
    expect(safe).toMatch(/<TEL_\d{3}>/);

    expect(ctx.rehydrate(safe)).toBe(original);
  });

  it('las cifras monetarias no consumen tokens', () => {
    const ctx = createPIIContext();
    const safe = ctx.tokenize('Ventas 3500000000, patrimonio 2820558242');
    expect(safe).toBe('Ventas 3500000000, patrimonio 2820558242');
    expect(ctx.size()).toBe(0);
  });

  it('el mismo valor reutiliza el mismo token', () => {
    const ctx = createPIIContext();
    const safe = ctx.tokenize('celular 3001234567 y de nuevo celular 3001234567');
    const tokens = safe.match(/<TEL_\d{3}>/g) ?? [];
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toBe(tokens[1]);
    expect(ctx.size()).toBe(1);
  });

  it('no sustituye tokens que no acuñó (defensa ante alucinación del LLM)', () => {
    const ctx = createPIIContext();
    ctx.tokenize('celular 3001234567');
    const out = ctx.rehydrate('El teléfono <TEL_999> no existe');
    expect(out).toContain('<TEL_999>');
  });
});

// ---------------------------------------------------------------------------
// Formatos de teléfono con indicativo — hueco preexistente
// ---------------------------------------------------------------------------
// El patrón anterior era `(?:\+?57…)?(?:\(?\d{1,3}\)?…)?\b3\d{9}\b`. En
// "+573001234567" no hay frontera de palabra entre el 7 y el 3, así que `\b3`
// nunca casaba: el número viajaba INTACTO al proveedor del LLM. Tampoco casaban
// los formatos con espacios. No era un efecto de la corrección de las cifras —
// era un hueco de PII que llevaba ahí desde el principio.
describe('redactPII — formatos de teléfono con indicativo y separadores', () => {
  const FORMATOS = [
    'celular +573001234567',
    'celular +57 300 123 4567',
    'celular 57 3001234567',
    'celular 300 123 4567',
    'celular 300-123-4567',
    'celular 300.123.4567',
    'teléfono +57 601 234 5678',
    'teléfono 601-234-5678',
  ];

  for (const texto of FORMATOS) {
    it(`redacta — ${texto}`, () => {
      const out = redactPII(texto);
      expect(out, `quedó sin redactar: ${out}`).toContain('[TELÉFONO REDACTADO]');
      expect(out).not.toMatch(/\d{4}/);
    });
  }

  it('un número dentro de una cifra más larga no se parte por la mitad', () => {
    // 15 dígitos: no es un teléfono, es una cifra. El lookahead de dígito lo
    // protege de que el patrón muerda los primeros diez.
    const out = redactPII('El acumulado es 300123456789012');
    expect(out).toContain('300123456789012');
  });
});
