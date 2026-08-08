// ---------------------------------------------------------------------------
// Regresión — Auditoría normativa 2026-08, grupo "calendario fiscal"
// ---------------------------------------------------------------------------
// Cubre los defectos del calendario DIAN que producían fechas POSTERIORES al
// plazo legal (extemporaneidad → Art. 641 / Art. 651 E.T.) o que presentaban
// como ciertas fechas que el sistema calcula.
//
// Fuentes verificadas (2026-08-07):
//   - Decreto 2229 de 2023, compilado en el DUR 1625 de 2016 (arts. 1.6.1.13.2.x):
//     plazo del 7º al 16º día hábil según "el último dígito del NIT del declarante
//     que conste en el RUT, SIN TENER EN CUENTA EL DÍGITO DE VERIFICACIÓN".
//     https://normograma.dian.gov.co/dian/compilacion/docs/decreto_2229_2023.htm
//   - Decreto 500 de 2024 — Día Cívico de la Paz con la Naturaleza (tercer viernes
//     de abril). En 2026 cae el 17-abr y la DIAN confirmó el 4-mar-2026 que corre
//     los vencimientos posteriores del mes.
//     https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=238215
//   - Resolución Única DIAN 000227 de 2025 (Título 3), modif. Res. 000233 de 2025
//     y Res. 000012 de 2026 — información exógena AG 2025.
//     https://actualicese.com/plazos-para-reportar-informacion-exogena-en-2026/
//   - Tablas del calendario tributario 2026 (renta PJ, PN, IVA, retención):
//     https://www.enlegislacion.com/calendario-tributario/13-calendario-tributario-2026
//     https://siemprealdia.co/colombia/calendario-tributario-2026/
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  buildDeadlines2026,
  digitToBusinessDay,
  exogenaPJPNPorDosDigitos,
  nthBusinessDay,
  rentaPNPorDosDigitos,
  tieneFestivosVerificados,
} from '@/lib/scrapers/dian-scraper';
import { NACIONAL_2026 } from '../nacional-2026';
import type { NationalDeadline } from '../types';

function porObligacion(fragmento: string): NationalDeadline[] {
  return NACIONAL_2026.filter((d) => d.obligation.includes(fragmento));
}

function fechaDe(fragmento: string, digit: number, period?: string): string {
  const match = NACIONAL_2026.filter(
    (d) =>
      d.obligation.includes(fragmento) &&
      d.nitDigit === digit &&
      (period === undefined || d.period.includes(period)),
  );
  expect(match.length, `esperaba 1 deadline para ${fragmento}/${digit}/${period}`).toBe(1);
  return match[0]!.dueDate;
}

// ---------------------------------------------------------------------------
// 17-abr-2026 — día NO hábil (Decreto 500 de 2024)
// ---------------------------------------------------------------------------
describe('Decreto 500 de 2024 — el 17-abr-2026 no es día hábil', () => {
  it('no aparece como N-ésimo día hábil de abril para ningún dígito', () => {
    for (let d = 0; d <= 9; d++) {
      expect(nthBusinessDay(2026, 4, digitToBusinessDay(d))).not.toBe('2026-04-17');
    }
  });

  it('corre los días hábiles 11º a 16º de abril un día: el 16º es el 27-abr, no el 24', () => {
    // Con el 17-abr contado como hábil el 16º día hábil caía el 24-abr, y el
    // sistema afirmaba que la 2ª cuota de grandes contribuyentes vencía el 24.
    expect(nthBusinessDay(2026, 4, 11)).toBe('2026-04-20');
    expect(nthBusinessDay(2026, 4, 12)).toBe('2026-04-21');
    expect(nthBusinessDay(2026, 4, 16)).toBe('2026-04-27');
  });

  it('la 2ª cuota de grandes contribuyentes del dígito 0 vence el 27-abr-2026', () => {
    expect(fechaDe('Renta Grandes Contribuyentes — Decl + Cuota 2', 0)).toBe('2026-04-27');
  });

  it('la retención del período marzo 2026 del dígito 0 vence el 27-abr-2026', () => {
    expect(fechaDe('Retención en la Fuente', 0, 'Marzo 2026')).toBe('2026-04-27');
  });
});

// ---------------------------------------------------------------------------
// Información exógena — NO vence en septiembre
// ---------------------------------------------------------------------------
describe('Información exógena AG 2025 — Res. Única DIAN 000227 de 2025', () => {
  it('ninguna fecha de exógena cae en septiembre de 2026', () => {
    const exogena = porObligacion('Información Exógena');
    expect(exogena.length).toBeGreaterThan(0);
    for (const d of exogena) {
      expect(
        d.dueDate.startsWith('2026-09'),
        `${d.obligation} dígito ${d.nitDigit} salió en septiembre: ${d.dueDate}`,
      ).toBe(false);
    }
  });

  it('todas las fechas de exógena están entre el 28-abr y el 12-jun de 2026', () => {
    for (const d of porObligacion('Información Exógena')) {
      expect(d.dueDate >= '2026-04-28').toBe(true);
      expect(d.dueDate <= '2026-06-12').toBe(true);
    }
  });

  it('la tabla de PJ/PN es ASCENDENTE: 01-05 vence antes que 96-00', () => {
    // El error invertido daba 12-jun-2026 a quien tenía que reportar el 14-may.
    expect(exogenaPJPNPorDosDigitos(3)).toBe('2026-05-14');
    expect(exogenaPJPNPorDosDigitos(0)).toBe('2026-06-12');
    expect(exogenaPJPNPorDosDigitos(99)).toBe('2026-06-12');
    expect(exogenaPJPNPorDosDigitos(1) < exogenaPJPNPorDosDigitos(96)).toBe(true);
  });

  it('grandes contribuyentes: dígito 1 el 28-abr, dígito 0 el 13-may', () => {
    expect(fechaDe('Información Exógena (Medios Magnéticos) — Grandes Contribuyentes', 1)).toBe('2026-04-28');
    expect(fechaDe('Información Exógena (Medios Magnéticos) — Grandes Contribuyentes', 0)).toBe('2026-05-13');
  });
});

// ---------------------------------------------------------------------------
// Renta personas naturales — bandas invertidas
// ---------------------------------------------------------------------------
describe('Renta personas naturales AG 2025 — orden ascendente por dos dígitos', () => {
  it('01-02 vence el 12-ago-2026 y 99-00 el 26-oct-2026', () => {
    expect(rentaPNPorDosDigitos(1)).toBe('2026-08-12');
    expect(rentaPNPorDosDigitos(2)).toBe('2026-08-12');
    expect(rentaPNPorDosDigitos(99)).toBe('2026-10-26');
    expect(rentaPNPorDosDigitos(0)).toBe('2026-10-26');
  });

  it('nunca cae en un festivo: ni el 17-ago ni el 12-oct de 2026', () => {
    for (let n = 0; n <= 99; n++) {
      expect(rentaPNPorDosDigitos(n)).not.toBe('2026-08-17');
      expect(rentaPNPorDosDigitos(n)).not.toBe('2026-10-12');
    }
  });

  it('la compresión por último dígito nunca es POSTERIOR a la fecha real', () => {
    // El repo publicaba 26-oct-2026 para el último dígito 0 cuando un NIT
    // terminado en 10 vencía el 19-ago: dos meses de extemporaneidad.
    for (let digit = 0; digit <= 9; digit++) {
      const publicada = fechaDe('Personas Naturales', digit);
      for (let decena = 0; decena <= 9; decena++) {
        const real = rentaPNPorDosDigitos(decena * 10 + digit);
        expect(
          publicada <= real,
          `dígito ${digit}: se publica ${publicada} pero ${decena * 10 + digit} vence ${real}`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// IVA — seis bimestres y tres cuatrimestres
// ---------------------------------------------------------------------------
describe('IVA — Art. 600 E.T.', () => {
  it('el IVA cuatrimestral tiene TRES períodos, incluido Sep-Dic → enero 2027', () => {
    const cuat = porObligacion('IVA — Cuatrimestral');
    const periodos = new Set(cuat.map((d) => d.period));
    expect(periodos.size).toBe(3);
    expect(fechaDe('IVA — Cuatrimestral', 1, 'Sep-Dic 2026')).toBe('2027-01-13');
    expect(fechaDe('IVA — Cuatrimestral', 0, 'Sep-Dic 2026')).toBe('2027-01-26');
  });

  it('el bimestre Mar-Abr 2026 vence en MAYO, no en marzo', () => {
    // La etiqueta "Bimestre 2 (Mar-Abr)" se emitía con fecha de marzo, que es
    // el vencimiento del bimestre Ene-Feb.
    expect(fechaDe('IVA — Bimestral', 1, 'Mar-Abr').startsWith('2026-05')).toBe(true);
    expect(fechaDe('IVA — Bimestral', 1, 'Ene-Feb').startsWith('2026-03')).toBe(true);
  });

  it('existe el vencimiento del bimestre Nov-Dic 2026 en enero de 2027', () => {
    const b6 = porObligacion('IVA — Bimestral').filter((d) => d.dueDate.startsWith('2027-01'));
    expect(b6.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Procedencia — ninguna fecha calculada se marca como verificada
// ---------------------------------------------------------------------------
describe('procedencia de las fechas', () => {
  it('ningún deadline del calendario estático se declara verificado contra el decreto', () => {
    const verificados = NACIONAL_2026.filter((d) => d.verified === true);
    expect(
      verificados.map((d) => `${d.obligation}/${d.nitDigit}`),
      'verified=true suprime el disclaimer aguas abajo sobre fechas que este archivo CALCULA',
    ).toEqual([]);
  });

  it('el calendario que persiste el cron tampoco se declara verificado', () => {
    // `buildRange`, `buildRentaPN` y `buildPatrimonioCuota2` emitían
    // `verified: true` pese a que el propio encabezado del scraper dice que no
    // extrae fechas del HTML/PDF. `src/lib/tools/tax-calendar.ts` imprime
    // "verificadas contra decreto oficial" cuando verified === true.
    const generados = buildDeadlines2026();
    expect(generados.length).toBeGreaterThan(100);
    const verificados = generados.filter((d) => d.verified === true);
    expect(verificados.map((d) => `${d.obligation}/${d.period}/${d.nitDigit}`)).toEqual([]);
  });

  it('el calendario del cron y el estático coinciden en la exógena y la renta PN', () => {
    // Las dos fuentes divergían: el cron y el fallback estático devolvían
    // fechas distintas para el mismo NIT según hubiera corrido o no el cron.
    const cron = buildDeadlines2026();
    for (const obligacion of ['Personas Naturales', 'Exógena']) {
      for (let digit = 0; digit <= 9; digit++) {
        const delCron = cron.filter(
          (d) => d.obligation.includes(obligacion) && d.nitDigit === digit,
        );
        const delEstatico = NACIONAL_2026.filter(
          (d) => d.obligation.includes(obligacion) && d.nitDigit === digit,
        );
        expect(delCron.length).toBe(delEstatico.length);
        expect(delCron.map((d) => d.dueDate).sort()).toEqual(
          delEstatico.map((d) => d.dueDate).sort(),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Guarda de festivos — no inventar fechas fuera del calendario verificado
// ---------------------------------------------------------------------------
describe('nthBusinessDay sólo opera sobre períodos con festivos verificados', () => {
  it('acepta 2026 completo y enero de 2027', () => {
    expect(tieneFestivosVerificados(2026, 4)).toBe(true);
    expect(tieneFestivosVerificados(2027, 1)).toBe(true);
  });

  it('lanza en vez de devolver una fecha calculada sin festivos (feb-2027 en adelante)', () => {
    expect(tieneFestivosVerificados(2027, 2)).toBe(false);
    expect(() => nthBusinessDay(2027, 2, 7)).toThrow(/festivos verificado/i);
    expect(() => nthBusinessDay(2028, 5, 7)).toThrow(/festivos verificado/i);
  });
});
