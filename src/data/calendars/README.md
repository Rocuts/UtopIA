# Sistema de Calendarios Tributarios — 1+1

## Estructura

```
src/data/calendars/
  types.ts            → Tipos TypeScript (rara vez cambian)
  index.ts            → Exports + funciones de consulta + CURRENT_YEAR
  nacional-2026.ts    → Obligaciones DIAN con fechas por dígito NIT
  municipal-2026.ts   → Obligaciones municipales por ciudad (6 ciudades)
  README.md           → Este archivo
```

## Proceso de Actualización Anual

### Cuándo actualizar

| Evento | Cuándo ocurre | Qué actualizar |
|--------|--------------|----------------|
| Publicación UVT | ~Diciembre | `uvt` en index.ts, sanction-calculator.ts |
| Decreto calendario nacional DIAN | ~Diciembre-Enero | nacional-YYYY.ts |
| Calendarios municipales | ~Enero-Febrero | municipal-YYYY.ts |

### Paso a paso (ejemplo: pasar de 2026 a 2027)

1. **Copiar archivos base**:
   ```bash
   cp src/data/calendars/nacional-2026.ts src/data/calendars/nacional-2027.ts
   cp src/data/calendars/municipal-2026.ts src/data/calendars/municipal-2027.ts
   ```

2. **Actualizar `nacional-2027.ts`**:
   - Cambiar año gravable en comentarios y datos
   - Actualizar fechas según el decreto publicado por la DIAN
   - Actualizar UVT si ya fue publicado
   - La estructura (helpers rentaPJ, retencion, etc.) NO cambia

3. **Actualizar `municipal-2027.ts`**:
   - Consultar Secretaría de Hacienda de cada ciudad
   - Actualizar fechas de ICA, predial, vehículos
   - Actualizar `lastVerified` de cada ciudad
   - Para agregar ciudades nuevas, copiar el formato de una existente

4. **Actualizar `index.ts`**:
   ```typescript
   import { NACIONAL_2027 } from './nacional-2027';
   import { MUNICIPAL_2027 } from './municipal-2027';
   export const CURRENT_YEAR = 2027;
   export const UVT_2027 = 55_000; // Actualizar con valor real
   ```

5. **Actualizar archivos relacionados**:
   - `src/lib/tools/sanction-calculator.ts` → UVT y tasa de usura
   - `src/data/tax_docs/calendario_municipal_YYYY.md` → Documento RAG

6. **Re-ingestar RAG**:
   ```bash
   npm run db:ingest
   ```

## Fuentes oficiales

| Fuente | URL | Qué contiene |
|--------|-----|-------------|
| DIAN Calendario | https://www.dian.gov.co/Calendarios | Decreto nacional, plazos por NIT |
| Bogotá SHD | https://www.shd.gov.co/ | ICA, predial, vehículos Bogotá |
| Medellín Hacienda | https://www.medellin.gov.co/hacienda | Calendario Medellín |
| Cali Hacienda | https://www.cali.gov.co/hacienda | Calendario Cali |
| Barranquilla | https://www.barranquilla.gov.co/hacienda | Calendario B/quilla |
| Cartagena | https://hacienda.cartagena.gov.co/ | Calendario Cartagena |
| Bucaramanga | https://www.bucaramanga.gov.co/hacienda | Calendario Bucaramanga |

## Cómo agregar una ciudad nueva

1. Crear un nuevo objeto `CityCalendar` en `municipal-YYYY.ts`
2. Seguir el formato de las ciudades existentes
3. Incluir: ICA (bimestral + anual), ReteICA, predial, vehículos
4. Indicar la URL oficial de la Secretaría de Hacienda
5. Agregarlo al array `MUNICIPAL_YYYY`

## Notas técnicas

- Las fechas marcadas como `"pendiente"` se suplen con búsqueda web en tiempo real
- El tool `get_tax_calendar` usa datos locales PRIMERO, luego web search como complemento
- Si no hay datos locales para un año, el tool cae automáticamente a web search
- Los datos locales se inyectan al LLM con indicación de fuente para anti-alucinación
