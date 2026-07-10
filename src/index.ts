// @wasm-gaming/engine-specs — the engine contract.
//
// Layer A (declarative): EngineManifest & friends — what an engine ships/needs.
// Layer B (imperative):  EngineSDK / EngineInstance — how the host drives it.
// Plus a runtime validator for the manifest.

export type {
  EngineManifest,
  EngineArtifacts,
  AssetSpec,
  AssetValidation,
  VideoSpec,
  EngineCapabilities,
  KeyMap,
  InputPreset,
  JSONSchema,
} from './manifest.js';

export type {
  EngineSDK,
  EngineInstance,
  EngineConfig,
  EngineEvent,
  AssetData,
  PersistMode,
} from './engine.js';

export { validateManifest, assertManifest } from './validate.js';
export type { ValidationResult } from './validate.js';

/** The contract version. Bump on breaking changes to the shapes above. */
export const CONTRACT_VERSION = '0.1.1';
