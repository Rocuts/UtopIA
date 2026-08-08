'use client';
/**
 * MiEquipoNomina — dashboard del equipo de Don Carlos: a quién le paga, cuánto
 * se lleva cada uno a la casa, cuánto le cuesta de verdad y qué se vence pronto.
 *
 * Pantalla de referencia del módulo: fija el lenguaje visual (header verde,
 * alertas de 3 colores, total oscuro con monto en oro, cards de empleado y
 * burbuja IA) que el resto de pantallas reproduce.
 *
 * Texto en español de barrio; la norma va como nota gris pequeña.
 */
import React, { useState } from 'react';
import { PYME, RADIUS, WHITE, rgba, gradient } from '../design/tokens';
import { NORMATIVA_2026 as N } from '../data/normativa2026';
import {
  auxTransporteAplicable,
  pilaEmpleador,
  netoEmpleado,
  provisionesMensuales,
} from '../data/calc';
import {
  SectionHeader,
  Alert,
  TotalCard,
  Card,
  Avatar,
  Badge,
  Money,
  MetricChip,
  ActionButton,
  AIBubble,
  Stack,
  NotaNormativa,
  uiFont,
} from '../design/primitives';
import type { ScreenProps } from './PymeShell';

interface Empleado {
  id: string;
  nombre: string;
  iniciales: string;
  cargo: string;
  salario: number;
  estado: 'aldia' | 'vence';
  venceTexto?: string;
}

const EQUIPO: Empleado[] = [
  // Maicol al SMMLV exacto → su costo real es el caso canónico ($2.843.020).
  {
    id: 'e1',
    nombre: 'Maicol Restrepo',
    iniciales: 'MR',
    cargo: 'Mensajero',
    salario: N.SMMLV,
    estado: 'vence',
    venceTexto: 'Contrato vence en 5 días',
  },
  {
    id: 'e2',
    nombre: 'Yuli Gómez',
    iniciales: 'YG',
    cargo: 'Cajera',
    salario: 2_300_000,
    estado: 'aldia',
  },
  {
    id: 'e3',
    nombre: 'Beto Salcedo',
    iniciales: 'BS',
    cargo: 'Maestro de obra',
    salario: 2_800_000,
    estado: 'aldia',
  },
];

function metricasEmpleado(salario: number) {
  const aux = auxTransporteAplicable(salario);
  const devengado = salario + aux;
  const pilaPatron = Math.round(pilaEmpleador(salario).total);
  const provisiones = provisionesMensuales(salario, aux).total;
  const neto = Math.round(netoEmpleado(devengado, salario));
  // Costo real: suma de partes redondeadas (al SMMLV ⇒ exactamente $2.843.020).
  const costoReal = devengado + pilaPatron + provisiones;
  return { aux, devengado, pilaPatron, provisiones, neto, costoReal };
}

export function MiEquipoNomina({ go }: ScreenProps) {
  const [equipo] = useState<Empleado[]>(EQUIPO);
  const costoTotalEquipo = equipo.reduce((s, e) => s + metricasEmpleado(e.salario).costoReal, 0);

  return (
    <Stack gap={12}>
      <SectionHeader
        icon="👷"
        title="Mi equipo"
        subtitle="Tu nómina al día, sin enredos"
        right={
          <span
            style={{
              ...uiFont,
              background: rgba(WHITE, 0.15),
              color: WHITE,
              fontSize: 11,
              fontWeight: 800,
              padding: '3px 9px',
              borderRadius: 999,
            }}
          >
            {equipo.length} personas
          </span>
        }
      />

      {/* Alertas — las 3 variantes */}
      <Stack gap={8}>
        <Alert
          variant="red"
          icon="⏰"
          title="El contrato de Maicol se vence en 5 días"
          actionLabel="Renovar o liquidar"
          onAction={() => go('liquidarContrato')}
        >
          Decide ya si lo renuevas o lo liquidas, para no pagar de más después.
        </Alert>
        <Alert
          variant="amber"
          icon="📅"
          title="La seguridad social se paga antes del 17"
          actionLabel="Ver lo que toca pagar"
          onAction={() => go('pagos')}
        >
          Este mes te toca girar la salud y la pensión de los 3.{' '}
          <NotaNormativa>PILA · Ley 100/1993</NotaNormativa>
        </Alert>
        <Alert variant="green" icon="✅" title="Todo lo demás está al día este mes">
          Ya guardaste la platica de prima, cesantías y vacaciones de tu gente.
        </Alert>
      </Stack>

      {/* Total oscuro destacado */}
      <TotalCard
        label="Lo que te cuesta el equipo completo este mes"
        value={costoTotalEquipo}
        hint="Incluye sueldos, lo que le toca pagar al patrón y la platica que se guarda"
      />

      {/* Cards de empleado */}
      <Stack gap={10}>
        {equipo.map((e) => {
          const m = metricasEmpleado(e.salario);
          return (
            <Card key={e.id} pad={0} radius={RADIUS.lg} style={{ overflow: 'hidden' }}>
              {/* Header pálido */}
              <div
                style={{
                  background: gradient(135, PYME.bgPale, PYME.bgPale2),
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <Avatar initials={e.iniciales} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: PYME.greenDark, fontSize: 13.5, fontWeight: 800, lineHeight: 1.1 }}>
                    {e.nombre}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <span style={{ color: PYME.textSec, fontSize: 10.5 }}>{e.cargo}</span>
                    {e.estado === 'aldia' ? (
                      <Badge tone="success">✓ al día</Badge>
                    ) : (
                      <Badge tone="warn">⏳ vence</Badge>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Money value={e.salario} kind="navy" size={13} weight={700} />
                  <div style={{ color: PYME.textHint, fontSize: 9, marginTop: 1, ...uiFont }}>sueldo</div>
                </div>
              </div>

              {/* Cuerpo */}
              <div style={{ padding: '10px 12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  <MetricChip
                    label="Se lleva a casa"
                    value={<Money value={m.neto} kind="pos" size={12.5} weight={600} />}
                  />
                  <MetricChip
                    label="Pagas antes del 17"
                    value={<Money value={m.pilaPatron} kind="neg" size={12.5} weight={600} />}
                  />
                  <MetricChip
                    label="Te cuesta al mes"
                    value={<Money value={m.costoReal} kind="total" size={12.5} weight={600} />}
                  />
                </div>

                <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                  <ActionButton icon="🧮" label="Liquidar mes" onClick={() => go('pagos')} />
                  <ActionButton icon="🎁" label="Prestaciones" onClick={() => go('prestaciones')} />
                  <ActionButton icon="📄" label="Liquidar" onClick={() => go('liquidarContrato')} />
                </div>

                {e.estado === 'vence' && (
                  <div style={{ marginTop: 8 }}>
                    <NotaNormativa>
                      Contrato a término fijo · avisa con 30 días si no lo renuevas (Art. 46 CST)
                    </NotaNormativa>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </Stack>

      <AIBubble
        title="¿Te enredas con algún pago?"
        buttonLabel="Pregúntale a la IA"
        onAsk={() => go('fechas')}
      >
        Escríbele como le hablarías a tu contador de confianza: «¿cuánto le pago a Maicol si trabajó
        2 domingos?» y te lo explica con plata, sin palabras raras.
      </AIBubble>
    </Stack>
  );
}

export default MiEquipoNomina;
