/**
 * InsightAlertEmail — React Email template para los insights del Sentinel.
 *
 * Diseño: header con marca UtopIA, banner de color por pilar, secciones
 * separadas para hallazgo + impacto + CTA. Funciona en clientes que no
 * soportan CSS moderno (Outlook, Gmail, etc.) — todos los estilos son inline.
 */

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

import type { Insight } from '@/lib/notifications/insight-types';

const PILLAR_COLORS: Record<Insight['pillar'], { primary: string; soft: string; emoji: string }> = {
  verdad: { primary: '#3D6B7E', soft: '#3D6B7E20', emoji: '⚖️' },
  escudo: { primary: '#A83838', soft: '#A8383820', emoji: '🛡️' },
  valor: { primary: '#B8934A', soft: '#B8934A20', emoji: '💰' },
  futuro: { primary: '#5A7F7A', soft: '#5A7F7A20', emoji: '🚀' },
};

const SEVERITY_LABELS: Record<Insight['severity'], { es: string; en: string; bg: string; fg: string }> = {
  critico: { es: 'CRÍTICO', en: 'CRITICAL', bg: '#A83838', fg: '#FFFFFF' },
  advertencia: { es: 'ADVERTENCIA', en: 'WARNING', bg: '#C48A2E', fg: '#FFFFFF' },
  informativo: { es: 'INFORMATIVO', en: 'INFO', bg: '#3D6B7E', fg: '#FFFFFF' },
};

export interface InsightAlertEmailProps {
  insight: Insight;
  ctaUrl?: string;
  unsubscribeUrl?: string;
}

export function InsightAlertEmail({ insight, ctaUrl, unsubscribeUrl }: InsightAlertEmailProps) {
  const lang = insight.language ?? 'es';
  const isEs = lang === 'es';
  const palette = PILLAR_COLORS[insight.pillar];
  const sev = SEVERITY_LABELS[insight.severity];
  const sevLabel = isEs ? sev.es : sev.en;
  const finalCtaUrl = ctaUrl ?? insight.accionRecomendada.href ?? '#';

  return (
    <Html lang={lang}>
      <Head />
      <Preview>{insight.subject}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          {/* Brand header */}
          <Section style={brandStyle}>
            <Text style={brandTextStyle}>UtopIA · 1+1</Text>
          </Section>

          {/* Pillar banner */}
          <Section style={{ ...bannerStyle, backgroundColor: palette.primary }}>
            <Text style={bannerEmojiStyle}>{palette.emoji}</Text>
            <Text style={bannerLabelStyle}>
              {isEs ? 'Pilar' : 'Pillar'} {capitalize(insight.pillar)}
            </Text>
          </Section>

          {/* Severity badge */}
          <Section style={severityRowStyle}>
            <span style={{ ...severityChipStyle, backgroundColor: sev.bg, color: sev.fg }}>
              {sevLabel}
            </span>
          </Section>

          {/* Subject */}
          <Heading style={headingStyle}>{insight.subject}</Heading>

          {/* Hallazgo */}
          <Section style={{ ...cardStyle, borderLeftColor: palette.primary }}>
            <Text style={labelStyle}>{isEs ? 'Hallazgo' : 'Finding'}</Text>
            <Text style={bodyTextStyle}>{insight.hallazgo}</Text>
          </Section>

          {/* Impacto */}
          <Section style={{ ...cardStyle, borderLeftColor: '#C48A2E' }}>
            <Text style={labelStyle}>{isEs ? 'Impacto Económico' : 'Economic Impact'}</Text>
            <Text style={bodyTextStyle}>{insight.impacto}</Text>
          </Section>

          {/* CTA */}
          <Section style={ctaSectionStyle}>
            <Button href={finalCtaUrl} style={{ ...ctaButtonStyle, backgroundColor: palette.primary }}>
              {insight.accionRecomendada.label}
            </Button>
          </Section>

          <Hr style={hrStyle} />

          {/* Footer */}
          <Section style={footerStyle}>
            <Text style={footerTextStyle}>
              {isEs
                ? 'Este es un mensaje automático de UtopIA · 1+1, tu socio financiero estratégico.'
                : 'This is an automated message from UtopIA · 1+1, your strategic financial partner.'}
            </Text>
            {unsubscribeUrl && (
              <Text style={footerTextStyle}>
                <a href={unsubscribeUrl} style={footerLinkStyle}>
                  {isEs ? 'Cancelar suscripción' : 'Unsubscribe'}
                </a>
              </Text>
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Inline styles (email-safe) ─────────────────────────────────────────────

const bodyStyle: React.CSSProperties = {
  backgroundColor: '#FCFBF8',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  margin: 0,
  padding: '24px 0',
};

const containerStyle: React.CSSProperties = {
  maxWidth: '600px',
  margin: '0 auto',
  backgroundColor: '#FFFFFF',
  borderRadius: '12px',
  border: '1px solid #E2DCC8',
  overflow: 'hidden',
};

const brandStyle: React.CSSProperties = {
  padding: '20px 32px 12px',
  backgroundColor: '#FCFBF8',
};

const brandTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  fontWeight: 600,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: '#B8934A',
  fontFamily: 'monospace',
};

const bannerStyle: React.CSSProperties = {
  padding: '24px 32px',
  textAlign: 'center' as const,
};

const bannerEmojiStyle: React.CSSProperties = {
  fontSize: '36px',
  margin: 0,
  lineHeight: 1,
};

const bannerLabelStyle: React.CSSProperties = {
  margin: '8px 0 0',
  color: '#FFFFFF',
  fontSize: '14px',
  fontWeight: 500,
  letterSpacing: '0.06em',
};

const severityRowStyle: React.CSSProperties = {
  padding: '20px 32px 0',
  textAlign: 'center' as const,
};

const severityChipStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 12px',
  borderRadius: '6px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.08em',
};

const headingStyle: React.CSSProperties = {
  padding: '12px 32px 0',
  margin: 0,
  fontSize: '22px',
  fontWeight: 600,
  lineHeight: 1.3,
  color: '#0C0A06',
  textAlign: 'center' as const,
};

const cardStyle: React.CSSProperties = {
  margin: '20px 32px 0',
  padding: '14px 16px',
  borderRadius: '8px',
  borderLeft: '3px solid',
  backgroundColor: '#FAF8F2',
};

const labelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '11px',
  letterSpacing: '0.16em',
  textTransform: 'uppercase' as const,
  color: '#7A7259',
  fontWeight: 600,
};

const bodyTextStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: '14px',
  lineHeight: 1.55,
  color: '#0C0A06',
};

const ctaSectionStyle: React.CSSProperties = {
  padding: '24px 32px',
  textAlign: 'center' as const,
};

const ctaButtonStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '12px 24px',
  borderRadius: '8px',
  color: '#FFFFFF',
  fontSize: '14px',
  fontWeight: 600,
  textDecoration: 'none',
};

const hrStyle: React.CSSProperties = {
  borderColor: '#E2DCC8',
  margin: '0 32px',
};

const footerStyle: React.CSSProperties = {
  padding: '16px 32px 24px',
  textAlign: 'center' as const,
};

const footerTextStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#7A7259',
  margin: '4px 0',
};

const footerLinkStyle: React.CSSProperties = {
  color: '#B8934A',
  textDecoration: 'underline',
};

export default InsightAlertEmail;
