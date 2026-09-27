# Arreglos de la PR #15 portados a main — 2026-09-27

Base: `main` en `c908b783` (PR #18 fusionada). Rama `claude/audit-provenance-reports-gmtj5v`, reiniciada desde
`main` porque su PR ya estaba fusionada. La PR #15 se cerró sin fusionar: su almacén de versiones quedó sustituido por
el de `main` (PR #17) y la persistencia de las Partes IV/V llegó con la #18. De su diff sólo dos arreglos faltaban en
`main`; aquí se portan con pruebas nuevas, sin cherry-pick (sus hunks ya no aplicaban). No se fusionó ni se desplegó.

## 1. Resolución del tenant y contrato de fases de autenticación

`src/lib/db/workspace.ts` decide la fase con `isAuthConfigured()` (`src/lib/auth/enabled.ts`), la misma fuente que ya
usaban el proxy, `requireAuthSession()` y `/api/auth/[...all]`: el resolutor no puede ser más laxo que la puerta que
tiene delante.

| Fase | Sesión | `getOrCreateWorkspace` | `getCurrentWorkspaceId` | `requireWorkspace` |
|---|---|---|---|---|
| 1 (sin secreto) | no se consulta | cookie anónima (la crea si falta) | id de la cookie sin reclamar, o null | fila de la cookie sin reclamar, o null |
| 2 | válida | workspace más antiguo del usuario (lo crea si falta) | ese id, o null | esa fila, o null |
| 2 | ausente o su lectura falla | lanza `WorkspaceAuthRequiredError` | null | null |

En fase 2 sin sesión la comprobación va antes de abrir la cookie: no hay lectura, `INSERT` ni `Set-Cookie`. La fase 1
no cambia. Los datos anónimos de la fase 1 se siguen heredando al registrarse: el hook `user.create.after` de
`src/lib/auth/config.ts` lee la cookie por su cuenta y llama a `claimAnonymousWorkspace`, sin pasar por los
resolutores.

Llamadores: las rutas y acciones que resuelven el tenant ya exigen sesión (`requireAuthSession`/`denyIfNoSession`)
antes de hacerlo, y las páginas de `/workspace` que llaman a `getOrCreateWorkspace` capturan el error y muestran su
estado vacío. El error nuevo sólo aparece si la segunda lectura de sesión falla después de la puerta; en las rutas que
usan `getOrCreateWorkspace` eso responde 500 (tres de ellas repiten el mensaje `Authentication required.`), no 401.
Traducirlo a 401 queda pendiente.

## 2. Eficiencia fiscal del CCV

`clasificarEficienciaFiscal` devolvía `'media'` como "placeholder neutro" cuando F02 (impuesto de referencia =
UAI × 35 %) no era positivo. En ese caso F10 (F03/F02) no es una cobertura: el Âncora la deja en 0 por falta de
denominador (`fiscal-anchor/calculator.ts`). Ahora la clase es `null` (N/D) si F02 ≤ 0 o si F10 no es finito o es
negativo; con F02 positivo los umbrales no cambian (≥ 80 alta, ≥ 50 media, resto baja).

- El snapshot determinístico se impone a la salida del LLM, también cuando es null; el esquema usa `.nullable()`.
- El agente y el sintetizador reciben "N/D". El prompt pide copiar la clase del snapshot (antes admitía cambiarla con
  un warning), declara no determinable la eficiencia N/D y limita la regla de cobertura baja a F02 > 0.
- La tarjeta muestra N/D (es) / N/A (en) en un distintivo neutro, sin ícono de clase y con su motivo. Sin esa rama,
  null se habría pintado como "Baja" en rojo.

Integridad aritmética y cumplimiento normativo no cambian: el ajuste corrige una clasificación inventada, no una
cifra. Los umbrales 80/50 no están certificados como medida de eficiencia tributaria.

## Verificación ejecutada

| Comprobación | Resultado |
|---|---|
| `npx vitest run` | 539 archivos / 5.479 aprobadas, 26 omitidas; `main` en `c908b783`: 537 / 5.432 / 26. 47 pruebas nuevas, ninguna omitida |
| `workspace.test.ts` | 32 pruebas (24 nuevas): cada nombre de secreto con sesión válida, sin sesión y con la lectura caída; fase 1 intacta. El entorno de la prueba ya no depende de los secretos exportados en la máquina |
| `ccv-eficiencia-nd.test.ts`, `ccv-fiscal-card-nd.test.tsx` | 18 + 5 pruebas: calculadora, agente, sintetizador, prompt, esquema y render de la tarjeta |
| Mutaciones | 10 del resolutor, 14 de la eficiencia y 2 de la tarjeta: cada una hace fallar al menos una prueba |
| `tsc`, `lint:strict-mode` | Correctos |
| `npm run lint` | 0 errores, 158 avisos (los mismos de `main`) |
| `npm run build` | Ver la PR (credenciales ficticias del CI) |

## Revisión adversarial

Cuatro revisores independientes (tenant, calidad de pruebas, eficiencia y dominio, divulgación y contrato) y dos
verificadores por hallazgo que intentaron refutarlo. De seis hallazgos, uno sobrevivió: las pruebas de la tarjeta no
detectaban que el N/D recuperara el ícono de "media" ni que perdiera el color neutro en inglés; se corrigió con
pruebas y dos mutaciones. Los otros cinco se refutaron por ser anteriores al cambio y no empeorados por él, o no
reproducibles con la configuración documentada. Una consideración operativa de despliegue se entregó al dueño fuera
del repositorio.

## Límites

- `next/headers`, BetterAuth y la base están simulados en las pruebas del resolutor; no se probó con BetterAuth, Neon
  ni un servidor Next reales. Los agentes del CCV están simulados; no se midió la narrativa del LLM real.
- F10 se sigue mostrando como 0,0 % cuando F02 ≤ 0, junto a la eficiencia N/D; volverla N/D toca a otros módulos.
- Quedan lecturas directas del nombre del secreto fuera de los resolutores (asserts de arranque y facturación);
  alinearlas con `isAuthConfigured()` es un cambio aparte.
- `WorkspaceAuthRequiredError` no se traduce todavía a 401 en las rutas.
