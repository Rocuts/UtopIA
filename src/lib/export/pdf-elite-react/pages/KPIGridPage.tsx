// pages/KPIGridPage.tsx — 4×3 KPI grid with delta pills.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport, KpiCell } from '../types';
import { EditorialTitle, PaginationFooter } from '../primitives';
import {
  N0,
  N50,
  N200,
  N500,
  N600,
  N1000,
  AREA_VALOR,
  AREA_FUTURO,
  GOLD_400,
  WINE_500,
} from '../tokens';

interface Props {
  doc: EditorialReport;
}

function statusColors(status: KpiCell['status']): {
  bg: string;
  fg: string;
} {
  switch (status) {
    case 'positive':
      return { bg: AREA_VALOR, fg: N0 };
    case 'warning':
      return { bg: GOLD_400, fg: N1000 };
    case 'critical':
      return { bg: WINE_500, fg: N0 };
    case 'neutral':
    default:
      return { bg: N200, fg: N1000 };
  }
}

function formatDelta(deltaPct?: number): string | null {
  if (deltaPct === undefined || deltaPct === null) return null;
  const sign = deltaPct >= 0 ? '+' : '';
  return `${sign}${deltaPct.toFixed(1)}%`;
}

export function KPIGridPage({ doc }: Props) {
  // Cap at 12 KPIs (4 cols × 3 rows)
  const kpis = doc.kpiGrid.kpis.slice(0, 12);

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
        leadText="Indicadores"
        emphasisText="clave"
        emphasisStyle="italic"
        areaAccent="valor"
        size="page"
        tone="dark-on-light"
      />

      <View
        style={{
          marginTop: 32,
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {kpis.map((kpi, i) => {
          const colors = statusColors(kpi.status);
          const delta = formatDelta(kpi.deltaPct);
          return (
            <View
              key={`kpi-${i}`}
              style={{
                flexBasis: '24%',
                borderWidth: 0.5,
                borderColor: N200,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Geist',
                  fontSize: 7,
                  color: N600,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                {kpi.label}
              </Text>
              <Text
                style={{
                  fontFamily: 'Fraunces',
                  fontWeight: 700,
                  fontSize: 18,
                  color: N1000,
                }}
              >
                {kpi.value}
              </Text>
              {kpi.unit && (
                <Text
                  style={{
                    fontFamily: 'Geist Mono',
                    fontSize: 8,
                    color: N500,
                    marginTop: 2,
                  }}
                >
                  {kpi.unit}
                </Text>
              )}
              {delta && (
                <View
                  style={{
                    marginTop: 8,
                    flexDirection: 'row',
                  }}
                >
                  <View
                    style={{
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      backgroundColor: colors.bg,
                      borderRadius: 4,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: 'Geist Mono',
                        fontSize: 7,
                        color: colors.fg,
                      }}
                    >
                      {delta}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </View>

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Indicadores" />
    </Page>
  );
}
