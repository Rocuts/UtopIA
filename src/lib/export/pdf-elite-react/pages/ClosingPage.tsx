// pages/ClosingPage.tsx — forest background back-cover, ESLOP editorial style.
// Layout:
//   - Forest (N1000) background.
//   - Topo 'corner' decorations at low opacity (top-right + bottom-left).
//   - Centered EditorialTitle "Gracias por confiar" with sage on "por confiar".
//   - UtopIA platform credit block in sand.
//   - 3-column signatories row (niifAnalyst / strategyDirector / governanceSpecialist)
//     sourced from directorLetter portrait + signerName/signerRole + fixed UtopIA team.
//   - Bottom sand pill with disclaimer text in small caps monospace.
//   - Emphasis paragraphs (NIA 706 §A1) rendered above disclaimer when present.
//   - GoldRule (via PaginationFooter) + PageNumberBadge.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import {
  EditorialTitle,
  AvatarInitials,
  TopoOrnament,
  PaginationFooter,
} from '../primitives';
import {
  N0,
  N300,
  N400,
  N1000,
  GOLD_400,
  AREA_FUTURO,
  FONT_SANS,
  FONT_DISPLAY,
  FONT_MONO,
  PAGE_W,
  PAGE_H,
  PAGE_MARGIN,
  TYPE_BODY,
  TYPE_CAPTION,
  S1,
  S2,
  S3,
  S4,
  S5,
  S6,
  R_PILL,
  R_LG,
} from '../tokens';

interface Props {
  doc: EditorialReport;
}

// Disclaimer text — Capa 3 Élite: invokes fundamental Ley 43/1990 framing.
const DISCLAIMER_ES =
  'Este informe ha sido generado por 1+1 mediante la orquestación de agentes especializados ' +
  'en NIIF para Pymes (Decreto 2420/2015), Estatuto Tributario colombiano y normativa contable ' +
  'vigente al cierre del periodo. Su contenido constituye un análisis informativo y NO sustituye ' +
  'el dictamen de un Contador Público autorizado (Ley 43/1990) ni la asesoría legal independiente. ' +
  'La emisión final requiere la firma del Contador y, cuando aplique, del Revisor Fiscal.';

interface SignatorySlot {
  initials: string;
  name: string;
  role: string;
}

const FALLBACK_SIGNATORIES: [SignatorySlot, SignatorySlot, SignatorySlot] = [
  { initials: 'NA', name: 'Analista NIIF', role: 'NIIF Analyst · 1+1' },
  { initials: 'SD', name: 'Director Estratégico', role: 'Strategy Director · 1+1' },
  { initials: 'GS', name: 'Especialista Gobierno', role: 'Governance Specialist · 1+1' },
];

function buildSignatories(doc: EditorialReport): [SignatorySlot, SignatorySlot, SignatorySlot] {
  // Use directorLetter signer for the first slot; fallback pair for the others.
  const dl = doc.directorLetter;
  const nameParts = dl.signerName.trim().split(/\s+/).filter(Boolean);
  const inits =
    nameParts.length >= 2
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
      : nameParts[0]?.slice(0, 2).toUpperCase() ?? 'EU';

  return [
    { initials: inits, name: dl.signerName, role: dl.signerRole },
    FALLBACK_SIGNATORIES[1],
    FALLBACK_SIGNATORIES[2],
  ];
}

const DISC_SIZE = 40;

export function ClosingPage({ doc }: Props) {
  const signatories = buildSignatories(doc);
  const emphasis = doc.emphasisParagraphs ?? [];
  const signatureLines = (doc.signatureBlock?.rendered ?? '').split('\n');
  const hasSignatureBlock = signatureLines.some(l => l.trim().length > 0);

  return (
    <Page
      size="A4"
      orientation="landscape"
      style={{
        backgroundColor: N1000,
        paddingHorizontal: PAGE_MARGIN,
        paddingTop: PAGE_MARGIN,
        paddingBottom: PAGE_MARGIN + S6,
        position: 'relative',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* Topo corner-tr decoration */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: PAGE_W * 0.45,
          height: PAGE_H * 0.4,
          opacity: 0.08,
        }}
      >
        <TopoOrnament
          variant="ribbons"
          opacity={1}
          areaAccent="valor"
          seed={21}
          width={PAGE_W * 0.45}
          height={PAGE_H * 0.4}
        />
      </View>

      {/* Topo corner-bl decoration */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: PAGE_W * 0.45,
          height: PAGE_H * 0.4,
          opacity: 0.08,
        }}
      >
        <TopoOrnament
          variant="lines"
          opacity={1}
          areaAccent="futuro"
          seed={88}
          width={PAGE_W * 0.45}
          height={PAGE_H * 0.4}
        />
      </View>

      {/* Center layout column */}
      <View
        style={{
          flex: 1,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
        }}
      >
        {/* Main title — centered */}
        <View style={{ alignItems: 'center', marginBottom: S5 }}>
          <EditorialTitle
            leadText="Gracias"
            emphasisText="por confiar"
            emphasisStyle="box"
            areaAccent="futuro"
            size="hero"
            tone="light-on-dark"
          />
        </View>

        {/* 1+1 platform credit */}
        <View style={{ alignItems: 'center', marginBottom: S6 }}>
          <Text
            style={{
              fontFamily: FONT_SANS,
              fontSize: TYPE_BODY,
              color: GOLD_400,
              textAlign: 'center',
            }}
          >
            Generado por 1+1 — Plataforma Contable y Tributaria Colombia 2026
          </Text>
        </View>

        {/* Emphasis paragraphs (NIA 706 §A1) — post-opinion, before disclaimer */}
        {emphasis.length > 0 ? (
          <View style={{ maxWidth: 440, marginBottom: S5, width: '100%' }}>
            {emphasis.map((p, i) => (
              <View
                key={`emp-${i}`}
                style={{
                  marginBottom: S4,
                  borderLeftWidth: 2,
                  borderLeftStyle: 'solid',
                  borderLeftColor: AREA_FUTURO,
                  paddingLeft: S3,
                }}
              >
                <Text
                  style={{
                    fontFamily: FONT_SANS,
                    fontWeight: 'bold',
                    fontSize: 9,
                    color: N0,
                    marginBottom: S1 + 1,
                  }}
                >
                  {p.heading}
                </Text>
                <Text
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 8,
                    color: N300,
                    lineHeight: 1.55,
                  }}
                >
                  {p.bodyMarkdown}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* 3-column signatories row */}
        <View
          style={{
            flexDirection: 'row',
            gap: S5,
            marginBottom: S6,
            justifyContent: 'center',
          }}
        >
          {signatories.map((sig, i) => (
            <View
              key={`sig-${i}`}
              style={{
                alignItems: 'center',
                gap: S2,
                width: 110,
              }}
            >
              <View
                style={{
                  width: DISC_SIZE,
                  height: DISC_SIZE,
                  borderRadius: R_PILL,
                  overflow: 'hidden',
                }}
              >
                <AvatarInitials
                  initials={sig.initials}
                  areaAccent={i === 0 ? 'valor' : i === 1 ? 'verdad' : 'futuro'}
                  size={DISC_SIZE}
                />
              </View>
              <Text
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 'bold',
                  fontSize: 8,
                  color: GOLD_400,
                  textAlign: 'center',
                }}
              >
                {sig.name}
              </Text>
              <Text
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 7,
                  color: AREA_FUTURO,
                  fontStyle: 'italic',
                  textAlign: 'center',
                  lineHeight: 1.3,
                }}
              >
                {sig.role}
              </Text>
            </View>
          ))}
        </View>

        {/* Dynamic signature block from fiscal-opinion signatories */}
        {hasSignatureBlock ? (
          <View style={{ width: '100%', maxWidth: 460, alignItems: 'center', marginBottom: S5 }}>
            {signatureLines.map((line, i) => {
              const isUnderline = /^_{20,}$/.test(line.trim());
              const isEmpty = line.trim().length === 0;
              if (isEmpty) return <View key={`sl-${i}`} style={{ height: 6 }} />;
              if (isUnderline) {
                return (
                  <View
                    key={`sl-${i}`}
                    style={{
                      width: 200,
                      borderTopWidth: 0.5,
                      borderTopColor: N400,
                      marginTop: S3,
                    }}
                  />
                );
              }
              return (
                <Text
                  key={`sl-${i}`}
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 8,
                    color: N300,
                    textAlign: 'center',
                    lineHeight: 1.4,
                  }}
                >
                  {line}
                </Text>
              );
            })}
          </View>
        ) : null}

        {/* Disclaimer pill — sand bg, small caps mono text */}
        <View
          style={{
            backgroundColor: 'rgba(212,184,118,0.12)',
            borderWidth: 0.5,
            borderStyle: 'solid',
            borderColor: GOLD_400,
            borderRadius: R_LG,
            paddingHorizontal: S5,
            paddingVertical: S3,
            maxWidth: 480,
            width: '100%',
          }}
        >
          <Text
            style={{
              fontFamily: FONT_MONO,
              fontSize: 7,
              color: N400,
              textAlign: 'center',
              lineHeight: 1.6,
              letterSpacing: 0.3,
            }}
          >
            {DISCLAIMER_ES}
          </Text>
        </View>

        {/* Generation timestamp */}
        <View style={{ marginTop: S4, alignItems: 'center' }}>
          <Text
            style={{
              fontFamily: FONT_MONO,
              fontSize: TYPE_CAPTION,
              color: N400,
              letterSpacing: 0.5,
            }}
          >
            {doc.meta.generatedAt.slice(0, 10)}
          </Text>
        </View>
      </View>

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Cierre" />
    </Page>
  );
}
