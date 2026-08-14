// ---- Introspectable property definitions ----

export type PropertiesDefinition<T> = {
  [K in keyof T]-?: {
    value: T[K];
    description?: string;
    editable?: boolean = true;
    default?: T[K];
    enum?: T[K][];
    allowedTypes?: string[];
  };
};

// ---- Types filled in by each concrete engine ----

export interface EngineConfig {
  [key: string]: any;
  version: string;
  // Defined by the engine
}
export interface EngineOptions {
  [key: string]: any;
  // Defined by the engine
}
export interface EngineAssets {
  [key: string]: any;
  // Defined by the engine
}
export interface EngineStorage {
  [key: string]: any;
  // Defined by the engine
}

export interface EngineInitOptions {
  config?: EngineConfig;
  options?: EngineOptions;
  assets?: EngineAssets;
  storage?: EngineStorage;
}

// ---- Shared fluent getter/setter contract ----
// TSelf is whatever each setter returns: each implementer decides its own "self"

export interface EngineDataAccessors<TSelf> {
  config(): Promise<PropertiesDefinition<EngineConfig>>;
  config(patch: Partial<EngineConfig>): TSelf;
  options(): Promise<PropertiesDefinition<EngineOptions>>;
  options(patch: Partial<EngineOptions>): TSelf;
  assets(): Promise<PropertiesDefinition<EngineAssets>>;
  assets(patch: Partial<EngineAssets>): TSelf;
  storage(): Promise<PropertiesDefinition<EngineStorage>>;
  storage(patch: Partial<EngineStorage>): TSelf;
}

// ---- Public contract each WASM engine must implement ----

export interface EnginePLAY extends EngineDataAccessors<PromisePLAY> {
  restart(): PromisePLAY;
  destroy(): Promise<void>;
}

export interface PromisePLAY
  extends Promise<EnginePLAY>,
    EngineDataAccessors<PromisePLAY> {

  restart(): PromisePLAY;
  destroy(): Promise<void>;
}

export interface EngineSDK extends EngineDataAccessors<EngineSDK> {
  boot(): PromisePLAY;
  start(): PromisePLAY;
}

// ---- Factory each engine exports to be instantiated ----

export interface EngineSDKConstructor {
  new (init?: Partial<EngineInitOptions>): EngineSDK;
}
