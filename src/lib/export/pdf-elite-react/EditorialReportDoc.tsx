// EditorialReportDoc.tsx — top-level <Document> assembling all pages.
//
// Page order (normal branch):
//   1. CoverPage
//   2. DirectorLetter (skip if no body)
//   3. TocPage
//   4. KPIGridPage
//   5. SectionDivider — "Estados / financieros"
//   6. StatementsPages (4 pages)
//   7. WaterfallPnLPage
//   8. DialGaugePage
//   9. SectionDivider — "Visión / estratégica" (only if pillars)
//  10. OrbitalPillarsPage (skipped if pillars undefined)
//  11. NotesPage (one per block)
//  12. RecommendationsPage
//  13. NormativeAppendix
//  14. ClosingPage
//
// BLOCKED branch (doc.meta.watermark === 'BLOQUEADO'):
//   1. CoverPage (warning variant)
//   2. NormativeAppendix
//   3. ClosingPage
//
// Pagination strategy: Each page calls <PaginationFooter /> internally. That
// primitive uses React-PDF's `render` slot pattern via fixed positioning, so
// it sees `pageNumber` / `totalPages` at render time. We do NOT thread page
// numbers through component props — the primitive handles it. (Polishing the
// numbering across multi-page wraps inside StatementsPages / NotesPage is a
// follow-up; the count will already work for single-page sections.)
import React from 'react';
import { Document } from '@react-pdf/renderer';
import type { EditorialReport } from './types';
import { CoverPage } from './pages/CoverPage';
import { DirectorLetter } from './pages/DirectorLetter';
import { TocPage } from './pages/TocPage';
import { KPIGridPage } from './pages/KPIGridPage';
import { SectionDivider } from './pages/SectionDivider';
import { StatementsPages } from './pages/StatementsPages';
import { WaterfallPnLPage } from './pages/WaterfallPnLPage';
import { DialGaugePage } from './pages/DialGaugePage';
import { OrbitalPillarsPage } from './pages/OrbitalPillarsPage';
import { NotesPage } from './pages/NotesPage';
import { RecommendationsPage } from './pages/RecommendationsPage';
import { NormativeAppendix } from './pages/NormativeAppendix';
import { ClosingPage } from './pages/ClosingPage';
import { BreakEvenPage } from './pages/BreakEvenPage';
import { ProjectedCashFlowPage } from './pages/ProjectedCashFlowPage';
import { ShareholderMinutesPage } from './pages/ShareholderMinutesPage';
import { AuditFindingsPage } from './pages/AuditFindingsPage';
import { QualityMetaAuditPage } from './pages/QualityMetaAuditPage';

interface Props {
  doc: EditorialReport;
}

export function EditorialReportDoc({ doc }: Props) {
  const isBlocked = doc.meta.watermark === 'BLOQUEADO';

  if (isBlocked) {
    return (
      <Document
        title={`1+1 · Informe BLOQUEADO · ${doc.meta.companyName}`}
        author="1+1"
        subject="Informe NIIF (BLOQUEADO)"
      >
        <CoverPage doc={doc} />
        <NormativeAppendix doc={doc} />
        <ClosingPage doc={doc} />
      </Document>
    );
  }

  const hasDirectorBody =
    doc.directorLetter && doc.directorLetter.bodyMarkdown.trim().length > 0;
  const hasPillars = !!doc.pillars;

  // Toggle del intake — cuando undefined, todo se renderiza (default
  // histórico para callers que no envían el toggle, p.ej. tests). Cuando
  // presente, cada flag false omite la página correspondiente. `?? true`
  // garantiza que un flag ausente equivale a "incluir" — solo se omite
  // si está EXPLÍCITAMENTE en false.
  const opts = doc.outputOptions;
  const showStatements = opts?.financialStatements ?? true;
  const showKpi = opts?.kpiDashboard ?? true;
  const showCashFlowProj = opts?.cashFlowProjection ?? true;
  const showBreakEven = opts?.breakevenAnalysis ?? true;
  const showNotes = opts?.notesToFinancialStatements ?? true;
  const showShareholderMinutes = opts?.shareholdersMinutes ?? true;
  // Audit + Quality son adicionalmente gated por la presencia del reporte
  // (su pipeline tuvo que correr). El toggle aquí es una segunda barrera
  // — si el usuario destildó el output pero el pipeline corrió igual,
  // respetamos su decisión y no renderizamos.
  const showAudit = (opts?.auditPipeline ?? true) && !!doc.auditFindings;
  const showQuality = (opts?.metaAudit ?? true) && !!doc.qualityScores;

  return (
    <Document
      title={`1+1 · Reporte NIIF Élite · ${doc.meta.companyName}`}
      author="1+1"
      subject="Informe NIIF Élite"
    >
      <CoverPage doc={doc} />
      {hasDirectorBody && <DirectorLetter doc={doc} />}
      <TocPage doc={doc} />
      {showKpi && <KPIGridPage doc={doc} />}
      {showStatements && (
        <SectionDivider
          areaAccent="valor"
          sectionTitle="Estados"
          sectionEmphasis="financieros"
        />
      )}
      {/* StatementsPages returns array of 4 <Page> elements */}
      {showStatements && StatementsPages({ doc })}
      {showKpi && <WaterfallPnLPage doc={doc} />}
      {showKpi && <DialGaugePage doc={doc} />}
      {/* Punto de Equilibrio + Flujo de Caja Proyectado — narrative pages from
          strategicAnalysis. Each renders null when its IR field is undefined
          (composer emits the field only when the agent produced non-empty
          markdown), so omission is automatic. Toggle es una segunda capa
          de gating sobre el ya implícito del composer. */}
      {showBreakEven && <BreakEvenPage doc={doc} />}
      {showCashFlowProj && <ProjectedCashFlowPage doc={doc} />}
      {hasPillars && (
        <SectionDivider
          areaAccent="verdad"
          sectionTitle="Visión"
          sectionEmphasis="estratégica"
        />
      )}
      {hasPillars && <OrbitalPillarsPage doc={doc} />}
      {/* NotesPage returns array, one per block */}
      {showNotes && NotesPage({ doc })}
      <RecommendationsPage doc={doc} />
      {/* Acta de Asamblea — governance.shareholderMinutes (Art. 187 Ley 222/1995).
          Omitida si el agente de Gobierno no produjo borrador o el usuario
          destildó el toggle. */}
      {showShareholderMinutes && <ShareholderMinutesPage doc={doc} />}
      {/* Auditoría Especializada (4 auditores NIA 700/705/706) + Meta-auditoría
          de Calidad (ISO 25012/42001/IFRS 18). Gating dual: toggle + presencia
          del reporte respectivo en el IR. */}
      {showAudit && <AuditFindingsPage doc={doc} />}
      {showQuality && <QualityMetaAuditPage doc={doc} />}
      <NormativeAppendix doc={doc} />
      <ClosingPage doc={doc} />
    </Document>
  );
}
