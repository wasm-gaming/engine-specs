// Layer B — the imperative contract.
//
// Every engine subproject exports a class that extends `EngineSDK`: a factory the
// host configures by chaining, and whose `boot()`/`start()` hand back an `EnginePlay`
// — the live engine. The chain is written once, here, so twelve engines don't each
// reinvent it; a concrete engine supplies only `create()`.
//
// Per-engine differences are absorbed by `manifest` (Layer A) and by closing the
// `Config` / `Options` generics.
//
// Status: shapes only. Every member is `abstract`, so the classes exist at runtime but
// implement nothing yet — the chain, the freeze, the payload merge and the idempotent
// `boot()` land with the contract 1.0 release.

import type { EngineManifest, KeyMap, InputPreset } from './manifest.js';

// ---------------------------------------------------------------------------
// Setup — what the host hands the factory
// ---------------------------------------------------------------------------

/**
 * Where a runtime asset comes from.
 *
 * The host owns its files; the SDK only ever reads them. The SDK picks the
 * strategy: an OPFS handle can be read on demand, a `showOpenFilePicker()` handle
 * has no sync access and gets copied. The host does not need to know which.
 *
 * A thunk is resolved by `boot()`, and only if the asset is actually needed.
 *
 * @category Setup
 */
export type AssetSource =
  | Uint8Array
  | ArrayBuffer
  | Blob
  /** A door to a file, read on demand. */
  | FileSystemFileHandle
  /** A URL the SDK downloads. The only source that makes the SDK touch the network. */
  | string
  /** Resolved lazily, by `boot()`, and only if the asset is needed. */
  | (() => AssetSource | Promise<AssetSource>);

/**
 * The SDK's own folder: saved games, plus whatever internal state the engine
 * persists. Never assets, never player preferences.
 *
 * There is no `required` flag: if the engine needs persistence and cannot have it,
 * boot fails on its own with a typed {@link EngineError} that says *what* went
 * wrong. Without `storage()` nothing is persisted at all.
 *
 * @category Setup
 */
export interface StorageSetup {
  /** Folder the SDK owns, e.g. `"rsdkv4/sonic-1"`. Chosen by the host. */
  namespace: string;
}

/** Live storage state, once the engine is up. @category Setup */
export interface StorageInfo extends StorageSetup {
  /** `false` when the browser granted only best-effort storage — warn the player. */
  persistent: boolean;
}

/**
 * The JSON-safe half of {@link EngineSetup}.
 *
 * `structuredClone` (and therefore IndexedDB) round-trips the full setup, but
 * `JSON.stringify` silently turns a `FileSystemFileHandle`, an `ArrayBuffer` or a
 * `Blob` into `{}` and drops functions. Only this half survives JSON.
 *
 * @category Setup
 */
export interface EngineSetupData<Config, Options> {
  /** Engine settings, applied at boot. */
  config?: Partial<Config>;
  /** Default session payload — see {@link EngineSDK.options}. */
  options?: Partial<Options>;
  storage?: StorageSetup;
}

/**
 * Everything the factory can be configured with, in one object.
 *
 * Accepted by the constructor, which is what makes "restore the last session"
 * a single call. Anything settable here is settable by chaining, and vice versa.
 *
 * @category Setup
 */
export interface EngineSetup<Config, Options> extends EngineSetupData<Config, Options> {
  /** Runtime files keyed by `AssetSpec.key`. */
  assets?: Record<string, AssetSource>;
  /** Where the engine is seen. A container is scaled by the SDK; a canvas is yours. */
  mount?: HTMLElement;
  on?: Partial<EngineEventHandlers>;
}

// ---------------------------------------------------------------------------
// Resolved properties — the one shape all four getters return
// ---------------------------------------------------------------------------

/**
 * One setting, resolved: what is in effect, plus the JSON Schema vocabulary the
 * manifest declared for it. Enough to paint a settings screen without asking the
 * engine anything.
 *
 * There is no `source` field: the method you called *is* the source —
 * {@link EngineSDK.config} are engine keys, {@link EngineSDK.options} are session keys.
 *
 * @category Config & options
 */
export interface ResolvedProperty<Value = unknown> {
  /** What is in effect — or what will be used, if there is no engine yet. */
  value: Value;
  /** What the manifest declares, when it declares it. */
  default?: Value;
  /**
   * Changing this needs a restart. It does **not** mean immutable: `player` is
   * `readOnly` in `options()` and changes fine through {@link EnginePlay.restart}.
   * A settings screen can grey it out instead of hiding it.
   */
  readOnly?: true;
  type?: string;
  enum?: readonly unknown[];
  enumNames?: readonly string[];
  minimum?: number;
  maximum?: number;
  title?: string;
  description?: string;
}

/** Every key of `T`, resolved. The return shape of all four getters. @category Config & options */
export type ResolvedProperties<T> = { [K in keyof T]-?: ResolvedProperty<T[K]> };

// ---------------------------------------------------------------------------
// Events and errors
// ---------------------------------------------------------------------------

/**
 * `ready` fires when `boot()` completes, `start` when a session opens. A
 * `sdk.start()` emits both, in that order; a `restart()` does not re-emit `ready`.
 *
 * @category Events
 */
export interface EngineEventMap {
  /** Engine up, no session. */
  ready: void;
  /** A session opened, with the payload it opened with. */
  start: { payload: unknown };
  /** `total` may be absent — guard before dividing. */
  progress: { key: string; loaded: number; total?: number };
  frame: { fps: number };
  pause: { owner: string };
  resume: { owner: string };
  error: { error: EngineError };
  exit: void;
}

/** @category Events */
export type EngineEventHandlers = {
  [K in keyof EngineEventMap]: (event: EngineEventMap[K]) => void;
};

/**
 * Why boot or a call failed.
 *
 * Storage checks (OPFS availability, `crossOriginIsolated`, sync access, quota) run
 * *before* the wasm is instantiated, so the failure arrives as a typed exception and
 * not as a console warning halfway through loading.
 *
 * @category Errors
 */
export type EngineErrorCode =
  /** No storage backend at all. */
  | 'storage-unavailable'
  /** The page needs COOP/COEP. */
  | 'not-isolated'
  /** Another tab holds the namespace. */
  | 'storage-locked'
  | 'quota-exceeded'
  /** A `required` asset was never handed over — see {@link EngineSDK.missingAssets}. */
  | 'asset-missing'
  /** The engine could not parse the file. Integrity checks against a catalogue are the host's job. */
  | 'asset-invalid'
  | 'unsupported-browser'
  /** A `readOnly` key was written on the live engine — use {@link EnginePlay.restart}. */
  | 'read-only'
  /** A setup method was called while an instance was alive. */
  | 'frozen'
  /** A method was called on a torn-down {@link EnginePlay}. */
  | 'destroyed';

/**
 * Errors reach the host **both ways**: the promise rejects *and* `error` is
 * emitted, so a host that does not `await` is not left blind.
 *
 * @category Errors
 */
export interface EngineError extends Error {
  code: EngineErrorCode;
}

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

/** One save slot, as a launcher would paint it. @category Saves */
export interface SaveSlot {
  id: number;
  empty: boolean;
  /** Ready to show, e.g. `"Zone 1 · A · 3 lives"`. */
  label: string;
  /** Engine-specific extras the host may render. */
  meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// The chainable promise
// ---------------------------------------------------------------------------

/**
 * A promise of the live engine, hydrated with the engine's own methods.
 *
 * Every method of {@link EnginePlay} already returns a promise, so hydrating is
 * enough: the actions come back as another `PlayPromise` and keep chaining, the
 * queries come back as a plain promise and close.
 *
 * ```js
 * await play.pause(OWNER.menu).options({ spindash: true }).resume(OWNER.menu)
 * const slots = await play.pause(OWNER.menu).saves()   // closes
 * ```
 *
 * Two normative rules:
 *
 * - A rejection aborts the rest of the chain — nothing downstream runs.
 * - It is a `Promise` subclass whose `Symbol.species` is `Promise`, so `then()`,
 *   `catch()` and `finally()` return a **plain** promise. Calling `then()` closes
 *   the chain, like a getter does.
 *
 * @category Lifecycle
 */
export type PlayPromise<Play> = Promise<Play> & Play;

// ---------------------------------------------------------------------------
// EnginePlay — the live engine
// ---------------------------------------------------------------------------

/**
 * The live engine. Handed to the host by {@link EngineSDK.boot} or
 * {@link EngineSDK.start}; never constructed by the host.
 *
 * Sessions come and go on the same live engine: `boot()` gives you one with no
 * session at all, and each {@link EnginePlay.restart} opens another.
 *
 * The capability-gated members exist **if and only if** `manifest.capabilities`
 * says so, so `if (play.saveState)` and reading the manifest always agree.
 *
 * @category Lifecycle
 */
export abstract class EnginePlay<
  Options = Record<string, unknown>,
  Config = Record<string, unknown>,
> {
  /**
   * Open a session, or reopen it.
   *
   * The payload is cumulative: there is one current payload, it starts as the
   * factory's, and every `start()`/`restart()` merges its own on top (flat merge,
   * one level). So `restart({ slot: 3 })` keeps the `player` you opened with, and
   * `restart()` with no argument is a power cycle that repeats the current payload.
   *
   * `null` is an explicit value, not "leave unchanged".
   */
  abstract restart(options?: Partial<Options>): PlayPromise<this>;

  /**
   * Freeze, on behalf of `owner`. Only the owner can resume, so an overlay cannot
   * resume what another one froze.
   */
  abstract pause(owner: string): PlayPromise<this>;
  /** Resume. Ignored when the pause belongs to somebody else. */
  abstract resume(owner: string): PlayPromise<this>;

  /**
   * Move the picture — reparents and refits. Throws on a different canvas: the GL
   * context was bound to a surface at boot.
   */
  abstract mount(target: HTMLElement): PlayPromise<this>;
  abstract setInput(map: InputPreset | KeyMap): PlayPromise<this>;

  /** Read the live engine settings: same keys as `sdk.config()`, current values. */
  abstract config(): Promise<ResolvedProperties<Config>>;
  /**
   * Apply engine settings to *this session only*. Never persisted — where
   * preferences live is the UI's call. Throws `read-only` on a `readOnly` key.
   */
  abstract config(values: Partial<Config>): PlayPromise<this>;

  /** Read the session options. Runtime discovery: their keys come from the loaded content. */
  abstract options(): Promise<ResolvedProperties<Options>>;
  /**
   * Write session options, as flat values. Throws `read-only` on a `readOnly` key —
   * those change through {@link EnginePlay.restart}.
   *
   * The getter shape (`{ volume: { value: 0.8 } }`) is not accepted: it would be
   * ambiguous the day a property is itself an object.
   */
  abstract options(values: Partial<Options>): PlayPromise<this>;

  /** Where saves are going, and whether the browser will really keep them. */
  abstract storage(): Promise<StorageInfo>;

  abstract on<K extends keyof EngineEventMap>(
    type: K,
    handler: (event: EngineEventMap[K]) => void,
  ): PlayPromise<this>;
  abstract off<K extends keyof EngineEventMap>(
    type: K,
    handler: (event: EngineEventMap[K]) => void,
  ): PlayPromise<this>;

  /**
   * Stop the loop, silence the audio, flush saves, release the canvas.
   *
   * **Closes the chain** — the factory stays frozen until this settles, which is
   * what stops a host from repointing `storage()` while the old engine is still
   * flushing into the old namespace.
   *
   * Idempotent: calling it again resolves and does nothing. The freeze is released
   * when it *settles*, not when it fulfils — a failed flush must not brick the
   * factory. Afterwards every method here throws `destroyed`, in-flight chains
   * included.
   */
  abstract destroy(): Promise<void>;

  /** Present when `capabilities.saves !== false`. */
  abstract saves?(): Promise<SaveSlot[]>;
  /** Present when `capabilities.saves !== false`. */
  abstract deleteSave?(id: number): PlayPromise<this>;
  /** Present when `capabilities.saveStates`. */
  abstract saveState?(): Promise<Uint8Array>;
  /** Present when `capabilities.saveStates`. */
  abstract loadState?(data: Uint8Array): PlayPromise<this>;
  /** Present when `capabilities.screenshots`. */
  abstract screenshot?(): Promise<Blob>;
}

// ---------------------------------------------------------------------------
// EngineSDK — the factory
// ---------------------------------------------------------------------------

/**
 * The factory every engine package exports a subclass of.
 *
 * Configured by chaining — all of it synchronous, because none of it crosses to
 * the engine; these methods record, they do not resolve. Then `boot()` or
 * `start()` produce the live {@link EnginePlay}.
 *
 * ```js
 * const play = await new MotorSDK()
 *   .assets({ data: packHandle })
 *   .config({ language: 4 })
 *   .storage({ namespace: 'motor/game-1' })
 *   .on('error', report)
 *   .mount(document.querySelector('#stage'))
 *   .start({ slot: 0, player: 1 })
 * ```
 *
 * Anything settable by chaining is settable in the constructor, and vice versa.
 *
 * Three boot verbs, two of them sugar for the third — and the equivalence is
 * literal, it is how the base class implements them:
 *
 * | | what it does | equals |
 * | --- | --- | --- |
 * | `boot()` | engine alive, no session | — |
 * | `play.restart(p)` | opens or reopens a session | — |
 * | `start(p)` | engine alive **and** session running | `boot().restart(p)` |
 *
 * `boot()` is idempotent, so a factory governs at most one live engine, and
 * `start(p)` on a live one is just `restart(p)`. Neither throws.
 *
 * @typeParam Config - the engine's own settings. Close it per engine; an open
 * `Record<string, unknown>` gives up the compile-time check that is the point.
 * @typeParam Options - the session payload, i.e. the writable keys of
 * {@link EnginePlay.options}.
 * @typeParam Play - the engine's own {@link EnginePlay} subclass, when it adds methods.
 *
 * @category Factory
 */
export abstract class EngineSDK<
  Config = Record<string, unknown>,
  Options = Record<string, unknown>,
  Play extends EnginePlay<Options, Config> = EnginePlay<Options, Config>,
> {
  /**
   * Accepts the whole setup at once, which is what makes "restore the last session"
   * a single call. Only {@link EngineSetupData} survives `JSON` — use
   * `structuredClone`/IndexedDB for the rest.
   */
  constructor(setup?: EngineSetup<Config, Options>) {
    void setup; // shape only: the base class does not run yet
  }

  /**
   * Register asset sources. **Always synchronous** — it records sources, it does
   * not resolve them, which is why a value may be a thunk.
   *
   * Throws `frozen` while an engine is alive.
   */
  abstract assets(sources: Record<string, AssetSource>): this;

  /**
   * Read the boot settings, without booting anything — enough to paint a
   * preferences screen. Synchronous: there is no engine to ask, only
   * `manifest.config` and whatever the chain put on top.
   *
   * With a live engine this still reads *what it booted with*;
   * {@link EnginePlay.config} reads how it is now. Both are correct at once.
   */
  abstract config(): ResolvedProperties<Config>;
  /** Set the boot settings. Throws `frozen` while an engine is alive. */
  abstract config(values: Partial<Config>): this;

  /**
   * Read the current session payload. Synchronous, and thinner than the other
   * getters — session keys are declared by the loaded content, so with no engine
   * there is no `enum` or `title` to give, only `value`.
   */
  abstract options(): ResolvedProperties<Options>;
  /**
   * Set the payload the next session will open with. Exactly the same as passing it
   * to `start()`.
   *
   * Unlike `assets()`, `config()` and `storage()` this does **not** freeze with a
   * live engine: it does not describe the engine, it describes the next session,
   * and opening another session is legal at any time. It changes nothing hot —
   * that is {@link EnginePlay.options}.
   */
  abstract options(payload: Partial<Options>): this;

  /** Point the SDK at its folder. Throws `frozen` while an engine is alive. */
  abstract storage(setup: StorageSetup): this;

  /**
   * Where the engine will be seen. A container is scaled by the SDK; pass your own
   * canvas and the scaling is yours — and only before booting.
   */
  abstract mount(target: HTMLElement): this;

  abstract on<K extends keyof EngineEventMap>(
    type: K,
    handler: (event: EngineEventMap[K]) => void,
  ): this;
  abstract off<K extends keyof EngineEventMap>(
    type: K,
    handler: (event: EngineEventMap[K]) => void,
  ): this;

  /**
   * The `required` manifest keys that have not been handed over, **or whose value
   * is not a valid {@link AssetSource}** — a `{}` left by a lost JSON round-trip
   * counts as absent, not as present.
   *
   * Synchronous: it reads the chain, not the disk. Whether the file exists in the
   * host's library is the host's question.
   */
  abstract missingAssets(): string[];

  /**
   * Engine alive, no session — where a launcher reads the saves and paints its
   * cards before committing to a game.
   *
   * Idempotent: with a live engine it returns *that* engine.
   */
  abstract boot(): PlayPromise<Play>;
  /** `boot()` and open a session. Literally `boot().restart(payload)`. */
  abstract start(payload?: Partial<Options>): PlayPromise<Play>;

  /**
   * Read the saves without a session.
   *
   * Present when `capabilities.saves !== false`. With `'storage'` it reads the
   * store in JS and does **not** boot; with `'engine'` it is sugar for
   * `boot().saves()` and does boot. Same rows either way.
   *
   * Every factory method that needs a live engine is sugar for
   * `boot().<method>()`; the capability only says whether that boot can be skipped.
   */
  abstract saves?(): Promise<SaveSlot[]>;

  /**
   * The only thing a concrete engine implements. Everything above is written once,
   * in the base class.
   */
  protected abstract create(setup: EngineSetup<Config, Options>): Promise<Play>;
}

/**
 * The static side of an engine package's export — the half `implements` cannot
 * check, since TypeScript has no abstract statics.
 *
 * ```ts
 * const _contract: EngineSDKClass<MotorConfig, MotorOptions, MotorPlay> = MotorSDK
 * ```
 *
 * @category Factory
 */
export interface EngineSDKClass<
  Config = Record<string, unknown>,
  Options = Record<string, unknown>,
  Play extends EnginePlay<Options, Config> = EnginePlay<Options, Config>,
> {
  new (setup?: EngineSetup<Config, Options>): EngineSDK<Config, Options, Play>;
  /** What the engine knows about itself, with nothing instantiated. */
  readonly manifest: EngineManifest;
}
