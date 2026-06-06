'use client';

// ---------------------------------------------------------------------------
// useAncoraView — fuente única del view-model AncoraView + bundle fiscal.
// ---------------------------------------------------------------------------
// Lee el Âncora + FiscalSnapshot del último reporte completado
// (`lastCompletedReport.report`, localStorage — flujo same-session). Si faltan,
// hace fallback best-effort a `GET /api/escudo/fiscal-anchor` (sobrevive refresh
// / multi-dispositivo). `view` SIEMPRE es un AncoraView válido (hasData:false
// cuando no hay datos ⇒ las áreas muestran su estado demo/placeholder).
//
// Bundle (aditivo, retro-compatible): además de `view` + `loading`, expone el
// `fiscalAnchor` / `riskScore` / `alertas` que El Escudo consume directo. Las
// alertas con id gestionado por DB SOLO vienen del GET, así que el GET se
// dispara también cuando la fuente local ya tiene datos (para enriquecerlas),
// igual que hacía `escudo/page.tsx` en su segundo effect.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';

import { useWorkspace } from '@/context/WorkspaceContext';
import { deriveAncoraView } from '@/lib/ancora/derive-ancora-view';
import type { AncoraView } from '@/lib/ancora/ancora-view';
import type { NiifAncora } from '@/lib/agents/financial/ancora/types';
import type { FiscalSnapshot, FiscalRiskScore } from '@/lib/agents/financial/types';
import type { FiscalAnchorBlock } from '@/lib/agents/financial/escudo-survival/fiscal-anchor/types';
import type { AlertView } from '@/lib/sentinel/alert-view';

export interface AncoraViewBundle {
  view: AncoraView;
  loading: boolean;
  fiscalAnchor: FiscalAnchorBlock | undefined;
  riskScore: FiscalRiskScore | undefined;
  alertas: AlertView[];
}

interface FiscalAnchorGetResponse {
  hasData?: boolean;
  ancora?: NiifAncora | null;
  fiscalSnapshot?: FiscalSnapshot | null;
  alertas?: AlertView[];
}

export function useAncoraView(): AncoraViewBundle {
  const { lastCompletedReport } = useWorkspace();
  const report = lastCompletedReport?.report ?? null;

  const localAncora: NiifAncora | null = report?.ancora ?? null;
  const localSnapshot: FiscalSnapshot | null = report?.fiscalSnapshot ?? null;
  const company = report?.company
    ? { name: report.company.name, nit: report.company.nit }
    : undefined;

  const [view, setView] = useState<AncoraView>(() =>
    deriveAncoraView(localAncora, localSnapshot, company),
  );
  const [loading, setLoading] = useState(false);
  const [fiscalAnchor, setFiscalAnchor] = useState<FiscalAnchorBlock | undefined>(
    () => localSnapshot?.anchor ?? undefined,
  );
  const [riskScore, setRiskScore] = useState<FiscalRiskScore | undefined>(
    () => localSnapshot?.riskScore ?? undefined,
  );
  const [alertas, setAlertas] = useState<AlertView[]>([]);

  const localNit = report?.company?.nit ?? null;

  useEffect(() => {
    // Recompute desde el reporte local en cada cambio.
    const local = deriveAncoraView(localAncora, localSnapshot, company);
    setView(local);
    setFiscalAnchor(localSnapshot?.anchor ?? undefined);
    setRiskScore(localSnapshot?.riskScore ?? undefined);

    const haveLocalData = local.hasData || Boolean(localSnapshot);

    // SIEMPRE intentamos el GET workspace-aware:
    //  - si NO hay datos locales: para hidratar view/anchor/riskScore/alertas.
    //  - si SÍ hay datos locales: solo para enriquecer `alertas` con ids DB
    //    (las alertas del snapshot local no tienen id gestionado por DB).
    let cancelled = false;
    if (!haveLocalData) setLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/escudo/fiscal-anchor', { method: 'GET' });
        if (!res.ok) return;
        const data = (await res.json()) as FiscalAnchorGetResponse;
        if (cancelled) return;

        if (Array.isArray(data.alertas) && data.alertas.length > 0) {
          setAlertas(data.alertas);
        }

        if (!haveLocalData) {
          const remote = deriveAncoraView(
            data.ancora ?? null,
            data.fiscalSnapshot ?? null,
            company,
          );
          if (remote.hasData) setView(remote);
          if (data.fiscalSnapshot?.anchor) {
            setFiscalAnchor(data.fiscalSnapshot.anchor);
          }
          if (data.fiscalSnapshot?.riskScore) {
            setRiskScore(data.fiscalSnapshot.riskScore);
          }
        }
      } catch {
        // best-effort: mantenemos lo que tengamos (estado demo si no hay nada).
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localAncora, localSnapshot, localNit]);

  return { view, loading, fiscalAnchor, riskScore, alertas };
}
