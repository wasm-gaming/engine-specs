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

The host holds an {@link EngineSDK}, calls `load()` with an {@link EngineConfig}, and gets
back an {@link EngineInstance}. Events flow the other way, through `onEvent`.

```mermaid
classDiagram
  direction LR
  class EngineSDK {
    +EngineManifest manifest
    +load(EngineConfig) Promise~EngineInstance~
  }
  class EngineConfig {
    +Record~string,AssetData~ assets
    +Record~string,unknown~ options?
    +PersistMode persist?
    +string storageNamespace?
    +HTMLCanvasElement canvasEl
    +HTMLElement attachTo
    +onEvent(EngineEvent)
  }
  class EngineInstance {
    +start() void
    +pause() void
    +resume() void
    +reset() void
    +setInput(map) void
    +saveState()? Promise~Uint8Array~
    +loadState(data)? Promise~void~
    +screenshot()? Promise~Blob~
    +destroy() void
  }
  class EngineEvent {
    <<union>>
    ready | error | exit | frame
  }
  EngineSDK ..> EngineManifest : declares
  EngineSDK ..> EngineConfig : load(config)
  EngineSDK ..> EngineInstance : returns
  EngineConfig ..> EngineEvent : onEvent
  EngineInstance ..> EngineEvent : emits
```

The capability-gated members (`saveState`, `loadState`, `screenshot`) exist **only** when
{@link EngineCapabilities} says so — that dashed line between the two layers is the whole
point of splitting them.
