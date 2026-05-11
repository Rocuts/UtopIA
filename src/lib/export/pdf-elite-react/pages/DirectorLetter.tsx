// pages/DirectorLetter.tsx — cream background, 2-col body, ESLOP editorial style.
// Header: EditorialTitle "Mensaje del Socio Director" with sage highlight.
// Below header: AuthorityChip cluster (NIA 700, Ley 222/1995, IFRS 18).
// Body: 2-column MarkdownToPdf (auto-balanced on paragraph boundaries).
// Right margin: AvatarInitials disc + signer name + role.
// Bottom-left: TopoOrnament 'lines' decoration at low opacity.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import {
  EditorialTitle,
  AuthorityChip,
  TopoOrnament,
  AvatarInitials,
  WatermarkWord,
  MarkdownToPdf,
  PaginationFooter,
} from '../primitives';
import {
  N0,
  N700,
  N1000,
  GOLD_400,
  AREA_FUTURO,
  FONT_DISPLAY,
  FONT_SANS,
  PAGE_MARGIN,
  PAGE_W,
  PAGE_H,
  S1,
  S2,
  S3,
  S4,
  S5,
  S6,
  R_PILL,
} from '../tokens';

interface Props {
  doc: EditorialReport;
}

// Letter-level citations pinned per spec §3.2 (always shown on this page).
const FIXED_CITATIONS = [
  { label: 'NIA 700' },
  { label: 'Ley 222/1995' },
  { label: 'IFRS 18' },
];

/**
 * Split markdown into two half-columns without breaking a paragraph.
 * Returns ['', full] when there are no paragraph boundaries.
 */
function splitMarkdown(md: string): [string, string] {
  if (!md) return ['', ''];
  const target = Math.floor(md.length / 2);
  const re = /\n\s*\n/g;
  const candidates: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    candidates.push(m.index + m[0].length);
  }
  if (candidates.length === 0) return ['', md];
  let best = candidates[0];
  let bestDist = Math.abs(best - target);
  for (const c of candidates) {
    const d = Math.abs(c - target);
    if (d < bestDist) { best = c; bestDist = d; }
  }
  return [md.slice(0, best).trimEnd(), md.slice(best).trimStart()];
}

const DISC_SIZE = 52;

export function DirectorLetter({ doc }: Props) {
  const dl = doc.directorLetter;
  const [colA, colB] = splitMarkdown(dl.bodyMarkdown);
  const useTwoColumns = colA.length > 0;

  // Merge fixed letter-level citations with any doc-specific ones (dedup by label).
  const seen = new Set<string>();
  const citations = [...FIXED_CITATIONS, ...dl.citations].filter(c => {
    if (seen.has(c.label)) return false;
    seen.add(c.label);
    return true;
  });

  // Derive initials from signer name.
  const nameParts = dl.signerName.trim().split(/\s+/).filter(Boolean);
  const initials =
    nameParts.length >= 2
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
      : nameParts[0]?.slice(0, 2).toUpperCase() ?? 'EU';

  return (
    <Page
      size="A4"
      orientation="landscape"
      style={{
        backgroundColor: N0,
        paddingHorizontal: PAGE_MARGIN,
        paddingTop: PAGE_MARGIN,
        paddingBottom: PAGE_MARGIN + S6,
        position: 'relative',
      }}
    >
      {/* Background watermark */}
      <WatermarkWord text="Liderazgo" opacity={0.04} />

      {/* Bottom-left topo decoration */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: PAGE_W * 0.35,
          height: PAGE_H * 0.3,
          opacity: 0.06,
        }}
      >
        <TopoOrnament
          variant="lines"
          opacity={1}
          areaAccent="futuro"
          seed={55}
          width={PAGE_W * 0.35}
          height={PAGE_H * 0.3}
        />
      </View>

      {/* Title row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          marginBottom: S3,
          // Leave room for the avatar disc on the right (DISC_SIZE + S4 buffer)
          marginRight: DISC_SIZE + S4,
        }}
      >
        <EditorialTitle
          leadText="Mensaje"
          emphasisText="del Socio Director"
          emphasisStyle="box"
          areaAccent="futuro"
          size="page"
          tone="dark-on-light"
        />
      </View>

      {/* Citations pill row */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: S2,
          marginBottom: S4,
          marginRight: DISC_SIZE + S4,
        }}
      >
        {citations.map((c, i) => (
          <AuthorityChip key={`cite-${i}`} label={c.label} tone="midnight" />
        ))}
      </View>

      {/* Avatar disc — top-right corner (absolute) */}
      <View
        style={{
          position: 'absolute',
          top: PAGE_MARGIN,
          right: PAGE_MARGIN,
          alignItems: 'center',
          gap: S1,
        }}
      >
        <View
          style={{
            width: DISC_SIZE,
            height: DISC_SIZE,
            borderRadius: R_PILL,
            overflow: 'hidden',
          }}
        >
          <AvatarInitials
            initials={initials}
            areaAccent={dl.portrait.areaAccent}
            size={DISC_SIZE}
          />
        </View>
        <Text
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 'bold',
            fontSize: 8,
            color: GOLD_400,
            textAlign: 'center',
            marginTop: S1,
          }}
        >
          {dl.signerName}
        </Text>
        <Text
          style={{
            fontFamily: FONT_SANS,
            fontSize: 7,
            color: AREA_FUTURO,
            fontStyle: 'italic',
            textAlign: 'center',
          }}
        >
          {dl.signerRole}
        </Text>
      </View>

      {/* Body — 2 columns if splittable, else single column */}
      <View style={{ flexGrow: 1, marginTop: S2 }}>
        {useTwoColumns ? (
          <View style={{ flexDirection: 'row', gap: S5 }}>
            <View style={{ flex: 1 }}>
              <MarkdownToPdf markdown={colA} tone="dark-on-light" />
            </View>
            <View style={{ flex: 1 }}>
              <MarkdownToPdf markdown={colB} tone="dark-on-light" />
            </View>
          </View>
        ) : (
          <MarkdownToPdf markdown={dl.bodyMarkdown} tone="dark-on-light" />
        )}
      </View>

      {/* Signer block — shown below body when avatar disc doesn't have room */}
      <View style={{ marginTop: S4 }}>
        <View
          style={{
            width: 120,
            borderTopWidth: 0.5,
            borderTopStyle: 'solid',
            borderTopColor: N700,
            marginBottom: S1,
          }}
        />
        <Text
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 'bold',
            fontSize: 10,
            color: N1000,
          }}
        >
          {dl.signerName}
        </Text>
        <Text
          style={{
            fontFamily: FONT_SANS,
            fontSize: 8,
            color: AREA_FUTURO,
            fontStyle: 'italic',
            marginTop: S1,
          }}
        >
          {dl.signerRole}
        </Text>
      </View>

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Liderazgo" />
    </Page>
  );
}
