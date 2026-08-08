'use client';
/**
 * Prestaciones — tracker de la "platica que se guarda": prima, cesantías,
 * intereses a las cesantías y vacaciones de la gente de Don Carlos.
 *
 * Identidad MORADA del módulo (header tone="purple", montos Money kind="purple"):
 * separa visualmente "lo que se guarda" del flujo de nómina mensual verde.
 *
 * El patrón calcula sobre un salario editable (default SMMLV) y muestra la
 * provisión mensual de cada concepto + el total que debería ir apartando.
 * Texto en español de barrio; la norma va como nota gris pequeña.
 */
import React, { useState } from 'react';
import { PYME, rgba } from '../design/tokens';
import { NORMATIVA_2026 as N } from '../data/normativa2026';
import { auxTransporteAplicable, provisionesMensuales } from '../data/calc';
import {
  SectionHeader,
  Card,
  TotalCard,
  Money,
  AIBubble,
  Stack,
  NotaNormativa,
  FieldLabel,
  NumberInput,
  uiFont,
} from '../design/primitives';
import type { ScreenProps } from './PymeShell';

interface ItemPrestacion {
  icon: string;
  titulo: string;
  desc: string;
  monto: number;
  nota: string;
}

export function Prestaciones({ go }: ScreenProps) {
  const [salario, setSalario] = useState<number>(N.SMMLV);
  const aux = auxTransporteAplicable(salario);
  const prov = provisionesMensuales(salario, aux);

  const items: ItemPrestacion[] = [
    {
      icon: '💰',
      titulo: 'Prima',
      desc: 'El sueldo extra de mitad y fin de año. Le toca completa.',
      monto: prov.prima,
      nota: '15 días por semestre · Art.306-308 CST',
    },
    {
      icon: '🏦',
      titulo: 'Cesantías',
      desc: 'El ahorro para cuando deje de trabajar o para estudiar/vivienda.',
      monto: prov.cesantias,
      nota: '1 mes de sueldo por año · Ley 50/1990',
    },
    {
      icon: '📈',
      titulo: 'Intereses a las cesantías',
      desc: 'Un premiecito del 12% al año sobre ese ahorro.',
      monto: prov.intereses,
      nota: '12% anual · Ley 52/1975',
    },
    {
      icon: '🏖️',
      titulo: 'Vacaciones',
      desc: 'Los 15 días pagados de descanso al año.',
      monto: prov.vacaciones,
      nota: '15 días hábiles/año, solo salario · Art.186 CST',
    },
  ];

  return (
    <Stack gap={12}>
      <SectionHeader
        tone="purple"
        icon="🎁"
        title="La platica que se guarda"
        subtitle="Prima, cesantías y vacaciones de tu gente"
      />

      {/* ¿Sobre qué sueldo? — salario editable */}
      <Card>
        <FieldLabel>¿Sobre qué sueldo?</FieldLabel>
        <NumberInput value={salario} onChange={setSalario} min={0} step={50_000} />
        <div style={{ marginTop: 6 }}>
          <NotaNormativa>
            Pon el sueldo mensual del trabajador. Lo demás te lo saco yo.
          </NotaNormativa>
        </div>
      </Card>

      {/* Lista de 4 prestaciones */}
      <Stack gap={10}>
        {items.map((it) => (
          <Card key={it.titulo}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
              {/* Icono grande */}
              <div style={{ fontSize: 26, lineHeight: 1, flexShrink: 0 }}>{it.icon}</div>

              {/* Centro: título morado + descripción + nota */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: PYME.purpleDark,
                    fontSize: 13,
                    fontWeight: 800,
                    lineHeight: 1.15,
                  }}
                >
                  {it.titulo}
                </div>
                <div
                  style={{
                    color: PYME.text,
                    fontSize: 11.5,
                    marginTop: 3,
                    lineHeight: 1.4,
                  }}
                >
                  {it.desc}
                </div>
                <div style={{ marginTop: 4 }}>
                  <NotaNormativa>{it.nota}</NotaNormativa>
                </div>
              </div>

              {/* Derecha: monto morado grande + "/mes" */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <Money value={it.monto} kind="purple" size={18} weight={700} />
                <div style={{ color: PYME.textHint, fontSize: 9, marginTop: 1, ...uiFont }}>
                  /mes
                </div>
              </div>
            </div>
          </Card>
        ))}
      </Stack>

      {/* Total que debería ir guardando */}
      <TotalCard
        label="Lo que deberías ir guardando cada mes"
        value={prov.total}
        hint="para no quedar embalado cuando toque pagar"
      />

      {/* Tip morado — guardar la platica aparte */}
      <Card
        style={{
          background: rgba(PYME.purple, 0.07),
          border: `1.5px solid ${rgba(PYME.purple, 0.25)}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
          <div style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>💡</div>
          <div
            style={{
              color: PYME.purpleDark,
              fontSize: 11.5,
              fontWeight: 700,
              lineHeight: 1.4,
            }}
          >
            Guarda esta platica aparte, no la mezcles con la caja del negocio.
          </div>
        </div>
      </Card>

      <AIBubble title="¿Cuándo se paga cada cosa?" onAsk={() => go('fechas')}>
        prima en junio y diciembre, cesantías antes del 14 de febrero al fondo... pregúntale a la
        IA por las fechas exactas.
      </AIBubble>
    </Stack>
  );
}

export default Prestaciones;
