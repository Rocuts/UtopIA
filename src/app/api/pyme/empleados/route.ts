import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/db/pyme-empleados';
import { createEmpleadoBodySchema } from '@/lib/validation/pyme-schemas';
import { requireAuthSession } from '@/lib/auth/require-session';
import {
  aporteIndependiente,
  costoEmpleado,
  type ArlClase,
} from '@/lib/payroll/prestaciones';
import type { PymeEmpleado } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// /api/pyme/empleados — nómina simple del workspace (Ola 8).
// ---------------------------------------------------------------------------
// GET:  lista personas activas + desglose de costo/aporte calculado en
//       runtime (src/lib/payroll — los factores legales cambian por reforma,
//       nunca se persisten cálculos).
// POST: registra una persona (empleado con contrato o dueño independiente).
//
// `numeric` llega como string desde drizzle — se convierte antes de calcular.
// ---------------------------------------------------------------------------

const MAX_JSON_BODY = 64 * 1024;

export interface EmpleadoConCosto {
  empleado: Omit<PymeEmpleado, 'salarioCop'> & { salarioCop: number };
  /** Desglose mensual: costo total (empleado) o aporte (dueño). */
  costo:
    | { kind: 'empleado'; data: ReturnType<typeof costoEmpleado> }
    | { kind: 'dueno'; data: ReturnType<typeof aporteIndependiente> };
}

function withCosto(e: PymeEmpleado): EmpleadoConCosto {
  const salario = Number(e.salarioCop);
  const base = { ...e, salarioCop: salario };
  if (e.tipo === 'dueno') {
    return { empleado: base, costo: { kind: 'dueno', data: aporteIndependiente(salario) } };
  }
  const clase = (e.arlClase ?? 1) as ArlClase;
  return { empleado: base, costo: { kind: 'empleado', data: costoEmpleado(salario, clase) } };
}

export async function GET() {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const ws = await getOrCreateWorkspace();
    const rows = await repo.listEmpleados(ws.id);
    return NextResponse.json({ ok: true, empleados: rows.map(withCosto) });
  } catch (err) {
    return handleError(err, '[pyme/empleados][GET]');
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const contentLength = req.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_JSON_BODY) {
      return NextResponse.json(
        { ok: false, error: 'payload_too_large' },
        { status: 413 },
      );
    }

    const ws = await getOrCreateWorkspace();
    const body = createEmpleadoBodySchema.parse(await req.json());

    const created = await repo.createEmpleado({
      workspaceId: ws.id,
      nombre: body.nombre,
      tipo: body.tipo,
      cargo: body.cargo,
      tipoContrato: body.tipoContrato,
      salarioCop: body.salarioCop.toFixed(2),
      eps: body.eps,
      afp: body.afp,
      arl: body.arl,
      arlClase: body.arlClase,
    });

    return NextResponse.json({ ok: true, empleado: withCosto(created) }, { status: 201 });
  } catch (err) {
    return handleError(err, '[pyme/empleados][POST]');
  }
}

function handleError(err: unknown, tag: string) {
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { ok: false, error: 'invalid_input', details: err.flatten() },
      { status: 400 },
    );
  }
  console.error(tag, err);
  return NextResponse.json(
    { ok: false, error: 'internal_error' },
    { status: 500 },
  );
}
