// pages/NormativeAppendix.tsx — normative annex, landscape A4.
//
// Structure (four sections, all wrappable):
//   1. Totales Vinculantes — two-column table from appendix.bindingTotalsBlock
//      with sage-tinted subtotal rows (parsed line-by-line from the preformatted
//      string, so the raw mono block is never dumped as-is).
//   2. Ajustes Aplicados  — from appendix.adjustmentsTable rows, each with
//      an AuthorityChip(norma) and a description+amount line.
//   3. Advertencias       — from appendix.validationWarnings, each in a wine-
//      bordered callout pill.
//   4. Marco Normativo    — AuthorityChip cluster (references aggregated from
//      all adjustmentsTable.norma entries, deduplicated).
//
// BLOQUEADO branch: this page is the ONLY content between CoverPage and
// ClosingPage. It is therefore designed to be fully self-explanatory:
//   - A prominent wine-colored warning box at the top explains the block.
//   - All four sections remain; if data is sparse, placeholder text is shown.
//
// Wrap strategy: each section carries `wrap` at the container level so
// React-PDF can push overflow to new pages. Section headers carry `wrap={false}`
// to stay attached to their first row.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport, AdjustmentRow } from '../types';
import {
  AuthorityChip,
  PaginationFooter,
  TopoOrnament,
} from '../primitives';
import {
  N0,
  N50,
  N100,
  N200,
  N500,
  N700,
  N800,
  N1000,
  AREA_VERDAD,
  GOLD_500,
  WINE_400,
  WINE_500,
  WINE_700,
  FONT_DISPLAY,
  FONT_SANS,
  FONT_MONO,
  PAGE_H,
  PAGE_W,
  S1,
  S2,
  S3,
  S4,
  S5,
  R_SM,
  R_MD,
  TYPE_BODY,
  TYPE_CAPTION,
  lighten,
} from '../tokens';

// Landscape A4
const LW = PAGE_H;
const LH = PAGE_W;
const MARGIN = 48;

// Sage tint for subtotal rows — lightened verdad
const SAGE_ROW_BG = lighten(AREA_VERDAD, 0.88);

interface Props {
  doc: EditorialReport;
}

// ─── Section header bar (compact variant — no circular badge) ────────────────
function SectionBar({
  title,
  subtitle,
  accent,
}: {
  title: string;
  subtitle?: string;
  accent: string;
}) {
  return (
    <View
      wrap={false}
      style={{
        backgroundColor: accent,
        borderRadius: R_SM,
        paddingVertical: S2 + 2,
        paddingHorizontal: S4,
        marginBottom: S3,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: FONT_SANS,
            fontWeight: 'bold',
            fontSize: 9,
            color: N0,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              fontFamily: FONT_SANS,
              fontSize: TYPE_CAPTION,
              color: N0,
              opacity: 0.75,
              marginTop: 2,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Section 1: Totales Vinculantes ─────────────────────────────────────────
// Parse the preformatted string into key/value pairs.
function parseBindingTotals(raw: string): Array<{ label: string; value: string }> {
  const lines = raw.split('\n');
  const result: Array<{ label: string; value: string }> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('TOTALES') || trimmed.startsWith('//')) {
      continue;
    }
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const label = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (label && value) {
      result.push({ label, value });
    }
  }
  return result;
}

// Highlight rows whose label contains these strings (case-insensitive).
const SUBTOTAL_LABELS = ['total', 'patrimonio', 'utilidad', 'ingresos'];

function isSubtotalRow(label: string): boolean {
  const lower = label.toLowerCase();
  return SUBTOTAL_LABELS.some((s) => lower.includes(s));
}

function BindingTotalsSection({ raw }: { raw: string }) {
  const rows = parseBindingTotals(raw);
  if (rows.length === 0) {
    return (
      <View style={{ marginBottom: S5 }}>
        <SectionBar
          title="Totales Vinculantes"
          subtitle="Control de Ecuación Patrimonial"
          accent={AREA_VERDAD}
        />
        <Text
          style={{
            fontFamily: FONT_SANS,
            fontSize: TYPE_BODY,
            color: N700,
            fontStyle: 'italic',
          }}
        >
          No se registraron totales vinculantes en este período.
        </Text>
      </View>
    );
  }

  // Two-column table layout — label left (55%), value right (45%)
  return (
    <View style={{ marginBottom: S5 }} wrap>
      <SectionBar
        title="Totales Vinculantes"
        subtitle="Fuente: preprocesador — no recalcular"
        accent={AREA_VERDAD}
      />
      <View
        style={{
          borderWidth: 0.5,
          borderColor: N200,
          borderStyle: 'solid',
          borderRadius: R_SM,
          overflow: 'hidden',
        }}
      >
        {/* Header row */}
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: N100,
            borderBottomWidth: 0.5,
            borderBottomColor: N200,
            borderBottomStyle: 'solid',
            paddingVertical: S2,
            paddingHorizontal: S3,
          }}
        >
          <Text
            style={{
              fontFamily: FONT_SANS,
              fontWeight: 'bold',
              fontSize: TYPE_CAPTION,
              color: N800,
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              flex: 1,
            }}
          >
            Concepto
          </Text>
          <Text
            style={{
              fontFamily: FONT_SANS,
              fontWeight: 'bold',
              fontSize: TYPE_CAPTION,
              color: N800,
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              textAlign: 'right',
              width: 200,
            }}
          >
            Monto (COP)
          </Text>
        </View>
        {/* Data rows */}
        {rows.map((row, i) => {
          const isSub = isSubtotalRow(row.label);
          return (
            <View
              key={`bt-${i}`}
              wrap={false}
              style={{
                flexDirection: 'row',
                backgroundColor: isSub ? SAGE_ROW_BG : i % 2 === 1 ? N50 : N0,
                borderBottomWidth: i < rows.length - 1 ? 0.25 : 0,
                borderBottomColor: N200,
                borderBottomStyle: 'solid',
                paddingVertical: S2,
                paddingHorizontal: S3,
              }}
            >
              <Text
                style={{
                  fontFamily: isSub ? FONT_SANS : FONT_SANS,
                  fontWeight: isSub ? 'bold' : 'normal',
                  fontSize: TYPE_BODY,
                  color: isSub ? AREA_VERDAD : N800,
                  flex: 1,
                }}
              >
                {row.label}
              </Text>
              <Text
                style={{
                  fontFamily: FONT_MONO,
                  fontWeight: isSub ? 'bold' : 'normal',
                  fontSize: TYPE_BODY,
                  color: isSub ? AREA_VERDAD : N800,
                  textAlign: 'right',
                  width: 200,
                }}
              >
                {row.value}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Section 2: Ajustes Aplicados ───────────────────────────────────────────
function AdjustmentsSection({ rows }: { rows: AdjustmentRow[] }) {
  if (rows.length === 0) return null;

  function formatCOP(amount: number): string {
    const abs = Math.abs(Math.round(amount));
    const sign = amount < 0 ? '(' : '';
    const close = amount < 0 ? ')' : '';
    const withDots = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${sign}$${withDots}${close}`;
  }

  return (
    <View style={{ marginBottom: S5 }} wrap>
      <SectionBar
        title="Ajustes Aplicados"
        subtitle="Reclasificaciones y ajustes del período"
        accent={AREA_VERDAD}
      />
      {rows.map((row, i) => (
        <View
          key={`adj-${i}`}
          wrap={false}
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            backgroundColor: i % 2 === 0 ? N0 : N50,
            borderBottomWidth: 0.25,
            borderBottomColor: N200,
            borderBottomStyle: 'solid',
            paddingVertical: S2 + 1,
            paddingHorizontal: S3,
          }}
        >
          {/* Account code pill */}
          <View
            style={{
              backgroundColor: N100,
              borderRadius: R_SM,
              paddingHorizontal: S2,
              paddingVertical: S1,
              marginRight: S3,
              flexShrink: 0,
              alignSelf: 'center',
            }}
          >
            <Text
              style={{
                fontFamily: FONT_MONO,
                fontSize: 8,
                color: N700,
                letterSpacing: 0.5,
              }}
            >
              {row.cuenta}
            </Text>
          </View>
          {/* Description */}
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: FONT_SANS,
                fontSize: TYPE_BODY,
                color: N800,
                lineHeight: 1.4,
              }}
            >
              {row.descripcion}
            </Text>
            {row.norma ? (
              <View style={{ marginTop: S1 }}>
                <AuthorityChip label={row.norma} tone="midnight" />
              </View>
            ) : null}
          </View>
          {/* Amount — wine if negative */}
          <Text
            style={{
              fontFamily: FONT_MONO,
              fontSize: TYPE_BODY,
              color: row.ajuste < 0 ? WINE_500 : N800,
              fontWeight: row.ajuste < 0 ? 'bold' : 'normal',
              textAlign: 'right',
              width: 140,
              flexShrink: 0,
            }}
          >
            {formatCOP(row.ajuste)}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ─── Section 3: Advertencias ────────────────────────────────────────────────
function WarningsSection({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;

  return (
    <View style={{ marginBottom: S5 }} wrap>
      <SectionBar title="Advertencias" accent={WINE_700} />
      {warnings.map((w, i) => (
        <View
          key={`warn-${i}`}
          wrap={false}
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            backgroundColor: lighten(WINE_400, 0.88),
            borderLeftWidth: 3,
            borderLeftColor: WINE_500,
            borderLeftStyle: 'solid',
            borderRadius: R_SM,
            paddingVertical: S2 + 2,
            paddingHorizontal: S3,
            marginBottom: S2,
          }}
        >
          {/* Warning pill */}
          <View
            style={{
              backgroundColor: WINE_500,
              borderRadius: R_SM,
              paddingHorizontal: S2,
              paddingVertical: S1,
              marginRight: S3,
              flexShrink: 0,
              alignSelf: 'flex-start',
            }}
          >
            <Text
              style={{
                fontFamily: FONT_SANS,
                fontSize: 7,
                color: N0,
                fontWeight: 'bold',
                letterSpacing: 0.8,
                textTransform: 'uppercase',
              }}
            >
              ADVERTENCIA
            </Text>
          </View>
          {/* Warning text */}
          <Text
            style={{
              fontFamily: FONT_SANS,
              fontSize: TYPE_BODY,
              color: WINE_700,
              flex: 1,
              lineHeight: 1.45,
            }}
          >
            {w}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ─── Section 4: Marco Normativo Aplicado ────────────────────────────────────
function NormativeFrameworkSection({ refs }: { refs: string[] }) {
  if (refs.length === 0) return null;

  return (
    <View wrap={false} style={{ marginBottom: S5 }}>
      <SectionBar title="Marco Normativo Aplicado" accent={AREA_VERDAD} />
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: S1 + 2,
          paddingTop: S2,
        }}
      >
        {refs.map((ref, i) => (
          <AuthorityChip key={`nf-${i}`} label={ref} tone="midnight" />
        ))}
      </View>
    </View>
  );
}

// ─── Blocked branch header ────────────────────────────────────────────────
function BlockedBanner() {
  return (
    <View
      wrap={false}
      style={{
        backgroundColor: lighten(WINE_400, 0.82),
        borderWidth: 1,
        borderColor: WINE_500,
        borderStyle: 'solid',
        borderRadius: R_MD,
        paddingVertical: S3,
        paddingHorizontal: S4,
        marginBottom: S5,
        flexDirection: 'row',
        alignItems: 'flex-start',
      }}
    >
      <View
        style={{
          backgroundColor: WINE_500,
          borderRadius: R_SM,
          paddingHorizontal: S2,
          paddingVertical: S1,
          marginRight: S3,
          flexShrink: 0,
        }}
      >
        <Text
          style={{
            fontFamily: FONT_SANS,
            fontWeight: 'bold',
            fontSize: 8,
            color: N0,
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          BLOQUEADO
        </Text>
      </View>
      <Text
        style={{
          fontFamily: FONT_SANS,
          fontSize: TYPE_BODY,
          color: WINE_700,
          flex: 1,
          lineHeight: 1.5,
        }}
      >
        Este informe no puede emitirse en su forma completa. Se presentan exclusivamente los
        totales vinculantes, ajustes registrados y observaciones de validación. Para acceder
        al reporte editorial completo, resuelva las advertencias indicadas a continuación.
      </Text>
    </View>
  );
}

// ─── Main page header bar ────────────────────────────────────────────────────
function AppendixHeaderBar({ isBlocked }: { isBlocked: boolean }) {
  const accent = isBlocked ? WINE_700 : AREA_VERDAD;
  return (
    <View
      wrap={false}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: accent,
        borderRadius: R_SM,
        paddingVertical: S3,
        paddingHorizontal: S4,
        marginBottom: S4,
      }}
    >
      {/* Circular badge */}
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: GOLD_500,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: S3,
          flexShrink: 0,
        }}
      >
        <Text
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 'bold',
            fontSize: 11,
            color: N1000,
            lineHeight: 1,
          }}
        >
          A
        </Text>
      </View>
      <Text
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 'bold',
          fontSize: 20,
          color: N0,
          letterSpacing: 0.3,
        }}
      >
        Anexo Normativo
      </Text>
    </View>
  );
}

// ─── Gather normative refs from adjustments ──────────────────────────────────
function collectNormativeRefs(rows: AdjustmentRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    if (row.norma && !seen.has(row.norma)) {
      seen.add(row.norma);
      out.push(row.norma);
    }
  }
  return out;
}

// ─── NormativeAppendix page ──────────────────────────────────────────────────
export function NormativeAppendix({ doc }: Props) {
  const apx = doc.appendix;
  const isBlocked = doc.meta.watermark === 'BLOQUEADO';

  const adjustments = apx.adjustmentsTable ?? [];
  const warnings = apx.validationWarnings ?? [];
  const bindingRaw = apx.bindingTotalsBlock ?? '';
  const normRefs = collectNormativeRefs(adjustments);

  return (
    <Page
      size={[LW, LH]}
      style={{
        backgroundColor: N0,
        paddingHorizontal: MARGIN,
        paddingTop: MARGIN,
        paddingBottom: 72,
        position: 'relative',
      }}
    >
      {/* Topo ornament — bottom-left corner */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: 240,
          height: 200,
          opacity: 0.05,
        }}
      >
        <TopoOrnament
          variant="ribbons"
          opacity={1}
          areaAccent="verdad"
          width={240}
          height={200}
          seed={19}
        />
      </View>

      {/* Main header */}
      <AppendixHeaderBar isBlocked={isBlocked} />

      {/* BLOQUEADO explanation banner */}
      {isBlocked && <BlockedBanner />}

      {/* Section 1: Totales Vinculantes */}
      {bindingRaw.length > 0 && (
        <BindingTotalsSection raw={bindingRaw} />
      )}

      {/* Section 2: Ajustes Aplicados */}
      {adjustments.length > 0 && (
        <AdjustmentsSection rows={adjustments} />
      )}

      {/* Section 3: Advertencias */}
      {warnings.length > 0 && (
        <WarningsSection warnings={warnings} />
      )}

      {/* Section 4: Marco Normativo */}
      {normRefs.length > 0 && (
        <NormativeFrameworkSection refs={normRefs} />
      )}

      {/* Fallback when all sections are empty */}
      {!bindingRaw && adjustments.length === 0 && warnings.length === 0 && (
        <View style={{ marginTop: S5 }}>
          <Text
            style={{
              fontFamily: FONT_SANS,
              fontSize: TYPE_BODY,
              color: N500,
              fontStyle: 'italic',
            }}
          >
            No se registraron ajustes, advertencias ni totales vinculantes para este período.
          </Text>
        </View>
      )}

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Anexo Normativo" />
    </Page>
  );
}
