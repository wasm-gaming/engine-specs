# Plan de migración al contrato 1.0

> Cómo llevar este repo de `0.1.1` (tipos + validador) a la 1.0 descrita en
> [API-fullexample.md](API-fullexample.md), sin romper de golpe los doce motores que ya dependen
> de él.

## 1. De dónde partimos

| | hoy (`0.1.1`) | 1.0 |
| --- | --- | --- |
| Capa A | `EngineManifest` con `mountPath`, `validate`, `options` | sin VFS ni `validate`; `config` + `contractVersion` |
| Capa B | `{ manifest, load(config) }` | clase: cadena + `boot()`/`start()`, instancia con ~15 métodos |
| Qué publica | **sólo tipos** + validador zod | tipos + validador + **una clase base real** |
| Peso en el motor | cero runtime | hereda de `EngineBuilder` |

**El cambio de naturaleza es ése, y es el que manda en todo el plan**: hoy el paquete no ejecuta
nada en producción; en la 1.0, §13 pide que la cadena se implemente **una sola vez** en
`EngineBuilder` y que cada motor sólo aporte `create()`. Deja de ser un paquete de tipos y pasa a
ser código que corre en el navegador de los doce motores.

Dos consecuencias inmediatas:

- **`zod` no puede colarse en el bundle de un motor.** Hoy `src/index.ts` reexporta el validador,
  así que importar la clase base arrastraría zod al navegador. Hay que partir los exports:
  `.` = tipos + `EngineBuilder`, sin dependencias; `./validate` = zod, sólo para CI y host.
- **Un bug en la clase base es un bug en los doce motores.** Eso sube el listón de la suite de
  tests: la que hoy valida manifests no basta.

## 2. F0 · Antes de escribir código

**Cerrar §15.** Ocho de las diez preguntas abiertas tocan la forma del manifest o de la instancia,
y el validador, el JSON Schema y los tests salen de ahí. Contestarlas cuesta una tarde; hacerlas
a medias cuesta reescribir `validate.ts` tres veces. Las que bloquean más: **P1** (`capabilities.saves`),
**P5** (`video` vs `config`), **P6** (`string` como `AssetSource`), **P7** (`sram`/`coreSelectable`),
**P8** (`progress`).

**Y un spike de una hora: la promesa encadenable.** Es la única pieza del contrato que no es
declarativa —`instance.pause(x).options({…}).resume(x)` (§7.2)— y la que decide si la API es
escribible o no. Un `Proxy` sobre `Promise` con los métodos colgados, más el tipado de "encadena
vs cierra", y comprobar que un `await` en medio no rompe y que un fallo aborta el resto.
Si esto no queda limpio, mejor saberlo antes de tocar los doce repos.

## 3. Fases en este repo

Cada fase deja el repo verde (`make test`), y ninguna publica hasta la 6.

**F1 · Capa A.** Reescribir `src/manifest.ts` con lo acordado en F0. Espejar en
`schema/engine-manifest.schema.json` y en `src/validate.ts` —los tres a la vez, es un solo cambio
en tres formatos—. Ampliar `tests/validate.test.mjs`: hoy cubre bien el rechazo, hay que añadir
los casos nuevos (`contractVersion`, `capabilities.saves` como escala, ausencia de `mountPath`).

**F2 · Capa B, sólo tipos.** `src/engine.ts` entero: `EngineSetup` / `EngineSetupData`,
`AssetSource`, `ResolvedProperty`, `EngineEventMap`, `EngineError` + códigos (§9.2),
`EngineInstance`, `EngineSDKClass`. Sin implementación todavía. El test de esta fase es de
compilación: un fichero `tests/types.test-d.ts` con un motor de mentira que *debe* compilar y
casos que *no* deben (`sdk.config({ startMenu: 'hots' })`, §13).

**F3 · `EngineBuilder`.** La implementación real: la cadena, el congelado con instancia viva
(§14), `boot()` idempotente, `start()` = `boot().restart()`, el payload vigente (§5.4), los
handlers que se copian a la instancia (§9.1), `missingAssets()` (§3.5), la resolución de thunks.
Aquí va **la suite de conformidad**, que es el entregable de verdad de esta fase: un test que
recibe una clase de motor y comprueba las reglas normativas de §14 contra ella. Los motores la
importarán para su propio CI.

**F4 · El demo como motor de referencia.** `demo/demo.sdk.js` deja de ser un objeto con `load()` y
pasa a ser una clase que extiende `EngineBuilder` — el primer consumidor real de la clase base, y
el que descubre lo que el diseño no previó. Detrás van `demo/demo.js` y los componentes
(`esc-menu.html` es el que más toca: pausa con dueño, `options()`, `saves()`).
El demo pasando la suite de conformidad **es** la prueba de que la 1.0 se puede implementar.

**F5 · Documentación.** `README.md` y `USAGE.md` reescritos sobre la API nueva; `docs/API-fullexample.md`
promovido de borrador a especificación (y traducido, si P9 dice que sí). Añadir un
`docs/MIGRATION-0.1-to-1.0.md` corto y mecánico —tabla de equivalencias `load()` → cadena— que es
lo que van a leer los doce repos.

**F6 · Publicación.** `CONTRACT_VERSION = '1.0.0'`, paquete a `1.0.0`, `exports` partidos (§1),
`make publish-dry-run` y publicar.

## 4. Los doce motores

`0.2.x` se queda publicado y congelado. Nadie tiene que migrar el día 1: quien no toque su
`package.json` sigue en `^0.2` y no se entera. Es lo que hace innecesario cualquier apaño de
compatibilidad dentro del paquete 1.0 — npm ya resuelve la convivencia.

Orden propuesto:

1. **rsdkv4-wasm primero.** Es el motor del que salieron los ejemplos (`docs/SDK-full-examples.md`),
   así que es el que menos sorpresas dará y el que valida el diseño de verdad. Lo que aprenda ahí
   se corrige en el contrato **antes** de tocar el segundo motor.
2. **Un emulador después** (mGBA o fbneo): tiene BIOS, ROM en memoria y saves del motor, o sea el
   camino de assets múltiples y `capabilities.saves: 'engine'`, que rsdkv4 no ejercita.
3. **El resto, en paralelo**, ya con dos precedentes y la guía de migración escrita.

**El host y `rom-manager` no esperan a los doce.** Si migrarlos primero interesa —y suele—, un
adaptador `fromLegacy(sdk0)` que envuelva un `{ manifest, load }` de `0.1.1` en la clase 1.0 deja
al host hablando un solo idioma desde el principio. Va en el host o en un paquete aparte, **no en
el contrato**: es andamiaje con fecha de caducidad y no debe fijarse en la especificación.

## 5. Riesgos

- **La cadena encadenable es la pieza frágil.** Mitigado con el spike de §2, y si sale mal el plan
  B es que las acciones devuelvan `Promise<Instance>` a secas y se pierda el encadenado sin
  `await`: menos elegante, cero riesgo.
- **La clase base convierte al contrato en dependencia de runtime.** Mitigado partiendo los
  exports y manteniendo `.` sin dependencias; medir el tamaño del bundle en F3 y no dejarlo crecer.
- **Doce repos migrando a la vez.** Mitigado con el congelado de `0.2.x` y el orden de §4.
- **La especificación tiene diez preguntas abiertas.** Mitigado con F0; y las que sigan abiertas al
  llegar a F1 se cierran con la opción más restrictiva —siempre es más fácil abrir después que
  quitar.
