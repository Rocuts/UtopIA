// ---------------------------------------------------------------------------
// Insight templates — 4 pilares × 3 severities × 2 idiomas.
// ---------------------------------------------------------------------------
// Las plantillas están escritas en formato directo (sin engine de plantillas
// pesado): usamos `interpolate(template, vars)` con sintaxis `{{variable}}`.
// Si una variable no se encuentra, dejamos el placeholder intacto — el
// llamador puede entonces detectar que faltan datos.
// ---------------------------------------------------------------------------

import type {
  Insight,
  InsightSeverity,
  InsightTemplate,
  InsightVariables,
} from './insight-types';
import type { PillarId } from '@/lib/pillars/types';

// ─── Diccionario de plantillas ──────────────────────────────────────────────
// Cada (pillar, severity, language) → InsightTemplate.

type TemplateDict = Record<PillarId, Record<InsightSeverity, Record<'es' | 'en', InsightTemplate>>>;

const TEMPLATES: TemplateDict = {
  // ════════════════════════════════════════════════════════════════════════
  // VERDAD — Integridad y Transparencia
  // ════════════════════════════════════════════════════════════════════════
  verdad: {
    critico: {
      es: {
        subjectTpl: '⚠️ Alerta de Integridad: Se detectó un descalce en tus libros.',
        hallazgoTpl:
          'Hola {{empresario_nombre}}, nuestro motor de IA detectó que el total de tus Activos no coincide con la suma de Pasivos y Patrimonio (Diferencia: {{monto_diferencia}}).',
        impactoTpl:
          'Esto impide la generación de estados financieros oficiales y distorsiona tus indicadores de rentabilidad.',
        accionLabelTpl: 'Revisar asientos descuadrados con mi contador',
        accionHrefTpl: '/workspace/contabilidad/mayor?showGap=true',
      },
      en: {
        subjectTpl: '⚠️ Integrity Alert: A balance gap was detected in your books.',
        hallazgoTpl:
          'Hi {{empresario_nombre}}, our AI engine detected that total Assets do not match Liabilities + Equity (Gap: {{monto_diferencia}}).',
        impactoTpl:
          'This blocks the issuance of official financial statements and skews your profitability indicators.',
        accionLabelTpl: 'Review unbalanced entries with my accountant',
        accionHrefTpl: '/workspace/contabilidad/mayor?showGap=true',
      },
    },
    advertencia: {
      es: {
        subjectTpl: '⚠️ Verdad: Anomalía contable detectada',
        hallazgoTpl: 'Hola {{empresario_nombre}}, el motor forense detectó anomalías en los asientos contables del periodo.',
        impactoTpl: 'Reduce la confianza en los reportes financieros hasta resolver las inconsistencias.',
        accionLabelTpl: 'Ver detalle de anomalías',
        accionHrefTpl: '/workspace/verdad/revisoria-fiscal',
      },
      en: {
        subjectTpl: '⚠️ Truth: Accounting anomaly detected',
        hallazgoTpl: 'Hi {{empresario_nombre}}, the forensic engine detected anomalies in the period’s journal entries.',
        impactoTpl: 'Reduces confidence in financial reports until inconsistencies are resolved.',
        accionLabelTpl: 'See anomaly details',
        accionHrefTpl: '/workspace/verdad/revisoria-fiscal',
      },
    },
    informativo: {
      es: {
        subjectTpl: 'ℹ️ Verdad: Resumen de integridad del periodo',
        hallazgoTpl: 'Tu Pilar de Verdad está saludable. {{empresario_nombre}}, los datos del periodo están consistentes.',
        impactoTpl: 'Puedes proceder con la generación de estados financieros oficiales.',
        accionLabelTpl: 'Ver dashboard de integridad',
        accionHrefTpl: '/workspace/verdad',
      },
      en: {
        subjectTpl: 'ℹ️ Truth: Period integrity summary',
        hallazgoTpl: 'Your Truth pillar is healthy. {{empresario_nombre}}, period data is consistent.',
        impactoTpl: 'You may proceed with official financial statement generation.',
        accionLabelTpl: 'See integrity dashboard',
        accionHrefTpl: '/workspace/verdad',
      },
    },
  },

  // ════════════════════════════════════════════════════════════════════════
  // ESCUDO — Resiliencia y Protección
  // ════════════════════════════════════════════════════════════════════════
  escudo: {
    // IW4 (ratios-kpis-10): antes proyectaba un "impuesto de renta" = UN ×
    // 35 %; la utilidad contable no es base fiscal. La alerta crítica del
    // Escudo es de liquidez medida (días de autonomía < 30).
    critico: {
      es: {
        subjectTpl: '🛡️ Alerta del Escudo: autonomía de caja crítica.',
        hallazgoTpl:
          '{{empresario_nombre}}, el efectivo disponible cubre sólo {{dias_autonomia}} días de los egresos del periodo.',
        impactoTpl:
          'Con menos de 30 días de autonomía, cualquier retraso en cobros o un vencimiento de obligaciones puede dejar la operación sin caja.',
        accionLabelTpl: 'Ajustar presupuesto de caja',
        accionHrefTpl: '/workspace/escudo',
      },
      en: {
        subjectTpl: '🛡️ Shield Alert: critical cash runway.',
        hallazgoTpl:
          '{{empresario_nombre}}, available cash covers only {{dias_autonomia}} days of the period outflows.',
        impactoTpl:
          'With fewer than 30 days of runway, any delay in collections or an obligation due date can leave operations without cash.',
        accionLabelTpl: 'Adjust cash budget',
        accionHrefTpl: '/workspace/escudo',
      },
    },
    advertencia: {
      es: {
        subjectTpl: '🛡️ Escudo: Liquidez bajo umbral',
        hallazgoTpl: '{{empresario_nombre}}, los días de autonomía cayeron a {{dias_autonomia}} días.',
        impactoTpl: 'Recomendamos restringir CapEx no esencial hasta recuperar el colchón.',
        accionLabelTpl: 'Ver plan de optimización',
        accionHrefTpl: '/workspace/escudo',
      },
      en: {
        subjectTpl: '🛡️ Shield: Liquidity below threshold',
        hallazgoTpl: '{{empresario_nombre}}, days of runway dropped to {{dias_autonomia}} days.',
        impactoTpl: 'We recommend pausing non-essential CapEx until the buffer recovers.',
        accionLabelTpl: 'See optimization plan',
        accionHrefTpl: '/workspace/escudo',
      },
    },
    informativo: {
      es: {
        subjectTpl: 'ℹ️ Escudo: Estado saludable',
        hallazgoTpl: '{{empresario_nombre}}, tu Pilar Escudo está sólido en este periodo.',
        impactoTpl: 'La empresa cuenta con suficiente liquidez para resistir un escenario adverso de 90+ días.',
        accionLabelTpl: 'Ver KPIs de Escudo',
        accionHrefTpl: '/workspace/escudo',
      },
      en: {
        subjectTpl: 'ℹ️ Shield: Healthy status',
        hallazgoTpl: '{{empresario_nombre}}, your Shield Pillar is solid this period.',
        impactoTpl: 'The company has enough liquidity to withstand a 90+ day adverse scenario.',
        accionLabelTpl: 'See Shield KPIs',
        accionHrefTpl: '/workspace/escudo',
      },
    },
  },

  // ════════════════════════════════════════════════════════════════════════
  // VALOR — Rentabilidad y Riqueza
  // ════════════════════════════════════════════════════════════════════════
  valor: {
    critico: {
      es: {
        subjectTpl: '💰 Alerta de Valor: Margen neto negativo',
        hallazgoTpl: 'La utilidad neta ajustada del periodo es negativa.',
        impactoTpl: 'La empresa pierde dinero después de costos, gastos e impuestos. Riesgo de erosión patrimonial.',
        accionLabelTpl: 'Auditar costos y gastos',
        accionHrefTpl: '/workspace/valor/inteligencia-financiera',
      },
      en: {
        subjectTpl: '💰 Value Alert: Negative net margin',
        hallazgoTpl: 'Adjusted net income for the period is negative.',
        impactoTpl: 'The company is losing money after costs, expenses, and taxes. Risk of equity erosion.',
        accionLabelTpl: 'Audit costs and expenses',
        accionHrefTpl: '/workspace/valor/inteligencia-financiera',
      },
    },
    advertencia: {
      es: {
        subjectTpl: '💰 Anomalía de Valor: Margen inusualmente alto detectado.',
        hallazgoTpl:
          'Tu margen bruto reportado es {{margen_bruto_pct}} y los días de inventario son {{dias_inventario}}.',
        impactoTpl: 'Tu rentabilidad podría estar inflada por falta de registro de costos.',
        accionLabelTpl: 'Revisar registro de costos',
        accionHrefTpl: '/workspace/contabilidad/mayor',
      },
      en: {
        subjectTpl: '💰 Value Anomaly: Unusually high margin detected.',
        hallazgoTpl:
          'Reported gross margin is {{margen_bruto_pct}} with {{dias_inventario}} inventory days.',
        impactoTpl: 'Profitability may be inflated by missing cost entries.',
        accionLabelTpl: 'Review cost entries',
        accionHrefTpl: '/workspace/contabilidad/mayor',
      },
    },
    informativo: {
      es: {
        subjectTpl: 'ℹ️ Valor: Reporte de rentabilidad',
        hallazgoTpl: '{{empresario_nombre}}, los KPIs de rentabilidad están dentro de rango saludable.',
        impactoTpl: 'EVA positivo: tu negocio crea valor sobre el costo de oportunidad del capital.',
        accionLabelTpl: 'Ver dashboard Valor',
        accionHrefTpl: '/workspace/valor',
      },
      en: {
        subjectTpl: 'ℹ️ Value: Profitability report',
        hallazgoTpl: '{{empresario_nombre}}, profitability KPIs are within healthy range.',
        impactoTpl: 'Positive EVA: your business creates value above capital opportunity cost.',
        accionLabelTpl: 'See Value dashboard',
        accionHrefTpl: '/workspace/valor',
      },
    },
  },

  // ════════════════════════════════════════════════════════════════════════
  // FUTURO — Proyección y Crecimiento
  // ════════════════════════════════════════════════════════════════════════
  futuro: {
    critico: {
      es: {
        subjectTpl: '🚀 Alerta del Futuro: Punto de inflexión en {{meses_inflexion}} meses.',
        hallazgoTpl:
          'Bajo el escenario conservador (-15% ventas), tu flujo de caja entraría en terreno negativo en {{mes_anio_inflexion}}.',
        impactoTpl: 'Riesgo de iliquidez operativa para el {{trimestre_inflexion}}.',
        accionLabelTpl: 'Ver plan de optimización de gastos',
        accionHrefTpl: '/workspace/futuro/escenarios',
      },
      en: {
        subjectTpl: '🚀 Future Alert: Inflection point in {{meses_inflexion}} months.',
        hallazgoTpl:
          'Under conservative scenario (-15% sales), cash flow turns negative in {{mes_anio_inflexion}}.',
        impactoTpl: 'Operational illiquidity risk by {{trimestre_inflexion}}.',
        accionLabelTpl: 'See expense optimization plan',
        accionHrefTpl: '/workspace/futuro/escenarios',
      },
    },
    advertencia: {
      es: {
        subjectTpl: '🚀 Futuro: Runway < 12 meses',
        hallazgoTpl: '{{empresario_nombre}}, el runway proyectado se acerca al umbral de alarma.',
        impactoTpl: 'Recomendamos revisar la estrategia de recaudación y reducción de DSO.',
        accionLabelTpl: 'Ver runway proyectado',
        accionHrefTpl: '/workspace/futuro',
      },
      en: {
        subjectTpl: '🚀 Future: Runway < 12 months',
        hallazgoTpl: '{{empresario_nombre}}, projected runway is nearing the alert threshold.',
        impactoTpl: 'We recommend revisiting collections strategy and DSO reduction.',
        accionLabelTpl: 'See projected runway',
        accionHrefTpl: '/workspace/futuro',
      },
    },
    informativo: {
      es: {
        subjectTpl: 'ℹ️ Futuro: Outlook positivo',
        hallazgoTpl: '{{empresario_nombre}}, las proyecciones a 36 meses son favorables en los 3 escenarios.',
        impactoTpl: 'La empresa cuenta con capacidad de inversión y resistencia a shocks moderados.',
        accionLabelTpl: 'Explorar oportunidades de inversión',
        accionHrefTpl: '/workspace/futuro/factibilidad',
      },
      en: {
        subjectTpl: 'ℹ️ Future: Positive outlook',
        hallazgoTpl: '{{empresario_nombre}}, 36-month projections are favorable across all 3 scenarios.',
        impactoTpl: 'The company has investment capacity and resilience to moderate shocks.',
        accionLabelTpl: 'Explore investment opportunities',
        accionHrefTpl: '/workspace/futuro/factibilidad',
      },
    },
  },
};

// ─── Valor / advertencia (T3) según el disparador ──────────────────────────
// Re-auditoría 2026-09-24 (ICU-06): T3 se dispara por margen bruto > 90 % o
// por días de inventario > 365, pero la plantilla siempre decía «Margen
// inusualmente alto detectado» y «tu rentabilidad podría estar inflada», aun
// con margen del 35 % o N/D. El asunto, el impacto y la acción nombran ahora
// la condición que disparó la alerta; el hallazgo (margen y días) no cambia.

export type ValorAnomaliaDisparador = 'margen' | 'inventario' | 'ambos';

const VALOR_ANOMALIA: Record<
  Exclude<ValorAnomaliaDisparador, 'margen'>,
  Record<'es' | 'en', Pick<InsightTemplate, 'subjectTpl' | 'impactoTpl' | 'accionLabelTpl'>>
> = {
  inventario: {
    es: {
      subjectTpl: '💰 Anomalía de Valor: Inventario sin rotación por más de un año.',
      impactoTpl:
        'Un inventario que tarda más de 365 días en rotar puede estar sobrevalorado (mercancía obsoleta o costo de ventas sin registrar).',
      accionLabelTpl: 'Revisar inventario y costo de ventas',
    },
    en: {
      subjectTpl: '💰 Value Anomaly: Inventory not turning over for more than a year.',
      impactoTpl:
        'Inventory that takes more than 365 days to turn over may be overstated (obsolete stock or unrecorded cost of sales).',
      accionLabelTpl: 'Review inventory and cost of sales',
    },
  },
  ambos: {
    es: {
      subjectTpl: '💰 Anomalía de Valor: Margen inusualmente alto e inventario sin rotación.',
      impactoTpl:
        'Tu rentabilidad podría estar inflada por falta de registro de costos, y el inventario podría estar sobrevalorado.',
      accionLabelTpl: 'Revisar registro de costos e inventario',
    },
    en: {
      subjectTpl: '💰 Value Anomaly: Unusually high margin and slow-moving inventory.',
      impactoTpl: 'Profitability may be inflated by missing cost entries, and inventory may be overstated.',
      accionLabelTpl: 'Review cost entries and inventory',
    },
  },
};

/** Plantilla de valor/advertencia (T3) para la condición que la disparó. */
export function getValorAnomaliaTemplate(
  disparador: ValorAnomaliaDisparador,
  language: 'es' | 'en',
): InsightTemplate {
  const base = TEMPLATES.valor.advertencia[language];
  return disparador === 'margen' ? base : { ...base, ...VALOR_ANOMALIA[disparador][language] };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getInsightTemplate(
  pillar: PillarId,
  severity: InsightSeverity,
  language: 'es' | 'en',
): InsightTemplate {
  return TEMPLATES[pillar][severity][language];
}

/**
 * Reemplaza `{{var}}` con el valor de `vars[var]`. Si la variable no existe
 * o es undefined, deja el placeholder intacto. NO lanza errores ni hace
 * coerción agresiva — el llamador debe asegurarse de pasar las vars relevantes.
 */
export function interpolate(template: string, vars: InsightVariables): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return match;
    return String(v);
  });
}

/**
 * Aplica plantilla + interpolación al insight raw (sin subject/hallazgo
 * todavía resueltos). Útil cuando el trigger genera solo `{pillar, severity, vars}`.
 */
export function fillInsightFromTemplate(
  insight: Pick<Insight, 'pillar' | 'severity' | 'vars'> & {
    triggerCode?: string;
    dedupKey?: string;
    workspaceId?: string;
    language?: 'es' | 'en';
    tone?: Insight['tone'];
    /** Plantilla explícita (p. ej. la de T3 según su disparador). */
    template?: InsightTemplate;
  },
): Insight {
  const language = insight.language ?? 'es';
  const tpl = insight.template ?? getInsightTemplate(insight.pillar, insight.severity, language);
  return {
    pillar: insight.pillar,
    severity: insight.severity,
    triggerCode: insight.triggerCode ?? `${insight.pillar.toUpperCase()}-${insight.severity}`,
    dedupKey:
      insight.dedupKey ??
      `${insight.pillar}-${insight.severity}-${insight.workspaceId ?? 'anon'}`,
    workspaceId: insight.workspaceId,
    language,
    tone: insight.tone ?? 'normal',
    subject: interpolate(tpl.subjectTpl, insight.vars),
    hallazgo: interpolate(tpl.hallazgoTpl, insight.vars),
    impacto: interpolate(tpl.impactoTpl, insight.vars),
    accionRecomendada: {
      label: interpolate(tpl.accionLabelTpl, insight.vars),
      href: interpolate(tpl.accionHrefTpl, insight.vars),
    },
    vars: insight.vars,
    generatedAt: new Date().toISOString(),
  };
}
