import { describe, expect, it } from 'vitest';
import { ofxParser } from '@/lib/accounting/banking/parsers/ofx';
import { mt940Parser } from '@/lib/accounting/banking/parsers/mt940';
import { detectParser } from '@/lib/accounting/banking/parsers';

// ─── Fixtures ────────────────────────────────────────────────────────────────

// OFX 1.x SGML (tags sin cerrar) — el formato que exportan la mayoría de bancos.
const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>COP
<BANKACCTFROM>
<BANKID>007
<ACCTID>123456789
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260601
<DTEND>20260630
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260603120000
<TRNAMT>1500000.00
<FITID>FIT-001
<NAME>ABONO NOMINA CLIENTE
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260605
<TRNAMT>-230000.50
<FITID>FIT-002
<CHECKNUM>900123
<MEMO>PAGO PROVEEDOR XYZ
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>1269999.50
<DTASOF>20260630
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

// MT940 estilo Banco de Bogotá / Davivienda.
const MT940 = `:20:REF-20260630
:25:0070123456789
:28C:00001/001
:60F:C260601COP5000000,00
:61:2606030603C1500000,00NTRFNONREF//BB-77881
:86:ABONO TRANSFERENCIA ACH NOMINA
:61:260605D230000,50NCHK900123//BB-77900
:86:CHEQUE 900123 PAGO PROVEEDOR
XYZ S.A.S.
:61:260610RC100000,00NRTI//BB-78001
:86:REVERSO ABONO DUPLICADO
:62F:C260630COP6169999,50
-`;

// ─── OFX ─────────────────────────────────────────────────────────────────────

describe('ofxParser', () => {
  it('canParse por extensión y por sniff de contenido', () => {
    expect(ofxParser.canParse('extracto.ofx', '')).toBe(true);
    expect(ofxParser.canParse('extracto.qfx', '')).toBe(true);
    expect(ofxParser.canParse('extracto.txt', OFX_SGML)).toBe(true);
    expect(ofxParser.canParse('extracto.txt', 'fecha;monto\n2026-01-01;100')).toBe(false);
  });

  it('parsea SGML: montos firmados, FITID, fechas y saldo de cierre', async () => {
    const st = await ofxParser.parse('extracto.ofx', OFX_SGML);
    expect(st.transactions).toHaveLength(2);

    const [abono, cargo] = st.transactions;
    expect(abono.amountCop).toBe('1500000.00');
    expect(abono.externalId).toBe('FIT-001');
    expect(abono.description).toContain('ABONO NOMINA');
    expect(abono.postedAt.toISOString().slice(0, 10)).toBe('2026-06-03');

    expect(cargo.amountCop).toBe('-230000.50');
    expect(cargo.reference).toBe('900123');
    expect(cargo.description).toContain('PAGO PROVEEDOR');

    expect(st.accountNumber).toBe('123456789');
    expect(st.endingBalance).toBe('1269999.50');
    expect(st.periodStart?.toISOString().slice(0, 10)).toBe('2026-06-01');
    expect(st.periodEnd?.toISOString().slice(0, 10)).toBe('2026-06-30');
  });

  it('lanza PARSE_FAILED sin bloques STMTTRN', async () => {
    await expect(ofxParser.parse('vacio.ofx', '<OFX></OFX>')).rejects.toThrow(/STMTTRN/);
  });
});

// ─── MT940 ───────────────────────────────────────────────────────────────────

describe('mt940Parser', () => {
  it('canParse por extensión y por sniff :20: + :61:', () => {
    expect(mt940Parser.canParse('extracto.sta', '')).toBe(true);
    expect(mt940Parser.canParse('extracto.mt940', '')).toBe(true);
    expect(mt940Parser.canParse('extracto.txt', MT940)).toBe(true);
    expect(mt940Parser.canParse('extracto.txt', 'fecha;monto')).toBe(false);
  });

  it('parsea :61:/:86: con signo C/D/RC, descripción multilínea y saldos', async () => {
    const st = await mt940Parser.parse('extracto.sta', MT940);
    expect(st.transactions).toHaveLength(3);

    const [abono, cargo, reverso] = st.transactions;
    // C = abono (positivo); fecha de entrada 0603 hereda el año de la valor.
    expect(abono.amountCop).toBe('1500000.00');
    expect(abono.description).toContain('ABONO TRANSFERENCIA');
    expect(abono.externalId).toBe('BB-77881');
    expect(abono.postedAt.toISOString().slice(0, 10)).toBe('2026-06-03');

    // D = cargo (negativo); :86: multilínea colapsada; ref de cliente.
    expect(cargo.amountCop).toBe('-230000.50');
    expect(cargo.description).toBe('CHEQUE 900123 PAGO PROVEEDOR XYZ S.A.S.');
    expect(cargo.reference).toBe('900123');
    expect(cargo.externalId).toBe('BB-77900');
    expect(cargo.postedAt.toISOString().slice(0, 10)).toBe('2026-06-05');

    // RC = reverso de crédito → neto cargo (negativo).
    expect(reverso.amountCop).toBe('-100000.00');
    expect(reverso.description).toContain('REVERSO');

    expect(st.accountNumber).toBe('0070123456789');
    expect(st.startingBalance).toBe('5000000.00');
    expect(st.endingBalance).toBe('6169999.50');
  });

  it('lanza PARSE_FAILED sin líneas :61:', async () => {
    await expect(
      mt940Parser.parse('vacio.sta', ':20:REF\n:25:123\n-'),
    ).rejects.toThrow(/:61:/);
  });
});

// ─── Registry ────────────────────────────────────────────────────────────────

describe('detectParser — orden de detección', () => {
  it('un .txt con contenido OFX va al parser OFX, no al CSV', () => {
    expect(detectParser('extracto.txt', OFX_SGML)).toBe(ofxParser);
  });

  it('un .txt con contenido SWIFT va al parser MT940', () => {
    expect(detectParser('extracto.txt', MT940)).toBe(mt940Parser);
  });

  it('mensaje de formato no soportado ya no dice "pendientes"', () => {
    expect(() => detectParser('archivo.pdf', '%PDF-1.7')).toThrow(/CSV\/TXT, OFX\/QFX y MT940/);
  });
});
