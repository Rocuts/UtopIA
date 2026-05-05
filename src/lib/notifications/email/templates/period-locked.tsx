import * as React from 'react';
import type { PeriodLockedPayload } from '@/lib/notifications/types';

// ─── Tokens ─────────────────────────────────────────────────────────────────
const GOLD = '#D4A017';
const DARK = '#0a0a0a';
const CARD = '#141414';
const TEXT = '#e5e5e5';
const MUTED = '#888888';
const AMBER = '#f59e0b';

// ─── Shared primitives ───────────────────────────────────────────────────────

const btn = (href: string, label: string) => (
  <a
    href={href}
    style={{
      display: 'inline-block',
      padding: '10px 22px',
      background: GOLD,
      color: '#000',
      fontWeight: 700,
      fontSize: '13px',
      textDecoration: 'none',
      borderRadius: '6px',
      letterSpacing: '0.03em',
    }}
  >
    {label}
  </a>
);

const pillarRow = (label: string, value: string) => (
  <tr key={label}>
    <td
      style={{
        padding: '10px 16px',
        color: MUTED,
        fontSize: '12px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        borderBottom: '1px solid #222',
      }}
    >
      {label}
    </td>
    <td
      style={{
        padding: '10px 16px',
        color: TEXT,
        fontSize: '14px',
        fontWeight: 500,
        textAlign: 'right',
        borderBottom: '1px solid #222',
      }}
    >
      {value}
    </td>
  </tr>
);

// ─── Component ───────────────────────────────────────────────────────────────

export interface PeriodLockedEmailProps {
  payload: PeriodLockedPayload;
  unsubscribeUrl: string;
}

export function PeriodLockedEmail({
  payload,
  unsubscribeUrl,
}: PeriodLockedEmailProps): React.ReactElement {
  const {
    workspaceName,
    periodLabel,
    periodHash,
    withWarnings,
    overrideReason,
    pillars,
    links,
  } = payload;

  const title = withWarnings
    ? '⚠️ 1+1 | Cierre de Mes con Salvedades'
    : '🛡️ 1+1 | Cierre de Mes Exitoso';

  const bodyText = withWarnings
    ? `el ciclo contable de <strong>${workspaceName}</strong> ha sido cerrado con salvedades. Revisa las advertencias antes de distribuir los estados financieros. Período: <strong>${periodLabel}</strong> — Estatus: <strong>CERRADO CON SALVEDADES ⚠️</strong>.`
    : `el ciclo contable de <strong>${workspaceName}</strong> ha sido cerrado y blindado. Tu Verdad Financiera está lista para revisión. Período: <strong>${periodLabel}</strong> — Estatus: <strong>BLOQUEADO 🔒</strong>.`;

  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
      </head>
      <body
        style={{
          margin: 0,
          padding: 0,
          background: DARK,
          fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
          color: TEXT,
        }}
      >
        {/* Wrapper */}
        <table
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ background: DARK, padding: '40px 16px' }}
        >
          <tbody>
            <tr>
              <td align="center">
                {/* Card */}
                <table
                  width="560"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{
                    maxWidth: '560px',
                    width: '100%',
                    background: CARD,
                    borderRadius: '12px',
                    overflow: 'hidden',
                    border: '1px solid #2a2a2a',
                  }}
                >
                  <tbody>
                    {/* Header */}
                    <tr>
                      <td
                        style={{
                          background: '#111',
                          borderBottom: `3px solid ${GOLD}`,
                          padding: '28px 32px 20px',
                        }}
                      >
                        <p
                          style={{
                            margin: 0,
                            color: GOLD,
                            fontSize: '11px',
                            fontWeight: 700,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                          }}
                        >
                          Plataforma Contable · Colombia 2026
                        </p>
                        <h1
                          style={{
                            margin: '8px 0 0',
                            color: '#fff',
                            fontSize: '22px',
                            fontWeight: 800,
                            lineHeight: 1.3,
                          }}
                        >
                          {title}
                        </h1>
                      </td>
                    </tr>

                    {/* Warning banner (conditional) */}
                    {withWarnings && overrideReason && (
                      <tr>
                        <td
                          style={{
                            background: '#1a1200',
                            borderLeft: `4px solid ${AMBER}`,
                            padding: '12px 32px',
                          }}
                        >
                          <p
                            style={{
                              margin: 0,
                              color: AMBER,
                              fontSize: '13px',
                              fontWeight: 600,
                            }}
                          >
                            Motivo de salvedad: {overrideReason}
                          </p>
                        </td>
                      </tr>
                    )}

                    {/* Body text */}
                    <tr>
                      <td style={{ padding: '28px 32px 20px' }}>
                        <p
                          style={{ margin: 0, fontSize: '15px', lineHeight: 1.7, color: TEXT }}
                          dangerouslySetInnerHTML={{ __html: `Hola, ${bodyText}` }}
                        />
                      </td>
                    </tr>

                    {/* Pillar KPI table */}
                    <tr>
                      <td style={{ padding: '0 32px 28px' }}>
                        <table
                          width="100%"
                          cellPadding={0}
                          cellSpacing={0}
                          style={{
                            background: '#0e0e0e',
                            borderRadius: '8px',
                            border: '1px solid #222',
                            overflow: 'hidden',
                          }}
                        >
                          <thead>
                            <tr>
                              <th
                                colSpan={2}
                                style={{
                                  padding: '12px 16px',
                                  background: '#181818',
                                  color: GOLD,
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  letterSpacing: '0.1em',
                                  textTransform: 'uppercase',
                                  textAlign: 'left',
                                  borderBottom: '1px solid #222',
                                }}
                              >
                                KPIs de los 4 Pilares
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {pillarRow(
                              '🛡️ Resiliencia — Provisión Impuestos',
                              pillars.resiliencia.totalProvisionTaxesCop,
                            )}
                            {pillarRow(
                              '💰 Valor — EBITDA',
                              pillars.valor.ebitdaCop,
                            )}
                            {pillarRow(
                              '✅ Verdad — Docs Verificados',
                              `${pillars.verdad.documentsVerifiedPct.toFixed(1)}%`,
                            )}
                            {pillarRow(
                              '🚀 Futuro — Free Cash Flow',
                              pillars.futuro.freeCashFlowProjectedCop,
                            )}
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* CTAs */}
                    <tr>
                      <td style={{ padding: '0 32px 32px' }}>
                        <table cellPadding={0} cellSpacing={0}>
                          <tbody>
                            <tr>
                              <td style={{ paddingRight: '10px' }}>
                                {btn(links.viewReportUrl, 'Ver Informe NIIF')}
                              </td>
                              <td style={{ paddingRight: '10px' }}>
                                {btn(links.shareReportUrl, 'Compartir')}
                              </td>
                              <td>
                                {btn(links.viewAnomaliesUrl, 'Explorar Anomalías')}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* Footer */}
                    <tr>
                      <td
                        style={{
                          padding: '20px 32px',
                          background: '#0d0d0d',
                          borderTop: '1px solid #1e1e1e',
                        }}
                      >
                        <p
                          style={{
                            margin: '0 0 6px',
                            color: MUTED,
                            fontSize: '11px',
                            fontFamily: 'monospace',
                          }}
                        >
                          Hash de integridad: {periodHash.slice(0, 16)}…
                        </p>
                        <p style={{ margin: 0, color: '#555', fontSize: '11px' }}>
                          Período: {periodLabel} ·{' '}
                          <a
                            href={unsubscribeUrl}
                            style={{ color: '#555', textDecoration: 'underline' }}
                          >
                            Cancelar suscripción
                          </a>
                        </p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}
