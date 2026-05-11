// pages/AuditFindingsPage.tsx — "Auditoría Especializada" page, landscape A4.
//
// Renders `EditorialReport.auditFindings`, sourced by the composer from the
// /api/financial-audit pipeline (4 auditors in parallel: NIIF, Tributario,
// Legal, Fiscal). Page is omitted when the field is undefined (user didn't
// enable outputOptions.auditPipeline or the pipeline failed).
//
// Layout:
//   - Top: title + opinion pill (favorable/con salvedades/desfavorable/abstención)
//   - 4 auditor score cards in a horizontal row (NIIF / Tributario / Legal / Fiscal)
//     each with compliance score % + finding count + auditor name
//   - Below: top-N findings stacked, color-coded by severity, with norm reference
//     and brief recommendation. Auto-wraps to additional pages via React-PDF
//     when content exceeds page height.
//   - GoldRule + PageNumberBadge bottom-right.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type {
  EditorialReport,
  AuditFindingDomain,
  AuditFindingSeverity,
  AuditOpinionKind,
} from '../types';
import {
  MixedWeightHeadline,
  NormativePill,
  PageNumberBadge,
  GoldRule,
  TopoOrnament,
} from '../primitives';
import {
  CREAM_50,
  FOREST_900,
  FOREST_700,
  SAGE_500,
  SAGE_300,
  SAND_500,
  SAND_300,
  CHARCOAL_900,
  WINE_500,
  WINE_700,
  N0,
  FONT_DISPLAY,
  FONT_SANS,
  FONT_MONO,
  PAGE_W,
  PAGE_H,
  PAGE_MARGIN,
  R_SM,
  R_MD,
  S1,
  S2,
  S3,
  S4,
  S5,
  S6,
  TYPE_H2,
  TYPE_BODY,
  TYPE_CAPTION,
} from '../tokens';

interface Props {
  doc: EditorialReport;
}

const DOMAIN_LABEL: Record<AuditFindingDomain, string> = {
  niif: 'NIIF / Contable',
  tributario: 'Tributario',
  legal: 'Legal / Societario',
  revisoria: 'Revisoría Fiscal',
};

const OPINION_LABEL: Record<AuditOpinionKind, string> = {
  favorable: 'FAVORABLE',
  con_salvedades: 'CON SALVEDADES',
  desfavorable: 'DESFAVORABLE',
  abstension: 'ABSTENCIÓN',
};

function opinionColor(o: AuditOpinionKind): string {
  switch (o) {
    case 'favorable': return SAGE_500;
    case 'con_salvedades': return SAND_500;
    case 'desfavorable': return WINE_500;
    case 'abstension': return CHARCOAL_900;
  }
}

function severityColor(s: AuditFindingSeverity): string {
  switch (s) {
    case 'critico': return WINE_700;
    case 'alto': return WINE_500;
    case 'medio': return SAND_500;
    case 'bajo': return SAGE_500;
    case 'informativo': return FOREST_700;
  }
}

function severityLabel(s: AuditFindingSeverity): string {
  switch (s) {
    case 'critico': return 'CRÍTICO';
    case 'alto': return 'ALTO';
    case 'medio': return 'MEDIO';
    case 'bajo': return 'BAJO';
    case 'informativo': return 'INFO';
  }
}

export function AuditFindingsPage({ doc }: Props) {
  const audit = doc.auditFindings;
  if (!audit) return null;

  const opColor = opinionColor(audit.opinionType);

  return (
    <Page
      size="A4"
      orientation="landscape"
      style={{
        backgroundColor: CREAM_50,
        paddingHorizontal: PAGE_MARGIN,
        paddingTop: PAGE_MARGIN,
        paddingBottom: PAGE_MARGIN + S6,
        position: 'relative',
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: PAGE_W * 0.28,
          height: PAGE_H * 0.32,
          opacity: 0.07,
        }}
      >
        <TopoOrnament
          variant="corner-tr"
          opacity={1}
          areaAccent="escudo"
          seed={404}
          width={PAGE_W * 0.28}
          height={PAGE_H * 0.32}
        />
      </View>

      {/* Header — title + opinion pill */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <MixedWeightHeadline
            parts={[
              { text: 'Auditoría', weight: 'light' },
              { text: 'Especializada', weight: 'bold', highlight: true },
            ]}
            fontSize={TYPE_H2}
            tone="dark-on-light"
            highlightOpacity={0.35}
          />
        </View>
        <View
          style={{
            paddingHorizontal: S3,
            paddingVertical: S2,
            backgroundColor: opColor,
            borderRadius: R_MD,
            alignItems: 'center',
            minWidth: 140,
          }}
        >
          <Text
            style={{
              fontFamily: FONT_SANS,
              fontWeight: 'bold',
              fontSize: 9,
              color: N0,
              letterSpacing: 1,
            }}
          >
            DICTAMEN
          </Text>
          <Text
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 'bold',
              fontSize: 13,
              color: N0,
              marginTop: 2,
            }}
          >
            {OPINION_LABEL[audit.opinionType]}
          </Text>
          <Text
            style={{
              fontFamily: FONT_MONO,
              fontSize: TYPE_CAPTION,
              color: N0,
              marginTop: 2,
              opacity: 0.85,
            }}
          >
            Score {audit.overallScore}/100
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 6, marginTop: S3, marginBottom: S4, flexWrap: 'wrap' }}>
        <NormativePill label="NIA 700" tone="sage-on-cream" />
        <NormativePill label="NIA 705" tone="sage-on-cream" />
        <NormativePill label="NIA 706" tone="sage-on-cream" />
        <NormativePill label="Ley 43/1990" tone="sage-on-cream" />
      </View>

      {/* 4 auditor score cards */}
      <View style={{ flexDirection: 'row', gap: S3, marginBottom: S5 }}>
        {audit.auditorCards.map((c) => (
          <View
            key={c.domain}
            style={{
              flex: 1,
              backgroundColor: c.failed ? WINE_700 : FOREST_900,
              borderRadius: R_MD,
              paddingHorizontal: S3,
              paddingVertical: S3,
            }}
          >
            <Text
              style={{
                fontFamily: FONT_MONO,
                fontSize: 7,
                color: SAND_300,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
              }}
            >
              {DOMAIN_LABEL[c.domain]}
            </Text>
            <Text
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 'bold',
                fontSize: 36,
                color: N0,
                marginTop: 2,
                lineHeight: 1,
              }}
            >
              {c.failed ? '—' : c.complianceScore}
              <Text style={{ fontSize: 16, color: SAND_500 }}>
                {c.failed ? '' : '/100'}
              </Text>
            </Text>
            <Text
              style={{
                fontFamily: FONT_SANS,
                fontSize: 8,
                color: SAGE_300,
                marginTop: 4,
              }}
            >
              {c.failed
                ? 'Auditor falló'
                : `${c.findingCount} hallazgo${c.findingCount === 1 ? '' : 's'}`}
            </Text>
          </View>
        ))}
      </View>

      {/* Severity counts ribbon */}
      <View style={{ flexDirection: 'row', gap: S2, marginBottom: S4 }}>
        {(['critico', 'alto', 'medio', 'bajo', 'informativo'] as AuditFindingSeverity[]).map((sev) => (
          <View
            key={sev}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: S2,
              paddingVertical: 3,
              borderRadius: R_SM,
              backgroundColor: CREAM_50,
              borderWidth: 0.5,
              borderColor: severityColor(sev),
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: severityColor(sev),
              }}
            />
            <Text
              style={{
                fontFamily: FONT_MONO,
                fontSize: 7,
                color: CHARCOAL_900,
                letterSpacing: 0.5,
              }}
            >
              {severityLabel(sev)} · {audit.findingCounts[sev]}
            </Text>
          </View>
        ))}
      </View>

      {/* Top findings list */}
      <View style={{ flexGrow: 1 }} wrap>
        {audit.topFindings.length === 0 ? (
          <Text style={{ fontFamily: FONT_SANS, fontSize: TYPE_BODY, color: CHARCOAL_900, fontStyle: 'italic' }}>
            Sin hallazgos materiales. Dictamen favorable sin salvedades.
          </Text>
        ) : (
          audit.topFindings.map((f) => (
            <View
              key={f.code}
              wrap={false}
              style={{
                borderLeftWidth: 3,
                borderLeftColor: severityColor(f.severity),
                paddingLeft: S3,
                marginBottom: S3,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: S2, marginBottom: 2 }}>
                <Text
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 7,
                    color: N0,
                    backgroundColor: severityColor(f.severity),
                    paddingHorizontal: 5,
                    paddingVertical: 1,
                    borderRadius: 2,
                    letterSpacing: 0.5,
                  }}
                >
                  {severityLabel(f.severity)}
                </Text>
                <Text
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: TYPE_CAPTION,
                    color: FOREST_700,
                  }}
                >
                  {f.code} · {DOMAIN_LABEL[f.domain]}
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 'bold',
                  fontSize: 11,
                  color: FOREST_900,
                  marginBottom: 1,
                }}
              >
                {f.title}
              </Text>
              <Text
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: TYPE_CAPTION,
                  color: SAGE_500,
                  marginBottom: 2,
                }}
              >
                {f.normReference}
              </Text>
              <Text
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 9,
                  color: CHARCOAL_900,
                  lineHeight: 1.4,
                  marginBottom: 2,
                }}
              >
                {f.description}
              </Text>
              <Text
                style={{
                  fontFamily: FONT_SANS,
                  fontStyle: 'italic',
                  fontSize: 8.5,
                  color: FOREST_700,
                  lineHeight: 1.4,
                }}
              >
                Recomendación: {f.recommendation}
              </Text>
            </View>
          ))
        )}
      </View>

      <GoldRule />
      <PageNumberBadge pageNumber={0} />
    </Page>
  );
}
