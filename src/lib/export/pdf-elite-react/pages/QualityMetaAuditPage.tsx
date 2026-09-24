// pages/QualityMetaAuditPage.tsx — "Meta-auditoría de Calidad" page, landscape A4.
//
// Renders `EditorialReport.qualityScores`, sourced by composer from
// /api/financial-quality (single meta-auditor scoring across 12 dimensions
// derived from ISO 25012 / ISO 42001 / IASB Conceptual Framework). Page is
// omitted when the field is undefined.
//
// Layout:
//   - Hero grade letter (A+, A, B, C, D, F) rotulado "GRADE INTERNO": se deriva
//     del score global v2.1 en código (auditoria-calidad-10), no del LLM.
//   - Three metric blocks side-by-side: IFRS 18 readiness · ISO 25012 data
//     quality (5 bars) · ISO 42001 AI governance (4 bars).
//   - Detalle interno D1–D14 as horizontal bars showing score / framework.
//   - Sello de calidad v2.1 (veredicto de la Spec v2.1 Parte V) en una franja,
//     DESPUÉS de la meta-auditoría (spec v2.1, reglas de integración).
//   - GoldRule + PageNumberBadge.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport, QualitySelloSpec } from '../types';
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
  TYPE_HERO,
  TYPE_CAPTION,
} from '../tokens';

interface Props {
  doc: EditorialReport;
}

function gradeColor(grade: string | null): string {
  if (grade === null) return SAND_500;
  if (grade.startsWith('A')) return SAGE_500;
  if (grade === 'B') return SAND_500;
  if (grade === 'C') return SAND_500;
  return WINE_500;
}

function selloColor(type: QualitySelloSpec['type']): string {
  switch (type) {
    case 'certificada': return SAGE_500;
    case 'con_observaciones': return SAND_500;
    case 'requiere_correccion': return WINE_500;
    case 'no_evaluable': return CHARCOAL_900;
  }
}

function fmtScore10(v: number | null): string {
  return v === null ? 'N/D' : `${v.toFixed(1).replace('.', ',')}/10`;
}

/** Franja con el sello v2.1: es el veredicto; el grade es interno. */
function SelloBanner({ sello }: { sello: QualitySelloSpec }) {
  const color = selloColor(sello.type);
  return (
    <View
      style={{
        borderLeftWidth: 4,
        borderLeftColor: color,
        backgroundColor: N0,
        borderRadius: R_SM,
        paddingHorizontal: S3,
        paddingVertical: S2,
        marginBottom: S4,
      }}
    >
      <Text style={{ fontFamily: FONT_MONO, fontSize: 7, color: FOREST_700, letterSpacing: 1, textTransform: 'uppercase' }}>
        Sello de calidad v2.1
      </Text>
      <Text style={{ fontFamily: FONT_DISPLAY, fontWeight: 'bold', fontSize: 13, color, marginTop: 2 }}>
        {sello.title}
      </Text>
      <Text style={{ fontFamily: FONT_SANS, fontSize: 8.5, color: CHARCOAL_900, marginTop: 2 }}>
        {`Score global ${fmtScore10(sello.score10)} · ${sello.approvedCount}/12 dimensiones aprobadas (evaluadas ${sello.evaluatedCount}/12)`}
      </Text>
      <Text style={{ fontFamily: FONT_SANS, fontSize: 8, color: FOREST_700, marginTop: 2, lineHeight: 1.3 }}>
        {sello.bottomLine}
      </Text>
    </View>
  );
}

function scoreColor(score: number | null): string {
  if (score === null) return SAND_500;
  if (score >= 80) return SAGE_500;
  if (score >= 60) return SAND_500;
  return WINE_500;
}

interface BarRowProps {
  label: string;
  /** null = sin dato → "N/D" y barra vacía (nunca 0). */
  value: number | null;
  framework?: string;
}

function BarRow({ label, value, framework }: BarRowProps) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <View style={{ marginBottom: S2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 2 }}>
        <Text
          style={{
            fontFamily: FONT_SANS,
            fontSize: 8.5,
            color: CHARCOAL_900,
            flex: 1,
          }}
        >
          {label}
          {framework ? (
            <Text style={{ fontFamily: FONT_MONO, fontSize: 7, color: FOREST_700 }}>{`  · ${framework}`}</Text>
          ) : null}
        </Text>
        <Text
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 'bold',
            fontSize: 10,
            color: scoreColor(value),
          }}
        >
          {value === null ? 'N/D' : value}
        </Text>
      </View>
      <View style={{ height: 4, backgroundColor: SAND_300, borderRadius: 2, overflow: 'hidden' }}>
        <View
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: scoreColor(value),
          }}
        />
      </View>
    </View>
  );
}

export function QualityMetaAuditPage({ doc }: Props) {
  const q = doc.qualityScores;
  if (!q) return null;

  const gColor = gradeColor(q.grade);

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
          bottom: 0,
          right: 0,
          width: PAGE_W * 0.26,
          height: PAGE_H * 0.3,
          opacity: 0.07,
        }}
      >
        <TopoOrnament
          variant="corner-bl"
          opacity={1}
          areaAccent="verdad"
          seed={42}
          width={PAGE_W * 0.26}
          height={PAGE_H * 0.3}
        />
      </View>

      <MixedWeightHeadline
        parts={[
          { text: 'Meta-auditoría', weight: 'light' },
          { text: 'de Calidad', weight: 'bold', highlight: true },
        ]}
        fontSize={TYPE_H2}
        tone="dark-on-light"
        highlightOpacity={0.35}
      />

      <View style={{ flexDirection: 'row', gap: 6, marginTop: S3, marginBottom: S4, flexWrap: 'wrap' }}>
        <NormativePill label="ISO 25012" tone="sage-on-cream" />
        <NormativePill label="ISO 42001" tone="sage-on-cream" />
        {/* NIIF 18 no está incorporada al marco técnico colombiano vigente: se
            rotula como preparación futura, no como norma aplicable. */}
        <NormativePill label="NIIF 18 (no vigente en Colombia)" tone="sage-on-cream" />
        <NormativePill label="IASB CF" tone="sage-on-cream" />
      </View>

      {/* Top row — grade hero + 3 metric blocks */}
      <View style={{ flexDirection: 'row', gap: S4, marginBottom: S5 }}>
        {/* Hero grade circle */}
        <View
          style={{
            width: 180,
            height: 180,
            borderRadius: 90,
            backgroundColor: FOREST_900,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 4,
            borderColor: gColor,
          }}
        >
          <Text
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 'bold',
              fontSize: 84,
              color: gColor,
              lineHeight: 1,
            }}
          >
            {q.grade ?? 'N/D'}
          </Text>
          <Text
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              color: SAND_300,
              marginTop: S1,
              letterSpacing: 1,
            }}
          >
            GRADE INTERNO · {q.overallScore === null ? 'N/D' : `${q.overallScore}/100`}
          </Text>
        </View>

        {/* IFRS 18 readiness */}
        <View
          style={{
            flex: 1,
            backgroundColor: N0,
            borderRadius: R_MD,
            paddingHorizontal: S3,
            paddingVertical: S3,
            borderWidth: 0.5,
            borderColor: SAND_300,
          }}
        >
          <Text style={{ fontFamily: FONT_MONO, fontSize: 7, color: SAGE_500, letterSpacing: 1, textTransform: 'uppercase' }}>
            Preparación NIIF 18 (no vigente en Colombia)
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: S2, marginTop: S1 }}>
            <Text style={{ fontFamily: FONT_DISPLAY, fontWeight: 'bold', fontSize: 28, color: FOREST_900 }}>
              {q.ifrs18Score ?? 'N/D'}
            </Text>
            <Text style={{ fontFamily: FONT_SANS, fontSize: 10, color: FOREST_700 }}>/ 100</Text>
            <View
              style={{
                marginLeft: S2,
                paddingHorizontal: S2,
                paddingVertical: 2,
                backgroundColor: q.ifrs18Ready === true ? SAGE_500 : SAND_500,
                borderRadius: R_SM,
              }}
            >
              <Text style={{ fontFamily: FONT_MONO, fontSize: 7, color: N0, letterSpacing: 0.5 }}>
                {q.ifrs18Ready === null ? 'SIN DATO' : q.ifrs18Ready ? 'LISTO' : 'EN PROGRESO'}
              </Text>
            </View>
          </View>
          {q.ifrs18Gaps.length > 0 ? (
            <View style={{ marginTop: S2 }}>
              <Text style={{ fontFamily: FONT_SANS, fontSize: 8, color: CHARCOAL_900, marginBottom: 2 }}>
                Gaps:
              </Text>
              {q.ifrs18Gaps.slice(0, 3).map((g, i) => (
                <Text
                  key={`gap-${i}`}
                  style={{ fontFamily: FONT_SANS, fontSize: 7.5, color: FOREST_700, marginBottom: 1, lineHeight: 1.3 }}
                >
                  · {g}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        {/* Data quality ISO 25012 */}
        <View
          style={{
            flex: 1,
            backgroundColor: N0,
            borderRadius: R_MD,
            paddingHorizontal: S3,
            paddingVertical: S3,
            borderWidth: 0.5,
            borderColor: SAND_300,
          }}
        >
          <Text style={{ fontFamily: FONT_MONO, fontSize: 7, color: SAGE_500, letterSpacing: 1, textTransform: 'uppercase', marginBottom: S2 }}>
            ISO 25012 · Data Quality
          </Text>
          <BarRow label="Completitud" value={q.dataQuality.completeness} />
          <BarRow label="Precisión" value={q.dataQuality.accuracy} />
          <BarRow label="Consistencia" value={q.dataQuality.consistency} />
          <BarRow label="Oportunidad" value={q.dataQuality.timeliness} />
          <BarRow label="Validez" value={q.dataQuality.validity} />
        </View>

        {/* AI governance ISO 42001 */}
        <View
          style={{
            flex: 1,
            backgroundColor: N0,
            borderRadius: R_MD,
            paddingHorizontal: S3,
            paddingVertical: S3,
            borderWidth: 0.5,
            borderColor: SAND_300,
          }}
        >
          <Text style={{ fontFamily: FONT_MONO, fontSize: 7, color: SAGE_500, letterSpacing: 1, textTransform: 'uppercase', marginBottom: S2 }}>
            ISO 42001 · AI Governance
          </Text>
          <BarRow label="Trazabilidad" value={q.aiGovernance.traceability} />
          <BarRow label="Explicabilidad" value={q.aiGovernance.explainability} />
          <BarRow label="Anti-alucinación" value={q.aiGovernance.antiHallucination} />
          <BarRow label="Supervisión humana" value={q.aiGovernance.humanOversight} />
        </View>
      </View>

      {/* 12 dimensions */}
      {q.dimensions.length > 0 ? (
        <View>
          <Text
            style={{
              fontFamily: FONT_MONO,
              fontSize: 8,
              color: FOREST_700,
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginBottom: S2,
            }}
          >
            Detalle interno del meta-auditor (D1–D14, escala 0–100)
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S3 }}>
            {q.dimensions.map((d, i) => (
              <View key={`dim-${i}`} style={{ width: '31%' }}>
                <BarRow label={d.name} value={d.score} framework={d.framework} />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Sello v2.1 al final de la meta-auditoría (spec v2.1, "REGLAS DE
          INTEGRACIÓN": el sello va después de la meta-auditoría;
          auditoria-calidad-30). */}
      {q.sello ? <SelloBanner sello={q.sello} /> : null}

      <GoldRule />
      <PageNumberBadge pageNumber={0} />
    </Page>
  );
}
