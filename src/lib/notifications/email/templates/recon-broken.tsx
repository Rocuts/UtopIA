import * as React from 'react';
import type { ReconBrokenPayload } from '@/lib/notifications/types';

const GOLD = '#D4A017';
const DARK = '#0a0a0a';
const CARD = '#141414';
const TEXT = '#e5e5e5';
const RED = '#ef4444';

export interface ReconBrokenEmailProps {
  payload: ReconBrokenPayload;
  unsubscribeUrl: string;
}

export function ReconBrokenEmail({
  payload,
  unsubscribeUrl,
}: ReconBrokenEmailProps): React.ReactElement {
  const { workspaceName, periodLabel, bankAccountLabel, differenceCop, reviewUrl } = payload;

  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <title>⚠️ Conciliación Bancaria Rota — {workspaceName}</title>
      </head>
      <body style={{ margin: 0, background: DARK, fontFamily: 'Arial, sans-serif', color: TEXT }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ background: DARK, padding: '40px 16px' }}>
          <tbody>
            <tr>
              <td align="center">
                <table width="520" cellPadding={0} cellSpacing={0} style={{ maxWidth: '520px', background: CARD, borderRadius: '12px', border: '1px solid #2a2a2a', overflow: 'hidden' }}>
                  <tbody>
                    <tr>
                      <td style={{ background: '#140000', borderBottom: `3px solid ${RED}`, padding: '24px 28px 18px' }}>
                        <h1 style={{ margin: 0, color: RED, fontSize: '20px', fontWeight: 800 }}>
                          ⚠️ Conciliación Bancaria Rota
                        </h1>
                        <p style={{ margin: '6px 0 0', color: '#aaa', fontSize: '13px' }}>
                          {workspaceName} · {periodLabel}
                        </p>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '24px 28px' }}>
                        <p style={{ margin: '0 0 16px', fontSize: '14px', lineHeight: 1.7 }}>
                          Se detectó una diferencia en la cuenta <strong>{bankAccountLabel}</strong>.<br />
                          Diferencia encontrada: <strong style={{ color: RED }}>{differenceCop}</strong>
                        </p>
                        <a href={reviewUrl} style={{ display: 'inline-block', padding: '10px 22px', background: GOLD, color: '#000', fontWeight: 700, fontSize: '13px', textDecoration: 'none', borderRadius: '6px' }}>
                          Revisar Ahora
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
