// ---------------------------------------------------------------------------
// Test de arquitectura: un validador escrito y no cableado no protege a nadie
// ---------------------------------------------------------------------------
// La auditoría de cálculos 2026-08 encontró el MISMO defecto cuatro veces: un
// cruce correcto, probado por sus tests unitarios, y sin un solo llamador en el
// camino de producción.
//
//   · E8  (`totalExpensesClass5Cents`) — pasándolo detectaba una duplicación de
//     $16.122.033,37 del Grupo 53; el call-site no lo pasaba.
//   · E3  (`cashAccountPuc11Cents`) — el orquestador derivaba la cifra del
//     periodo equivocado y la descartaba con un `void`.
//   · E9  para `grossProfit` / `operatingProfit` — el cruce estaba escrito y la
//     función que arma las anclas nunca poblaba esas dos claves.
//   · `applyCheck4ActaVsPL` — ni siquiera exportado del módulo.
//
// Un test unitario verde sobre un validador muerto es peor que no tenerlo:
// produce la sensación de cobertura sin la cobertura. Este test cierra la
// puerta a que vuelva a pasar en silencio.
//
// Cómo se usa
// -----------
// Si el test falla diciendo "sin llamador", hay dos salidas honestas:
//   1. Cablearlo (lo correcto casi siempre), o
//   2. Añadirlo a `CUARENTENA` con la razón de por qué NO se cablea todavía.
//
// La cuarentena no es una lista de perdones: es el inventario declarado de la
// deuda. Y si un validador en cuarentena aparece cableado, el test también
// falla, para que la lista no envejezca con entradas falsas.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(process.cwd(), 'src');

/**
 * Cuarentena declarada. Clave: `<ruta relativa>::<función>`.
 *
 * Las razones salen de la propia auditoría, que además REFUTÓ dos correcciones
 * que parecían obvias: conectar `detectInflatedCash` tal cual tumbaría el 100%
 * de los informes.
 */
const CUARENTENA: Record<string, string> = {
  'src/lib/agents/financial/validators/report-validator.ts::detectInflatedCash':
    'ROTO: lee "4.2" del encabezado "### 4.2 Saldo Inicial Depurado" y emite hard-fail idéntico ' +
    'en el informe correcto y en el inflado. Conectarlo tal cual tumba el 100% de los informes ' +
    '(clasifica tier C → el camino legacy lanza). Arreglar el parser ANTES de cablear.',
  'src/lib/agents/financial/validators/report-validator.ts::detectMissingWorkingCapital':
    'Proyección Big Four — pendiente de cablear junto con el resto de la superficie 7. ' +
    'Sin medición de falsos positivos todavía.',
  'src/lib/agents/financial/validators/report-validator.ts::detectMissingControlKPIs':
    'Proyección Big Four — pendiente de cablear junto con el resto de la superficie 7. ' +
    'Sin medición de falsos positivos todavía.',
  'src/lib/agents/financial/escudo-survival/validators/fiscal-anchor-validators.ts::validateFiscalAnchorL1':
    'El Escudo (superficie 6): los paneles que consumían estos veredictos están huérfanos desde ' +
    'cd6e202d. Cablear sin remontar los paneles no cambia nada de lo que ve el cliente.',
  'src/lib/agents/financial/escudo-survival/validators/fiscal-anchor-validators.ts::validateFiscalAnchorL2':
    'El Escudo (superficie 6) — mismo motivo que L1.',
  'src/lib/agents/financial/escudo-survival/validators/fiscal-anchor-validators.ts::validateFiscalAnchorL3':
    'El Escudo (superficie 6) — mismo motivo que L1.',
  'src/lib/agents/financial/escudo-survival/validators/fiscal-anchor-validators.ts::validateFiscalAnchorAll':
    'El Escudo (superficie 6) — mismo motivo que L1.',
  'src/lib/pillars/single-source-validator.ts::validateCrossPillarCoherence':
    'Coherencia entre pilares — pendiente de decidir por qué canal sella. Hoy no hay ninguno.',
  'src/lib/pillars/sync-validator.ts::validateDashboardIntegrity':
    'Integridad del dashboard — pendiente de decidir por qué canal sella. Hoy no hay ninguno.',
};

/** Un export cuenta como validador por su nombre, no por su ubicación. */
const NOMBRE_DE_VALIDADOR = /^(validate|detect|check|assert|verify)/;
const EXPORT_FUNCION = /^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm;

function recorrer(dir: string, acc: string[] = []): string[] {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === 'node_modules' || entrada.name === 'graphify-out') continue;
      recorrer(p, acc);
    } else if (entrada.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) {
      acc.push(p);
    }
  }
  return acc;
}

const esArchivoDeTest = (p: string) => p.includes('__tests__') || p.includes('__mocks__');

/** Vive en un directorio `validators/` o su nombre de fichero lo declara. */
const esFicheroValidador = (p: string) =>
  /\/validators?\//.test(p) || /validator/i.test(path.basename(p));

interface ExportValidador {
  clave: string;
  fichero: string;
  fn: string;
  llamadores: number;
}

function inventariar(): ExportValidador[] {
  const todos = recorrer(RAIZ);
  const consumidores = todos.filter((p) => !esArchivoDeTest(p));
  const contenido = new Map(consumidores.map((p) => [p, fs.readFileSync(p, 'utf8')]));
  const ficherosValidador = consumidores.filter(esFicheroValidador);

  const out: ExportValidador[] = [];
  for (const fichero of ficherosValidador) {
    const src = contenido.get(fichero)!;
    for (const m of src.matchAll(EXPORT_FUNCION)) {
      const fn = m[1];
      if (!NOMBRE_DE_VALIDADOR.test(fn)) continue;
      const patron = new RegExp(`\\b${fn}\\b`);
      let llamadores = 0;
      for (const [p, texto] of contenido) {
        if (p === fichero) continue;
        if (patron.test(texto)) llamadores++;
      }
      out.push({
        clave: `${path.relative(process.cwd(), fichero)}::${fn}`,
        fichero: path.relative(process.cwd(), fichero),
        fn,
        llamadores,
      });
    }
  }
  return out;
}

describe('arquitectura — ningún validador exportado se queda sin llamador en silencio', () => {
  const inventario = inventariar();

  it('el inventario encuentra validadores (la heurística no se rompió)', () => {
    expect(inventario.length).toBeGreaterThan(20);
    // Control positivo: el validador del NIIF JSON tiene llamador de producción.
    const niif = inventario.find((v) => v.fn === 'validateNiifReportJson');
    expect(niif, 'validateNiifReportJson debe estar en el inventario').toBeDefined();
    expect(niif!.llamadores).toBeGreaterThan(0);
  });

  it('todo validador sin llamador está declarado en CUARENTENA con su razón', () => {
    const sinLlamador = inventario.filter((v) => v.llamadores === 0).map((v) => v.clave);
    const nuevos = sinLlamador.filter((c) => !(c in CUARENTENA));
    expect(
      nuevos,
      `Validadores exportados SIN ningún importador fuera de __tests__:\n` +
        nuevos.map((c) => `  · ${c}`).join('\n') +
        `\n\nUn validador que nadie llama no protege a nadie: sus tests pasan y el defecto ` +
        `llega igual al cliente. Cablearlo, o añadirlo a CUARENTENA en este fichero con la ` +
        `razón por la que todavía no se cabla.`,
    ).toEqual([]);
  });

  it('la CUARENTENA no arrastra entradas obsoletas', () => {
    const claves = new Set(inventario.map((v) => v.clave));
    const conLlamador = new Set(
      inventario.filter((v) => v.llamadores > 0).map((v) => v.clave),
    );
    const yaCableados = Object.keys(CUARENTENA).filter((c) => conLlamador.has(c));
    expect(
      yaCableados,
      `Estas entradas de CUARENTENA ya tienen llamador — quítalas de la lista:\n` +
        yaCableados.map((c) => `  · ${c}`).join('\n'),
    ).toEqual([]);

    const inexistentes = Object.keys(CUARENTENA).filter((c) => !claves.has(c));
    expect(
      inexistentes,
      `Estas entradas de CUARENTENA ya no existen (renombradas o borradas):\n` +
        inexistentes.map((c) => `  · ${c}`).join('\n'),
    ).toEqual([]);
  });
});
