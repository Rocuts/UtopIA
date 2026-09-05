import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CLIENT_REPORT_MODEL_ID,
  detectMissingPhases,
  isPartialReport,
  resolveResumePoint,
  mergeWarnings,
  savePendingRun,
  loadPendingRun,
  clearPendingRun,
  saveNiifCheckpoint,
  loadNiifCheckpoint,
  clearNiifCheckpoint,
  PENDING_RUN_KEY,
} from '../pipeline-resilience';
import type { NiifReportIntake } from '@/types/platform';

// ---------------------------------------------------------------------------
// Regresiones de la auditoría 2026-08 — grupo "resiliencia del pipeline".
//
// El repo no tiene @testing-library/react ni entorno DOM, así que los defectos
// se cubren en dos capas:
//   1. Tests de comportamiento sobre la lógica pura extraída del componente
//      (`pipeline-resilience.ts`).
//   2. Tests de contrato sobre el CÓDIGO FUENTE para los defectos que son
//      estructurales del componente (dependencias de un efecto, cleanup que
//      aborta, literal hardcodeado, ausencia de región aria-live). Estos
//      fallan con el archivo anterior a la corrección, que es lo que se pide
//      de una regresión.
// ---------------------------------------------------------------------------

// ─── Fake localStorage (entorno node) ────────────────────────────────────────

class FakeStorage {
  private data = new Map<string, string>();
  /** Si es > 0, `setItem` lanza cuando el valor supera este tamaño (cuota). */
  quota = 0;

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    if (this.quota > 0 && value.length > this.quota) {
      throw new Error('QuotaExceededError');
    }
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  get size(): number {
    return this.data.size;
  }
}

let store: FakeStorage;

beforeEach(() => {
  store = new FakeStorage();
  (globalThis as { localStorage?: unknown }).localStorage = store;
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

function makeIntake(overrides: Partial<NiifReportIntake> = {}): NiifReportIntake {
  return {
    caseType: 'niif_report',
    company: {
      name: 'Comercializadora Andina SAS',
      nit: '900123456-7',
      entityType: 'SAS',
    },
    niifGroup: 2,
    fiscalPeriod: '2025',
    rawData: '1105,CAJA GENERAL,1500000\n2205,PROVEEDORES,-800000',
    outputOptions: {
      financialStatements: true,
      kpiDashboard: true,
      cashFlowProjection: true,
      breakevenAnalysis: true,
      notesToFinancialStatements: true,
      shareholdersMinutes: true,
      auditPipeline: true,
      metaAudit: true,
      excelExport: true,
      comparativeAnalysis: true,
    },
    ...overrides,
  };
}

// ─── 1. Reporte parcial rehidratado como "completo" ──────────────────────────

describe('detectMissingPhases — checkpoint parcial no puede pasar por completo', () => {
  it('marca Estrategia y Gobierno cuando el reporte trae los stubs vacíos del checkpoint NIIF', () => {
    // Shape exacta que persiste el pipeline tras la sub-fase NIIF:
    // `emptyStrategy()` / `emptyGovernance()` con `fullContent: ''`.
    const checkpoint = {
      niifAnalysis: { fullContent: '# Estados financieros...' },
      strategicAnalysis: {
        kpiDashboard: '',
        breakEvenAnalysis: '',
        projectedCashFlow: '',
        strategicRecommendations: '',
        fullContent: '',
      },
      governance: { financialNotes: '', shareholderMinutes: '', fullContent: '' },
      consolidatedReport: '# REPORTE FINANCIERO CONSOLIDADO...',
    };

    expect(detectMissingPhases(checkpoint)).toEqual(['strategy', 'governance']);
    expect(isPartialReport(checkpoint)).toBe(true);
  });

  it('detecta el caso de fallo SOLO en Gobierno (Estrategia sí corrió)', () => {
    const report = {
      strategicAnalysis: { fullContent: '## KPIs\nMargen bruto 32%' },
      governance: { fullContent: '   ' }, // whitespace ≠ contenido
    };
    expect(detectMissingPhases(report)).toEqual(['governance']);
  });

  it('no marca nada cuando las tres partes tienen contenido', () => {
    const report = {
      strategicAnalysis: { fullContent: '## KPIs' },
      governance: { fullContent: '## Acta de asamblea' },
    };
    expect(detectMissingPhases(report)).toEqual([]);
    expect(isPartialReport(report)).toBe(false);
  });

  it('trata un reporte corrupto o de otra versión como parcial, no como bueno', () => {
    expect(detectMissingPhases(null)).toEqual([]);
    expect(detectMissingPhases({ strategicAnalysis: null, governance: undefined })).toEqual([
      'strategy',
      'governance',
    ]);
  });
});

// ─── 2. Reanudación por sub-fase ─────────────────────────────────────────────

describe('resolveResumePoint — no re-ejecutar el Analista NIIF si no hace falta', () => {
  it('reanuda en Estrategia cuando hay checkpoint utilizable', () => {
    expect(
      resolveResumePoint({
        missing: ['strategy', 'governance'],
        hasNiifResult: true,
        hasBindingTotals: true,
      }),
    ).toBe('strategy');
  });

  it('reanuda en Gobierno cuando Estrategia ya está pagada', () => {
    expect(
      resolveResumePoint({ missing: ['governance'], hasNiifResult: true, hasBindingTotals: true }),
    ).toBe('governance');
  });

  it('exige corrida completa si faltan los bindingTotals (los schemas los requieren)', () => {
    expect(
      resolveResumePoint({
        missing: ['strategy'],
        hasNiifResult: true,
        hasBindingTotals: false,
      }),
    ).toBe('full');
  });

  it('no propone nada si el reporte está completo', () => {
    expect(
      resolveResumePoint({ missing: [], hasNiifResult: true, hasBindingTotals: true }),
    ).toBeNull();
  });
});

// ─── 3. Salvedades del validador contable ────────────────────────────────────

describe('mergeWarnings', () => {
  it('deduplica el mismo invariante roto reportado por varias sub-fases', () => {
    const first = mergeWarnings([], ['E1 Activo ≠ Pasivo + Patrimonio. Brecha $1.200.000']);
    const second = mergeWarnings(first, [
      'E1 Activo ≠ Pasivo + Patrimonio. Brecha $1.200.000',
      'E9 Comparativo faltante',
    ]);
    expect(second).toEqual([
      'E1 Activo ≠ Pasivo + Patrimonio. Brecha $1.200.000',
      'E9 Comparativo faltante',
    ]);
  });

  it('devuelve el array previo por identidad si no hay nada nuevo (evita render inútil)', () => {
    const prev = ['E1 ...'];
    expect(mergeWarnings(prev, ['E1 ...'])).toBe(prev);
    expect(mergeWarnings(prev, ['   '])).toBe(prev);
  });
});

// ─── 4. Persistencia de la corrida (F5 durante la generación) ────────────────

describe('persistencia de la corrida pendiente', () => {
  it('sobrevive un refresh: el intake vuelve completo, sin truncar el balance', () => {
    const intake = makeIntake();
    expect(savePendingRun(intake)).toBe(true);

    const restored = loadPendingRun();
    expect(restored).not.toBeNull();
    expect(restored?.input.rawData).toBe(intake.rawData);
    expect(restored?.input.company.name).toBe('Comercializadora Andina SAS');
    expect(restored?.input.outputOptions.metaAudit).toBe(true);
  });

  it('ante cuota excedida NO deja un registro a medias (reanudar con datos mutilados daría cifras falsas)', () => {
    store.quota = 10; // cualquier payload real excede esto
    expect(savePendingRun(makeIntake())).toBe(false);
    expect(loadPendingRun()).toBeNull();
    expect(store.getItem(PENDING_RUN_KEY)).toBeNull();
  });

  it('descarta un registro corrupto en vez de rehidratar basura', () => {
    store.setItem(PENDING_RUN_KEY, '{"input":{"company":{"name":"X"}}}'); // sin rawData
    expect(loadPendingRun()).toBeNull();
    store.setItem(PENDING_RUN_KEY, 'no-es-json');
    expect(loadPendingRun()).toBeNull();
  });

  it('clearPendingRun borra la oferta de reanudación', () => {
    savePendingRun(makeIntake());
    clearPendingRun();
    expect(loadPendingRun()).toBeNull();
  });

  it('no explota en SSR (sin localStorage)', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(savePendingRun(makeIntake())).toBe(false);
    expect(loadPendingRun()).toBeNull();
    expect(() => clearPendingRun()).not.toThrow();
  });
});

describe('checkpoint NIIF reanudable', () => {
  it('devuelve los bindingTotals de la MISMA corrida', () => {
    saveNiifCheckpoint({
      conversationId: 'report-1',
      bindingTotals: 'ACTIVO=150000000;PASIVO=80000000;PATRIMONIO=70000000',
      savedAt: new Date().toISOString(),
    });
    expect(loadNiifCheckpoint('report-1')?.bindingTotals).toContain('ACTIVO=150000000');
  });

  it('rechaza el checkpoint de otra corrida (mezclaría totales de otra empresa)', () => {
    saveNiifCheckpoint({
      conversationId: 'report-1',
      bindingTotals: 'ACTIVO=150000000',
      savedAt: new Date().toISOString(),
    });
    expect(loadNiifCheckpoint('report-2')).toBeNull();
  });

  it('no guarda un checkpoint inservible', () => {
    expect(
      saveNiifCheckpoint({ conversationId: 'report-1', bindingTotals: '', savedAt: '' }),
    ).toBe(false);
    expect(loadNiifCheckpoint()).toBeNull();
    clearNiifCheckpoint();
  });
});

// ─── 5. Contratos sobre el código fuente del componente ──────────────────────

const PIPELINE_SRC = readFileSync(
  fileURLToPath(new URL('../PipelineWorkspace.tsx', import.meta.url)),
  'utf8',
);
const PAGE_SRC = readFileSync(
  fileURLToPath(new URL('../../../app/workspace/page.tsx', import.meta.url)),
  'utf8',
);
const MODELS_SRC = readFileSync(
  fileURLToPath(new URL('../../../lib/config/models.ts', import.meta.url)),
  'utf8',
);

describe('contrato: la corrida no depende del ciclo de vida ni del idioma', () => {
  it('el efecto que dispara la corrida no depende de `language`', () => {
    // Con el código anterior:
    //   }, [pipelineInput, language, setPipelineState, ...]);
    // cambiar el idioma disparaba el cleanup del efecto (abort) y el re-run se
    // cortaba por el guard de "mismo input": spinner infinito, sin error.
    expect(PIPELINE_SRC).not.toMatch(/\[\s*pipelineInput,\s*language\b/);
    // El disparador vive en un efecto minimalista que solo observa el intake y
    // la función de orquestación (que tampoco depende del idioma).
    expect(PIPELINE_SRC).toMatch(/\}, \[pipelineInput, runPipeline\]\);/);
    // El idioma se congela por corrida en un ref.
    expect(PIPELINE_SRC).toMatch(/const runLanguage = languageRef\.current;/);
  });

  it('el desmontaje del componente ya no aborta el fetch del pipeline', () => {
    // Patrón viejo: `return () => { controller.abort(); };` como cleanup del
    // efecto de orquestación. Navegar a otra área mataba la corrida.
    expect(PIPELINE_SRC).not.toMatch(/return\s*\(\s*\)\s*=>\s*\{\s*controller\.abort\(\)/);
  });

  it('el guard de re-disparo vive fuera del componente (un remount no cobra dos veces)', () => {
    expect(PIPELINE_SRC).toMatch(/runtimeRun\.dispatchedInput/);
  });
});

describe('contrato: accesibilidad de errores y progreso', () => {
  it('expone al menos una región `role="alert"` y una `aria-live`', () => {
    // Antes: cero coincidencias en 2600 líneas. Una corrida de minutos podía
    // fallar sin que un lector de pantalla anunciara nada.
    expect(PIPELINE_SRC).toMatch(/role="alert"/);
    expect(PIPELINE_SRC).toMatch(/aria-live="polite"/);
  });
});

describe('contrato: procedencia de auditoría y meta-auditoría', () => {
  it('la auditoría y la meta-auditoría se piden por referencia, nunca con el contenido', () => {
    // Patrón viejo: se construía un `earlyReport` en el navegador y se enviaba
    // como `report`, así que el dictamen se formaba sobre lo que mandara el
    // cliente y no sobre un artefacto del servidor.
    expect(PIPELINE_SRC).not.toMatch(/const earlyReport/);
    expect(PIPELINE_SRC).toMatch(
      /'\/api\/financial-audit'[\s\S]{0,400}?body: JSON\.stringify\(\{ reportVersionId: args\.reportVersionId, language: args\.language \}\)/,
    );
    expect(PIPELINE_SRC).toMatch(/reportVersionId: phase1Report\.reportVersionId,\s*\n\s*auditVersionId:/);
    // Ningún cuerpo vuelve a llevar el informe ni la auditoría completa.
    expect(PIPELINE_SRC).not.toMatch(/body: JSON\.stringify\(\{\s*\n?\s*report: phase1Report/);
  });

  it('sin versión guardada no se audita nada', () => {
    expect(PIPELINE_SRC).toMatch(/auditPipeline \?\? false\) &&\s*\n\s*!!reportVersionId &&/);
  });

  it('un informe nuevo no hereda la auditoría del anterior', () => {
    // Antes esto sólo pasaba en un re-run (`if (isRerun)`), así que tras
    // recargar la página el primer informe de la sesión conservaba la
    // auditoría restaurada del informe previo y la descarga enviaba una
    // referencia de otro informe.
    expect(PIPELINE_SRC).toMatch(
      /if \(start === 'niif'\) \{\s*\n\s*setAuditReport\(null\);\s*\n\s*auditReportRef\.current = null;\s*\n\s*setQualityReport\(null\);\s*\n\s*\}/,
    );
    expect(PIPELINE_SRC).not.toMatch(/if \(isRerun\) \{\s*\n\s*setAuditReport\(null\);/);
  });

  it('la descarga sólo adjunta referencias marcadas como completas', () => {
    expect(PIPELINE_SRC).toMatch(/auditReport\?\.auditComplete \? auditReport\.auditVersionId \?\? null : null/);
    expect(PIPELINE_SRC).toMatch(/qualityReport\?\.qualityComplete \? qualityReport\.qualityVersionId \?\? null : null/);
    // Ambos formatos envían el mismo par de referencias que el servidor valida.
    expect(PIPELINE_SRC.match(/format: '(excel|pdf-elite)', \.\.\.exportRefs/g)).toHaveLength(2);
  });
});

describe('contrato: trazabilidad del modelo en la ficha técnica', () => {
  it('no hay modelId hardcodeado en el metadata del reporte', () => {
    expect(PIPELINE_SRC).not.toMatch(/modelId:\s*'gpt-/);
    expect(PIPELINE_SRC).toMatch(/modelId:\s*CLIENT_REPORT_MODEL_ID/);
  });

  it('el espejo del cliente coincide con el default de MODELS.FINANCIAL_PIPELINE', () => {
    // Si alguien cambia el modelo del pipeline y no actualiza el espejo, el
    // documento que firma el cliente vuelve a declarar un modelo falso.
    const match = MODELS_SRC.match(
      /FINANCIAL_PIPELINE:\s*envModel\(\s*'OPENAI_MODEL_FINANCIAL'\s*,\s*'([^']+)'\s*\)/,
    );
    expect(match, 'no se pudo leer el default de FINANCIAL_PIPELINE').not.toBeNull();
    expect(CLIENT_REPORT_MODEL_ID).toBe(match?.[1]);
  });
});

describe('contrato: navegar dentro del workspace no mata la corrida', () => {
  it('la página mantiene montado PipelineWorkspace mientras el pipeline corre', () => {
    // Antes: `if (activeCaseType === 'niif_report' && activeMode === 'pipeline')
    //           return <PipelineWorkspace />;`
    // — cualquier cambio de área lo desmontaba y abortaba el reporte.
    expect(PAGE_SRC).toMatch(/pipelineState\.mode/);
    expect(PAGE_SRC).toMatch(/keepPipelineMounted/);
    expect(PAGE_SRC).not.toMatch(/return\s*<PipelineWorkspace\s*\/>;/);
  });
});
