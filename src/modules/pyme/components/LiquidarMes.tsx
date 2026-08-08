'use client';
/**
 * LiquidarMes — calculadora de nómina del mes: "cuánto le pago este mes".
 *
 * Don Carlos teclea cómo trabajó el empleado (sueldo, días, extras, domingos,
 * otros descuentos) y la pantalla le muestra, con plata clara, lo que se ganó,
 * lo que se le descuenta, lo que se lleva a la casa, lo que le toca aportar al
 * patrón y, al final, lo que le cuesta de verdad ese empleado este mes.
 *
 * Toda la matemática normativa sale de `data/calc.ts`; ningún número se formatea
 * a mano. Texto en español de barrio; la norma va como nota gris pequeña.
 */
import React, { useState } from 'react';
import { PYME } from '../design/tokens';
import { NORMATIVA_2026 as N } from '../data/normativa2026';
import {
  auxTransporteAplicable,
  pilaEmpleado,
  pilaEmpleador,
  horaExtraDiurna,
  dominicalDiurnoDia,
  netoEmpleado,
  costoRealEmpleado,
} from '../data/calc';
import {
  SectionHeader,
  Card,
  KVRow,
  Money,
  Rate,
  TotalCard,
  Alert,
  AIBubble,
  FieldLabel,
  NumberInput,
  NotaNormativa,
  Stack,
  uiFont,
} from '../design/primitives';
import type { ScreenProps } from './PymeShell';

export function LiquidarMes({ go }: ScreenProps) {
  const [salario, setSalario] = useState<number>(N.SMMLV);
  const [diasTrabajados, setDiasTrabajados] = useState<number>(30);
  const [horasExtraDiurnas, setHorasExtraDiurnas] = useState<number>(0);
  const [domingosTrabajados, setDomingosTrabajados] = useState<number>(0);
  const [otrosDescuentos, setOtrosDescuentos] = useState<number>(0);

  // ── Cálculo (montos derivados solo con funciones de calc.ts) ──
  const aux = auxTransporteAplicable(salario);
  // ASUNCIÓN: calc.ts no expone un prorrateo del devengado base; se prorratea el
  // sueldo y el auxilio por días/30 (misma convención diaria que dominicalDiurnoDia).
  const sueldoProrateado = salario * (diasTrabajados / 30);
  const auxProrateado = aux * (diasTrabajados / 30);
  const extras = horaExtraDiurna() * horasExtraDiurnas; // valor hora ya recargada × cantidad
  const dominicales = dominicalDiurnoDia(salario) * domingosTrabajados;
  const devengado = sueldoProrateado + auxProrateado + extras + dominicales;

  const pEmpleado = pilaEmpleado(salario, diasTrabajados);
  const pPatron = pilaEmpleador(salario, diasTrabajados);
  // Neto y costo real SIEMPRE desde calc.ts (no recalcular la fórmula a mano).
  const neto = netoEmpleado(devengado, salario, diasTrabajados, otrosDescuentos);
  // Costo del mes = devengado + PILA patrón; sin provisiones (esto es caja del mes).
  const costoReal = costoRealEmpleado(devengado, salario, diasTrabajados, 0);

  return (
    <Stack gap={12}>
      <SectionHeader
        icon="🧮"
        title="Liquidar el mes"
        subtitle="Cuánto recibe y cuánto te cuesta"
      />

      {/* ── Entrada: cómo trabajó este mes ── */}
      <Card>
        <div style={{ color: PYME.greenDark, fontSize: 13, fontWeight: 800, ...uiFont }}>
          ¿Cómo trabajó este mes?
        </div>

        <div style={{ marginTop: 12 }}>
          <FieldLabel>Sueldo del mes</FieldLabel>
          <NumberInput value={salario} onChange={(v) => setSalario(v)} step={50_000} />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            marginTop: 12,
          }}
        >
          <div>
            <FieldLabel>Días trabajados</FieldLabel>
            <NumberInput
              value={diasTrabajados}
              onChange={(v) => setDiasTrabajados(v)}
              suffix="días"
            />
          </div>
          <div>
            <FieldLabel>Horas extra de día</FieldLabel>
            <NumberInput
              value={horasExtraDiurnas}
              onChange={(v) => setHorasExtraDiurnas(v)}
              suffix="h"
            />
          </div>
          <div>
            <FieldLabel>Domingos / festivos</FieldLabel>
            <NumberInput
              value={domingosTrabajados}
              onChange={(v) => setDomingosTrabajados(v)}
              suffix="días"
            />
          </div>
          <div>
            <FieldLabel>Otros descuentos</FieldLabel>
            <NumberInput
              value={otrosDescuentos}
              onChange={(v) => setOtrosDescuentos(v)}
              step={10_000}
            />
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          <NotaNormativa>
            Los "otros descuentos" son cosas como préstamos o adelantos que ya le diste.
          </NotaNormativa>
        </div>
      </Card>

      {/* ── Lo que se ganó este mes ── */}
      <Card>
        <div style={{ color: PYME.greenDark, fontSize: 13, fontWeight: 800, ...uiFont }}>
          Lo que se ganó este mes
        </div>
        <div style={{ marginTop: 2, marginBottom: 2 }}>
          <NotaNormativa>en la nómina a esto le dicen «devengado»</NotaNormativa>
        </div>

        <KVRow label="Sueldo">
          <Money value={sueldoProrateado} kind="pos" />
        </KVRow>

        {auxProrateado > 0 && (
          <KVRow label="Auxilio de transporte" nota="no es salario, pero se paga">
            <Money value={auxProrateado} kind="pos" />
          </KVRow>
        )}

        {extras > 0 && (
          <KVRow label="Horas extra de día" nota="Art. 159 CST">
            <Money value={extras} kind="pos" />
          </KVRow>
        )}

        {dominicales > 0 && (
          <KVRow label="Domingos / festivos">
            <Money value={dominicales} kind="pos" />
          </KVRow>
        )}

        <KVRow label="Total que se ganó" emphasis>
          <Money value={devengado} kind="pos" weight={800} />
        </KVRow>
      </Card>

      {/* ── Lo que se le descuenta ── */}
      <Card>
        <div style={{ color: PYME.greenDark, fontSize: 13, fontWeight: 800, ...uiFont }}>
          Lo que se le descuenta
        </div>

        <KVRow
          label={
            <span>
              Salud <Rate value={N.PILA.salud.empleado} size={11} />
            </span>
          }
        >
          <Money value={pEmpleado.salud} kind="neg" prefix="−" />
        </KVRow>

        <KVRow
          label={
            <span>
              Pensión <Rate value={N.PILA.pension.empleado} size={11} />
            </span>
          }
        >
          <Money value={pEmpleado.pension} kind="neg" prefix="−" />
        </KVRow>

        {otrosDescuentos > 0 && (
          <KVRow label="Otros (préstamos, etc.)">
            <Money value={otrosDescuentos} kind="neg" prefix="−" />
          </KVRow>
        )}

        <div style={{ marginTop: 8 }}>
          <NotaNormativa>PILA empleado · Ley 100/1993</NotaNormativa>
        </div>
      </Card>

      {/* ── Lo que se lleva a la casa ── */}
      <TotalCard label="Lo que se lleva a la casa" value={neto} />

      {/* ── Lo que te toca pagar a vos (patrón) ── */}
      <Card>
        <div style={{ color: PYME.greenDark, fontSize: 13, fontWeight: 800, ...uiFont }}>
          Lo que te toca pagar a vos (patrón)
        </div>

        <KVRow
          label={
            <span>
              Salud <Rate value={N.PILA.salud.empleador} size={11} />
            </span>
          }
        >
          <Money value={pPatron.salud} kind="neg" />
        </KVRow>

        <KVRow
          label={
            <span>
              Pensión <Rate value={N.PILA.pension.empleador} size={11} />
            </span>
          }
        >
          <Money value={pPatron.pension} kind="neg" />
        </KVRow>

        <KVRow
          label={
            <span>
              ARL <Rate value={N.PILA.arlClaseI.empleador} size={11} />
            </span>
          }
          nota="riesgo I"
        >
          <Money value={pPatron.arl} kind="neg" />
        </KVRow>

        <KVRow
          label={
            <span>
              Caja de compensación <Rate value={N.PILA.ccf.empleador} size={11} />
            </span>
          }
        >
          <Money value={pPatron.ccf} kind="neg" />
        </KVRow>

        {pPatron.exentoParafiscal ? (
          <KVRow label="SENA + ICBF" nota="exento por ganar menos de 10 mínimos">
            <Money value={0} kind="neg" />
          </KVRow>
        ) : (
          <>
            <KVRow
              label={
                <span>
                  SENA <Rate value={N.PILA.sena.empleador} size={11} />
                </span>
              }
            >
              <Money value={pPatron.sena} kind="neg" />
            </KVRow>
            <KVRow
              label={
                <span>
                  ICBF <Rate value={N.PILA.icbf.empleador} size={11} />
                </span>
              }
            >
              <Money value={pPatron.icbf} kind="neg" />
            </KVRow>
          </>
        )}

        <KVRow label="Aportes del patrón antes del 17" emphasis>
          <Money value={pPatron.total} kind="neg" weight={800} />
        </KVRow>

        <div style={{ marginTop: 8 }}>
          <NotaNormativa>PILA empleador</NotaNormativa>
        </div>
      </Card>

      {/* ── Lo que cuesta de verdad este mes ── */}
      <TotalCard
        label="En total, este empleado te cuesta"
        value={costoReal}
        hint="lo que recibe + lo que aportas vos"
      />

      {/* ── Aviso: incapacidad / ATEL ── */}
      <Alert variant="amber" icon="🩺" title="¿Se incapacitó?">
        Si fue por enfermedad común, los 2 primeros días los pagas tú al 66,67% del sueldo del día;
        del 3.º en adelante responde la EPS. Si fue por accidente de trabajo (ATEL), eso es más
        enredado — consúltalo, no lo calcules aquí.{' '}
        <NotaNormativa>Incapacidad común vs ATEL</NotaNormativa>
      </Alert>

      <AIBubble title="¿Algo no te cuadra?" onAsk={() => go('fechas')}>
        Cuéntale a la IA cómo trabajó tu gente este mes —«¿cuánto le pago si me hizo 3 horas
        extra y un domingo?»— y te lo desglosa en plata, sin enredos de contador.
      </AIBubble>
    </Stack>
  );
}

export default LiquidarMes;