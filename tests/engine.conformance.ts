// A complete, working engine written against the contract — nothing is stubbed with
// `as never`. It exists to answer one question the types alone cannot: is this
// contract implementable at all? If a rule cannot be satisfied by an engine that has
// nothing else to do, twelve real engines will not fare better.
//
// It is type-checked, not executed: `make typecheck-tests` compiles it, and
// `tests/types.test-d.ts` drives it the way a host would.

import type {
  EngineInit,
  EnginePayloads,
  EnginePlay,
  EngineSDK,
  EngineSDKConstructor,
  PromisePlay,
  PropertiesDefinition,
} from '../src/engine-specs.js';

// ---- The engine closes its four payloads with named interfaces ----

export interface DummyConfig {
  region: 'us' | 'eu' | 'jp';
  scanlines?: boolean;
}
export interface DummyOptions {
  player: 'sonic' | 'tails';
  slot: number;
}
export interface DummyAssets {
  pack: Uint8Array;
}
export interface DummyStorage {
  namespace: string;
}
export interface DummyPayloads extends EnginePayloads {
  config: DummyConfig;
  options: DummyOptions;
  assets: DummyAssets;
  storage: DummyStorage;
}

// ---- The live engine ----

class DummyPlay implements EnginePlay<DummyPayloads> {
  #config: DummyConfig = { region: 'us' };
  #options: DummyOptions = { player: 'sonic', slot: 0 };
  #assets: Partial<DummyAssets> = {};
  #storage: DummyStorage = { namespace: 'dummy' };
  #mount: HTMLElement | undefined;

  constructor(init?: EngineInit<DummyPayloads>) {
    if (init?.config) Object.assign(this.#config, init.config);
    if (init?.options) Object.assign(this.#options, init.options);
    if (init?.assets) Object.assign(this.#assets, init.assets);
    if (init?.storage) Object.assign(this.#storage, init.storage);
    this.#mount = init?.mount;
  }

  config(): Promise<PropertiesDefinition<DummyConfig>>;
  config(patch: Partial<DummyConfig>): PromisePlay<DummyPayloads>;
  config(
    patch?: Partial<DummyConfig>,
  ): Promise<PropertiesDefinition<DummyConfig>> | PromisePlay<DummyPayloads> {
    // `arguments.length`, not `patch === undefined`: `config(undefined)` is a write
    // of nothing, not a read.
    if (arguments.length === 0) {
      return Promise.resolve<PropertiesDefinition<DummyConfig>>({
        region: {
          value: this.#config.region,
          default: 'us',
          enum: ['us', 'eu', 'jp'],
          description: 'Region the engine boots in',
          // Not changeable on a running engine: the engine re-reads it at boot.
          live: false,
        },
        scanlines: {
          value: this.#config.scanlines,
          default: false,
          live: true,
        },
      });
    }
    Object.assign(this.#config, patch);
    return hydrate(Promise.resolve(this));
  }

  options(): Promise<PropertiesDefinition<DummyOptions>>;
  options(patch: Partial<DummyOptions>): PromisePlay<DummyPayloads>;
  options(
    patch?: Partial<DummyOptions>,
  ): Promise<PropertiesDefinition<DummyOptions>> | PromisePlay<DummyPayloads> {
    if (arguments.length === 0) {
      return Promise.resolve<PropertiesDefinition<DummyOptions>>({
        player: { value: this.#options.player, enum: ['sonic', 'tails'], live: true },
        slot: { value: this.#options.slot, default: 0, live: true },
      });
    }
    Object.assign(this.#options, patch);
    return hydrate(Promise.resolve(this));
  }

  assets(): Promise<PropertiesDefinition<DummyAssets>>;
  assets(patch: Partial<DummyAssets>): PromisePlay<DummyPayloads>;
  assets(
    patch?: Partial<DummyAssets>,
  ): Promise<PropertiesDefinition<DummyAssets>> | PromisePlay<DummyPayloads> {
    if (arguments.length === 0) {
      return Promise.resolve<PropertiesDefinition<DummyAssets>>({
        pack: { value: this.#assets.pack ?? new Uint8Array(), live: false },
      });
    }
    Object.assign(this.#assets, patch);
    return hydrate(Promise.resolve(this));
  }

  storage(): Promise<PropertiesDefinition<DummyStorage>>;
  storage(patch: Partial<DummyStorage>): PromisePlay<DummyPayloads>;
  storage(
    patch?: Partial<DummyStorage>,
  ): Promise<PropertiesDefinition<DummyStorage>> | PromisePlay<DummyPayloads> {
    if (arguments.length === 0) {
      return Promise.resolve<PropertiesDefinition<DummyStorage>>({
        namespace: { value: this.#storage.namespace, live: false },
      });
    }
    Object.assign(this.#storage, patch);
    return hydrate(Promise.resolve(this));
  }

  /** Where the picture goes. Reparenting a live engine is legal; re-mounting is not. */
  mount(target: HTMLElement): PromisePlay<DummyPayloads> {
    this.#mount = target;
    return hydrate(Promise.resolve(this));
  }

  restart(options?: Partial<DummyOptions>): PromisePlay<DummyPayloads> {
    // The payload is cumulative: one current payload, merged flat, one level.
    if (options) Object.assign(this.#options, options);
    return hydrate(Promise.resolve(this));
  }

  async destroy(): Promise<void> {
    this.#assets = {};
    this.#mount = undefined;
  }
}

// ---- The chainable promise ----
//
// Structural, as the contract documents: this is not a `Promise` subclass, it
// delegates to one — plus `[Symbol.toStringTag]`, which `extends Promise<T>` pulls
// in and an implementer must not forget.

function hydrate(inner: Promise<DummyPlay>): PromisePlay<DummyPayloads> {
  const chain = (
    step: (play: DummyPlay) => PromisePlay<DummyPayloads>,
  ): PromisePlay<DummyPayloads> => hydrate(inner.then((play) => step(play).then(() => play)));

  const hydrated: PromisePlay<DummyPayloads> = {
    then: (onfulfilled, onrejected) => inner.then(onfulfilled, onrejected),
    catch: (onrejected) => inner.catch(onrejected),
    finally: (onfinally) => inner.finally(onfinally),
    [Symbol.toStringTag]: 'PromisePlay',

    config: ((patch?: Partial<DummyConfig>) =>
      patch === undefined
        ? inner.then((play) => play.config())
        : chain((play) => play.config(patch))) as PromisePlay<DummyPayloads>['config'],

    options: ((patch?: Partial<DummyOptions>) =>
      patch === undefined
        ? inner.then((play) => play.options())
        : chain((play) => play.options(patch))) as PromisePlay<DummyPayloads>['options'],

    assets: ((patch?: Partial<DummyAssets>) =>
      patch === undefined
        ? inner.then((play) => play.assets())
        : chain((play) => play.assets(patch))) as PromisePlay<DummyPayloads>['assets'],

    storage: ((patch?: Partial<DummyStorage>) =>
      patch === undefined
        ? inner.then((play) => play.storage())
        : chain((play) => play.storage(patch))) as PromisePlay<DummyPayloads>['storage'],

    mount: (target: HTMLElement) => chain((play) => play.mount(target)),
    restart: (options?: Partial<DummyOptions>) => chain((play) => play.restart(options)),
    destroy: () => inner.then((play) => play.destroy()),
  };
  return hydrated;
}

// ---- The factory ----

class DummySDK implements EngineSDK<DummyPayloads> {
  static readonly id = 'dummy';
  static readonly version = '1.0.0';
  static readonly name = 'Dummy engine';
  static readonly description = 'Reference implementation of the engine-specs contract.';

  #init: EngineInit<DummyPayloads> = {};
  #play: DummyPlay | undefined;

  constructor(init?: EngineInit<DummyPayloads>) {
    if (init) this.#init = { ...init };
  }

  /**
   * Where the engine will be seen. Recorded now, applied when the engine exists —
   * and it lands in the same `#init` as everything else, which is what makes
   * `new Sdk({ mount: el })` and `new Sdk().mount(el)` the same call.
   */
  mount(target: HTMLElement): this {
    this.#init.mount = target;
    if (this.#play) this.#play.mount(target);
    return this;
  }

  config(): Promise<PropertiesDefinition<DummyConfig>>;
  config(patch: Partial<DummyConfig>): this;
  config(patch?: Partial<DummyConfig>): Promise<PropertiesDefinition<DummyConfig>> | this {
    if (arguments.length === 0) return (this.#play ?? new DummyPlay(this.#init)).config();
    this.#init.config = { ...this.#init.config, ...patch };
    return this;
  }

  options(): Promise<PropertiesDefinition<DummyOptions>>;
  options(patch: Partial<DummyOptions>): this;
  options(patch?: Partial<DummyOptions>): Promise<PropertiesDefinition<DummyOptions>> | this {
    if (arguments.length === 0) return (this.#play ?? new DummyPlay(this.#init)).options();
    this.#init.options = { ...this.#init.options, ...patch };
    return this;
  }

  assets(): Promise<PropertiesDefinition<DummyAssets>>;
  assets(patch: Partial<DummyAssets>): this;
  assets(patch?: Partial<DummyAssets>): Promise<PropertiesDefinition<DummyAssets>> | this {
    if (arguments.length === 0) return (this.#play ?? new DummyPlay(this.#init)).assets();
    this.#init.assets = { ...this.#init.assets, ...patch };
    return this;
  }

  storage(): Promise<PropertiesDefinition<DummyStorage>>;
  storage(patch: Partial<DummyStorage>): this;
  storage(patch?: Partial<DummyStorage>): Promise<PropertiesDefinition<DummyStorage>> | this {
    if (arguments.length === 0) return (this.#play ?? new DummyPlay(this.#init)).storage();
    this.#init.storage = { ...this.#init.storage, ...patch };
    return this;
  }

  /**
   * Bringing the engine up is this engine's own business, not a step the contract
   * exposes — so it stays private. A factory governs at most one live engine.
   */
  #boot(): DummyPlay {
    this.#play ??= new DummyPlay(this.#init);
    return this.#play;
  }

  /** The only way in. On a live engine it reopens the session rather than rebuilding. */
  start(options?: Partial<DummyOptions>): PromisePlay<DummyPayloads> {
    return hydrate(Promise.resolve(this.#boot())).restart(options);
  }
}

/** The line an engine puts in its own CI: does the class satisfy the constructor type? */
export const DummyEngine: EngineSDKConstructor<DummyPayloads> = DummySDK;
