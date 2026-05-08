// pages/TocPage.tsx — Pill chip header + 2-column TOC with dot leaders.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import { PaginationFooter } from '../primitives';
import { N0, N700, N1000, GOLD_500, AREA_VERDAD, R_PILL } from '../tokens';

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
      style={{
        backgroundColor: N0,
        paddingHorizontal: 48,
        paddingTop: 48,
        paddingBottom: 72,
      }}
    >
      {/* Pill chip header */}
      <View style={{ flexDirection: 'row', marginBottom: 32 }}>
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            backgroundColor: AREA_VERDAD,
            borderRadius: R_PILL,
          }}
        >
          <Text
            style={{
              fontFamily: 'Geist',
              fontSize: 10,
              color: N0,
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}
          >
            Tabla de Contenidos
          </Text>
        </View>
      </View>

      {/* Two columns */}
      <View style={{ flexDirection: 'row', gap: 32 }}>
        {[left, right].map((column, ci) => (
          <View key={`col-${ci}`} style={{ flex: 1, flexDirection: 'column' }}>
            {column.map((entry, ei) => (
              <View
                key={`entry-${ci}-${ei}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  paddingVertical: 6,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Geist',
                    fontSize: 9,
                    color: N1000,
                    textTransform: entry.uppercase ? 'uppercase' : 'none',
                    letterSpacing: entry.uppercase ? 1 : 0,
                  }}
                >
                  {entry.label}
                </Text>
                <View
                  style={{
                    flexGrow: 1,
                    borderBottomWidth: 0.5,
                    borderBottomStyle: 'dotted',
                    borderBottomColor: N700,
                    marginHorizontal: 8,
                    alignSelf: 'flex-end',
                    height: 1,
                    bottom: 3,
                  }}
                />
                <Text
                  style={{
                    fontFamily: 'Geist',
                    fontSize: 10,
                    color: GOLD_500,
                  }}
                >
                  {entry.page}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Contenidos" />
    </Page>
  );
}
