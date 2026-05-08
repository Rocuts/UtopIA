// pages/ClosingPage.tsx — back cover with disclaimer + signature block + watermark.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import { WatermarkWord } from '../primitives';
import { N0, N300, N600, N700, N1000 } from '../tokens';

interface Props {
  doc: EditorialReport;
}

const DISCLAIMER_ES = `Este informe ha sido generado por UtopIA mediante la orquestación de agentes especializados en NIIF para Pymes (Decreto 2420/2015), Estatuto Tributario colombiano y normativa contable vigente al ${''}cierre del periodo. Su contenido constituye un análisis informativo y NO sustituye el dictamen de un Contador Público autorizado ni la asesoría legal independiente. La emisión final del estado financiero requiere la firma y responsabilidad del Contador y, cuando aplique, del Revisor Fiscal de la entidad.`;

export function ClosingPage({ doc }: Props) {
  return (
    <Page
      size="A4"
      style={{
        backgroundColor: N0,
        paddingHorizontal: 48,
        paddingTop: 96,
        paddingBottom: 96,
        position: 'relative',
      }}
    >
      <View
        style={{
          flex: 1,
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {/* Legal disclaimer */}
        <View style={{ maxWidth: 400, marginBottom: 64 }}>
          <Text
            style={{
              fontFamily: 'Geist',
              fontSize: 9,
              color: N600,
              textAlign: 'center',
              lineHeight: 1.6,
            }}
          >
            {DISCLAIMER_ES}
          </Text>
        </View>

        {/* Signature block */}
        <View
          style={{
            flexDirection: 'row',
            gap: 24,
            width: '100%',
            maxWidth: 460,
          }}
        >
          <View style={{ flex: 1, alignItems: 'center' }}>
            <View
              style={{
                width: '100%',
                borderTopWidth: 0.5,
                borderTopColor: N1000,
                marginBottom: 6,
                paddingTop: 6,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Geist',
                  fontSize: 8,
                  color: N700,
                  textAlign: 'center',
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                Contador
              </Text>
            </View>
            <Text
              style={{
                fontFamily: 'Geist',
                fontSize: 8,
                color: N300,
                textAlign: 'center',
                marginTop: 4,
              }}
            >
              T.P. ____________________
            </Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <View
              style={{
                width: '100%',
                borderTopWidth: 0.5,
                borderTopColor: N1000,
                marginBottom: 6,
                paddingTop: 6,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Geist',
                  fontSize: 8,
                  color: N700,
                  textAlign: 'center',
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                Revisor Fiscal
              </Text>
            </View>
            <Text
              style={{
                fontFamily: 'Geist',
                fontSize: 8,
                color: N300,
                textAlign: 'center',
                marginTop: 4,
              }}
            >
              T.P. ____________________
            </Text>
          </View>
        </View>

        {/* Generation timestamp + integrity hash placeholder */}
        <View style={{ marginTop: 64, alignItems: 'center' }}>
          <Text
            style={{
              fontFamily: 'Geist Mono',
              fontSize: 7,
              color: N300,
            }}
          >
            Generado: {doc.meta.generatedAt}
          </Text>
          <Text
            style={{
              fontFamily: 'Geist Mono',
              fontSize: 7,
              color: N300,
              marginTop: 2,
            }}
          >
            (integrity hash)
          </Text>
        </View>
      </View>

      {/* Watermark */}
      <View
        style={{
          position: 'absolute',
          bottom: 24,
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
      >
        <WatermarkWord text="Confianza" opacity={0.06} />
      </View>
    </Page>
  );
}
