// pages/NotesPage.tsx — one <Page> per note block, with wrap for long bodies.
import React from 'react';
import { Page, View } from '@react-pdf/renderer';
import type { EditorialReport, NoteBlock } from '../types';
import {
  EditorialTitle,
  AuthorityChip,
  PaginationFooter,
  MarkdownToPdf,
} from '../primitives';
import { N0 } from '../tokens';

interface Props {
  doc: EditorialReport;
}

interface SinglePageProps {
  block: NoteBlock;
}

function NoteBlockPage({ block }: SinglePageProps) {
  // Split heading into "leadText" + "emphasisText" if it contains a space, else
  // use the whole heading as emphasis.
  const parts = block.heading.split(/\s+/);
  let leadText = '';
  let emphasisText = block.heading;
  if (parts.length >= 2) {
    leadText = parts[0];
    emphasisText = parts.slice(1).join(' ');
  }

  return (
    <Page
      size="A4"
      style={{
        backgroundColor: N0,
        paddingHorizontal: 48,
        paddingTop: 48,
        paddingBottom: 72,
      }}
    >
      <EditorialTitle
        leadText={leadText}
        emphasisText={emphasisText}
        emphasisStyle="italic"
        areaAccent="verdad"
        size="section"
        tone="dark-on-light"
      />

      {block.citations.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 12,
            marginBottom: 20,
          }}
        >
          {block.citations.map((c, i) => (
            <AuthorityChip
              key={`note-cite-${i}`}
              label={c.label}
              tone="midnight"
            />
          ))}
        </View>
      )}

      <View wrap style={{ marginTop: 12 }}>
        <MarkdownToPdf markdown={block.bodyMarkdown} tone="dark-on-light" />
      </View>

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Notas" />
    </Page>
  );
}

/**
 * Returns one <Page> per note block. Long blocks flow across pages via
 * <View wrap> at the body level (React-PDF handles multi-page wrapping).
 */
export function NotesPage({ doc }: Props): React.ReactElement[] {
  return doc.notes.blocks.map((block, i) => (
    <NoteBlockPage key={`note-${i}`} block={block} />
  ));
}

export { NoteBlockPage };
