// pages/CoverPage.tsx — full-bleed espresso cover with editorial title + watermark.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import {
  EditorialTitle,
  AuthorityChip,
  TopoOrnament,
  WatermarkWord,
} from '../primitives';
import { N0, N100, N300, N1000, GOLD_500, WINE_500 } from '../tokens';

interface Props {
  doc: EditorialReport;
}

export function CoverPage({ doc }: Props) {
  const isBlocked = doc.meta.watermark === 'BLOQUEADO';

  return (
    <Page
      size="A4"
      style={{
        backgroundColor: N1000,
        position: 'relative',
        padding: 0,
      }}
    >
      {/* Topographic ornament background */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      >
        <TopoOrnament
          variant="ribbons"
          opacity={0.1}
          areaAccent={doc.cover.accentArea}
          seed={42}
        />
      </View>

      {/* Title block — vertically centered */}
      <View
        style={{
          flex: 1,
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 64,
          paddingTop: 96,
          paddingBottom: 96,
        }}
      >
        {isBlocked ? (
          <>
            <EditorialTitle
              leadText="Informe"
              emphasisText="BLOQUEADO"
              emphasisStyle="box"
              areaAccent="escudo"
              size="hero"
              tone="light-on-dark"
            />
            {/* Vertical stack of bordeaux warnings */}
            <View style={{ marginTop: 32, width: '100%', maxWidth: 460 }}>
              {(doc.appendix.validationWarnings ?? []).map((w, i) => (
                <View
                  key={`warn-${i}`}
                  style={{
                    borderLeftWidth: 3,
                    borderLeftStyle: 'solid',
                    borderLeftColor: WINE_500,
                    paddingLeft: 12,
                    paddingVertical: 6,
                    marginBottom: 8,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'Geist',
                      fontSize: 10,
                      color: N100,
                    }}
                  >
                    {w}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <EditorialTitle
            leadText="Reporte"
            emphasisText="NIIF Élite"
            emphasisStyle="box"
            areaAccent={doc.cover.accentArea}
            size="hero"
            tone="light-on-dark"
          />
        )}

        {/* Company / NIT / period */}
        <View
          style={{
            marginTop: 48,
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Text
            style={{
              fontFamily: 'Geist',
              fontSize: 14,
              color: GOLD_500,
              letterSpacing: 0.5,
            }}
          >
            {doc.meta.companyName}
          </Text>
          <AuthorityChip label={`NIT ${doc.meta.nit}`} tone="gold" />
          <Text
            style={{
              fontFamily: 'Geist',
              fontSize: 11,
              color: N100,
              marginTop: 4,
            }}
          >
            Periodo {doc.meta.fiscalPeriod}
            {doc.meta.comparativePeriod
              ? `  vs  ${doc.meta.comparativePeriod}`
              : ''}
          </Text>
          <Text
            style={{
              fontFamily: 'Geist',
              fontSize: 9,
              color: N300,
            }}
          >
            Generado: {doc.meta.generatedAt}
          </Text>
        </View>
      </View>

      {/* Bottom-right watermark */}
      <View
        style={{
          position: 'absolute',
          bottom: 16,
          right: 24,
        }}
      >
        <WatermarkWord text="UtopIA" opacity={0.12} />
      </View>
    </Page>
  );
}
