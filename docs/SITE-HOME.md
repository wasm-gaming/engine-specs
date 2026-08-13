# @wasm-gaming/engine-specs

The **engine contract** for the wasm-gaming ecosystem: the single shared interface that every
WASM game/emulator engine and the host app conform to. Defined once here, depended on
everywhere, so engines can't drift.

TypeScript is the source of truth; a JSON Schema mirrors the manifest for non-TS consumers, and
a Zod-based validator lets any CI fail on drift.

## Where to start

- **[Contract map](CONTRACT-MAP.md)** — how the types fit together, in two diagrams.
- {@link EngineManifest} — what an engine declares about itself, before anything boots.
- {@link EngineSDK} — the factory every engine package exports a subclass of.
- {@link EnginePlay} — the live engine, once the host has booted it.
- {@link validateManifest} / {@link assertManifest} — runtime validation for CI and hosts.

## Reading the reference

Members marked optional exist **only** when {@link EngineCapabilities} says so: check the
capability before calling `saves`, `saveState`, `loadState` or `screenshot`.

Layer B is mid-migration: the shapes below are the **1.0 contract**, published as ambient
declarations, so the package still ships no runtime for them. The 0.2.x line (`{ manifest, load }`)
stays on npm and frozen — see [Usage](USAGE.md) for what is live today.

Every symbol page links back to the line that defines it, so the source is always one click away.
