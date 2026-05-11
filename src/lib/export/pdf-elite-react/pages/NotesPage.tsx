// pages/NotesPage.tsx — one <Page> per note block, landscape A4, ESLOP editorial style.
//
// Wrap strategy: the body container carries `wrap` so React-PDF can split the
// MarkdownToPdf content across pages when the prose overflows a single 595pt
// landscape page. Per-note pages do NOT carry `wrap={false}` at the Page level
// — that would orphan long notes. Instead the outer <Page> stays wrappable and
// the note header (NumberedSectionHeader equivalent + chip cluster) carries
// `wrap={false}` so it never splits mid-header.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport, NoteBlock } from '../types';
import {
  AuthorityChip,
  PaginationFooter,
  MarkdownToPdf,
  TopoOrnament,
} from '../primitives';
import {
  N0,
  N200,
  N1000,
  AREA_VERDAD,
  FONT_DISPLAY,
  GOLD_500,
  PAGE_H,
  PAGE_W,
  S1,
  S3,
  S4,
  TYPE_SECTION,
  R_SM,
} from '../tokens';

// Landscape A4: width = PAGE_H (842), height = PAGE_W (595)
const LW = PAGE_H; // 842 pt
const LH = PAGE_W; // 595 pt
const MARGIN = 48;
const CONTENT_W = LW - MARGIN * 2;
const COL_GAP = 16;
const COL_W = (CONTENT_W - COL_GAP) / 2;

interface Props {
  doc: EditorialReport;
}

interface NotePageProps {
  block: NoteBlock;
  index: number;
}

// Section header bar — emulates the ESLOP numbered forest-green bar with
// circular badge (page 20-22 reference). Forest-green fill, badge left.
function NoteHeaderBar({ index, title }: { index: number; title: string }) {
  const badgeDiameter = 36;

  return (
    <View
      wrap={false}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: AREA_VERDAD,
        borderRadius: R_SM,
        paddingVertical: S3,
        paddingHorizontal: S4,
        marginBottom: S3,
      }}
    >
      {/* Circular badge */}
      <View
        style={{
          width: badgeDiameter,
          height: badgeDiameter,
          borderRadius: badgeDiameter / 2,
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
            fontSize: 14,
            color: N1000,
            lineHeight: 1,
          }}
        >
          {String(index).padStart(2, '0')}
        </Text>
      </View>

      {/* Title block */}
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 'bold',
            fontSize: TYPE_SECTION,
            color: N0,
            lineHeight: 1.1,
          }}
        >
          {title}
        </Text>
      </View>
    </View>
  );
}

// NormativePill cluster — wrapping row of AuthorityChip with midnight tone.
function CitationCluster({ citations }: { citations: NoteBlock['citations'] }) {
  if (citations.length === 0) return null;
  return (
    <View
      wrap={false}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: S1 + 2,
        marginBottom: S4,
      }}
    >
      {citations.map((c, i) => (
        <AuthorityChip key={`nc-${i}`} label={c.label} tone="midnight" />
      ))}
    </View>
  );
}

// Two-column body — left and right columns auto-balance via flex.
// React-PDF does not support CSS columns natively; we simulate with two
// equal-width flex children. Long bodies wrap via the outer `wrap` on the
// Page — each column expands vertically and React-PDF creates new pages.
function TwoColumnBody({ markdown }: { markdown: string }) {
  // Split markdown at midpoint (nearest blank line to midpoint) so each
  // column gets roughly equal content.
  const mid = Math.floor(markdown.length / 2);
  let splitIdx = mid;
  // Walk backward to find last blank-line boundary before midpoint.
  const before = markdown.lastIndexOf('\n\n', mid);
  if (before > mid * 0.4) {
    splitIdx = before + 2;
  }

  const leftMd = markdown.slice(0, splitIdx).trim();
  const rightMd = markdown.slice(splitIdx).trim();

  return (
    <View style={{ flexDirection: 'row', gap: COL_GAP }} wrap>
      <View style={{ width: COL_W }}>
        <MarkdownToPdf markdown={leftMd} tone="dark-on-light" />
      </View>
      {/* Thin vertical rule separator */}
      <View
        style={{
          width: 0.5,
          backgroundColor: N200,
          marginHorizontal: 0,
          flexShrink: 0,
        }}
      />
      <View style={{ width: COL_W }}>
        <MarkdownToPdf markdown={rightMd} tone="dark-on-light" />
      </View>
    </View>
  );
}

function NoteBlockPage({ block, index }: NotePageProps) {
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
      {/* Topo ornament — bottom-left corner, very low opacity */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: 220,
          height: 180,
          opacity: 0.06,
        }}
      >
        <TopoOrnament
          variant="lines"
          opacity={1}
          areaAccent="verdad"
          width={220}
          height={180}
          seed={index * 31 + 7}
        />
      </View>

      {/* Section header bar */}
      <NoteHeaderBar index={index} title={block.heading} />

      {/* Normative citations */}
      <CitationCluster citations={block.citations} />

      {/* Two-column body — wrappable */}
      <TwoColumnBody markdown={block.bodyMarkdown} />

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Notas" />
    </Page>
  );
}

/**
 * Returns one <Page> per note block. Long blocks flow across pages automatically
 * via React-PDF's internal wrap mechanism on the body container.
 */
export function NotesPage({ doc }: Props): React.ReactElement[] {
  return doc.notes.blocks.map((block, i) => (
    <NoteBlockPage key={`note-${i}`} block={block} index={i + 1} />
  ));
}

export { NoteBlockPage };
