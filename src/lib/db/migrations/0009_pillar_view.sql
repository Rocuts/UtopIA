-- ───────────────────────────────────────────────────────────────────────────
-- 0009_pillar_view — Ola 1+1 Élite (WS6.2)
--
-- Vista NO-materializada que agrega los KPIs de los 4 pilares en una sola
-- query indexable. Reemplaza las 3 queries SQL raw de
-- src/lib/kpis/pillar-view.ts (Resiliencia/Valor/Futuro). El KPI Verdad
-- (% pyme_entries confirmados) NO entra aquí porque no vive en
-- journal_lines — sigue computándose por separado.
--
-- IDempotente: CREATE OR REPLACE VIEW. Se puede re-aplicar sin downtime.
-- Si en el futuro la tabla journal_lines crece a millones de rows, se puede
-- promover a vista MATERIALIZED + cron de REFRESH (ver TODO al final).
--
-- Convenciones de nombres del PUC PYME (Decreto 2706/2012 + 2420/2015):
--   '1105*' Caja, '1110*' Bancos               → liquidez (Futuro+)
--   '21*' Obligaciones financieras + CxP corto → deuda (Futuro−)
--   '24*' Impuestos por pagar                  → Resiliencia
--   '4*'  Ingresos                             → Valor (+)
--   '5*'  Gastos operacionales                 → Valor (−)
--   '6*'  Costos                               → Valor (−)
--   '7*'  Costos de producción/servicio        → Valor (−)
--
-- IMPORTANTE: usa solo journal_lines de entries con status='posted'. Drafts
-- y reversed NO afectan la vista (los reversed se compensan con el reverso).
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW "pillar_kpis_view" AS
SELECT
  je.workspace_id,
  je.period_id,
  COUNT(DISTINCT je.id)::integer AS posted_entries_count,

  -- ─── Resiliencia: provisión total de impuestos por pagar (saldo crédito) ──
  COALESCE(
    SUM(
      CASE
        WHEN coa.code LIKE '24%'
        THEN jl.credit - jl.debit
        ELSE 0
      END
    ),
    0
  )::numeric(20, 2) AS resiliencia_total_provision_taxes_cop,

  -- ─── Valor: utilidad operacional ≈ ingresos − gastos − costos ────────────
  -- Ingresos suman al haber (credit-debit). Gastos/costos suman al debe.
  (
    COALESCE(
      SUM(
        CASE
          WHEN coa.code LIKE '4%'
          THEN jl.credit - jl.debit
          ELSE 0
        END
      ),
      0
    )
    - COALESCE(
      SUM(
        CASE
          WHEN coa.code LIKE '5%' OR coa.code LIKE '6%' OR coa.code LIKE '7%'
          THEN jl.debit - jl.credit
          ELSE 0
        END
      ),
      0
    )
  )::numeric(20, 2) AS valor_ebitda_cop,

  -- ─── Futuro: caja y bancos − obligaciones de corto plazo ─────────────────
  (
    COALESCE(
      SUM(
        CASE
          WHEN coa.code LIKE '1105%' OR coa.code LIKE '1110%'
          THEN jl.debit - jl.credit
          ELSE 0
        END
      ),
      0
    )
    - COALESCE(
      SUM(
        CASE
          WHEN coa.code LIKE '21%'
          THEN jl.credit - jl.debit
          ELSE 0
        END
      ),
      0
    )
  )::numeric(20, 2) AS futuro_free_cash_flow_cop

FROM journal_entries je
INNER JOIN journal_lines jl ON jl.entry_id = je.id
INNER JOIN chart_of_accounts coa ON coa.id = jl.account_id
WHERE je.status = 'posted'
GROUP BY je.workspace_id, je.period_id;

-- TODO WS6.3: si la vista se vuelve costosa cuando journal_lines crece más
-- allá de algunos millones de rows, promover a:
--   CREATE MATERIALIZED VIEW pillar_kpis_view_mat AS (la query de arriba);
--   CREATE UNIQUE INDEX ON pillar_kpis_view_mat (workspace_id, period_id);
--   -- y un cron / trigger en postEntry que llame:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY pillar_kpis_view_mat;
-- Hasta entonces, los índices existentes en journal_lines (jl_ws_account_idx,
-- je_ws_period_status_idx) son suficientes para grupos por (workspace, period).
