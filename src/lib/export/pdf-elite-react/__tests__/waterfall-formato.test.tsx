// reportes-export-19 (remanente): la cascada del PDF Élite usaba formatters
// propios ('200.0M', '1.5B', '-$150.000.000') en la misma página que los
// estados con convención es-CO ('$1.234,56', negativos entre paréntesis). La
// spec v10.1 ("Formato numérico estricto") pide coma decimal, escalas en
// español ('M', 'mil M', nunca 'B': un billón es 10^12) y paréntesis para los
// negativos. Se verifica sobre el PDF renderizado.
import React from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { Document, Page, renderToBuffer } from '@react-pdf/renderer';
import { registerEditorialFonts } from '../fonts';
import { WaterfallPnL } from '../charts/WaterfallPnL';

async function chartText(items: React.ComponentProps<typeof WaterfallPnL>['items']): Promise<string> {
  const buf = await renderToBuffer(
    <Document>
      <Page size="A4" orientation="landscape">
        <WaterfallPnL items={items} width={700} height={320} />
      </Page>
    </Document>,
  );
  const { PDFParse } = await import('pdf-parse');
  return (await new PDFParse({ data: new Uint8Array(buf) }).getText()).text.replace(/\s+/g, ' ');
}

beforeAll(() => registerEditorialFonts());

describe('WaterfallPnL — formato numérico es-CO (reportes-export-19)', () => {
  it('etiquetas compactas en español y montos con paréntesis para los negativos', async () => {
    const text = await chartText([
      { label: 'Ingresos', amount: 2_400_000_000, sign: 'pos' },
      { label: 'Costos y gastos', amount: -2_550_000_000, sign: 'neg' },
      { label: 'Pérdida neta', amount: -150_000_000, sign: 'total' },
    ]);
    // Compactas: '$2,4 mil M' y '($150 M)', no '2.4B' ni '-150.0M'.
    expect(text).toContain('$2,4 mil M');
    expect(text).toContain('($150 M)');
    expect(text).not.toMatch(/\d\.\dB|\d\.\dM|\dK\b/);
    // Montos completos: '$2.400.000.000' y '($150.000.000)', nunca '-$'.
    expect(text).toContain('$2.400.000.000');
    expect(text).toContain('($2.550.000.000)');
    expect(text).toContain('($150.000.000)');
    expect(text).not.toContain('-$');
  }, 30_000);
});
