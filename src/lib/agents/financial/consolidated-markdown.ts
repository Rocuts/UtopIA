// ---------------------------------------------------------------------------
// Markdown del reporte consolidado (Partes I/II/III).
// ---------------------------------------------------------------------------
// Módulo puro (sin dependencias de servidor) para que el cliente
// (PipelineWorkspace) y el paso servidor `/api/financial-report/consolidate`
// ensamblen EXACTAMENTE el mismo texto. Reproduce el formato de
// `buildConsolidatedReport` del orchestrator legacy: el validador post-render
// (`validateConsolidatedReport`) busca los encabezados `# PARTE I/II/III:`.
// ---------------------------------------------------------------------------

export interface ConsolidatedHeaderCompany {
  name: string;
  nit: string;
  entityType?: string;
  fiscalPeriod: string;
}

export function buildConsolidatedReportMarkdown(
  company: ConsolidatedHeaderCompany,
  niifContent: string,
  strategyContent: string,
  governanceContent: string,
  language: 'es' | 'en',
  now: Date = new Date(),
): string {
  const title =
    language === 'en'
      ? 'CONSOLIDATED FINANCIAL REPORT'
      : 'REPORTE FINANCIERO CONSOLIDADO';
  const subtitle =
    language === 'en'
      ? 'NIIF Elite Corporate Analysis'
      : 'Analisis Corporativo Elite NIIF';
  const date = now.toLocaleDateString(language === 'es' ? 'es-CO' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `# ${title}
## ${subtitle}

---

| Campo | Detalle |
|-------|---------|
| **Empresa** | ${company.name} |
| **NIT** | ${company.nit} |
| **Tipo Societario** | ${company.entityType || 'N/A'} |
| **Periodo Fiscal** | ${company.fiscalPeriod} |
| **Fecha de Generacion** | ${date} |
| **Generado por** | 1+1 — Financial Orchestrator (3 Agentes Especializados) |

---

# PARTE I: ESTADOS FINANCIEROS NIIF
*Preparado por: Agente Analista Contable NIIF*

${niifContent}

---

# PARTE II: ANALISIS ESTRATEGICO Y PROYECCIONES
*Preparado por: Agente Director de Estrategia Financiera*

${strategyContent}

---

# PARTE III: GOBIERNO CORPORATIVO Y DOCUMENTOS LEGALES
*Preparado por: Agente Especialista en Gobierno Corporativo*

${governanceContent}

---

> **Nota Legal:** Este reporte fue generado por 1+1, un sistema de inteligencia artificial. Las cifras, analisis y documentos legales deben ser validados por un Contador Publico certificado y un abogado antes de su uso oficial. 1+1 no reemplaza la asesoria profesional.
`;
}
