// pages/TocPage.tsx — cream background, ESLOP editorial TOC style.
// Top-left: pill chip "TABLA DE CONTENIDO" in sage fill + cream text.
// 2-column layout: section title + dotted leader + page ref placeholder.
// Right: small topo hex decoration.
// Bottom: PaginationFooter (gold rule + page number).
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import {
  TopoOrnament,
  PaginationFooter,
} from '../primitives';
import {
  N0,
  N50,
  N300,
  N700,
  N1000,
  GOLD_400,
  GOLD_500,
  AREA_FUTURO,
  FONT_SANS,
  FONT_MONO,
  PAGE_MARGIN,
  PAGE_H,
  TYPE_BODY,
  TYPE_CAPTION,
  TYPE_CHIP,
  S1,
  S2,
  S5,
  S6,
  R_PILL,
} from '../tokens';

interface Props {
  doc: EditorialReport;
}

export function TocPage({ doc }: Props) {
  const entries = doc.toc.entries;
  const half = Math.ceil(entries.length / 2);
  const left = entries.slice(0, half);
  const right = entries.slice(half);

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
      {/* Right-side topo masked-circle decoration (low opacity) */}
      <View
        style={{
          position: 'absolute',
          top: PAGE_H * 0.2,
          right: PAGE_MARGIN - 16,
          width: 120,
          height: 120,
          borderRadius: R_PILL,
          overflow: 'hidden',
          opacity: 0.08,
        }}
      >
        <TopoOrnament
          variant="hex"
          opacity={1}
          areaAccent="futuro"
          seed={31}
          width={120}
          height={120}
        />
      </View>

      {/* Pill chip header — sage fill, cream text */}
      <View style={{ flexDirection: 'row', marginBottom: S5 }}>
        <View
          style={{
            backgroundColor: AREA_FUTURO,
            borderRadius: R_PILL,
            paddingHorizontal: S5,
            paddingVertical: S2 + 2,
            alignSelf: 'flex-start',
          }}
        >
          <Text
            style={{
              fontFamily: FONT_SANS,
              fontSize: TYPE_CHIP + 2,
              color: N0,
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}
          >
            Tabla de Contenido
          </Text>
        </View>
      </View>

      {/* Two-column TOC grid */}
      <View style={{ flexDirection: 'row', gap: S6, flexGrow: 1 }}>
        {([left, right] as typeof entries[]).map((column, ci) => (
          <View key={`col-${ci}`} style={{ flex: 1, flexDirection: 'column' }}>
            {column.map((entry, ei) => {
              // Section-level entries (uppercase = true) get a subtle sage pill
              const isSectionEntry = entry.uppercase;
              return (
                <View
                  key={`entry-${ci}-${ei}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-end',
                    paddingVertical: isSectionEntry ? S2 : S1 + 2,
                    borderBottomWidth: isSectionEntry ? 0 : 0,
                  }}
                >
                  {/* Section indicator pill for uppercase entries */}
                  {isSectionEntry ? (
                    <View
                      style={{
                        backgroundColor: N50,
                        borderLeftWidth: 2,
                        borderLeftStyle: 'solid',
                        borderLeftColor: AREA_FUTURO,
                        paddingHorizontal: S2,
                        paddingVertical: S1,
                        marginRight: S2,
                        alignSelf: 'center',
                      }}
                    />
                  ) : null}

                  {/* Label */}
                  <Text
                    style={{
                      fontFamily: isSectionEntry ? FONT_SANS : FONT_SANS,
                      fontWeight: isSectionEntry ? 'bold' : 'normal',
                      fontSize: isSectionEntry ? TYPE_BODY : TYPE_BODY - 1,
                      color: isSectionEntry ? N1000 : N700,
                      textTransform: isSectionEntry ? 'uppercase' : 'none',
                      letterSpacing: isSectionEntry ? 0.5 : 0,
                      flexShrink: 1,
                    }}
                  >
                    {entry.label}
                  </Text>

                  {/* Dotted leader */}
                  <View
                    style={{
                      flexGrow: 1,
                      borderBottomWidth: 0.5,
                      borderBottomStyle: 'dotted',
                      borderBottomColor: N300,
                      marginHorizontal: S2,
                      alignSelf: 'flex-end',
                      height: 1,
                      bottom: 3,
                      minWidth: 8,
                    }}
                  />

                  {/* Page reference — placeholder dashes when page = 1 (default from buildTocEntries) */}
                  <Text
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: TYPE_CAPTION + 1,
                      color: isSectionEntry ? GOLD_500 : GOLD_400,
                      minWidth: 20,
                      textAlign: 'right',
                    }}
                  >
                    {entry.page > 1 ? String(entry.page) : '—'}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>

      {/* Bottom rule + 1+1 generation tag */}
      <View
        style={{
          position: 'absolute',
          bottom: PAGE_MARGIN + S6 + 20,
          left: PAGE_MARGIN,
        }}
      >
        <Text
          style={{
            fontFamily: FONT_MONO,
            fontSize: TYPE_CAPTION,
            color: N300,
            letterSpacing: 0.5,
          }}
        >
          1+1 — Plataforma Contable y Tributaria Colombia
        </Text>
      </View>

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Contenidos" />
    </Page>
  );
}
