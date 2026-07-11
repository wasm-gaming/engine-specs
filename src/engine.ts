// Layer B — the imperative contract.
//
// Every engine subproject's SDK exposes `{ manifest, load }` (an `EngineSDK`).
// `load()` boots the engine and returns an `EngineInstance` the host controls.
// The interface is identical across engines; per-engine differences are absorbed
// by `manifest` (Layer A) and the `assets`/`options` payloads.

import type { EngineManifest, KeyMap, InputPreset } from './manifest.js';

/** Binary asset payload accepted by `load()`. */
export type AssetData = Uint8Array | ArrayBuffer | string;

/** Where an engine may persist saves/SRAM. */
export type PersistMode = 'idbfs' | 'opfs' | null;

type EngineConfigBase = {
  /** Runtime files keyed by `AssetSpec.key`. Required specs must be present. */
  assets: Record<string, AssetData>;
  /** Engine-specific settings, validated against `manifest.options`. */
  options?: Record<string, unknown>;
  /** Persistence backend for saves, when the engine supports it. */
  persist?: PersistMode;
  /**
   * Optional storage namespace under the engine's working dir.
   * Hosts can use this to isolate per-game persisted assets (e.g. sonic1/sonic2).
   */
  storageNamespace?: string;
  /** Lifecycle/telemetry sink. Handlers must not throw. */
  onEvent?: (e: EngineEvent) => void;
  /** Override artifact locations (e.g. host-fetched Release assets). */
  jsUrl?: string;
  wasmUrl?: string;
};

export type EngineConfig = EngineConfigBase &
  (
    | {
        /** Render target. The SDK is responsible for the `#canvas` id if the engine needs it. */
        canvasEl: HTMLCanvasElement;
        /** Optional container element for SDK-owned DOM when a canvas element is present. */
        attachTo?: HTMLElement;
      }
    | {
        /** Optional render target when the SDK primarily mounts into a container element. */
        canvasEl?: HTMLCanvasElement;
        /** Container element the SDK can use to mount engine-owned DOM. */
        attachTo: HTMLElement;
      }
  );

export type EngineEvent =
  | { type: 'ready' }
  | { type: 'error'; error: Error }
  | { type: 'exit' }
  | { type: 'frame'; fps: number };

export interface EngineInstance {
  /** Begin running. `load()` may auto-start; then this is a no-op. */
  start(): void;
  pause(): void;
  resume(): void;
  /** Reset to power-on. May throw if the engine cannot reset in-process. */
  reset(): void;
  /** Swap the active input preset/map at runtime. */
  setInput(map: InputPreset | KeyMap): void;

  // Capability-gated (see manifest.capabilities). Present only when supported.
  saveState?(): Promise<Uint8Array>;
  loadState?(data: Uint8Array): Promise<void>;
  screenshot?(): Promise<Blob>;

  /**
   * Optional targeted purge of persisted runtime files for the active namespace.
   * Engines that do not persist assets can omit this method.
   */
  purgeStorage?():
    | { data: boolean; settings: boolean }
    | Promise<{ data: boolean; settings: boolean }>;

  /** Tear down: stop the loop, release listeners/DOM, free the instance. */
  destroy(): void;
}

/** The default export shape every engine package must provide. */
export interface EngineSDK {
  manifest: EngineManifest;
  load(config: EngineConfig): Promise<EngineInstance>;
}
