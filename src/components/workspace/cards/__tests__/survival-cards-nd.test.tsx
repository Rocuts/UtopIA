// tributario-modulos-07 — Anti-DIAN: pagosEfectivoTotal, excesoNoDeducibleGeneral
// y mayorImpuestoEstimado son `null` cuando el balance no trae el flujo de
// pagos en efectivo (el saldo de 1105 es un stock). La tarjeta los leía con
// `?? 0`: mostraba "$0" como mayor impuesto y el semáforo "Óptimo" con «sin
// inconsistencias», una afirmación que el balance no soporta.
//
// tributario-calc-01 — la reserva legal de la SAS sólo existe si los estatutos
// la prevén (Supersociedades 220-069664/2017); la de S.A. y Ltda. es
// obligatoria (Arts. 452 y 371 C.Co.). La tarjeta presentaba siempre la brecha
// como "Gap reserva legal (Art. 452)" en color de advertencia.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

import { AntiDianCard } from '../AntiDianCard';
import { ContingencyReserveCard } from '../ContingencyReserveCard';
import type {
  AntiDianResult,
  ContingencyReserveResult,
} from '@/lib/agents/financial/escudo-survival/types';

function text(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ');
}

const tAnti = { title: 'Anti-DIAN Preventivo', metric: 'Mayor impuesto si no se actúa', norma: 'Art. 771-5 E.T.' };
const tReserve = { title: 'Reserva Fiscal de Contingencia', metric: 'Reserva sugerida', norma: 'Buena práctica financiera' };

function antiDian(data: Partial<AntiDianResult['data']> = {}): AntiDianResult {
  return {
    markdown: '',
    warnings: [],
    data: {
      pagosEfectivoTotal: null,
      pagosNoDeduciblesIndividuales: [],
      excesoNoDeducibleGeneral: null,
      crucesExogenaSospechosos: [],
      mayorImpuestoEstimado: null,
      ...data,
    },
  };
}

function reserve(data: Partial<ContingencyReserveResult['data']> = {}): ContingencyReserveResult {
  return {
    markdown: '',
    warnings: [],
    data: {
      utilidadNeta: 100_000_000,
      reservaSugerida: 10_000_000,
      pctUtilidad: 0.1,
      cuentaSugerida: '11 - Caja y Bancos',
      reservaLegalActual: 5_000_000,
      gapReservaLegal: 20_000_000,
      ...data,
    },
  };
}

describe('AntiDianCard — cifras N/D sin flujo de pagos (tributario-modulos-07)', () => {
  it('mayor impuesto null → N/D, nunca $0 ni «Óptimo / sin inconsistencias»', () => {
    const t = text(<AntiDianCard data={antiDian()} t={tAnti} language="es" />);
    expect(t).toContain('N/D');
    expect(t).not.toMatch(/\$\s*0(?![\d.,])/);
    expect(t).not.toContain('Óptimo');
    expect(t).not.toContain('Sin inconsistencias detectadas');
  });

  it('en: N/A', () => {
    const t = text(<AntiDianCard data={antiDian()} t={tAnti} language="en" />);
    expect(t).toContain('N/A');
    expect(t).not.toContain('Optimal');
  });

  it('con cifras verificadas las muestra', () => {
    const t = text(
      <AntiDianCard
        data={antiDian({ pagosEfectivoTotal: 50_000_000, excesoNoDeducibleGeneral: 0, mayorImpuestoEstimado: 1_750_000 })}
        t={tAnti}
        language="es"
      />,
    );
    expect(t).toMatch(/1\.750\.000/);
    expect(t).not.toContain('N/D');
  });
});

describe('ContingencyReserveCard — reserva legal según tipo societario (tributario-calc-01)', () => {
  it('SAS sin estatutos: la brecha no se presenta como reserva obligatoria', () => {
    const t = text(
      <ContingencyReserveCard data={reserve()} t={tReserve} language="es" entityType="SAS" />,
    );
    expect(t).not.toContain('Gap reserva legal (Art. 452)');
    expect(t).toMatch(/no es obligatoria/i);
  });

  it('tipo societario desconocido: sin afirmar incumplimiento', () => {
    const t = text(<ContingencyReserveCard data={reserve()} t={tReserve} language="es" />);
    expect(t).not.toContain('Gap reserva legal (Art. 452)');
    expect(t).toMatch(/S\.A\. y Ltda\./);
  });

  it('S.A.: la brecha frente a la reserva obligatoria se mantiene', () => {
    const t = text(
      <ContingencyReserveCard data={reserve()} t={tReserve} language="es" entityType="S.A." />,
    );
    expect(t).toMatch(/Brecha reserva legal obligatoria \(Art\. 452 C\.Co\.\)/);
    expect(t).toMatch(/20\.000\.000/);
  });

  it('en: SAS is not mandatory', () => {
    const t = text(
      <ContingencyReserveCard data={reserve()} t={tReserve} language="en" entityType="SAS" />,
    );
    expect(t).toMatch(/not mandatory/i);
    expect(t).not.toContain('Legal reserve gap (Art. 452)');
  });
});
