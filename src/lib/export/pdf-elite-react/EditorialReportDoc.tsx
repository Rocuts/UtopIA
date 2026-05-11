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
        title={`UtopIA · Informe BLOQUEADO · ${doc.meta.companyName}`}
        author="UtopIA"
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

  return (
    <Document
      title={`UtopIA · Reporte NIIF Élite · ${doc.meta.companyName}`}
      author="UtopIA"
      subject="Informe NIIF Élite"
    >
      <CoverPage doc={doc} />
      {hasDirectorBody && <DirectorLetter doc={doc} />}
      <TocPage doc={doc} />
      <KPIGridPage doc={doc} />
      <SectionDivider
        areaAccent="valor"
        sectionTitle="Estados"
        sectionEmphasis="financieros"
      />
      {/* StatementsPages returns array of 4 <Page> elements */}
      {StatementsPages({ doc })}
      <WaterfallPnLPage doc={doc} />
      <DialGaugePage doc={doc} />
      {/* Punto de Equilibrio + Flujo de Caja Proyectado — narrative pages from
          strategicAnalysis. Each renders null when its IR field is undefined
          (composer emits the field only when the agent produced non-empty
          markdown), so omission is automatic. */}
      <BreakEvenPage doc={doc} />
      <ProjectedCashFlowPage doc={doc} />
      {hasPillars && (
        <SectionDivider
          areaAccent="verdad"
          sectionTitle="Visión"
          sectionEmphasis="estratégica"
        />
      )}
      {hasPillars && <OrbitalPillarsPage doc={doc} />}
      {/* NotesPage returns array, one per block */}
      {NotesPage({ doc })}
      <RecommendationsPage doc={doc} />
      {/* Acta de Asamblea — governance.shareholderMinutes (Art. 187 Ley 222/1995).
          Omitida si el agente de Gobierno no produjo borrador. */}
      <ShareholderMinutesPage doc={doc} />
      {/* Auditoría Especializada (4 auditores NIA 700/705/706) + Meta-auditoría
          de Calidad (ISO 25012/42001/IFRS 18). Pipelines opcionales — cada
          página retorna null si el composer no recibió el reporte de su
          pipeline (usuario destildó el output o falló la corrida). */}
      <AuditFindingsPage doc={doc} />
      <QualityMetaAuditPage doc={doc} />
      <NormativeAppendix doc={doc} />
      <ClosingPage doc={doc} />
    </Document>
  );
}
