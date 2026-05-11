// pages/RecommendationsPage.tsx — numbered recommendation cards, landscape A4.
//
// Layout: full-width section header bar (ESLOP page-20 pattern) at top,
// then a vertically stacked list of numbered cards. Each card carries:
//   Left: circular index badge (sage or sand depending on area accent)
//   Center: title (Fraunces bold forest) + body (Geist charcoal) + pillar chip
//   Right: priority pill (forest/sage/sand)
//
// Cards stack vertically; `wrap` on the outer container lets React-PDF push
// overflow onto a new page automatically.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport, AreaKey, RecommendationItem } from '../types';
import {
  AuthorityChip,
  PaginationFooter,
  MarkdownToPdf,
  TopoOrnament,
} from '../primitives';
import {
  N0,
  N50,
  N1000,
  AREA_ESCUDO,
  AREA_VALOR,
  AREA_VERDAD,
  AREA_FUTURO,
  FONT_DISPLAY,
  FONT_SANS,
  PAGE_H,
  PAGE_W,
  S1,
  S2,
  S3,
  S4,
  R_MD,
  R_PILL,
  R_SM,
  TYPE_CAPTION,
  TYPE_SECTION,
  lighten,
} from '../tokens';

// Landscape A4
const LW = PAGE_H; // 842 pt
const LH = PAGE_W; // 595 pt
const MARGIN = 48;

interface Props {
  doc: EditorialReport;
}

function areaHex(area: AreaKey): string {
  switch (area) {
    case 'escudo': return AREA_ESCUDO;
    case 'valor':  return AREA_VALOR;
    case 'verdad': return AREA_VERDAD;
    case 'futuro': return AREA_FUTURO;
  }
}

// Badge background: lighter tint of the area accent so the numeral stays
// legible. We lighten to 80% toward white.
function badgeBg(area: AreaKey): string {
  return lighten(areaHex(area), 0.78);
}

// Priority pill color: forest for high, sage for medium, sand for low.
// We reuse the area palette as a proxy: escudo/verdad for high, futuro for medium,
// valor for low. Direct priority field is not on the type — we map from areaAccent.
function priorityLabel(area: AreaKey): string {
  switch (area) {
    case 'escudo': return 'ALTA';
    case 'valor':  return 'MEDIA';
    case 'verdad': return 'ALTA';
    case 'futuro': return 'MEDIA';
    default:       return 'NORMAL';
  }
}

function priorityBg(area: AreaKey): string {
  switch (area) {
    case 'escudo': return AREA_ESCUDO;
    case 'verdad': return AREA_VERDAD;
    case 'futuro': return AREA_FUTURO;
    case 'valor':  return AREA_VALOR;
  }
}

// Section header bar — same pattern as NotesPage but accent is "futuro".
function RecoHeaderBar() {
  return (
    <View
      wrap={false}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: AREA_FUTURO,
        borderRadius: R_SM,
        paddingVertical: S3,
        paddingHorizontal: S4,
        marginBottom: S4,
      }}
    >
      <Text
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 'bold',
          fontSize: TYPE_SECTION,
          color: N0,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
        }}
      >
        Recomendaciones
      </Text>
      <View style={{ flex: 1 }} />
      <Text
        style={{
          fontFamily: FONT_SANS,
          fontSize: TYPE_CAPTION,
          color: N0,
          opacity: 0.7,
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}
      >
        Hoja de Ruta
      </Text>
    </View>
  );
}

// Single recommendation card.
function RecoCard({ item, index }: { item: RecommendationItem; index: number }) {
  const accent = areaHex(item.areaAccent);
  const bbg = badgeBg(item.areaAccent);
  const priLabel = priorityLabel(item.areaAccent);
  const priBg = priorityBg(item.areaAccent);

  return (
    <View
      wrap={false}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: N50,
        borderRadius: R_MD,
        borderLeftWidth: 4,
        borderLeftColor: accent,
        borderLeftStyle: 'solid',
        padding: S4,
        marginBottom: S3,
      }}
    >
      {/* Left: circular index badge */}
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 21,
          backgroundColor: bbg,
          borderWidth: 1.5,
          borderColor: accent,
          borderStyle: 'solid',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: S4,
          flexShrink: 0,
        }}
      >
        <Text
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 'bold',
            fontSize: 13,
            color: accent,
            lineHeight: 1,
          }}
        >
          {String(index).padStart(2, '0')}
        </Text>
      </View>

      {/* Center: title + body + pillar chip */}
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 'bold',
            fontSize: 13,
            color: N1000,
            marginBottom: S2,
            lineHeight: 1.2,
          }}
        >
          {item.title}
        </Text>
        <MarkdownToPdf
          markdown={item.bodyMarkdown}
          tone="dark-on-light"
          baseStyle={{ marginBottom: S2 }}
        />
        {/* Pillar tag — maps area accent to a NormativePill */}
        <View style={{ flexDirection: 'row', marginTop: S1 }}>
          <AuthorityChip
            label={`Pilar ${item.areaAccent.charAt(0).toUpperCase() + item.areaAccent.slice(1)}`}
            tone={item.areaAccent === 'escudo' ? 'wine' : item.areaAccent === 'valor' ? 'gold' : 'midnight'}
          />
        </View>
      </View>

      {/* Right: priority pill */}
      <View
        style={{
          marginLeft: S4,
          alignItems: 'flex-end',
          flexShrink: 0,
        }}
      >
        <View
          style={{
            backgroundColor: priBg,
            borderRadius: R_PILL,
            paddingHorizontal: S3,
            paddingVertical: S1 + 1,
          }}
        >
          <Text
            style={{
              fontFamily: FONT_SANS,
              fontWeight: 'bold',
              fontSize: 7,
              color: N0,
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}
          >
            {priLabel}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function RecommendationsPage({ doc }: Props) {
  const items = doc.recommendations.items;

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
      {/* Topo ornament — bottom-right corner */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 200,
          height: 160,
          opacity: 0.06,
        }}
      >
        <TopoOrnament
          variant="hex"
          opacity={1}
          areaAccent="futuro"
          width={200}
          height={160}
          seed={91}
        />
      </View>

      {/* Section header */}
      <RecoHeaderBar />

      {/* Cards — wrappable so overflow spills to new pages */}
      <View wrap>
        {items.map((item, i) => (
          <RecoCard key={`rec-${i}`} item={item} index={i + 1} />
        ))}
      </View>

      <PaginationFooter
        pageNumber={0}
        totalPages={0}
        sectionLabel="Recomendaciones"
      />
    </Page>
  );
}
