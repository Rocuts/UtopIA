-- ============================================================
-- 1+1 · Contabilidad Pyme — Esquema Supabase (REFERENCIA)
-- Motor tributario RST vs Ordinario · Colombia · UVT 2026
--
-- ⚠️ ARCHIVO DE REFERENCIA. No fue ejecutado ni verificado contra
-- Supabase por el diseñador. Ejecútelo en su proyecto (SQL Editor),
-- valide las tasas con las tablas oficiales DIAN vigentes y corra
-- sus tests antes de producción.
-- ============================================================

-- ---- 1) Tabla de UVT por año (lectura pública) ----
create table if not exists public.uvt_values (
  year        int primary key,
  uvt_cop     numeric not null,
  resolucion  text,
  created_at  timestamptz default now()
);

-- ---- 2) Tarifas RST consolidadas por grupo CIIU (lectura pública) ----
create table if not exists public.ciiu_rst_rates (
  id          bigint generated always as identity primary key,
  grupo       text not null,         -- 'tiendas' | 'servicios' | ...
  uvt_max     numeric not null,      -- límite superior del tramo (UVT)
  rate        numeric not null,      -- tarifa consolidada (ej. 0.0188)
  unique (grupo, uvt_max)
);

-- ---- 3) Negocio del usuario ----
create table if not exists public.businesses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  nit           text not null,
  razon_social  text not null,
  ciudad        text,
  regimen       text not null default 'RST',   -- 'RST' | 'ORDINARIO'
  ciiu_grupo    text not null default 'tiendas',
  margin        numeric not null default 0.35,  -- utilidad / ventas
  created_at    timestamptz default now()
);

-- ---- 4) Cálculos tributarios (historial por negocio) ----
create table if not exists public.tax_calculations (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  periodo       text not null,                 -- ej. '2026'
  annual_sales  numeric not null,
  rst           numeric not null,
  ordinario     numeric not null,
  recommended   text not null,                 -- 'RST' | 'ORDINARIO'
  savings       numeric not null,
  semaforo      text not null,                 -- 'verde' | 'amarillo' | 'rojo'
  created_at    timestamptz default now()
);

-- ============================================================
-- Inserciones de datos base (UVT 2026 + tarifas RST ilustrativas)
-- ============================================================
insert into public.uvt_values (year, uvt_cop, resolucion) values
  (2026, 52374, 'Res. DIAN 000238 del 15-dic-2025')
on conflict (year) do update set uvt_cop = excluded.uvt_cop, resolucion = excluded.resolucion;

insert into public.ciiu_rst_rates (grupo, uvt_max, rate) values
  ('tiendas',    6000,  0.0188),
  ('tiendas',   15000,  0.0240),
  ('tiendas',   30000,  0.0290),
  ('tiendas', 1000000,  0.0340),
  ('servicios',  6000,  0.0590),
  ('servicios', 15000,  0.0750),
  ('servicios', 30000,  0.0860),
  ('servicios',1000000, 0.0950)
on conflict (grupo, uvt_max) do update set rate = excluded.rate;

-- ============================================================
-- Row Level Security — cada usuario solo ve SUS datos
-- ============================================================
alter table public.businesses        enable row level security;
alter table public.tax_calculations  enable row level security;
alter table public.uvt_values        enable row level security;
alter table public.ciiu_rst_rates    enable row level security;

-- Negocios: dueño = auth.uid()
create policy "businesses_select_own" on public.businesses
  for select using (auth.uid() = user_id);
create policy "businesses_insert_own" on public.businesses
  for insert with check (auth.uid() = user_id);
create policy "businesses_update_own" on public.businesses
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "businesses_delete_own" on public.businesses
  for delete using (auth.uid() = user_id);

-- Cálculos: dueño = auth.uid()
create policy "calc_select_own" on public.tax_calculations
  for select using (auth.uid() = user_id);
create policy "calc_insert_own" on public.tax_calculations
  for insert with check (auth.uid() = user_id);
create policy "calc_delete_own" on public.tax_calculations
  for delete using (auth.uid() = user_id);

-- Tablas paramétricas: lectura pública, sin escritura por usuarios
create policy "uvt_public_read"  on public.uvt_values     for select using (true);
create policy "ciiu_public_read" on public.ciiu_rst_rates for select using (true);
