'use client';
/**
 * Cifras2026 — tabla de referencia normativa 2026 ("las cuentas claras de este
 * año"): lo básico del sueldo, lo que se aporta (PILA), horas extra y recargos,
 * y los topes que conviene tener a la mano.
 *
 * Pantalla de solo lectura. Reproduce el lenguaje visual de MiEquipoNomina
 * (header verde, cards tituladas con KVRow, montos en DM Mono) y deriva TODO
 * número de NORMATIVA_2026 y calc — nunca formatea a mano.
 *
 * Texto en español de barrio; la norma va como nota gris pequeña.
 */
import React from 'react';
import { PYME } from '../design/tokens';
import { NORMATIVA_2026 as N } from '../data/normativa2026';
import { RECARGO_HORA } from '../data/calc';
import {
  SectionHeader,
  Card,
  KVRow,
  Money,
  Rate,
  AIBubble,
  Stack,
  NotaNormativa,
  monoFont,
} from '../design/primitives';
import type { ScreenProps } from './PymeShell';

/** Título verde de cada card de referencia. */
function CardTitulo({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: PYME.greenDark,
        fontSize: 13,
        fontWeight: 800,
        lineHeight: 1.2,
        marginBottom: 2,
      }}
    >
      {children}
    </div>
  );
}

/** Bajada barrio de la card (gris, debajo del título). */
function CardBajada({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: PYME.textSec, fontSize: 10.5, lineHeight: 1.35, marginBottom: 2 }}>
      {children}
    </div>
  );
}

/** Etiqueta gris "patrón" / "trabajador" al lado de una tasa. */
function QuienPaga({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ color: PYME.textHint, fontSize: 10, fontWeight: 700 }}>{children}</span>
  );
}

/** Separador gris ("/" o "+") entre dos tasas. */
function SepTasa({ children }: { children: React.ReactNode }) {
  return <span style={{ color: PYME.textHint, fontSize: 11 }}>{children}</span>;
}

const tasaRowStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

export function Cifras2026({ go }: ScreenProps) {
  return (
    <Stack gap={12}>
      <SectionHeader
        icon="📊"
        title="Las cifras del 2026"
        subtitle="Todo lo que cambió este año, en plata"
      />

      {/* ── Lo básico del sueldo ── */}
      <Card>
        <CardTitulo>Lo básico del sueldo</CardTitulo>
        <Stack gap={0}>
          <KVRow label="Sueldo mínimo" nota="Decreto 2673/2025">
            <Money value={N.SMMLV} kind="navy" />
          </KVRow>
          <KVRow label="Auxilio de transporte" nota="si gana hasta 2 mínimos">
            <Money value={N.AUX_TRANSPORTE} kind="navy" />
          </KVRow>
          <KVRow label="Mínimo en la mano (sueldo + aux)" emphasis>
            <Money value={N.TOTAL_MINIMO} kind="total" />
          </KVRow>
          <KVRow label="Jornada de la semana" nota="Ley 2101/2021">
            <span style={{ ...monoFont, color: PYME.navy, fontSize: 14, fontWeight: 600 }}>
              {N.JORNADA_SEMANAL} h
            </span>
          </KVRow>
          <KVRow label="Lo que vale una hora normal" nota="mínimo ÷ 182 horas/mes">
            <Money value={N.HORA_ORDINARIA} kind="navy" />
          </KVRow>
        </Stack>
      </Card>

      {/* ── Lo que se aporta cada mes (la norma "PILA" va como nota) ── */}
      <Card>
        <CardTitulo>Lo que se aporta cada mes</CardTitulo>
        <CardBajada>Lo que sale del bolsillo de cada uno, mes a mes.</CardBajada>
        <div style={{ marginBottom: 4 }}>
          <NotaNormativa>En el banco esto aparece como «PILA» · planilla de aportes</NotaNormativa>
        </div>
        <Stack gap={0}>
          <KVRow label="Salud" nota="Ley 100/1993 Art.204">
            <span style={tasaRowStyle}>
              <Rate value={N.PILA.salud.empleador} />
              <QuienPaga>patrón</QuienPaga>
              <SepTasa>/</SepTasa>
              <Rate value={N.PILA.salud.empleado} color={PYME.greenLight} />
              <QuienPaga>trabajador</QuienPaga>
            </span>
          </KVRow>
          <KVRow label="Pensión" nota="Ley 100/1993 Art.20">
            <span style={tasaRowStyle}>
              <Rate value={N.PILA.pension.empleador} />
              <QuienPaga>patrón</QuienPaga>
              <SepTasa>/</SepTasa>
              <Rate value={N.PILA.pension.empleado} color={PYME.greenLight} />
              <QuienPaga>trabajador</QuienPaga>
            </span>
          </KVRow>
          <KVRow label="ARL (riesgo I)" nota="Decreto 1607/2002">
            <span style={tasaRowStyle}>
              <Rate value={N.PILA.arlClaseI.empleador} />
              <QuienPaga>patrón</QuienPaga>
            </span>
          </KVRow>
          <KVRow label="Caja de compensación" nota="Ley 21/1982">
            <span style={tasaRowStyle}>
              <Rate value={N.PILA.ccf.empleador} />
              <QuienPaga>patrón</QuienPaga>
            </span>
          </KVRow>
          <KVRow
            label="SENA + ICBF"
            nota="exentos si el sueldo es menor a 10 mínimos · Ley 1607/2012"
          >
            <span style={tasaRowStyle}>
              <Rate value={N.PILA.sena.empleador} />
              <SepTasa>+</SepTasa>
              <Rate value={N.PILA.icbf.empleador} />
              <QuienPaga>patrón</QuienPaga>
            </span>
          </KVRow>
        </Stack>
      </Card>

      {/* ── Horas extra y recargos ── */}
      <Card>
        <CardTitulo>Horas extra y recargos</CardTitulo>
        <CardBajada>Si te toca pagar horas de más.</CardBajada>
        <Stack gap={0}>
          <KVRow label="Hora extra de día" nota="+25% · Art.159-171 CST">
            <Money value={RECARGO_HORA.extraDiurna} kind="navy" />
          </KVRow>
          <KVRow label="Hora extra de noche" nota="+75%">
            <Money value={RECARGO_HORA.extraNocturna} kind="navy" />
          </KVRow>
          <KVRow label="Hora normal de noche" nota="recargo +35%, no es extra">
            <Money value={RECARGO_HORA.nocturna} kind="navy" />
          </KVRow>
          <KVRow label="Domingo o festivo de día" nota="+75%">
            <Money value={RECARGO_HORA.dominicalDiurna} kind="navy" />
          </KVRow>
          <KVRow label="Extra de noche en domingo" nota="+110%">
            <Money value={RECARGO_HORA.extraDominicalNocturna} kind="navy" />
          </KVRow>
        </Stack>
      </Card>

      {/* ── Topes que conviene saber ── */}
      <Card>
        <CardTitulo>Topes que conviene saber</CardTitulo>
        <Stack gap={0}>
          <KVRow label="Tope para dar auxilio" nota="2 SMMLV">
            <Money value={N.LIM_AUX_TRANSPORTE} kind="navy" />
          </KVRow>
          <KVRow label="Tope para no pagar SENA/ICBF" nota="10 SMMLV · Ley 1607/2012">
            <Money value={N.LIM_EXENTO_PARAFISCAL} kind="navy" />
          </KVRow>
          <KVRow
            label="UVT (para impuestos)"
            nota="OJO: pendiente confirmar Resolución DIAN 2026"
          >
            <Money value={N.UVT} kind="navy" />
          </KVRow>
        </Stack>
      </Card>

      <AIBubble title="¿No te cuadra alguna cifra?" onAsk={() => go('equipo')}>
        Si ves un número que no te suena, escríbele a la IA: «¿de dónde sale el mínimo en la mano?»
        o «¿por qué pago tanto de salud?» y te lo desmenuza con plata, sin palabras raras.
      </AIBubble>
    </Stack>
  );
}

export default Cifras2026;
