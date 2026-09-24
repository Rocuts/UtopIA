-- ---------------------------------------------------------------------------
-- 0023 — Alineación del PUC sembrado con el Decreto 2650/1993 (WP10)
-- ---------------------------------------------------------------------------
--
-- contab-nomina-18 / -06. El seed anterior (puc-pyme-colombia.ts) sembraba
-- 2404 = IVA (240405/240410), 2408 = ICA (240805), 2365 bajo el grupo 24,
-- 236510 = Honorarios, 516010/516015 corridos, 510568 agregando ARL/EPS/
-- pensión y 520527 = Comisiones. El seed de provisiones creaba además
-- cuentas huérfanas con nombres ajenos al PUC. El seed de código ya está
-- corregido para workspaces nuevos; esta migración corrige los workspaces
-- sembrados con la versión anterior SIN tocar cifras:
--
--   * Sólo se renombra una cuenta si conserva EXACTAMENTE el nombre del seed
--     anterior y NO tiene movimientos (journal_lines). Con movimientos se
--     deja como está (renombrarla reclasificaría asientos ya contabilizados)
--     y se emite NOTICE; el seed de provisiones rechaza esas cuentas con un
--     error explícito en lugar de reutilizarlas.
--   * 2365 pasa a colgar del grupo 23 (sólo jerarquía).
--   * 2610xx (pasivos estimados laborales) deja de exigir tercero.
--   * Se insertan las cuentas nuevas que falten (ON CONFLICT DO NOTHING).
--
-- También agrega workspaces.empleador_beneficiario_114_1 (contab-nomina-07 /
-- -19): condición del empleador frente al Art. 114-1 E.T.; null = no
-- declarada (nómina y provisiones no asumen la exoneración), y
-- pyme_empleados.salario_integral (contab-nomina-19).
-- ---------------------------------------------------------------------------

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS empleador_beneficiario_114_1 boolean;
--> statement-breakpoint
-- contab-nomina-19: salario integral (aportes sobre el 70 %, sin prima/cesantías).
ALTER TABLE pyme_empleados ADD COLUMN IF NOT EXISTS salario_integral boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- Workspaces sembrados con el PUC anterior (marcador inequívoco: 2404 = IVA).
CREATE TEMP TABLE wp10_puc_ws AS
SELECT DISTINCT workspace_id
FROM chart_of_accounts
WHERE code = '2404' AND name = 'IMPUESTO SOBRE LAS VENTAS POR PAGAR (IVA)';
--> statement-breakpoint

CREATE TEMP TABLE wp10_moved AS
SELECT c.workspace_id, c.code
FROM chart_of_accounts c
WHERE c.workspace_id IN (SELECT workspace_id FROM wp10_puc_ws)
  AND (
    EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.account_id = c.id)
    OR EXISTS (
      SELECT 1 FROM fixed_assets fa
      WHERE fa.expense_account_id = c.id
         OR fa.depreciation_account_id = c.id
         OR fa.asset_account_id = c.id
    )
  );
--> statement-breakpoint

-- Familias que se renombran juntas: si CUALQUIER hoja de la familia tiene
-- movimientos, no se renombra ninguna cuenta de esa familia.
CREATE TEMP TABLE wp10_renames (family text, code text, legacy_name text, new_name text);
--> statement-breakpoint
INSERT INTO wp10_renames (family, code, legacy_name, new_name) VALUES
  ('renta',   '2404',   'IMPUESTO SOBRE LAS VENTAS POR PAGAR (IVA)', 'DE RENTA Y COMPLEMENTARIOS'),
  ('renta',   '240405', 'IVA generado (debito)',                     'Vigencia fiscal corriente'),
  ('renta',   '240410', 'IVA descontable (credito)',                 'Vigencias fiscales anteriores'),
  ('iva',     '2408',   'IMPUESTO DE INDUSTRIA Y COMERCIO',          'IMPUESTO SOBRE LAS VENTAS POR PAGAR (IVA)'),
  ('iva',     '240805', 'Vigencia fiscal corriente',                 'IVA generado'),
  ('dep',     '516010', 'Equipo de oficina',                         'Maquinaria y equipo'),
  ('dep',     '516015', 'Equipo de computacion y comunicacion',      'Equipo de oficina'),
  ('236510',  '236510', 'Honorarios',                                'Dividendos y/o participaciones'),
  ('510568',  '510568', 'Aportes ARL/EPS/Pension',                   'Aportes a administradoras de riesgos laborales ARL'),
  ('520527',  '520527', 'Comisiones de ventas',                      'Auxilio de transporte'),
  -- Cuentas creadas por el seed de provisiones anterior (upsertAccountByCode).
  ('237005',  '237005', 'SGSSS por pagar — Empleador',               'Aportes a entidades promotoras de salud EPS'),
  ('237006',  '237006', 'Pensiones AFP por pagar',                   'Aportes a administradoras de riesgos laborales ARL'),
  ('237010',  '237010', 'ARL por pagar',                             'Aportes al ICBF, SENA y cajas de compensacion'),
  ('510569',  '510569', 'Gasto ARL — Empleador',                     'Aportes a entidades promotoras de salud EPS'),
  ('510570',  '510570', 'Gasto Pensiones — Empleador',               'Aportes a fondos de pensiones y/o cesantias'),
  ('510575',  '510575', 'Gasto Parafiscales',                        'Aportes ICBF'),
  ('510515',  '510515', 'Gasto Prima de Servicios',                  'Horas extras y recargos');
--> statement-breakpoint

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT m.workspace_id, rn.family
    FROM wp10_renames rn
    JOIN wp10_moved m ON m.code = rn.code
  LOOP
    RAISE NOTICE 'PUC 2650: workspace % conserva la familia % sin renombrar (tiene movimientos o activos asociados).', r.workspace_id, r.family;
  END LOOP;
END $$;
--> statement-breakpoint

UPDATE chart_of_accounts c
SET name = rn.new_name
FROM wp10_renames rn
WHERE c.workspace_id IN (SELECT workspace_id FROM wp10_puc_ws)
  AND c.code = rn.code
  AND c.name = rn.legacy_name
  AND NOT EXISTS (
    SELECT 1 FROM wp10_renames rn2
    JOIN wp10_moved m ON m.code = rn2.code AND m.workspace_id = c.workspace_id
    WHERE rn2.family = rn.family
  );
--> statement-breakpoint

-- 2365 cuelga del grupo 23.
UPDATE chart_of_accounts c
SET parent_id = p.id
FROM chart_of_accounts p
WHERE c.workspace_id IN (SELECT workspace_id FROM wp10_puc_ws)
  AND c.code = '2365'
  AND p.workspace_id = c.workspace_id
  AND p.code = '23'
  AND c.parent_id IS DISTINCT FROM p.id;
--> statement-breakpoint

-- Pasivos estimados laborales: estimación global, sin tercero obligatorio.
UPDATE chart_of_accounts
SET requires_third_party = false
WHERE workspace_id IN (SELECT workspace_id FROM wp10_puc_ws)
  AND code IN ('261005', '261010', '261015', '261020')
  AND requires_third_party = true;
--> statement-breakpoint

-- Cuentas nuevas del seed corregido (padres primero).
CREATE TEMP TABLE wp10_new_accounts (
  code text, name text, type account_type, level integer, parent_code text,
  is_postable boolean, requires_cost_center boolean
);
--> statement-breakpoint
INSERT INTO wp10_new_accounts VALUES
  ('2368',   'IMPUESTO DE INDUSTRIA Y COMERCIO RETENIDO',          'PASIVO', 3, '23',   false, false),
  ('2370',   'RETENCIONES Y APORTES DE NOMINA',                    'PASIVO', 3, '23',   false, false),
  ('2380',   'ACREEDORES VARIOS',                                  'PASIVO', 3, '23',   false, false),
  ('2412',   'DE INDUSTRIA Y COMERCIO',                            'PASIVO', 3, '24',   false, false),
  ('236515', 'Honorarios',                                         'PASIVO', 4, '2365', true,  false),
  ('236805', 'Impuesto de industria y comercio retenido',          'PASIVO', 4, '2368', true,  false),
  ('237005', 'Aportes a entidades promotoras de salud EPS',        'PASIVO', 4, '2370', true,  false),
  ('237006', 'Aportes a administradoras de riesgos laborales ARL', 'PASIVO', 4, '2370', true,  false),
  ('237010', 'Aportes al ICBF, SENA y cajas de compensacion',      'PASIVO', 4, '2370', true,  false),
  ('238030', 'Fondos de cesantias y/o pensiones',                  'PASIVO', 4, '2380', true,  false),
  ('240810', 'IVA descontable',                                    'PASIVO', 4, '2408', true,  false),
  ('241205', 'Vigencia fiscal corriente',                          'PASIVO', 4, '2412', true,  false),
  ('510515', 'Horas extras y recargos',                            'GASTO',  4, '5105', true,  true),
  ('510518', 'Comisiones',                                         'GASTO',  4, '5105', true,  true),
  ('510533', 'Intereses sobre cesantias',                          'GASTO',  4, '5105', true,  true),
  ('510539', 'Vacaciones',                                         'GASTO',  4, '5105', true,  true),
  ('510569', 'Aportes a entidades promotoras de salud EPS',        'GASTO',  4, '5105', true,  true),
  ('510570', 'Aportes a fondos de pensiones y/o cesantias',        'GASTO',  4, '5105', true,  true),
  ('510572', 'Aportes cajas de compensacion familiar',             'GASTO',  4, '5105', true,  true),
  ('510575', 'Aportes ICBF',                                       'GASTO',  4, '5105', true,  true),
  ('510578', 'Aportes SENA',                                       'GASTO',  4, '5105', true,  true),
  ('516020', 'Equipo de computacion y comunicacion',               'GASTO',  4, '5160', true,  false),
  ('520518', 'Comisiones',                                         'GASTO',  4, '5205', true,  true);
--> statement-breakpoint

INSERT INTO chart_of_accounts
  (workspace_id, code, name, type, parent_id, level, is_postable, currency,
   requires_third_party, requires_cost_center, active)
SELECT w.workspace_id, n.code, n.name, n.type, p.id, n.level, n.is_postable, 'COP',
       false, n.requires_cost_center, true
FROM wp10_puc_ws w
CROSS JOIN wp10_new_accounts n
JOIN chart_of_accounts p ON p.workspace_id = w.workspace_id AND p.code = n.parent_code
WHERE n.level = 3
ON CONFLICT (workspace_id, code) DO NOTHING;
--> statement-breakpoint

INSERT INTO chart_of_accounts
  (workspace_id, code, name, type, parent_id, level, is_postable, currency,
   requires_third_party, requires_cost_center, active)
SELECT w.workspace_id, n.code, n.name, n.type, p.id, n.level, n.is_postable, 'COP',
       false, n.requires_cost_center, true
FROM wp10_puc_ws w
CROSS JOIN wp10_new_accounts n
JOIN chart_of_accounts p ON p.workspace_id = w.workspace_id AND p.code = n.parent_code
WHERE n.level = 4
ON CONFLICT (workspace_id, code) DO NOTHING;
--> statement-breakpoint

-- Cuentas huérfanas que el seed de provisiones anterior creó sin padre:
-- enlazarlas a su cuenta de nivel 3 si ya existe.
UPDATE chart_of_accounts c
SET parent_id = p.id
FROM wp10_new_accounts n, chart_of_accounts p
WHERE c.workspace_id IN (SELECT workspace_id FROM wp10_puc_ws)
  AND c.code = n.code
  AND c.parent_id IS NULL
  AND p.workspace_id = c.workspace_id
  AND p.code = n.parent_code;
--> statement-breakpoint

DROP TABLE wp10_new_accounts;
--> statement-breakpoint
DROP TABLE wp10_renames;
--> statement-breakpoint
DROP TABLE wp10_moved;
--> statement-breakpoint
DROP TABLE wp10_puc_ws;
