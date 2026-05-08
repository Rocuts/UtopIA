// MarkdownToPdf.tsx — Minimal Markdown → React-PDF renderer.
//
// Supported:
//   - `## Heading`, `### Heading` (4-6 hash levels collapse to h3)
//   - `**bold**`, `*italic*` inline (single-asterisk italic only when not
//     part of `**`)
//   - Unordered lists (`- ` prefix), ordered lists (`1. ` / `2. ` ...)
//   - GFM tables (`| col | col |` with `|---|---|` separator on the next row)
//   - Paragraph splits on blank lines
//
// Skipped (intentional, NoteBlock filters these upstream):
//   - Code blocks, raw HTML, blockquotes, images, footnotes,
//     nested lists deeper than 1 level
//
// Parser is hand-rolled (no markdown lib) — the call sites only render
// already-filtered prose from the financial pipeline.
// ───────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { View, Text } from '@react-pdf/renderer';
import {
  FONT_DISPLAY,
  FONT_SANS,
  GOLD_500,
  N0,
  N100,
  N200,
  N700,
  N900,
  N1000,
  S1,
  S2,
  S3,
  TYPE_BODY,
} from '../tokens';

export type MarkdownTone = 'dark-on-light' | 'light-on-dark';

export interface MarkdownToPdfProps {
  markdown: string;
  /** Extra style merged into root <View>. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  baseStyle?: any;
  tone?: MarkdownTone;
}

interface ParsedHeading {
  kind: 'heading';
  level: 2 | 3;
  text: string;
}
interface ParsedParagraph {
  kind: 'paragraph';
  text: string;
}
interface ParsedList {
  kind: 'list';
  ordered: boolean;
  items: string[];
}
interface ParsedTable {
  kind: 'table';
  headers: string[];
  rows: string[][];
}
type Block = ParsedHeading | ParsedParagraph | ParsedList | ParsedTable;

const HEADING_RE = /^(#{2,6})\s+(.+)$/;
const ULI_RE = /^-\s+(.+)$/;
const OLI_RE = /^\d+\.\s+(.+)$/;
const TABLE_ROW_RE = /^\|(.+)\|$/;
const TABLE_SEP_RE = /^\|[\s:-]+\|[\s:|-]*$/;

function parseTableCells(line: string): string[] {
  const inner = line.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Heading
    const h = HEADING_RE.exec(line);
    if (h) {
      const hashes = h[1].length;
      blocks.push({ kind: 'heading', level: hashes === 2 ? 2 : 3, text: h[2].trim() });
      i++;
      continue;
    }

    // Table — current row is `| ... |` and next row is the separator `|---|`.
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const headers = parseTableCells(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        rows.push(parseTableCells(lines[i]));
        i++;
      }
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }

    // List (unordered or ordered) — collect contiguous list lines.
    const ulHead = ULI_RE.exec(line);
    const olHead = OLI_RE.exec(line);
    if (ulHead || olHead) {
      const ordered = !!olHead;
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered ? OLI_RE.exec(lines[i]) : ULI_RE.exec(lines[i]);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    // Paragraph — collect lines until blank line / heading / list / table start.
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (next.trim() === '') break;
      if (HEADING_RE.test(next)) break;
      if (ULI_RE.test(next) || OLI_RE.test(next)) break;
      if (TABLE_ROW_RE.test(next)) break;
      para.push(next);
      i++;
    }
    blocks.push({ kind: 'paragraph', text: para.join(' ') });
  }
  return blocks;
}

interface InlineSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

function parseInline(input: string): InlineSegment[] {
  // Tokenize on **bold** first, then *italic* within remaining text. Naive
  // but adequate for the curated prose the pipeline emits.
  const out: InlineSegment[] = [];
  const boldRe = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  const matches: Array<{ start: number; end: number; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(input)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, text: m[1] });
  }

  function pushItalic(plain: string, alsoBold = false): void {
    const italRe = /\*([^*]+)\*/g;
    let last = 0;
    let im: RegExpExecArray | null;
    while ((im = italRe.exec(plain)) !== null) {
      if (im.index > last) {
        out.push({ text: plain.slice(last, im.index), bold: alsoBold });
      }
      out.push({ text: im[1], italic: true, bold: alsoBold });
      last = im.index + im[0].length;
    }
    if (last < plain.length) {
      out.push({ text: plain.slice(last), bold: alsoBold });
    }
  }

  for (const match of matches) {
    if (match.start > cursor) {
      pushItalic(input.slice(cursor, match.start), false);
    }
    pushItalic(match.text, true);
    cursor = match.end;
  }
  if (cursor < input.length) {
    pushItalic(input.slice(cursor), false);
  }
  return out;
}

function InlineText(props: {
  segments: InlineSegment[];
  fontColor: string;
  bold?: boolean;
}): React.ReactElement {
  return (
    <Text style={{ fontFamily: FONT_SANS, fontSize: TYPE_BODY, color: props.fontColor, lineHeight: 1.55 }}>
      {props.segments.map((seg, i) => (
        <Text
          key={i}
          style={{
            fontWeight: seg.bold || props.bold ? 'bold' : 'normal',
            fontStyle: seg.italic ? 'italic' : 'normal',
          }}
        >
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}

/**
 * Render filtered Markdown into React-PDF nodes. Returns a `<View>` whose
 * children mirror the parsed block structure.
 */
export function MarkdownToPdf(props: MarkdownToPdfProps): React.ReactElement {
  const { markdown, baseStyle, tone = 'dark-on-light' } = props;
  const fontColor = tone === 'dark-on-light' ? N700 : N0;
  const headingColor = tone === 'dark-on-light' ? N1000 : N0;
  const dimColor = tone === 'dark-on-light' ? N700 : N100;
  const ruleColor = tone === 'dark-on-light' ? N200 : N900;

  const blocks = parseBlocks(markdown);

  return (
    <View style={baseStyle}>
      {blocks.map((block, idx) => {
        if (block.kind === 'heading') {
          return (
            <View key={idx} style={{ marginTop: idx === 0 ? 0 : S3, marginBottom: S2 }}>
              <Text
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 'bold',
                  fontSize: block.level === 2 ? 18 : 14,
                  color: headingColor,
                  lineHeight: 1.2,
                }}
              >
                {block.text}
              </Text>
            </View>
          );
        }

        if (block.kind === 'paragraph') {
          return (
            <View key={idx} style={{ marginBottom: S2 }}>
              <InlineText segments={parseInline(block.text)} fontColor={fontColor} />
            </View>
          );
        }

        if (block.kind === 'list') {
          return (
            <View key={idx} style={{ marginBottom: S2, paddingLeft: S3 }}>
              {block.items.map((item, j) => (
                <View
                  key={j}
                  style={{ flexDirection: 'row', marginBottom: S1, alignItems: 'flex-start' }}
                >
                  <Text
                    style={{
                      fontFamily: FONT_SANS,
                      fontSize: TYPE_BODY,
                      color: GOLD_500,
                      width: 14,
                      lineHeight: 1.55,
                    }}
                  >
                    {block.ordered ? `${j + 1}.` : '•'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <InlineText segments={parseInline(item)} fontColor={fontColor} />
                  </View>
                </View>
              ))}
            </View>
          );
        }

        // Table
        return (
          <View key={idx} style={{ marginBottom: S3, borderWidth: 0.5, borderColor: ruleColor, borderStyle: 'solid' }}>
            {/* Header row */}
            <View
              style={{
                flexDirection: 'row',
                backgroundColor: tone === 'dark-on-light' ? N100 : N900,
                borderBottomWidth: 0.5,
                borderBottomColor: ruleColor,
                borderBottomStyle: 'solid',
              }}
            >
              {block.headers.map((h, j) => (
                <View
                  key={j}
                  style={{
                    flex: 1,
                    paddingHorizontal: S2,
                    paddingVertical: S1,
                    borderRightWidth: j < block.headers.length - 1 ? 0.5 : 0,
                    borderRightColor: ruleColor,
                    borderRightStyle: 'solid',
                  }}
                >
                  <Text
                    style={{
                      fontFamily: FONT_SANS,
                      fontWeight: 'bold',
                      fontSize: TYPE_BODY,
                      color: headingColor,
                    }}
                  >
                    {h}
                  </Text>
                </View>
              ))}
            </View>
            {/* Body rows */}
            {block.rows.map((row, rIdx) => (
              <View
                key={rIdx}
                style={{
                  flexDirection: 'row',
                  borderBottomWidth: rIdx < block.rows.length - 1 ? 0.5 : 0,
                  borderBottomColor: ruleColor,
                  borderBottomStyle: 'solid',
                  backgroundColor: rIdx % 2 === 1 ? (tone === 'dark-on-light' ? N0 : N1000) : 'transparent',
                }}
              >
                {row.map((cell, j) => (
                  <View
                    key={j}
                    style={{
                      flex: 1,
                      paddingHorizontal: S2,
                      paddingVertical: S1,
                      borderRightWidth: j < row.length - 1 ? 0.5 : 0,
                      borderRightColor: ruleColor,
                      borderRightStyle: 'solid',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: FONT_SANS,
                        fontSize: TYPE_BODY,
                        color: dimColor,
                      }}
                    >
                      {cell}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
