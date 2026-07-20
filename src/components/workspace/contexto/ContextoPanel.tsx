'use client';

// Panel "Contexto de la empresa": lista/filtra/registra/edita/revoca hechos.
// Comparte el handler de mutación con el chat vía las Server Actions.

import { useMemo, useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';
import type { FactDTO } from '@/lib/facts/dto';
import type { FactFormState } from '@/lib/facts/panel-helpers';
import { buildRegistrarInput, factToFormState, versionHistoryFor } from '@/lib/facts/panel-helpers';
import {
  registerManualFactAction,
  revokeFactAction,
} from '@/lib/facts/actions/contexto-actions';
import { FactCard } from './FactCard';
import { FactForm } from './FactForm';

const EMPTY_FORM: FactFormState = {
  kind: 'narrative', title: '', body: '', fiscalPeriod: '', montoPesos: '', articulo: '257',
};

type KindFilter = 'all' | 'narrative' | 'donation';

export function ContextoPanel({ facts }: { facts: FactDTO[] }) {
  const { language } = useLanguage();
  const router = useRouter();
  const t = (es: string, en: string) => (language === 'es' ? es : en);

  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  const [onlyActive, setOnlyActive] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<FactFormState>(EMPTY_FORM);
  // Remonta FactForm al cambiar de destino (registrar vs editar A vs editar B):
  // FactForm siembra su estado interno con `initial` SOLO en el mount.
  const [editKey, setEditKey] = useState('new');
  const [formError, setFormError] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const periods = useMemo(() => {
    const set = new Set<string>();
    for (const f of facts) if (f.fiscalPeriod) set.add(f.fiscalPeriod);
    return [...set].sort().reverse();
  }, [facts]);

  const visible = useMemo(() => {
    return facts.filter((f) => {
      if (onlyActive && f.status !== 'active') return false;
      if (kindFilter !== 'all' && f.kind !== kindFilter) return false;
      if (periodFilter !== 'all' && f.fiscalPeriod !== periodFilter) return false;
      return true;
    });
  }, [facts, onlyActive, kindFilter, periodFilter]);

  const openRegister = useCallback(() => {
    setFormInitial(EMPTY_FORM);
    setEditKey('new');
    setFormError(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((fact: FactDTO) => {
    setFormInitial(factToFormState(fact));
    setEditKey(fact.id);
    setFormError(null);
    setFormOpen(true);
  }, []);

  const submit = useCallback(
    (form: FactFormState) => {
      setFormError(null);
      startTransition(async () => {
        const res = await registerManualFactAction(buildRegistrarInput(form));
        if (res.ok) {
          setFormOpen(false);
          router.refresh();
        } else {
          setFormError(res.message);
        }
      });
    },
    [router],
  );

  const revoke = useCallback(
    (fact: FactDTO) => {
      const msg =
        language === 'es'
          ? '¿Revocar este hecho? No se borra (queda como revocado).'
          : 'Revoke this fact? It is soft-deleted, never erased.';
      if (!window.confirm(msg)) return;
      startTransition(async () => {
        const res = await revokeFactAction(fact.id);
        if (res.ok) router.refresh();
        else window.alert(res.message);
      });
    },
    [router, language],
  );

  const toggleHistory = useCallback((fact: FactDTO) => {
    setOpenHistory((prev) => {
      const next = new Set(prev);
      if (next.has(fact.id)) next.delete(fact.id);
      else next.add(fact.id);
      return next;
    });
  }, []);

  const selectCls = cn(
    'h-9 px-2 rounded-lg border bg-n-0 border-n-200 text-xs text-n-1000',
    'focus:outline-none focus:border-gold-500/60 focus-visible:ring-2 focus-visible:ring-gold-500/40',
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8 md:py-10">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Info className="h-4 w-4 text-gold-500" aria-hidden="true" />
          <p className="font-mono text-xs uppercase tracking-widest text-gold-600 font-semibold">
            {t('Memoria de contexto', 'Context memory')}
          </p>
        </div>
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <h1 className="font-serif text-3xl font-bold text-n-1000 tracking-tight">
            {t('Contexto de la empresa', 'Company context')}
          </h1>
          <button
            type="button"
            onClick={openRegister}
            className={cn(
              'inline-flex items-center gap-1.5 h-10 px-4 rounded-lg',
              'bg-gold-500 text-n-0 text-sm font-semibold hover:bg-gold-600 transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
            )}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('Registrar hecho', 'Add fact')}
          </button>
        </div>
        <p className="mt-1.5 text-sm text-n-700 max-w-xl">
          {t(
            'Los hechos duraderos de tu negocio que alimentan tus reportes. Editar crea una versión nueva; revocar nunca borra (auditoría DIAN).',
            'Durable facts about your business that feed your reports. Editing creates a new version; revoking never erases (DIAN audit).',
          )}
        </p>
      </header>

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <select className={selectCls} value={kindFilter} onChange={(e) => setKindFilter(e.target.value as KindFilter)} aria-label={t('Filtrar por tipo', 'Filter by kind')}>
          <option value="all">{t('Todos los tipos', 'All kinds')}</option>
          <option value="narrative">{t('Narrativos', 'Narrative')}</option>
          <option value="donation">{t('Donaciones', 'Donations')}</option>
        </select>
        <select className={selectCls} value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} aria-label={t('Filtrar por período', 'Filter by period')}>
          <option value="all">{t('Todos los períodos', 'All periods')}</option>
          {periods.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1.5 text-xs text-n-800 select-none cursor-pointer">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} className="accent-gold-500" />
          {t('Solo activos', 'Active only')}
        </label>
      </div>

      {formOpen && (
        <div className="mb-5">
          <FactForm
            key={editKey}
            initial={formInitial}
            submitting={pending}
            error={formError}
            language={language}
            onSubmit={submit}
            onCancel={() => setFormOpen(false)}
          />
        </div>
      )}

      {/* Lista */}
      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-n-200 py-12 text-center">
          <p className="text-sm text-n-700">
            {t('Aún no hay hechos que coincidan. Regístralos aquí o menciónalos en el chat.', 'No matching facts yet. Add them here or mention them in chat.')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((fact) => {
            const history = fact.status === 'active' ? versionHistoryFor(fact, facts) : [];
            const isOpen = openHistory.has(fact.id);
            return (
              <div key={fact.id}>
                <FactCard
                  fact={fact}
                  language={language}
                  onEdit={openEdit}
                  onRevoke={revoke}
                  onToggleHistory={toggleHistory}
                  historyCount={history.length}
                  historyOpen={isOpen}
                />
                {isOpen && history.length > 0 && (
                  <ul className="mt-1 ml-3 border-l border-n-200 pl-3 space-y-1">
                    {history.map((h) => (
                      <li key={h.id} className="text-xs text-n-600">
                        <span className="font-mono text-[10px] text-n-500">
                          {new Date(h.createdAt).toLocaleDateString(language === 'es' ? 'es-CO' : 'en-US')}
                        </span>{' '}
                        · {h.title}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ContextoPanel;
