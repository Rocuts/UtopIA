# 1+1 · Motor tributario — paquete de referencia (handoff)

Estos archivos son **referencia para el equipo de desarrollo** sobre el repo real
(Next.js + Supabase). **No fueron ejecutados ni verificados** por el diseñador:
las casillas de "tablas creadas en Supabase", "RLS aplicado" y "tests pasan"
deben validarse en su entorno.

## Contenido
| Archivo | Qué es |
|---|---|
| `taxCalculator.js` | Módulo puro RST vs Ordinario + semáforo. Funciona en navegador y Node (importable en tests). |
| `useTaxCalculator.js` | Hook React que envuelve el módulo y devuelve `result` + `semáforo`. |
| `supabase_schema.sql` | 4 tablas (`uvt_values`, `ciiu_rst_rates`, `businesses`, `tax_calculations`), inserciones de UVT 2026 + tarifas, y políticas RLS por usuario. |

## Cómo usarlo
1. **SQL:** pegue `supabase_schema.sql` en el SQL Editor de Supabase y ejecútelo.
   Verifique que las 4 tablas se crean y que RLS queda habilitado.
2. **Módulo:** copie `taxCalculator.js` a `src/lib/tax/` y `useTaxCalculator.js` a `src/hooks/`.
   Ajuste el import del hook (`./taxCalculator` → su ruta).
3. **Test sugerido** (Vitest):
   ```js
   import { compare, semaforo } from '@/lib/tax/taxCalculator';
   it('RST conviene para tendero ~$1.5M/mes', () => {
     const r = compare(1_500_000 * 12, { group: 'tiendas' });
     expect(r.recommended).toBe('RST');
   });
   it('semáforo verde para $98M de $183M de tope', () => {
     expect(semaforo(98_000_000).level).toBe('verde');
   });
   ```

## ⚠️ Importante sobre las tarifas
Las tasas RST por grupo CIIU y la carga del régimen ordinario en `taxCalculator.js`
están **calibradas para demostración**. Antes de producción, reemplácelas con las
tablas oficiales DIAN vigentes (Régimen Simple — Art. 908 E.T. y siguientes) y la
estructura real de renta (Art. 241), ICA municipal e IVA.

## Verificación en el prototipo
La lógica está demostrada en vivo en **`Pyme - Mis Pagos.html`**: el botón
"¿Estoy pagando el impuesto correcto?" abre una calculadora con slider de ventas
que recalcula RST vs Ordinario, el ahorro y el semáforo en tiempo real.
