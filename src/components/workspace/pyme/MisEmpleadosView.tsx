'use client';

/**
 * MisEmpleadosView — /workspace/pyme/empleados ("Mis Empleados").
 *
 * Diseño del handoff "Pyme - Mis Empleados.html" en estado HONESTO:
 * todavía no existe modelo de nómina/empleados en el backend (sin tabla,
 * sin API), así que la vista no inventa personas ni cifras — muestra el
 * marco visual del área con un estado vacío claro y la capacidad marcada
 * como "Próximamente".
 *
 * Cuando llegue el modelo de nómina (tabla empleados + aportes PILA), esta
 * vista recupera las tarjetas expandibles del prototipo con datos reales.
 */

import { Users } from 'lucide-react';
import { PymeSubpageShell } from '@/components/workspace/pyme/PymeSubpageShell';
import { PymeGreenHero } from '@/components/workspace/pyme/PymeGreenHero';

export function MisEmpleadosView() {
  return (
    <PymeSubpageShell>
      <PymeGreenHero
        title="Mis Empleados"
        subtitle="Lo que le cuesta cada persona y cuándo pagar su salud y pensión."
        metrics={[
          { value: '0', label: 'Personas' },
          { value: '—', label: 'Nómina al mes' },
          { value: '—', label: 'Carga prestacional' },
        ]}
      />

      {/* Estado vacío honesto */}
      <div className="rounded-2xl border border-area-pyme/25 bg-n-0 px-8 py-12 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-area-pyme/12 text-area-pyme">
          <Users className="h-7 w-7" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h2 className="font-serif-elite text-2xl font-medium text-n-1000">
          Aún no ha registrado empleados
        </h2>
        <p className="mx-auto mt-2 max-w-[48ch] text-sm leading-relaxed text-n-600">
          Aquí va a ver cuánto le cuesta cada persona (salario + salud, pensión
          y ARL), y le avisaremos antes de cada pago de seguridad social (PILA)
          para que nunca pague multas.
        </p>
        <button
          type="button"
          disabled
          title="Próximamente — el registro de empleados está en construcción"
          className="mt-6 inline-flex h-11 cursor-not-allowed items-center gap-2 rounded-md border-[1.5px] border-dashed border-area-pyme/40 bg-area-pyme/[0.07] px-5 text-[15px] font-semibold text-n-600"
        >
          Agregar empleado
          <span className="rounded-full bg-area-pyme/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2A5E1F] dark:text-area-pyme">
            Próximamente
          </span>
        </button>
      </div>

      {/* Contexto útil mientras tanto — normativa real, no datos inventados */}
      <div className="mt-4 rounded-xl border border-area-pyme/35 bg-area-pyme/[0.09] px-5 py-4">
        <p className="text-[15px] leading-relaxed text-n-700">
          Mientras tanto, recuerde: todo trabajador debe estar afiliado a EPS,
          pensión y ARL desde el primer día. Trabajar sin afiliación es un
          riesgo legal y económico grave — si se accidenta, responde usted de
          su bolsillo.
        </p>
      </div>
    </PymeSubpageShell>
  );
}
