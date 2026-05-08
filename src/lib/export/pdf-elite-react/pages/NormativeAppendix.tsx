// pages/NormativeAppendix.tsx — adjustments table + warnings + binding totals.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport, AdjustmentRow } from '../types';
import { EditorialTitle, PaginationFooter } from '../primitives';
import {
  N0,
  N50,
  N100,
  N200,
  N300,
  N700,
  N1000,
  WINE_500,
  R_LG,
} from '../tokens';

interface Props {
  doc: EditorialReport;
}

function formatCOP(amount: number): string {
  const abs = Math.abs(Math.round(amount));
  const sign = amount < 0 ? '(' : '';
  const close = amount < 0 ? ')' : '';
  const withThousands = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${withThousands}${close}`;
}

interface AdjustmentsTableProps {
  rows: AdjustmentRow[];
}

function AdjustmentsTable({ rows }: AdjustmentsTableProps) {
  // Columns: Cuenta (15%), Descripción (50%), Ajuste (20%, right), Norma (15%)
  const headers = ['Cuenta', 'Descripción', 'Ajuste (COP)', 'Norma'];
  const widths = ['15%', '50%', '20%', '15%'] as const;

  return (
    <View style={{ flexDirection: 'column' }}>
      <View
        style={{
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: N1000,
          paddingVertical: 6,
        }}
      >
        {headers.map((h, i) => (
          <View
            key={`adj-hdr-${i}`}
            style={{ flexBasis: widths[i], paddingHorizontal: 6 }}
          >
            <Text
              style={{
                fontFamily: 'Geist',
                fontWeight: 700,
                fontSize: 8,
                color: N1000,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                textAlign: i === 2 ? 'right' : 'left',
              }}
            >
              {h}
            </Text>
          </View>
        ))}
      </View>
      {rows.map((r, i) => (
        <View
          key={`adj-row-${i}`}
          style={{
            flexDirection: 'row',
            paddingVertical: 4,
            backgroundColor: i % 2 === 1 ? N100 : 'transparent',
            borderTopWidth: 0.25,
            borderTopColor: N300,
          }}
        >
          <View style={{ flexBasis: widths[0], paddingHorizontal: 6 }}>
            <Text
              style={{ fontFamily: 'Geist Mono', fontSize: 8, color: N1000 }}
            >
              {r.cuenta}
            </Text>
          </View>
          <View style={{ flexBasis: widths[1], paddingHorizontal: 6 }}>
            <Text style={{ fontFamily: 'Geist', fontSize: 8, color: N1000 }}>
              {r.descripcion}
            </Text>
          </View>
          <View style={{ flexBasis: widths[2], paddingHorizontal: 6 }}>
            <Text
              style={{
                fontFamily: 'Geist Mono',
                fontSize: 8,
                color: r.ajuste < 0 ? WINE_500 : N1000,
                textAlign: 'right',
              }}
            >
              {formatCOP(r.ajuste)}
            </Text>
          </View>
          <View style={{ flexBasis: widths[3], paddingHorizontal: 6 }}>
            <Text style={{ fontFamily: 'Geist', fontSize: 8, color: N700 }}>
              {r.norma ?? ''}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function NormativeAppendix({ doc }: Props) {
  const apx = doc.appendix;

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
        leadText="Anexo"
        emphasisText="normativo"
        emphasisStyle="box"
        areaAccent="verdad"
        size="page"
        tone="dark-on-light"
      />

      {/* (a) adjustments table */}
      {apx.adjustmentsTable && apx.adjustmentsTable.length > 0 && (
        <View style={{ marginTop: 24 }} wrap>
          <Text
            style={{
              fontFamily: 'Fraunces',
              fontWeight: 700,
              fontSize: 12,
              color: N1000,
              marginBottom: 8,
            }}
          >
            Ajustes contables
          </Text>
          <AdjustmentsTable rows={apx.adjustmentsTable} />
        </View>
      )}

      {/* (b) validation warnings */}
      {apx.validationWarnings && apx.validationWarnings.length > 0 && (
        <View style={{ marginTop: 32 }} wrap>
          <Text
            style={{
              fontFamily: 'Fraunces',
              fontWeight: 700,
              fontSize: 12,
              color: N1000,
              marginBottom: 8,
            }}
          >
            Observaciones de validación
          </Text>
          <View>
            {apx.validationWarnings.map((w, i) => (
              <View
                key={`warn-${i}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  marginBottom: 4,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Geist',
                    fontSize: 9,
                    color: WINE_500,
                    marginRight: 6,
                  }}
                >
                  •
                </Text>
                <Text
                  style={{
                    fontFamily: 'Geist',
                    fontSize: 9,
                    color: N1000,
                    flex: 1,
                  }}
                >
                  {w}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* (c) binding totals */}
      {apx.bindingTotalsBlock && (
        <View style={{ marginTop: 32 }} wrap>
          <Text
            style={{
              fontFamily: 'Fraunces',
              fontWeight: 700,
              fontSize: 12,
              color: N1000,
              marginBottom: 8,
            }}
          >
            Totales vinculantes
          </Text>
          <View
            style={{
              backgroundColor: N50,
              borderRadius: R_LG,
              padding: 12,
              borderWidth: 0.5,
              borderColor: N200,
            }}
          >
            <Text
              style={{
                fontFamily: 'Geist Mono',
                fontSize: 8,
                color: N1000,
                lineHeight: 1.5,
              }}
            >
              {apx.bindingTotalsBlock}
            </Text>
          </View>
        </View>
      )}

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Anexo" />
    </Page>
  );
}
