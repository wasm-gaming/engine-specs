/**
 * @module
 * @document ../docs/CONTRACT-MAP.md
 * @document ../docs/USAGE.md
 */

// @wasm-gaming/engine-specs — the engine contract.
//
// Layer A (declarative): EngineManifest & friends — what an engine ships/needs.
// Layer B (imperative):  EngineSDK / EnginePlay — how the host drives it.
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

// The two base classes. Every member is abstract for now: the shapes are the 1.0
// contract, the implementation lands with it.
export { EngineSDK, EnginePlay } from './engine.js';

export type {
  EngineSDKClass,
  // Setup
  AssetSource,
  EngineSetup,
  EngineSetupData,
  StorageSetup,
  StorageInfo,
  // Config & options
  ResolvedProperty,
  ResolvedProperties,
  // Lifecycle
  PlayPromise,
  // Events & errors
  EngineEventMap,
  EngineEventHandlers,
  EngineError,
  EngineErrorCode,
  // Saves
  SaveSlot,
} from './engine.js';

export { validateManifest, assertManifest } from './validate.js';
export type { ValidationResult } from './validate.js';

/** The contract version. Bump on breaking changes to the shapes above. */
export const CONTRACT_VERSION = '0.1.1';
