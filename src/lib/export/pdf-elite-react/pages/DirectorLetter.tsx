// pages/DirectorLetter.tsx — director's message with crescent portrait + 2-col body.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import {
  EditorialTitle,
  AuthorityChip,
  CrescentMask,
  WatermarkWord,
  PaginationFooter,
  MarkdownToPdf,
} from '../primitives';
import { N0, N700, N1000 } from '../tokens';

interface Props {
  doc: EditorialReport;
}

/**
 * Split a markdown string into roughly two halves WITHOUT breaking a paragraph.
 * Prefers a paragraph boundary (double newline) closest to the midpoint.
 * If no boundary exists, returns ['', full] so we render single-column upstream.
 */
function splitMarkdown(md: string): [string, string] {
  if (!md) return ['', ''];
  const target = Math.floor(md.length / 2);
  // Find all paragraph boundary indices.
  const re = /\n\s*\n/g;
  const candidates: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    candidates.push(m.index + m[0].length);
  }
  if (candidates.length === 0) {
    return ['', md];
  }
  // Pick the candidate closest to `target`.
  let best = candidates[0];
  let bestDist = Math.abs(best - target);
  for (const c of candidates) {
    const d = Math.abs(c - target);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return [md.slice(0, best).trimEnd(), md.slice(best).trimStart()];
}

export function DirectorLetter({ doc }: Props) {
  const dl = doc.directorLetter;
  const [colA, colB] = splitMarkdown(dl.bodyMarkdown);
  const useTwoColumns = colA.length > 0;

  return (
    <Page
      size="A4"
      style={{
        backgroundColor: N0,
        paddingHorizontal: 48,
        paddingTop: 48,
        paddingBottom: 72,
        position: 'relative',
      }}
    >
      {/* Background watermark */}
      <View
        style={{
          position: 'absolute',
          bottom: 80,
          left: 24,
        }}
      >
        <WatermarkWord text="Liderazgo" opacity={0.04} />
      </View>

      {/* Top-right portrait crescent */}
      <View
        style={{
          position: 'absolute',
          top: 32,
          right: 48,
        }}
      >
        <CrescentMask
          portrait={dl.portrait}
          size={140}
          satellite={{ size: 48, offset: { x: 110, y: -10 } }}
        />
      </View>

      {/* Title */}
      <View style={{ marginRight: 200, marginBottom: 16 }}>
        <EditorialTitle
          leadText="Mensaje de"
          emphasisText="nuestra dirección"
          emphasisStyle="box"
          areaAccent="valor"
          size="page"
          tone="dark-on-light"
        />
      </View>

      {/* Citations row */}
      {dl.citations.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 6,
            marginBottom: 16,
            marginRight: 200,
          }}
        >
          {dl.citations.map((c, i) => (
            <AuthorityChip
              key={`cite-${i}`}
              label={c.label}
              tone="midnight"
            />
          ))}
        </View>
      )}

      {/* Body — 2 columns if splittable, else 1 */}
      <View style={{ marginTop: 24, flexGrow: 1 }}>
        {useTwoColumns ? (
          <View style={{ flexDirection: 'row', gap: 32 }}>
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

      {/* Signer */}
      <View style={{ marginTop: 24 }}>
        <Text
          style={{
            fontFamily: 'Fraunces',
            fontWeight: 700,
            fontSize: 12,
            color: N1000,
          }}
        >
          {dl.signerName}
        </Text>
        <Text
          style={{
            fontFamily: 'Geist',
            fontSize: 9,
            color: N700,
            marginTop: 2,
          }}
        >
          {dl.signerRole}
        </Text>
      </View>

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Liderazgo" />
    </Page>
  );
}
