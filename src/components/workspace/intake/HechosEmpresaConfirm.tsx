'use client';

import { useEffect, useState } from 'react';
import { getActiveNarrativesForReportAction } from '@/lib/facts/actions/report-facts-actions';
import type { FactDTO } from '@/lib/facts/dto';

interface HechosEmpresaConfirmProps {
  fiscalPeriod: string;
  /** IDs actualmente EXCLUIDOS (controlado por el padre). */
  excludedIds: string[];
  onToggle: (factId: string) => void;
  language: 'es' | 'en';
}

/**
 * Confirmación human-in-the-loop pre-reporte (Ola 2): lista los hechos NARRATIVOS
 * del negocio que se incluirán como contexto en el reporte, con un toggle por hecho
 * para EXCLUIRLO sólo en esta corrida (no muta la DB). Sólo se muestra si hay hechos.
 */
export function HechosEmpresaConfirm({
  fiscalPeriod,
  excludedIds,
  onToggle,
  language,
}: HechosEmpresaConfirmProps) {
  const t = (es: string, en: string) => (language === 'es' ? es : en);
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; facts: FactDTO[] } | { status: 'error' }
  >({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    getActiveNarrativesForReportAction(fiscalPeriod)
      .then((facts) => {
        if (alive) setState({ status: 'ready', facts });
      })
      .catch(() => {
        if (alive) setState({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [fiscalPeriod]);

  if (state.status !== 'ready' || state.facts.length === 0) {
    // Silencioso: mientras carga, en error, o sin hechos → no se muestra nada
    // (evita el flash de "Cargando…" en Fase-1-anónima, donde el read action
    // habitualmente resuelve en []).
    return null;
  }

  const includedCount = state.facts.filter((f) => !excludedIds.includes(f.id)).length;

  return (
    <section className="rounded-xl border border-n-200 bg-n-50 p-4">
      <h4 className="text-sm font-semibold text-n-1000">
        {t(
          `${includedCount} hecho(s) del negocio se incluirán en este reporte`,
          `${includedCount} business fact(s) will be included in this report`,
        )}
      </h4>
      <p className="mt-1 text-xs text-n-700">
        {t(
          'Contexto para la redacción del reporte. Desmarca un hecho para excluirlo sólo en esta corrida (no se elimina).',
          'Context for the report narrative. Uncheck a fact to exclude it for this run only (it is not deleted).',
        )}
      </p>
      <ul className="mt-3 space-y-2">
        {state.facts.map((f) => {
          const included = !excludedIds.includes(f.id);
          return (
            <li key={f.id}>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() => onToggle(f.id)}
                  className="mt-1 h-4 w-4 accent-gold-500"
                />
                <span className="text-sm">
                  <span className="font-medium text-n-1000">{f.title}</span>
                  <span className="text-n-700">{f.body ? ` — ${f.body}` : ''}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
