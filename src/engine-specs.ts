// ---- Introspectable property definitions ----

export interface PropertyDefinition<Value = unknown> {
  value: Value;
  default?: Value;
  description?: string;
  /** Absent means `true`. `false` = changing it needs a `restart()`. */
  live?: boolean;
  enum?: readonly Value[];
  allowedTypes?: readonly string[];
}

export type PropertiesDefinition<T> = { [K in keyof T]-?: PropertyDefinition<T[K]> };

// ---- Default open payloads, for an engine that doesn't close its types ----

export interface EngineConfig { [key: string]: unknown }
export interface EngineOptions { [key: string]: unknown }
export interface EngineAssets { [key: string]: unknown }
export interface EngineStorage { [key: string]: unknown }

/**
 * Members are `object`, not the four interfaces above, on purpose: a named
 * `interface MyEngineConfig { … }` has no implicit index signature, so
 * constraining to a type that has one would reject exactly what a closed-type
 * engine will write. Each engine can close its own config/options/assets/storage
 * shapes without an index signature and still satisfy this constraint.
 */
export interface EnginePayloads {
  config: object; options: object; assets: object; storage: object;
}

export interface DefaultPayloads extends EnginePayloads {
  config: EngineConfig; options: EngineOptions;
  assets: EngineAssets; storage: EngineStorage;
}

export interface EngineInit<P extends EnginePayloads = DefaultPayloads> {
  config?: Partial<P['config']>;
  options?: Partial<P['options']>;
  assets?: Partial<P['assets']>;
  storage?: Partial<P['storage']>;
}

// ---- Shared fluent getter/setter contract ----

export interface EngineDataAccessors<TSelf, P extends EnginePayloads = DefaultPayloads> {
  config(): Promise<PropertiesDefinition<P['config']>>;
  config(patch: Partial<P['config']>): TSelf;
  options(): Promise<PropertiesDefinition<P['options']>>;
  options(patch: Partial<P['options']>): TSelf;
  assets(): Promise<PropertiesDefinition<P['assets']>>;
  assets(patch: Partial<P['assets']>): TSelf;
  storage(): Promise<PropertiesDefinition<P['storage']>>;
  storage(patch: Partial<P['storage']>): TSelf;
}

// ---- Public contract each WASM engine must implement ----

export interface EnginePlay<P extends EnginePayloads = DefaultPayloads>
  extends EngineDataAccessors<PromisePlay<P>, P> {
  restart(options?: Partial<P['options']>): PromisePlay<P>;
  destroy(): Promise<void>;
}

/**
 * Structural, not nominal: an engine does NOT need to subclass the real
 * `Promise` to satisfy this. Implementing `then`/`catch`/`finally` with the
 * right signatures — typically by delegating to an internal real `Promise` —
 * is enough. Note that `extends Promise<T>` also pulls in
 * `[Symbol.toStringTag]: string` via lib.es2015.symbol.wellknown, so an
 * implementer needs that member too, not just the three methods.
 */
export interface PromisePlay<P extends EnginePayloads = DefaultPayloads>
  extends Promise<EnginePlay<P>>, EngineDataAccessors<PromisePlay<P>, P> {
  restart(options?: Partial<P['options']>): PromisePlay<P>;
  destroy(): Promise<void>;
}

export interface EngineSDK<P extends EnginePayloads = DefaultPayloads>
  extends EngineDataAccessors<EngineSDK<P>, P> {

  /** Stable engine id, e.g. "rsdkv4" | "fbneo" | "blastem" | "jgenesis" | "smw". */
  id: string;
  /** SemVer of this engine build/contract implementation. */
  version: string;
  /** Human-readable name. */
  name?: string;
  description?: string;
  
  boot(init?: EngineInit<P>): PromisePlay<P>;
  start(options?: Partial<P['options']>): PromisePlay<P>;
}

export interface EngineSDKConstructor<P extends EnginePayloads = DefaultPayloads> {
  new (init?: EngineInit<P>): EngineSDK<P>;
}
