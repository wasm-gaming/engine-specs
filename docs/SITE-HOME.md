# @wasm-gaming/engine-specs

The **engine contract** for the wasm-gaming ecosystem: the single shared interface that every
WASM game/emulator engine and the host app conform to. Defined once here, depended on
everywhere, so engines can't drift.

TypeScript is the source of truth; a JSON Schema mirrors the manifest for non-TS consumers, and
a Zod-based validator lets any CI fail on drift.

## Where to start

- **[Contract map](CONTRACT-MAP.md)** — how the types fit together, in two diagrams.
- {@link EngineManifest} — what an engine declares about itself, before anything boots.
- {@link EngineSDK} — what every engine package exports: `{ manifest, load }`.
- {@link EngineInstance} — what the host drives once the engine is up.
- {@link validateManifest} / {@link assertManifest} — runtime validation for CI and hosts.

## Reading the reference

Members marked optional exist **only** when {@link EngineCapabilities} says so: check the
capability before calling `saveState`, `loadState` or `screenshot`.

Every symbol page links back to the line that defines it, so the source is always one click away.
