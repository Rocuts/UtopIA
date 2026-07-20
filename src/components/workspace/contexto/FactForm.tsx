'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { FactFormState } from '@/lib/facts/panel-helpers';

const inputCls = cn(
  'w-full h-10 px-3 rounded-lg border bg-n-0 border-n-200',
  'text-sm text-n-1000 placeholder:text-n-500',
  'focus:outline-none focus:border-gold-500/60 focus-visible:ring-2 focus-visible:ring-gold-500/40 transition-colors',
);
const labelCls = 'block text-xs font-medium text-n-800 mb-1';

export function FactForm({
  initial,
  submitting,
  error,
  language,
  onSubmit,
  onCancel,
}: {
  initial: FactFormState;
  submitting: boolean;
  error: string | null;
  language: 'es' | 'en';
  onSubmit: (form: FactFormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FactFormState>(initial);
  const set = <K extends keyof FactFormState>(k: K, v: FactFormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const isDonation = form.kind === 'donation';
  const t = (es: string, en: string) => (language === 'es' ? es : en);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="rounded-xl border border-n-200 bg-n-0 p-4 space-y-3"
    >
      <div>
        <label className={labelCls}>{t('Tipo de hecho', 'Fact type')}</label>
        <select
          value={form.kind}
          onChange={(e) => set('kind', e.target.value as FactFormState['kind'])}
          className={inputCls}
          aria-label={t('Tipo de hecho', 'Fact type')}
        >
          <option value="narrative">{t('Narrativo (contexto)', 'Narrative (context)')}</option>
          <option value="donation">{t('Donación (Art. 257 E.T.)', 'Donation (Art. 257)')}</option>
        </select>
      </div>

      <div>
        <label className={labelCls}>{t('Título', 'Title')}</label>
        <input
          className={inputCls}
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          required
          maxLength={200}
          placeholder={t('Donación fundación X', 'Donation to foundation X')}
        />
      </div>

      <div>
        <label className={labelCls}>{t('Descripción', 'Description')}</label>
        <textarea
          className={cn(inputCls, 'h-auto min-h-[72px] py-2 resize-y')}
          value={form.body}
          onChange={(e) => set('body', e.target.value)}
          required
          placeholder={t('Anclado en tus palabras…', 'Anchored in your words…')}
        />
      </div>

      <div>
        <label className={labelCls}>
          {t('Período fiscal (año)', 'Fiscal period (year)')}
          {isDonation && <span className="text-danger"> *</span>}
        </label>
        <input
          className={inputCls}
          value={form.fiscalPeriod}
          onChange={(e) => set('fiscalPeriod', e.target.value)}
          maxLength={8}
          inputMode="numeric"
          placeholder="2026"
        />
      </div>

      {isDonation && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>
              {t('Monto donado (COP)', 'Donation amount (COP)')}<span className="text-danger"> *</span>
            </label>
            <input
              className={inputCls}
              value={form.montoPesos}
              onChange={(e) => set('montoPesos', e.target.value)}
              inputMode="numeric"
              placeholder="50000000"
            />
          </div>
          <div>
            <label className={labelCls}>{t('Artículo E.T.', 'E.T. article')}</label>
            <input
              className={inputCls}
              value={form.articulo}
              onChange={(e) => set('articulo', e.target.value)}
              placeholder="257"
            />
          </div>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 px-3 rounded-lg text-sm text-n-800 hover:text-n-1000 hover:bg-gold-500/6 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
        >
          {t('Cancelar', 'Cancel')}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className={cn(
            'h-9 px-4 rounded-lg text-sm font-semibold bg-gold-500 text-n-0',
            'hover:bg-gold-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {submitting ? t('Guardando…', 'Saving…') : t('Guardar', 'Save')}
        </button>
      </div>
    </form>
  );
}
