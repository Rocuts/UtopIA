// ---------------------------------------------------------------------------
// Capa 2 — Motor Normativo — Catálogo: Sanciones tributarias
// ---------------------------------------------------------------------------
//
// Matriz del régimen sancionatorio E.T. con tarifas, topes y reducciones
// aplicables. Fuente: dictamen corregido escudo-tributario-co 2026.
// ---------------------------------------------------------------------------

import type { SanctionEntry } from '../types';

export const SANCIONES: readonly SanctionEntry[] = [
  {
    id: 'SANCION_EXTEMPORANEIDAD_ART641',
    normaRef: 'Art. 641 E.T.',
    nombre: 'Sanción por extemporaneidad',
    supuesto:
      'Presentación de declaración tributaria fuera del plazo legal. Aplica por mes o fracción de mes de retardo.',
    tarifa:
      '5% mensual del impuesto a cargo antes de emplazamiento; 10% mensual después de emplazamiento.',
    tope:
      '100% del impuesto a cargo. Sin impuesto a cargo: 0.5% sobre ingresos brutos (tope 5%) o 1% sobre patrimonio líquido (tope 2.500 UVT = $130.935.000 COP 2026).',
    reducciones: [
      {
        momento: 'Corrección voluntaria antes de emplazamiento',
        reduccion: 'Solo acumulan el 5% mensual (no el 10%)',
        norma: 'Art. 641 E.T.',
      },
      {
        momento: 'Principios de gradualidad Art. 640',
        reduccion: '50% si primer incumplimiento documentado; 75% si subsana antes de pliego',
        norma: 'Art. 640 E.T.',
      },
    ],
    estado: 'VIGENTE_2026',
  },
  {
    id: 'SANCION_CORRECCION_ART644',
    normaRef: 'Art. 644 E.T.',
    nombre: 'Sanción por corrección de declaraciones',
    supuesto:
      'Corrección de declaración que aumenta el impuesto a pagar o disminuye el saldo a favor liquidado.',
    tarifa:
      '10% del mayor valor del impuesto antes de emplazamiento para corregir; 20% después de emplazamiento.',
    tope: null,
    reducciones: [
      {
        momento: 'Corrección voluntaria antes de emplazamiento',
        reduccion: 'Solo 10% (mitad del 20%)',
        norma: 'Art. 644 E.T.',
      },
    ],
    estado: 'VIGENTE_2026',
  },
  {
    id: 'SANCION_INEXACTITUD_ART647',
    normaRef: 'Art. 647 E.T. / Art. 648 E.T.',
    nombre: 'Sanción por inexactitud',
    supuesto:
      'Omisión de ingresos, inclusión de deducciones, descuentos o impuestos descontables inexistentes o improcedentes, o datos falsos, incompletos o desfigurados en la declaración.',
    tarifa: '100% del mayor valor del impuesto que se generó.',
    tope: null,
    reducciones: [
      {
        momento: 'Aceptación de pliego de cargos (Art. 709)',
        reduccion: '25% de la sanción',
        norma: 'Art. 709 E.T.',
      },
      {
        momento: 'Aceptación de liquidación oficial (Art. 713)',
        reduccion: '50% de la sanción',
        norma: 'Art. 713 E.T.',
      },
      {
        momento: 'Gradualidad primer incumplimiento (Art. 640)',
        reduccion: 'Hasta 50% adicional si se cumplen condiciones',
        norma: 'Art. 640 E.T.',
      },
    ],
    estado: 'VIGENTE_2026',
  },
  {
    id: 'SANCION_MINIMA_ART639',
    normaRef: 'Art. 639 E.T.',
    nombre: 'Sanción mínima',
    supuesto:
      'Cualquier sanción tributaria no puede ser inferior al equivalente de 10 UVT.',
    tarifa: '10 UVT',
    tope: '10 UVT = $523.740 COP (UVT 2026: $52.374).',
    reducciones: [],
    estado: 'VIGENTE_2026',
  },
  {
    id: 'SANCION_RETENCIONES_NO_CONSIGNADAS',
    normaRef: 'Art. 402 E.T.',
    nombre: 'Sanción por retenciones no consignadas — apropiación indebida',
    supuesto:
      'El agente de retención que practique retenciones y no las consigne dentro del plazo previsto puede incurrir en responsabilidad penal (apropiación de recursos del Estado, Art. 402 C.P.).',
    tarifa:
      'Sanción económica: intereses moratorios sobre el valor no consignado (Art. 634 E.T.). Responsabilidad penal independiente.',
    tope: null,
    reducciones: [
      {
        momento: 'Pago voluntario con intereses antes de actuación DIAN',
        reduccion: 'Elimina responsabilidad económica; no elimina la penal',
        norma: 'Art. 634 E.T.',
      },
    ],
    estado: 'VIGENTE_2026',
  },
  {
    id: 'SANCION_NO_DECLARAR_ART643',
    normaRef: 'Art. 643 E.T.',
    nombre: 'Sanción por no declarar',
    supuesto:
      'Contribuyente obligado a declarar que no lo hace. La DIAN puede proferir emplazamiento para declarar.',
    tarifa:
      '20% de las consignaciones bancarias o ingresos brutos del periodo (declaración de renta). Para IVA: 10% de los ingresos brutos del periodo no declarado.',
    tope: null,
    reducciones: [
      {
        momento: 'Presentación voluntaria antes de emplazamiento DIAN',
        reduccion: 'Aplica solo la sanción de extemporaneidad (Art. 641), no la de no declarar',
        norma: 'Art. 641 E.T.',
      },
    ],
    estado: 'VIGENTE_2026',
  },
] as const;
