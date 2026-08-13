# API — Contract 1.0 (propuesta)

> **Estado: propuesta, no implementado.** Este documento es el borrador de trabajo del
> contrato 1.0. Sustituye a `EngineConfig` / `sdk.load()` (contrato `0.1.1`, ver
> [USAGE.md](../USAGE.md)) y converge con los ejemplos de rsdkv4
> (`docs/SDK-full-examples.md` en `rsdkv4-wasm`), generalizados a cualquier motor.
>
> Los ejemplos son la especificación: si un ejemplo y una tabla no coinciden, gana el ejemplo.
> Lo que aún no está acordado vive en [§15 Preguntas abiertas](#15-preguntas-abiertas) y va
> marcado con **⟨abierto⟩** allí donde aparece.

Notación: `MotorSDK` es el marcador de posición de la clase que exporta cada motor
(`Rsdkv4SDK`, `FbneoSDK`, `MgbaSDK`…). Las claves de asset (`data`, `rom`, `bios`) y las de
`config` son de cada motor: aquí sólo se fija la *forma*.

---

## 1. Forma general

Una **fábrica** que se configura encadenando, un arranque que devuelve la **instancia**, y una
instancia cuyas acciones también encadenan.

```js
const sdk = new MotorSDK()
  .assets({ … })       // entradas del jugador — del host; el SDK sólo lee
  .config({ … })       // ajustes del motor, de arranque
  .storage({ … })      // carpeta propia del SDK: ajustes + partidas
  .on('error', fn)     // eventos
  .mount(el)           // dónde se ve

const instance = await sdk.start({ … })
```

Tres verbos de arranque, y dos de ellos son azúcar del tercero:

| | qué hace | equivale a |
| --- | --- | --- |
| `sdk.boot()` | motor vivo, sin partida | — |
| `instance.restart(payload?)` | inicia o reinicia la partida | — |
| `sdk.start(payload?)` | motor vivo **y** partida corriendo | `sdk.boot().restart(payload)` |

La equivalencia es literal, no conceptual: `start()` se implementa así en la clase base. De ahí
se siguen dos reglas que evitan casos de error:

- **`boot()` es idempotente.** Con una instancia viva devuelve *esa* instancia.
- Por tanto, `sdk.start(p)` con una instancia viva equivale a `instance.restart(p)`. No lanza.

---

## 2. Arranque

### 2.1 Lo mínimo

El SDK no sabe dónde vive el asset: hay que dárselo siempre (ver [§3](#3-assets)).

```js
import { MotorSDK } from '@wasm-gaming/<motor>'

const instance = await new MotorSDK()
  .assets({ data: packHandle })
  .storage({ namespace: 'motor/juego-1' })
  .mount(document.querySelector('#stage'))
  .start()
```

### 2.2 Arrancar sin abrir partida

`boot()` deja el motor vivo y sin sesión: es donde un lanzador lee las partidas guardadas y
pinta sus tarjetas, o donde se consulta al motor antes de comprometerse con una partida.

```js
const instance = await sdk.boot()
const slots = await instance.saves()
// … el jugador elige …
await instance.restart({ slot: 0, player: 1 })
```

### 2.3 Con el menú nativo del motor

Con `startMenu: 'native'`, las pantallas de guardado y personaje las pinta el propio juego y el
payload sobra.

```js
await new MotorSDK()
  .assets({ data: packHandle })
  .config({ startMenu: 'native' })
  .mount(el)
  .start()                              // manda el menú del motor
```

### 2.4 Un motor que recibe la ROM en memoria

```js
await new MotorSDK()
  .assets({ rom: await file.arrayBuffer() })
  .mount(el)
  .start()
```

### 2.5 Configuración plana, sin cadena

El constructor acepta el `EngineSetup` completo: es lo que permite restaurar la última sesión o
escribir tests de tabla.

```js
const setup = await db.get('sessions', 'last')   // IndexedDB, no JSON — ver §3.6
const instance = await new MotorSDK(setup).mount(el).start()
```

---

## 3. Assets

**Los assets son del host.** El SDK los lee; nunca los escribe, nunca los guarda, nunca sabe
dónde viven. La biblioteca —dónde se guarda, con qué nombre, cuándo se borra, si dos juegos
comparten un BIOS— es responsabilidad del host, que es quien conoce a su usuario.

### 3.1 Fuentes admitidas

```ts
type AssetSource =
  | Uint8Array | ArrayBuffer | Blob         // bytes en memoria
  | FileSystemFileHandle                    // puerta a un fichero: lectura a demanda
  | string                                  // URL que el SDK descarga        ⟨abierto: P6⟩
  | (() => AssetSource | Promise<AssetSource>)   // thunk: sólo si hace falta
```

El SDK elige la estrategia: con un handle de OPFS lee a demanda sin meter el fichero en
memoria; con uno de disco (`showOpenFilePicker()`), que no tiene acceso síncrono, copia. El
host no tiene que saber cuál toca.

### 3.2 Primera vez: el host consigue el fichero y lo guarda en *su* biblioteca

```js
// 1. pedírselo al jugador, con lo que el manifest declara
const { accept, description } = MotorSDK.manifest.assets.find((a) => a.key === 'data')
const [picked] = await showOpenFilePicker({
  types: [{ description, accept: { 'application/octet-stream': accept } }],
})

// 2. guardarlo donde el host quiera — aquí, su propio OPFS
const dir = await (await navigator.storage.getDirectory())
  .getDirectoryHandle('mi-biblioteca', { create: true })
const stored = await dir.getFileHandle('juego-1.pak', { create: true })
await (await picked.getFile()).stream().pipeTo(await stored.createWritable())

// 3. prestárselo al SDK
await new MotorSDK().assets({ data: stored }).mount(el).start()
```

### 3.3 Siguientes veces

```js
const stored = await dir.getFileHandle('juego-1.pak').catch(() => null)
if (!stored) return pedirAsset()
await new MotorSDK().assets({ data: stored }).mount(el).start()
```

### 3.4 Perezosos

El thunk sólo se invoca si el asset hace falta de verdad.

```js
sdk.assets({
  data: async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('mi-biblioteca')
    return await dir.getFileHandle('juego-1.pak')
  },
})
```

### 3.5 Qué falta por entregar

```js
sdk.missingAssets()   // ['bios'] — síncrono: mira la cadena, no el disco
```

Devuelve las claves `required` del manifest que no se han pasado **o cuyo valor no es una
`AssetSource` válida**. Lo segundo importa: un `{}` (típico de una deserialización perdida,
§3.6) cuenta como ausente, no como presente.

Si el fichero existe o no en la biblioteca del host es pregunta del host.

### 3.6 Persistir el setup

`EngineSetup` **no sobrevive a `JSON`**: `JSON.stringify` convierte un `FileSystemFileHandle`,
un `ArrayBuffer` o un `Blob` en `{}` y descarta las funciones, sin avisar. Al restaurar, la
clave existe con un valor inútil.

Lo que sí funciona es `structuredClone`, y por tanto IndexedDB: serializa handles y buffers. Y
hay una asimetría que refuerza el consejo de §3.2 — un handle de OPFS se restaura y se usa; uno
de `showOpenFilePicker()` necesita `requestPermission()` tras recargar, que exige un gesto del
usuario.

Por eso el tipo se parte en dos:

```ts
type EngineSetupData<C> = { config?: C; storage?: StorageSetup }   // JSON-safe
type EngineSetup<C> = EngineSetupData<C> & {
  assets?: Record<string, AssetSource>
  mount?: HTMLElement
  on?: Partial<EngineEventMap>
}
```

El constructor acepta el completo; sólo `EngineSetupData` viaja en JSON.

---

## 4. Almacenamiento

`.storage()` es la carpeta del SDK y contiene **sólo lo que el SDK escribe**: los ajustes que el
motor necesita en disco y las partidas guardadas. Nunca assets.

```js
sdk.storage({ namespace: 'motor/juego-1', required: true })
```

`required: true` convierte la falta de persistencia en un error de arranque. Sin él, el motor
arranca y el host lo consulta:

```js
const { namespace, persistent } = await instance.storage()
if (!persistent) avisar('Esta partida no se guardará')
```

Sin `.storage()` no se guarda nada: ni ajustes ni partidas.

```js
await instance.purgeStorage()   // { settings: true, saves: true }
// nunca toca los assets: no son suyos, y ni siquiera sabe dónde están
```

---

## 5. Sesiones

### 5.1 Empezar una partida concreta

```js
await sdk.start({ slot: 0, player: 1 })
await sdk.start({ slot: null })
await sdk.start()                         // valores por defecto
```

### 5.2 Reiniciar con otros parámetros

```js
await instance.restart({ slot: 2 })   // en caliente, sin tocar el wasm
await instance.restart()              // power cycle
```

### 5.3 Qué acepta el payload

El payload de `start()`/`restart()` es el subconjunto escribible de `instance.options()`
(ver [§6](#6-config-y-options)). No hay un esquema estático en el manifest, porque las claves
las declara el contenido cargado, no el motor.

```js
const { player } = await instance.options()
// { value: 0, type: 'integer', enum: [0, 1, 2, 3], readOnly: true,
//   title: 'Character', enumNames: ['A', 'B', 'C', 'A & B'] }

// readOnly: no se cambia en caliente, se cambia abriendo otra sesión
await instance.restart({ slot: 0, player: 2 })
```

### 5.4 Cambiar de contenido

Cambiar el asset rearranca el motor, y se nota en los eventos (`exit` y luego `ready`). Tras
`destroy()` la fábrica se descongela y se puede reconfigurar.

```js
await instance.destroy()
await sdk.assets({ data: otroPack }).storage({ namespace: 'motor/juego-2' }).start()
```

---

## 6. `config()` y `options()`

Tres niveles, dos dominios. **`config` es el motor; `options` es la partida.**

| | quién escribe | cuándo | persiste |
| --- | --- | --- | --- |
| `sdk.config()` | host, antes de arrancar | congelado con instancia viva | sí, en `storage` |
| `instance.config()` | jugador, en marcha | inmediato | **no**: sólo esta sesión |
| `instance.options()` | jugador, en marcha | inmediato | según el motor |

`sdk.config()` es **síncrono**: no hay motor al que preguntar, sólo `manifest.config` con lo que
la cadena haya puesto encima. Los dos de la instancia son asíncronos: cruzan al worker.

### 6.1 Un solo formato de propiedad resuelta

Los tres getters devuelven `Record<string, ResolvedProperty>`, con la misma forma:

```ts
type ResolvedProperty = {
  value: unknown        // lo que está en efecto (o lo que se usará, si aún no hay motor)
  default?: unknown     // lo que declara el manifest, si lo declara
  readOnly?: true       // hay que reiniciar para cambiar esto
  // …y el vocabulario JSON Schema de la propiedad, tal cual:
  // type · enum · enumNames · minimum · maximum · title · description
}
```

No hay campo `source`: el método que llamas *es* la fuente. `config()` son claves del motor,
`options()` son claves de la partida.

**`readOnly` significa lo mismo en los tres sitios: no se puede cambiar en la instancia viva,
hay que reiniciar.** No significa inmutable — `player` es `readOnly` en `options()` y se cambia
perfectamente con `restart({ player })`. Una pantalla de ajustes puede pintarlo en gris con un
"requiere reiniciar" en vez de esconderlo.

### 6.2 Ajustes de arranque

```js
sdk.config({ language: 4, volume: 0.8, vsync: true, startMenu: 'host' })

sdk.config()   // getter síncrono, sin arrancar nada
{
  language: {
    value: 4, default: 0, type: 'integer',
    enum: [0, 1, 2, 3, 4], enumNames: ['EN', 'FR', 'IT', 'DE', 'ES'], title: 'Language',
  },
  volume:    { value: 0.8, default: 1, type: 'number', minimum: 0, maximum: 1, title: 'Volume' },
  vsync:     { value: true, default: true, type: 'boolean', readOnly: true, title: 'VSync' },
  startMenu: { value: 'host', default: 'native', type: 'string',
               enum: ['native', 'host'], readOnly: true },
}
```

Sirve para pintar una pantalla de preferencias **sin arrancar nada**.

### 6.3 Los mismos ajustes, en caliente

`instance.config()` es la copia viva: mismas claves, valores actuales. El setter aplica sólo a
esta sesión y **no persiste**.

```js
await instance.config({ volume: 0.5 })    // se oye ya; no se guarda
await instance.config({ vsync: false })   // ✗ lanza: readOnly
```

Los dos getters son correctos a la vez y pueden discrepar: **`sdk.config()` dice con qué
arrancó; `instance.config()` dice cómo está ahora.**

Si el host quiere que un cambio en caliente sobreviva a la sesión, lo guarda él y lo pasa al
siguiente arranque — es el host quien conoce sus preferencias, y `sdk.config()` está congelado
mientras haya instancia:

```js
const live = await instance.config()
await db.put('prefs', Object.fromEntries(
  Object.entries(live).map(([k, p]) => [k, p.value]),
))
// … la próxima vez …
new MotorSDK({ config: await db.get('prefs') })
```

### 6.4 Las opciones de la partida

`instance.options()` es descubrimiento en runtime: el manifest no las declara porque no las
conoce (cambian con el contenido cargado).

```js
await instance.options()

{
  // sesión: se cambian abriendo otra con restart()
  player: { value: 0, type: 'integer', enum: [0, 1, 2, 3],
            enumNames: ['A', 'B', 'C', 'A & B'], title: 'Character', readOnly: true },
  stage:  { value: 12, type: 'integer', enum: [0, 1, 2 /* … */],
            enumNames: ['Título', /* … */, 'Zona 1'], title: 'Level' },

  // del contenido: vivas, y distintas en cada juego
  spindash:  { value: false, type: 'boolean', title: 'Spindash' },
  shieldType: { value: 1, type: 'integer', enum: [0, 1, 2, 3],
                enumNames: ['A', 'B', 'A+C', 'B+C'], title: 'Item type' },
}
```

### 6.5 Escribir: valores planos

```js
await instance.options({ spindash: true, stage: 14 })   // sólo lo que cambia
await instance.options({ player: 2 })                   // ✗ lanza: readOnly → usa restart()
```

Sin argumentos es lectura; con objeto, escritura. El setter **no** acepta la forma del getter
(`{ volume: { value: 0.8 } }`): sería ambiguo el día que una propiedad sea de tipo objeto.

Cambiar de escenario es una escritura más — no hay un `warp()` aparte:

```js
await instance.options({ stage: 14 })
```

### 6.6 Agrupar y extraer

```js
const opts = await instance.options()
const values    = Object.fromEntries(Object.entries(opts).map(([k, o]) => [k, o.value]))
const editables = Object.entries(opts).filter(([, o]) => !o.readOnly)
```

---

## 7. Ciclo de vida y encadenado

### 7.1 Pausa con dueño

Sólo quien pausó puede reanudar, así que un overlay no puede reanudar lo que congeló otro.

```js
const OWNER = { menu: 'menu', startScreen: 'start-screen' }

await instance.pause(OWNER.startScreen)
await instance.resume(OWNER.menu)          // ignorado: la pausa es de otro
await instance.resume(OWNER.startScreen)   // ahora sí
```

### 7.2 Qué encadena y qué cierra la cadena

Las acciones devuelven una promesa de la instancia, con los métodos colgados encima; los
getters devuelven una promesa normal.

```js
instance.pause(OWNER.menu)                 // Promise<Instance> — encadena
instance.pause(OWNER.menu).saves()         // Promise<SaveSlot[]> — cierra
```

| | encadena | cierra |
| --- | --- | --- |
| `restart` `pause` `resume` `mount` `setInput` `deleteSave` `loadState` `destroy` | ✓ | |
| `saves` `storage` `purgeStorage` `screenshot` `saveState` | | ✓ |
| `options` `config` | con argumento (setter) | sin argumento (getter) |

```js
await instance.pause(OWNER.menu).options({ spindash: true }).resume(OWNER.menu)
```

Un fallo aborta el resto de la cadena:

```js
try {
  await instance.config({ vsync: false }).restart({ slot: 1 })   // restart no llega a correr
} catch (e) { console.error(e) }
```

### 7.3 Cerrar

```js
await instance.destroy()   // para el bucle, calla el audio, vuelca partidas, suelta el canvas
```

Tras `destroy()` la fábrica queda reutilizable: `assets()`, `config()` y `storage()` vuelven a
aceptar escrituras.

### 7.4 Una fábrica, una instancia

`boot()` es idempotente, así que una fábrica gobierna como mucho un motor vivo. Para dos a la
vez, dos fábricas — y eso es lo que declara la capacidad:

```js
if (!MotorSDK.manifest.capabilities.multiInstance) {
  await instance.destroy()          // obligatorio antes de arrancar otro
}
const otra = await new MotorSDK(setup).mount(otroBox).start()
```

---

## 8. Render

El SDK crea y posee el canvas. El host decide dónde se coloca.

```js
sdk.mount(document.querySelector('#stage'))       // contenedor: el SDK escala
sdk.mount(document.querySelector('canvas#mio'))   // canvas propio: escalas tú, sólo antes de arrancar
```

Con el juego en marcha se puede mover la imagen, no cambiar la superficie:

```js
await instance.mount(document.querySelector('#fullscreen-box'))   // reparenta y reajusta
await instance.mount(otroCanvas)                                  // ✗ lanza: el contexto GL
                                                                  //   quedó atado al arrancar
```

La geometría nativa está en `manifest.video`, pero **puede depender de `config`** (un motor con
ancho de pantalla configurable no mide lo mismo en 4:3 que en panorámico). La fuente de verdad
con el motor vivo es la instancia. ⟨abierto: P5⟩

---

## 9. Eventos y errores

### 9.1 Catálogo

```js
sdk
  .on('ready',    () => console.log('motor arriba, sin partida'))
  .on('start',    ({ payload }) => console.log('sesión', payload))
  .on('progress', ({ key, loaded, total }) => total && (barra.value = loaded / total))
  .on('frame',    ({ fps }) => hud.textContent = `${fps} fps`)
  .on('pause',    ({ owner }) => …)          // ⟨abierto: P4⟩
  .on('resume',   ({ owner }) => …)          // ⟨abierto: P4⟩
  .on('error',    ({ error }) => console.error(error))
  .on('exit',     () => volverAlLanzador())
```

```ts
ready:    void
start:    { payload: unknown }
progress: { key: string; loaded: number; total?: number }   // total puede faltar: guárdate
frame:    { fps: number }
error:    { error: EngineError }
exit:     void
```

`ready` se emite al completar `boot()`; `start` al abrir sesión. Con `sdk.start()` llegan los
dos, en ese orden. Un `restart()` no vuelve a emitir `ready`.

Los handlers de la fábrica se copian a cada instancia nueva; lo que la instancia añada o quite
no afecta a la fábrica.

```js
instance.on('frame', onFrame)
instance.off('frame', onFrame)
```

### 9.2 Errores tipados

```js
try {
  await sdk.start({ slot: 0 })
} catch (e) {
  switch (e.code) {
    case 'storage-unavailable': return avisar('Tu navegador no permite guardar partidas')
    case 'not-isolated':        return avisar('La página necesita COOP/COEP')
    case 'storage-locked':      return avisar('Cierra la otra pestaña con el juego abierto')
    case 'quota-exceeded':      return avisar('No hay espacio')
    case 'asset-missing':       return pedirFichero()
    case 'asset-invalid':       return avisar('El motor no ha sabido leer ese fichero')
    case 'unsupported-browser': return avisar('Necesitas un navegador más reciente')
    case 'read-only':           return avisar('Eso requiere reiniciar la partida')
    default: throw e
  }
}
```

`asset-invalid` significa *"el motor no supo parsearlo"*. La comprobación de integridad contra
un catálogo (CRC, SHA) es cosa del host: el manifest ya no declara `validate`.

Las comprobaciones de almacenamiento se hacen **antes** de instanciar el wasm —disponibilidad
de OPFS, aislamiento (`crossOriginIsolated`), acceso síncrono, cuota— para que el fallo llegue
como excepción tipada y no como un warning en consola a mitad de carga.

El error llega **por las dos vías**: la promesa rechaza y además se emite `error`, para que un
host que no hace `await` no se quede a ciegas.

---

## 10. Consultas

### 10.1 Partidas guardadas

```js
const slots = await instance.saves()
// [{ id: 0, empty: false, label: 'Zona 1 · A · 3 vidas',
//    meta: { character: 0, lives: 3, score: 12000 } },
//  { id: 1, empty: true, label: 'NEW GAME', meta: {} }, …]

await instance.deleteSave(2)
```

### 10.2 Leerlas sin partida abierta, o sin motor

Hay tres situaciones distintas y cada motor declara la suya:

```ts
capabilities.saves: false | 'engine' | 'storage'
```

| | `instance.saves()` | `sdk.saves()` |
| --- | --- | --- |
| `false` | no existe | no existe |
| `'engine'` | lee del motor | azúcar de `boot().saves()`: **arranca** |
| `'storage'` | lee del motor | lee el almacén en JS: **no arranca** |

`'storage'` es posible cuando el formato de guardado se puede leer sin el wasm, que es lo
normal en formatos planos. Es lo que permite pintar las tarjetas de un lanzador sin pagar un
arranque:

```js
const slots = await sdk.saves()   // mismas filas en los tres casos
```

Y el patrón sigue la equivalencia de §1: **todo método de la fábrica que necesite un motor vivo
es azúcar de `boot().<método>()`.** La capacidad sólo dice si ese `boot()` se puede saltar.

### 10.3 Qué sabe el motor de sí mismo, sin instanciar nada

```js
MotorSDK.manifest                 // artefactos, assets, vídeo, input, config, capacidades
MotorSDK.manifest.capabilities
// { saves: 'storage', saveStates: false, screenshots: true, multiInstance: false }
```

---

## 11. Capacidades

```ts
interface EngineCapabilities {
  /** Ranuras de guardado: dónde se pueden leer. */
  saves: false | 'engine' | 'storage'
  /** saveState() / loadState() — volcado completo del estado. */
  saveStates: boolean
  /** screenshot(). */
  screenshots: boolean
  /** Si dos fábricas pueden tener motor vivo a la vez en la misma página. */
  multiInstance: boolean
}
```

Los métodos opcionales existen **si y sólo si** su capacidad lo dice, así que
`if (instance.saveState)` y la lectura del manifest dan siempre la misma respuesta.

Fuera respecto al contrato `0.1.1`: `sram` (lo absorbe `saves`) y `coreSelectable` (es dato de
catálogo del host: qué core eligió para una plataforma, no algo que el motor sepa de sí mismo).
⟨abierto: P7⟩

---

## 12. Manifest (capa A)

```ts
interface EngineManifest {
  /** Versión del contrato que implementa este manifest. */
  contractVersion: string
  id: string
  version: string
  name?: string
  description?: string
  artifacts: { wasm: string; js: string; data?: string }
  /** Lo que aporta el jugador. Sin mountPath (el VFS es interno) ni validate (es del host). */
  assets: Array<{
    key: string
    required: boolean
    accept?: string[]
    description?: string
  }>
  input: InputPreset | KeyMap
  video: { baseWidth: number; baseHeight: number; aspect?: string }
  /** JSON Schema de los ajustes del motor. `readOnly: true` = sólo al arrancar. */
  config?: JSONSchema
  capabilities: EngineCapabilities
}
```

**No hay `manifest.options`.** Para las claves del motor sería redundante —"las cambiables" es
exactamente "las de `config` sin `readOnly`", y una lista derivada escrita a mano se
desincroniza—. Para las de la partida sería imposible: dependen del contenido cargado y sólo se
conocen en runtime.

```js
config: {
  type: 'object',
  properties: {
    volume: { type: 'number', default: 1, minimum: 0, maximum: 1, title: 'Volume' },
    vsync:  { type: 'boolean', default: true, readOnly: true, title: 'VSync' },
  },
}
```

---

## 13. TypeScript

Los genéricos se cierran por motor, así que los payloads dejan de ser bolsas opacas.

```ts
import { MotorSDK, type MotorConfig, type MotorStart } from '@wasm-gaming/<motor>'

const sdk = new MotorSDK()
sdk.config({ startMenu: 'host' })        // ✓
sdk.config({ startMenu: 'hots' })        // ✗ error de compilación
await sdk.start({ player: 'B' })         // ✗ error: player es un índice
await sdk.start({ player: 1 })           // ✓
```

La conformidad se comprueba **en compilación**, que es lo que hoy no verifica nadie. Incluye el
lado estático (el constructor y `manifest`), no sólo la instancia:

```ts
import type { EngineSDKClass } from '@wasm-gaming/engine-specs'
const _contract: EngineSDKClass = MotorSDK
```

Y la cadena se implementa **una sola vez**, en la clase base del contrato; cada motor sólo
aporta el arranque real:

```ts
export abstract class EngineBuilder<Config, Start> implements EngineSDK<Config, Start> {
  constructor(setup: EngineSetup<Config> = {}) { … }
  // assets() · config() · storage() · on() · off() · mount() · missingAssets()
  // boot() · start() · saves()  ← aquí, para los diez motores
  protected abstract create(setup: EngineSetup<Config>): Promise<EngineInstance<Start>>
}

export class MotorSDK extends EngineBuilder<MotorConfig, MotorStart> {
  static manifest = manifest
  protected create(setup) { /* lo único propio del motor */ }
}
```

Es la pieza que evita que diez motores reinventen la misma cadena con tres nombres distintos.

---

## 14. Tabla normativa

Qué hace cada método según haya o no una instancia viva:

| | sin instancia | con instancia viva |
| --- | --- | --- |
| `assets({…})` `config({…})` `storage({…})` | configura | **lanza** |
| `config()` | lee (síncrono) | lee: con qué arrancó |
| `mount(container)` | recuerda | reparenta y reajusta |
| `mount(canvas)` | fija la superficie | **lanza** |
| `on()` `off()` | registra | registra |
| `missingAssets()` | lee | lee |
| `boot()` | arranca | devuelve la misma instancia |
| `start(p)` | `boot().restart(p)` | equivale a `restart(p)` |
| `saves()` | según `capabilities.saves` | lee |

Y en la instancia: `config({…})` y `options({…})` lanzan `read-only` sobre una clave marcada
`readOnly`; el resto de los cambios de sesión pasan por `restart()`.

---

## 15. Preguntas abiertas

Lo que he decidido aquí por mi cuenta y necesita tu visto bueno. Numeradas para poder
responderlas sueltas.

**P1 · `capabilities.saves` como escala.** He unificado en un solo campo de tres valores
(`false | 'engine' | 'storage'`) lo que antes eran `saveSlots` + `savesOffline`. La alternativa
son dos booleanos independientes, pero entonces `{ saveSlots: false, savesOffline: true }` es
representable y no significa nada. ¿Escala?

**P2 · `deleteSave` en frío.** Con `saves: 'storage'`, ¿`sdk.deleteSave(n)` también sin
arrancar? Es coherente (si sabes leer el almacén, sabes borrarlo) pero amplía la superficie de
la fábrica. Yo lo dejaría fuera de la 1.0: borrar es raro en un lanzador y ya hay `boot()`.

**P3 · `instance.config()` y la persistencia.** Tu decisión es que el setter no persista. Eso
deja al host la responsabilidad de guardar las preferencias del jugador (§6.3), porque
`sdk.config()` está congelado mientras haya instancia. La alternativa sería un
`instance.config(valores, { persist: true })`. Yo prefiero tu versión —el SDK no adivina qué
merece sobrevivir— pero conviene que sea decisión explícita y no un olvido.

**P4 · Eventos `pause` / `resume`.** No están en los ejemplos de rsdkv4. Los he añadido porque
con pausa con dueño hay varios actores (menú, overlay, pérdida de foco) y sin evento cada uno
tiene que adivinar el estado. ¿Entran?

**P5 · `video` frente a `config`.** Si un motor tiene el ancho de pantalla en `config`, el
`video` del manifest es sólo el valor por defecto y el host que calcule el aspecto a partir de
él se equivoca. Opciones: (a) `video` es "lo nativo por defecto" y la instancia expone la
geometría real; (b) la geometría sale siempre de `config` y `video` desaparece. Me inclino por
(a), que no rompe a los motores de geometría fija.

**P6 · `string` como `AssetSource`.** Lo he definido como URL que el SDK descarga. Es cómodo
para assets públicos, pero es la única fuente que hace que el SDK haga red, y eso choca un poco
con "el host es el dueño de los ficheros". ¿Lo quitamos y que el host haga el `fetch`?

**P7 · `sram` y `coreSelectable`.** Los he quitado de `capabilities` (§11). `sram` lo absorbe
`saves`; `coreSelectable` describe el catálogo del host, no el motor. Ambos están hoy en
[src/manifest.ts](../src/manifest.ts), así que quitarlos es un cambio real en los manifests
existentes.

**P8 · `progress`.** El `key` es la clave del asset que se está cargando, pero un motor también
querrá reportar fases sin asset (instanciar el wasm, descomprimir). ¿`key` libre con unos
valores reservados, o un campo `phase` aparte?

**P9 · Idioma.** Este documento está en español porque converge con `SDK-full-examples.md` y es
material de trabajo. [README.md](../README.md) y [USAGE.md](../USAGE.md) están en inglés. Al
publicar la 1.0, ¿lo traduzco?
