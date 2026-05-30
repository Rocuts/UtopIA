// ---------------------------------------------------------------------------
// Fixtures determinísticos para deriveAncoraView. Números redondos para que las
// aserciones sean legibles. Centavos = pesos × 100.
// ---------------------------------------------------------------------------

import type { NiifAncora } from '@/lib/agents/financial/ancora/types';
import type { FiscalSnapshot } from '@/lib/agents/financial/types';

/** Âncora "sano": ecuación patrimonial cuadra, EFE concilia, sin alertas. */
export function makeAncora(overrides?: Partial<NiifAncora>): NiifAncora {
  return {
    periodos: { actual: '2025', comparativo: '2024' },
    nitDigito: '6',
    ccvNiif: {
      A01: '100000000000', // activos 1.000.000.000
      A02: '90000000000', // activos prev 900.000.000
      A03: '40000000000', // pasivos 400.000.000
      A04: '38000000000', // pasivos prev 380.000.000
      A05: '60000000000', // patrimonio 600.000.000
      A06: '52000000000', // patrimonio prev 520.000.000
      A07: '50000000000', // ingresos 500.000.000
      A08: '40000000000', // ingresos prev 400.000.000
      A09: '10000000000', // EBIT 100.000.000
      A10: '8000000000', // EBIT prev 80.000.000
      A11: '5000000000', // utilidad neta 50.000.000
      A12: '4000000000', // utilidad neta prev 40.000.000
      A13: '12000000000', // efectivo 120.000.000
      A14: '10000000000', // efectivo prev 100.000.000
      A15: '20000000000', // pasivo corriente 200.000.000
      A16: '6000000000', // inventarios 60.000.000
      A17: '8000000000', // cartera 80.000.000
      A18: '7000000000', // proveedores 70.000.000
      A19: '2000000000', // variación caja 20.000.000 (=A13-A14)
      X01: '25000000000', // ganancia bruta 250.000.000
      X02: '20000000000',
      X03: '40000000000', // activo corriente 400.000.000
      X04: '60000000000', // activo no corriente 600.000.000
    },
    ccvFiscal: {
      F01: '5000000000', // 50.000.000
      F02: '1750000000', // 17.500.000
      F03: '500000000', // 5.000.000
      F04: '1250000000', // 12.500.000
      F05: '0',
      F06: '0',
      F07: '0',
      F08: '0',
      F09: '0.00',
      F10: '28.57', // 5/17.5*100
    },
    checks: {
      patrimonioDelta2025: '0',
      patrimonioDelta2024: '0',
      efeReconcilia: 'ok',
      alertaA5: 'inactiva',
      alertaDev: 'inactiva',
    },
    version: '1.0',
    computedAt: '2026-05-28T00:00:00.000Z',
    ...overrides,
  };
}

/** FiscalSnapshot mínimo (sólo lo que lee deriveAncoraView). */
export function makeFiscalSnapshot(): FiscalSnapshot {
  return {
    anchor: {
      f01: '5000000000',
      f02: '1750000000',
      f03: '500000000',
      f04: '1250000000',
      f05: '0',
      f06: '0',
      f07: '0',
      f08: '0',
      f09: 5.9,
      f10: 28.57,
    },
    riskScore: { score: 68, nivel: 'muy_alto', factores: [] },
    period: '2025',
    computedAt: '2026-05-28T00:00:00.000Z',
    // calendarioDian/alertas/fuente no los lee el derivador; cast para el fixture.
  } as unknown as FiscalSnapshot;
}
