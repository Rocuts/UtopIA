import * as React from 'react';
import type { AnomalyPayload } from '@/lib/notifications/types';

const GOLD = '#D4A017';
const DARK = '#0a0a0a';
const CARD = '#141414';
const TEXT = '#e5e5e5';

const SEVERITY_COLOR: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e',
};

export interface AnomalyDetectedEmailProps {
  payload: AnomalyPayload;
  unsubscribeUrl: string;
}

export function AnomalyDetectedEmail({
  payload,
  unsubscribeUrl,
}: AnomalyDetectedEmailProps): React.ReactElement {
  const { workspaceName, periodLabel, anomalyKind, description, severity, reviewUrl } = payload;
  const accent = SEVERITY_COLOR[severity] ?? GOLD;
  const severityLabel = severity === 'high' ? 'ALTA' : severity === 'medium' ? 'MEDIA' : 'BAJA';

  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <title>🔍 Anomalía Detectada — {workspaceName}</title>
      </head>
      <body style={{ margin: 0, background: DARK, fontFamily: 'Arial, sans-serif', color: TEXT }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ background: DARK, padding: '40px 16px' }}>
          <tbody>
            <tr>
              <td align="center">
                <table width="520" cellPadding={0} cellSpacing={0} style={{ maxWidth: '520px', background: CARD, borderRadius: '12px', border: '1px solid #2a2a2a', overflow: 'hidden' }}>
                  <tbody>
                    <tr>
                      <td style={{ borderBottom: `3px solid ${accent}`, padding: '24px 28px 18px', background: '#111' }}>
                        <h1 style={{ margin: 0, color: accent, fontSize: '20px', fontWeight: 800 }}>
                          🔍 Anomalía Detectada
                        </h1>
                        <p style={{ margin: '6px 0 0', color: '#aaa', fontSize: '13px' }}>
                          {workspaceName} · {periodLabel} ·{' '}
                          <span style={{ color: accent, fontWeight: 700 }}>Severidad {severityLabel}</span>
                        </p>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '24px 28px' }}>
                        <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          Tipo: {anomalyKind}
                        </p>
                        <p style={{ margin: '0 0 20px', fontSize: '14px', lineHeight: 1.7, color: '#ccc' }}>
                          {description}
                        </p>
                        <a href={reviewUrl} style={{ display: 'inline-block', padding: '10px 22px', background: GOLD, color: '#000', fontWeight: 700, fontSize: '13px', textDecoration: 'none', borderRadius: '6px' }}>
                          Revisar Anomalía
                        </a>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '16px 28px', background: '#0d0d0d', borderTop: '1px solid #1e1e1e' }}>
                        <p style={{ margin: 0, color: '#555', fontSize: '11px' }}>
                          <a href={unsubscribeUrl} style={{ color: '#555', textDecoration: 'underline' }}>Cancelar suscripción</a>
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
