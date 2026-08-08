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
    normaRef: 'Art. 641 E.T. / Art. 642 E.T.',
    nombre: 'Sanción por extemporaneidad',
    supuesto:
      'Presentación de declaración tributaria fuera del plazo legal. Aplica por mes o fracción de mes de retardo.',
    tarifa:
      '5% mensual del impuesto a cargo antes de emplazamiento (Art. 641); 10% mensual después de emplazamiento o auto de inspección tributaria (Art. 642).',
    tope:
      'Antes de emplazamiento: 100% del impuesto a cargo (Art. 641). Después de emplazamiento: 200% del impuesto o retención a cargo (Art. 642). Sin impuesto a cargo: 0.5% sobre ingresos brutos (tope 5%) o 1% sobre patrimonio líquido (tope 2.500 UVT = $130.935.000 COP 2026); post-emplazamiento estos porcentajes se duplican (1% mensual, topes 10% / 5.000 UVT).',
    reducciones: [
      {
        momento: 'Corrección voluntaria antes de emplazamiento',
        reduccion: 'Solo acumulan el 5% mensual (no el 10%)',
        norma: 'Art. 641 E.T.',
      },
      {
        momento:
          'Gradualidad Art. 640 — sanción liquidada por el contribuyente (num. 1 y 2)',
        reduccion:
          'Se reduce AL 50% del monto legal si en los 2 años anteriores a la conducta no se cometió la misma conducta sancionada mediante acto en firme Y la DIAN no ha proferido pliego de cargos, requerimiento especial ni emplazamiento previo por no declarar. Se reduce AL 75% si el período limpio es de 1 año, con la misma condición procesal.',
        norma: 'Art. 640 num. 1 y 2 E.T.',
      },
      {
        momento:
          'Gradualidad Art. 640 — sanción propuesta o determinada por la DIAN (num. 3 y 4)',
        reduccion:
          'Se reduce AL 50% si en los 4 años anteriores no se cometió la misma conducta sancionada mediante acto en firme Y la sanción es aceptada y la infracción subsanada. AL 75% si el período limpio es de 2 años, con las mismas condiciones.',
        norma: 'Art. 640 num. 3 y 4 E.T.',
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
    tarifa:
      'Escalonada (Art. 648 E.T.). Inciso 1º — base: 100% de la diferencia entre el saldo a pagar o saldo a favor determinado en la liquidación oficial y el declarado; 15% de los valores inexactos en declaraciones de ingresos y patrimonio. Inciso 3º — cuantías agravadas: 200% del mayor valor del impuesto a cargo cuando se omitan activos o se incluyan pasivos inexistentes (num. 1, aplicable desde el año gravable 2018); 160% de la diferencia cuando la inexactitud provenga del numeral 5 del Art. 647 (proveedores ficticios o insolventes) o del abuso en materia tributaria del Art. 869 (num. 2); 20% de los valores inexactos en declaraciones de ingresos y patrimonio por esas mismas conductas (num. 3); 50% de la diferencia en declaraciones del monotributo (num. 4). No se aplica sobre el mayor valor del anticipo que se genere al modificar el impuesto declarado.',
    tope: null,
    reducciones: [
      {
        momento: 'Corrección provocada por el requerimiento especial o su ampliación (Art. 709)',
        reduccion: 'La sanción por inexactitud se reduce a la cuarta parte (25%) de la planteada por la Administración, en relación con los hechos aceptados',
        norma: 'Art. 709 E.T.',
      },
      {
        momento: 'Corrección provocada por la liquidación oficial de revisión (Art. 713)',
        reduccion: 'La sanción por inexactitud se reduce a la mitad (50%) de la inicialmente propuesta, en relación con los hechos aceptados',
        norma: 'Art. 713 E.T.',
      },
      {
        momento: 'Gradualidad Art. 640 — SOLO sobre la sanción del inciso 1º del Art. 648',
        reduccion:
          'Se reduce AL 50% o AL 75% del monto legal según el historial de reincidencia y el momento procesal (Art. 640 num. 1 a 4). NO es un descuento adicional acumulable sobre las reducciones de los Arts. 709 y 713. EXCLUSIÓN EXPRESA: por el par. 3 del Art. 640, la proporcionalidad y la gradualidad NO aplican a los numerales 1, 2 y 3 del inciso 3º del Art. 648 — no puede ofrecerse reducción alguna sobre el 200% por activos omitidos/pasivos inexistentes, el 160% por proveedores ficticios o abuso, ni el 20% de ingresos y patrimonio.',
        norma: 'Art. 640 E.T. (par. 3)',
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
