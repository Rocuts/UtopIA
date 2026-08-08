// ofx-mt940-amounts.test.ts — Regresión del parseo de importes en OFX y MT940.
//
// OFX: el estándar exige punto decimal y prohíbe separador de miles, pero los
// exportadores locales incumplen ambas cosas. La implementación anterior hacía
// `replace(',', '.')` (solo la PRIMERA coma) y luego borraba los no-dígitos, así
// que `-1.234.567,89` quedaba como `-1.234.567.89` → NaN → movimiento
// DESCARTADO. Un extracto en formato ES-CO perdía todos sus movimientos.
//
// MT940: en SWIFT la coma SIEMPRE es el decimal, así que ese parser conserva su
// propia lógica; aquí se fija que una línea sin dígitos no se convierta en un
// movimiento de $0.

import { describe, expect, it } from 'vitest';
import { ofxParser } from '../ofx';
import { mt940Parser } from '../mt940';

function ofxWith(...amounts: string[]): string {
  const txs = amounts
    .map(
      (amt, i) => `<STMTTRN>
<TRNTYPE>OTHER
<DTPOSTED>2026060${i + 1}
<TRNAMT>${amt}
<FITID>FIT-00${i + 1}
<NAME>MOVIMIENTO ${i + 1}
</STMTTRN>`,
    )
    .join('\n');
  return `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST>
${txs}
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
}

describe('ofxParser — importes en formato local', () => {
  it('acepta ES-CO (1.234.567,89), EN-US (1,234,567.89) y miles sin centavos', async () => {
    const result = await ofxParser.parse(
      'extracto.ofx',
      ofxWith('-1.234.567,89', '1,234,567.89', '3.450.000'),
    );
    expect(result.warnings).toEqual([]);
    expect(result.transactions.map((t) => t.amountCop)).toEqual([
      '-1234567.89',
      '1234567.89',
      '3450000.00',
    ]);
  });

  it('mantiene el formato canónico OFX (punto decimal)', async () => {
    const result = await ofxParser.parse('extracto.ofx', ofxWith('1500000.00', '-230000.50'));
    expect(result.transactions.map((t) => t.amountCop)).toEqual(['1500000.00', '-230000.50']);
  });
});

describe('mt940Parser — la coma es SIEMPRE decimal (SWIFT)', () => {
  const base = (line61: string) => `:20:REF-1
:25:0070123456789
:60F:C260601COP5000000,00
${line61}
:86:MOVIMIENTO DE PRUEBA
:62F:C260630COP5000000,00
-`;

  it('1.234.567,89 se lee como 1234567.89 (puntos = miles)', async () => {
    const result = await mt940Parser.parse('e.sta', base(':61:260603C1.234.567,89NTRFNONREF//BB-1'));
    expect(result.transactions[0].amountCop).toBe('1234567.89');
  });

  it('un monto sin dígitos no se convierte en un movimiento de $0', async () => {
    // Antes: se quitaban los puntos y quedaba '' → `Number('')` = 0 → la línea
    // corrupta entraba al libro como un movimiento válido de cero pesos.
    await expect(
      mt940Parser.parse('e.sta', base(':61:260603C.NTRFNONREF//BB-1')),
    ).rejects.toThrow();
  });
});
