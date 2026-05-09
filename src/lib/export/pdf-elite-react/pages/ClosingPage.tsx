// pages/ClosingPage.tsx — back cover with emphasis paragraphs (NIA 706),
// disclaimer, dynamic signature block, and watermark.
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
  // Bloque de firma dinamico — viene de signatories (canonico) o legacy.
  // Si todos los slots son null, `rendered` ya trae las lineas placeholder.
  const signatureLines = (doc.signatureBlock?.rendered ?? '').split('\n');
  const emphasis = doc.emphasisParagraphs ?? [];

  return (
    <Page
      size="A4"
      style={{
        backgroundColor: N0,
        paddingHorizontal: 48,
        paddingTop: 64,
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
        {/* Parrafos de Enfasis / Otras Cuestiones (NIA 706 §A1, §8-9).
            Posicion: post-opinion, ANTES del disclaimer y firmas. */}
        {emphasis.length > 0 ? (
          <View style={{ maxWidth: 460, marginBottom: 32, width: '100%' }}>
            {emphasis.map((p, i) => (
              <View
                key={`emp-${i}`}
                style={{
                  marginBottom: 16,
                  borderLeftWidth: 2,
                  borderLeftStyle: 'solid',
                  borderLeftColor: N1000,
                  paddingLeft: 12,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Geist',
                    fontSize: 10,
                    fontWeight: 700,
                    color: N1000,
                    marginBottom: 4,
                  }}
                >
                  {p.heading}
                </Text>
                <Text
                  style={{
                    fontFamily: 'Geist',
                    fontSize: 9,
                    color: N700,
                    lineHeight: 1.55,
                  }}
                >
                  {p.bodyMarkdown}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Legal disclaimer */}
        <View style={{ maxWidth: 400, marginBottom: 48 }}>
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

        {/* Signature block — render dinamico desde signatureBlock.rendered.
            Cada linea se renderiza tal cual; las lineas que son '__________________________________'
            se estilizan como linea de firma. */}
        <View style={{ width: '100%', maxWidth: 460, alignItems: 'center' }}>
          {signatureLines.map((line, i) => {
            const isUnderline = /^_{20,}$/.test(line.trim());
            const isEmpty = line.trim().length === 0;
            if (isEmpty) {
              return <View key={`sig-${i}`} style={{ height: 8 }} />;
            }
            if (isUnderline) {
              return (
                <View
                  key={`sig-${i}`}
                  style={{
                    width: 220,
                    borderTopWidth: 0.5,
                    borderTopColor: N1000,
                    marginTop: 12,
                  }}
                />
              );
            }
            return (
              <Text
                key={`sig-${i}`}
                style={{
                  fontFamily: 'Geist',
                  fontSize: 9,
                  color: N700,
                  textAlign: 'center',
                  lineHeight: 1.4,
                }}
              >
                {line}
              </Text>
            );
          })}
        </View>

        {/* Generation timestamp + integrity hash placeholder */}
        <View style={{ marginTop: 48, alignItems: 'center' }}>
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
