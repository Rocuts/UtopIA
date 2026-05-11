// pages/CoverPage.tsx — full-bleed forest cover with ESLOP editorial treatment.
// Two-column split: left 60% = MixedWeight title + company block;
// right 40% = topo masked-circle ornament.
// BLOQUEADO variant: diagonal wine WatermarkWord + blocked pill overlay.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import {
  EditorialTitle,
  AuthorityChip,
  TopoOrnament,
  AvatarInitials,
} from '../primitives';
import {
  N0,
  N100,
  N400,
  N1000,
  GOLD_400,
  GOLD_500,
  WINE_500,
  WINE_700,
  AREA_FUTURO,
  FONT_SANS,
  FONT_DISPLAY,
  FONT_MONO,
  PAGE_W,
  PAGE_H,
  PAGE_MARGIN,
  TYPE_BODY,
  TYPE_CAPTION,
  S1,
  S2,
  S3,
  S4,
  S5,
  S6,
  S7,
  S8,
  R_PILL,
  R_LG,
} from '../tokens';

interface Props {
  doc: EditorialReport;
}

// Derive a 2-letter initials string from company name.
function companyInitials(name: string): string {
  const words = name
    .replace(/\bS\.?A\.?S\.?\b|\bS\.?A\.?\b|\bLtda\.?\b|\bE\.?S\.?E\.?\b/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'UT';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function CoverPage({ doc }: Props) {
  const isBlocked = doc.meta.watermark === 'BLOQUEADO';
  const isDraft = doc.meta.watermark === 'BORRADOR';
  const watermarkSubtitle = doc.meta.watermarkSubtitle;

  const LEFT_W = PAGE_W * 0.60;
  const RIGHT_W = PAGE_W * 0.40;
  const DISC_SIZE = 180;

  // Company initials for the right-side disc.
  const initials = companyInitials(doc.meta.companyName);

  return (
    <Page
      size="A4"
      orientation="landscape"
      style={{
        backgroundColor: N1000,
        position: 'relative',
        padding: 0,
        flexDirection: 'row',
      }}
    >
      {/* Full-bleed topo ribbons — very low opacity sand contours */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: PAGE_W,
          height: PAGE_H,
        }}
      >
        <TopoOrnament
          variant="ribbons"
          opacity={0.07}
          areaAccent="valor"
          seed={42}
          width={PAGE_W}
          height={PAGE_H}
        />
      </View>

      {/* Corner-tr topo in sand at low opacity */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: RIGHT_W,
          height: PAGE_H * 0.5,
        }}
      >
        <TopoOrnament
          variant="hex"
          opacity={0.05}
          areaAccent="valor"
          seed={99}
          width={RIGHT_W}
          height={PAGE_H * 0.5}
        />
      </View>

      {/* LEFT column — 60%. Uses space-between so the bottom credits block
          (gold rule + "Generado por...") is anchored to the page bottom and
          can NEVER overlap the period text, regardless of how tall the
          editorial title block above grows. */}
      <View
        style={{
          width: LEFT_W,
          height: PAGE_H,
          paddingLeft: PAGE_MARGIN,
          paddingRight: S6,
          paddingTop: PAGE_MARGIN + S4,
          paddingBottom: PAGE_MARGIN,
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
       <View>
        {/* Eyebrow label */}
        <View style={{ marginBottom: S3 }}>
          <Text
            style={{
              fontFamily: FONT_MONO,
              fontSize: TYPE_CAPTION,
              color: AREA_FUTURO,
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}
          >
            Informe Financiero NIIF · Colombia 2026
          </Text>
        </View>

        {/* Main editorial title */}
        {isBlocked ? (
          <EditorialTitle
            leadText="Informe"
            emphasisText="BLOQUEADO"
            emphasisStyle="box"
            areaAccent="escudo"
            size="hero"
            tone="light-on-dark"
          />
        ) : isDraft ? (
          <EditorialTitle
            leadText="Reporte"
            emphasisText="BORRADOR"
            emphasisStyle="box"
            areaAccent="valor"
            size="hero"
            tone="light-on-dark"
          />
        ) : (
          <EditorialTitle
            leadText="Reporte NIIF"
            emphasisText="Élite"
            emphasisStyle="box"
            areaAccent="futuro"
            size="hero"
            tone="light-on-dark"
          />
        )}

        {/* Watermark subtitle (comparativos impracticables, draft notice) */}
        {watermarkSubtitle ? (
          <View style={{ marginTop: S3 }}>
            <Text
              style={{
                fontFamily: FONT_SANS,
                fontSize: 10,
                color: GOLD_400,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              {watermarkSubtitle}
            </Text>
          </View>
        ) : null}

        {/* Company name + NIT block */}
        <View style={{ marginTop: S7, gap: S2 }}>
          <Text
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 'bold',
              fontSize: 14,
              color: GOLD_400,
              letterSpacing: 0.5,
            }}
          >
            {doc.meta.companyName}
          </Text>

          <View style={{ flexDirection: 'row', gap: S2, flexWrap: 'wrap' }}>
            <AuthorityChip label={`NIT ${doc.meta.nit}`} tone="gold" />
            {doc.meta.entityType ? (
              <AuthorityChip label={doc.meta.entityType} tone="dim" />
            ) : null}
          </View>

          <Text
            style={{
              fontFamily: FONT_SANS,
              fontSize: 11,
              color: N100,
              marginTop: S1,
            }}
          >
            {'Periodo '}
            {doc.meta.fiscalPeriod}
            {doc.meta.comparativePeriod
              ? `  vs  ${doc.meta.comparativePeriod}`
              : ''}
          </Text>
        </View>

        {/* BLOQUEADO warning list */}
        {isBlocked ? (
          <View style={{ marginTop: S5, width: '100%' }}>
            {(doc.appendix.validationWarnings ?? []).map((w, i) => (
              <View
                key={`warn-${i}`}
                style={{
                  borderLeftWidth: 3,
                  borderLeftStyle: 'solid',
                  borderLeftColor: WINE_500,
                  paddingLeft: S3,
                  paddingVertical: S1 + 2,
                  marginBottom: S2,
                }}
              >
                <Text
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: TYPE_BODY,
                    color: N100,
                    lineHeight: 1.4,
                  }}
                >
                  {w}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
       </View>

        {/* Bottom credits block — anchored to page bottom via flex
            justifyContent:'space-between' on parent. Was previously absolute-
            positioned, which made it overlap the Period text when the title
            grew. */}
        <View>
          <View
            style={{
              width: 200,
              borderTopWidth: 0.5,
              borderTopStyle: 'solid',
              borderTopColor: GOLD_500,
              marginBottom: S2,
            }}
          />
          <Text
            style={{
              fontFamily: FONT_MONO,
              fontSize: TYPE_CAPTION,
              color: N400,
              letterSpacing: 0.5,
            }}
          >
            Generado por UtopIA · {doc.meta.generatedAt.slice(0, 10)}
          </Text>
        </View>
      </View>

      {/* RIGHT column — 40% */}
      <View
        style={{
          width: RIGHT_W,
          height: PAGE_H,
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {isBlocked ? (
          /* BLOQUEADO — show a wine-tinted "DOCUMENTO BLOQUEADO" pill */
          <View
            style={{
              backgroundColor: WINE_700,
              borderRadius: R_LG,
              paddingHorizontal: S5,
              paddingVertical: S4,
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                fontFamily: FONT_SANS,
                fontWeight: 'bold',
                fontSize: 11,
                color: N0,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              Documento Bloqueado
            </Text>
          </View>
        ) : (
          /* Normal — company initials disc with topo hex behind it */
          <>
            <View
              style={{
                position: 'absolute',
                top: PAGE_H * 0.15,
                right: 0,
                width: RIGHT_W * 0.9,
                height: PAGE_H * 0.6,
              }}
            >
              <TopoOrnament
                variant="hex"
                opacity={0.08}
                areaAccent="futuro"
                seed={17}
                width={RIGHT_W * 0.9}
                height={PAGE_H * 0.6}
              />
            </View>

            {/* Circular disc with company initials */}
            <View
              style={{
                width: DISC_SIZE,
                height: DISC_SIZE,
                borderRadius: R_PILL,
                borderWidth: 1.5,
                borderStyle: 'solid',
                borderColor: AREA_FUTURO,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AvatarInitials
                initials={initials}
                areaAccent={doc.cover.accentArea}
                size={DISC_SIZE}
              />
            </View>
          </>
        )}
      </View>

      {/* BLOQUEADO diagonal watermark over entire page */}
      {isBlocked ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.12,
          }}
        >
          <Text
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 'bold',
              fontSize: 100,
              color: WINE_500,
              letterSpacing: -2,
              transform: 'rotate(-30deg)',
            }}
          >
            BLOQUEADO
          </Text>
        </View>
      ) : null}
    </Page>
  );
}
