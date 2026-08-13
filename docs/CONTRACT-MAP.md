---
title: Contract map
---

# Contract map

How the contract's types fit together. The interfaces barely inherit from each other —
they *contain* each other, which is why the generated **Hierarchy** page is empty and this
one exists.

## Layer A — the manifest

What an engine declares about itself, before anything boots. Every box is a type you can
open: {@link EngineManifest}, {@link AssetSpec}, {@link EngineCapabilities}.

```mermaid
classDiagram
  direction LR
  class EngineManifest {
    +string id
    +string version
    +string name?
    +string description?
  }
  class EngineArtifacts {
    +string wasm
    +string js
    +string data?
  }
  class AssetSpec {
    +string key
    +string mountPath
    +boolean required
    +string[] accept?
  }
  class AssetValidation {
    +number bytes?
    +string sha1?
  }
  class VideoSpec {
    +number baseWidth
    +number baseHeight
    +string aspect?
  }
  class EngineCapabilities {
    +boolean saveStates?
    +boolean sram?
    +boolean coreSelectable?
  }
  class JSONSchema {
    <<type>>
  }
  EngineManifest *-- EngineArtifacts : artifacts
  EngineManifest *-- "0..n" AssetSpec : assets
  EngineManifest *-- VideoSpec : video
  EngineManifest *-- EngineCapabilities : capabilities
  EngineManifest ..> JSONSchema : options
  AssetSpec *-- AssetValidation : validate
```

## Layer B — driving the engine

Two classes. The host configures an {@link EngineSDK} by chaining — all synchronous, none
of it crosses to the engine — and `boot()`/`start()` hand back an {@link EnginePlay}: the
live engine. Sessions come and go on that same engine through `restart()`.

```mermaid
classDiagram
  direction LR
  class EngineSDK {
    <<abstract>>
    +manifest EngineManifest$
    +assets(sources) this
    +config(values?) this|Resolved
    +options(payload?) this|Resolved
    +storage(setup) this
    +mount(target) this
    +on(type, handler) this
    +missingAssets() string[]
    +boot() PlayPromise~Play~
    +start(payload?) PlayPromise~Play~
    +saves()? Promise~SaveSlot[]~
    #create(setup) Promise~Play~
  }
  class EngineSetup {
    +Record~string,AssetSource~ assets?
    +Partial~Config~ config?
    +Partial~Options~ options?
    +StorageSetup storage?
    +HTMLElement mount?
  }
  class EnginePlay {
    <<abstract>>
    +restart(options?) PlayPromise
    +pause(owner) PlayPromise
    +resume(owner) PlayPromise
    +mount(target) PlayPromise
    +setInput(map) PlayPromise
    +config(values?) PlayPromise|Resolved
    +options(values?) PlayPromise|Resolved
    +storage() Promise~StorageInfo~
    +saves()? Promise~SaveSlot[]~
    +saveState()? Promise~Uint8Array~
    +screenshot()? Promise~Blob~
    +destroy() Promise~void~
  }
  class PlayPromise {
    <<type>>
    Promise~Play~ & Play
  }
  class EngineEventMap {
    ready | start | progress | frame
    pause | resume | error | exit
  }
  EngineSDK ..> EngineManifest : declares (static)
  EngineSDK *-- EngineSetup : constructor / chain
  EngineSDK ..> PlayPromise : boot() / start()
  PlayPromise ..> EnginePlay : resolves to
  EnginePlay ..> PlayPromise : actions chain
  EngineSDK ..> EngineEventMap : on()
  EnginePlay ..> EngineEventMap : emits
```

Three boot verbs, and two are sugar for the third — the equivalence is literal, it is how
the base class implements them:

| | what it does | equals |
| --- | --- | --- |
| `sdk.boot()` | engine alive, no session | — |
| `play.restart(p)` | opens or reopens a session | — |
| `sdk.start(p)` | engine alive **and** session running | `boot().restart(p)` |

`boot()` is idempotent, so one factory governs at most one live engine.

{@link PlayPromise} is what makes the chain work: a promise of the live engine hydrated
with the engine's own methods. Since every {@link EnginePlay} method already returns a
promise, actions come back chainable and queries come back closed, with no extra
machinery — and `then()` closes the chain, like a getter.

```js
await play.pause(OWNER.menu).options({ spindash: true }).resume(OWNER.menu)
const slots = await play.pause(OWNER.menu).saves()   // closes
```

`destroy()` closes too, returning `Promise<void>`. That `await` is the barrier that keeps
the factory frozen until teardown settles — without it a host could repoint `storage()`
while the old engine is still flushing saves into the old namespace.

The capability-gated members (`saves`, `deleteSave`, `saveState`, `loadState`,
`screenshot`) exist **only** when {@link EngineCapabilities} says so — that dashed line
between the two layers is the whole point of splitting them.
