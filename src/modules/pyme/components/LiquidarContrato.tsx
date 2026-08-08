'use client';
/**
 * LiquidarContrato — calculadora de liquidación definitiva: cuánto se le debe
 * a alguien cuando se va (renuncia, despido, mutuo acuerdo o justa causa).
 *
 * Sub-vista empujada desde "Mi equipo" → lleva botón Atrás arriba. Header verde,
 * inputs de sueldo/antigüedad/causa, resultado concepto por concepto y total
 * oscuro con monto en oro. Texto en español de barrio; la norma va como nota
 * gris pequeña.
 */
import React, { useState } from 'react';
import { PYME } from '../design/tokens';
import { NORMATIVA_2026 as N } from '../data/normativa2026';
import { auxTransporteAplicable, liquidacion, type CausaTerminacion } from '../data/calc';
import {
  SectionHeader,
  Card,
  KVRow,
  Money,
  Alert,
  TotalCard,
  AIBubble,
  PillButton,
  FieldLabel,
  NumberInput,
  Segmented,
  NotaNormativa,
  Stack,
} from '../design/primitives';
import type { ScreenProps } from './PymeShell';

const CAUSAS: { value: CausaTerminacion; label: string }[] = [
  { value: 'renuncia', label: 'Renunció' },
  { value: 'despido_sin_justa_causa', label: 'Despido' },
  { value: 'mutuo_acuerdo', label: 'Mutuo' },
  { value: 'justa_causa', label: 'Con justa causa' },
];

export function LiquidarContrato({ go }: ScreenProps) {
  const [salario, setSalario] = useState<number>(N.SMMLV);
  const [diasTotales, setDiasTotales] = useState<number>(360);
  const [causa, setCausa] = useState<CausaTerminacion>('renuncia');

  const aux = auxTransporteAplicable(salario);
  const r = liquidacion({ salario, auxTransporte: aux, diasTotales, causa });

  return (
    <Stack gap={12}>
      <div>
        <PillButton tone="neutral" onClick={() => go('equipo')}>
          ← Volver
        </PillButton>
      </div>

      <SectionHeader
        icon="📄"
        title="Liquidar a alguien"
        subtitle="Cuánto se le debe cuando se va"
      />

      {/* Inputs */}
      <Card pad="0.85rem">
        <Stack gap={12}>
          <div style={{ color: PYME.greenDark, fontSize: 13, fontWeight: 800 }}>
            ¿Quién se va y desde cuándo?
          </div>

          <div>
            <FieldLabel>Sueldo</FieldLabel>
            <NumberInput value={salario} onChange={setSalario} step={50_000} />
          </div>

          <div>
            <FieldLabel>Días que trabajó en total</FieldLabel>
            <NumberInput value={diasTotales} onChange={setDiasTotales} suffix="días" />
            <div style={{ marginTop: 4 }}>
              <NotaNormativa>cuenta desde que entró hasta el último día</NotaNormativa>
            </div>
          </div>

          <div>
            <FieldLabel>¿Por qué se va?</FieldLabel>
            <Segmented<CausaTerminacion> options={CAUSAS} value={causa} onChange={setCausa} />
          </div>
        </Stack>
      </Card>

      {/* Resultado */}
      <Card pad="0.85rem">
        <div style={{ color: PYME.greenDark, fontSize: 13, fontWeight: 800, marginBottom: 4 }}>
          Lo que se le debe
        </div>

        <KVRow label="Cesantías" nota="su ahorro acumulado">
          <Money value={r.cesantias} kind="ink" />
        </KVRow>

        <KVRow label="Intereses de cesantías" nota="Ley 52/1975">
          <Money value={r.interesesCesantias} kind="ink" />
        </KVRow>

        <KVRow label="Prima proporcional" nota="lo que alcanzó del semestre">
          <Money value={r.primaProporcional} kind="ink" />
        </KVRow>

        <KVRow label="Vacaciones" nota="los días que no se tomó">
          <Money value={r.vacaciones} kind="ink" />
        </KVRow>

        {r.tieneIndemnizacion ? (
          <KVRow label="Indemnización por despido" nota="Art. 64 CST · Ley 789/2002">
            <Money value={r.indemnizacion} kind="neg" />
          </KVRow>
        ) : (
          <div style={{ marginTop: 10 }}>
            <Alert variant="green" icon="✅" title="Sin indemnización, y está bien">
              Como{' '}
              {causa === 'renuncia'
                ? 'renunció por su cuenta'
                : 'no fue un despido sin justa causa'}
              , no hay que pagar indemnización. Eso es lo normal.
            </Alert>
          </div>
        )}

        <KVRow label="Total a pagar" emphasis>
          <Money value={r.total} kind="total" />
        </KVRow>
      </Card>

      <TotalCard
        label="En total, la liquidación queda en"
        value={r.total}
        hint={
          r.tieneIndemnizacion
            ? 'incluye la indemnización por despido'
            : 'sin indemnización'
        }
      />

      <AIBubble title="¿Dudas con la liquidación?" onAsk={() => go('equipo')}>
        Escríbele como le hablarías a tu contador de confianza: «¿y si lo despido sin justa
        causa cuánto cambia?» y la IA te lo compara, con plata, sin palabras raras.
      </AIBubble>
    </Stack>
  );
}

export default LiquidarContrato;
