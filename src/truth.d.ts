
export abstract class EngineSDK {
  #config: EngineConfig;
  #options: EngineOptions;
  #assets: EngineAssets;
  #storage: EngineStorage;
  constructor(init?: EngineInitOptions);
  config(): Promise<PropertiesDefinition<EngineConfig>>;
  config({ }: Partial<EngineConfig>): EngineSDK;
  options(): Promise<PropertiesDefinition<EngineOptions>>;
  options({ }: Partial<EngineOptions>): EngineSDK;
  assets(): Promise<PropertiesDefinition<EngineAssets>>;
  assets({ }: Partial<EngineAssets>): EngineSDK;
  storage(): Promise<PropertiesDefinition<EngineStorage>>;
  storage({ }: Partial<EngineStorage>): EngineSDK;
  boot(): PromisePLAY;
  start(): PromisePLAY;
}

export abstract class EnginePlay {
  #config: EngineConfig;
  #options: EngineOptions;
  #assets: EngineAssets;
  #storage: EngineStorage;
  constructor(init?: EngineInitOptions);
  
  config(): Promise<PropertiesDefinition<EngineConfig>>;
  config({ }: Partial<EngineConfig>): PromisePLAY;
  options(): Promise<PropertiesDefinition<EngineOptions>>;
  options({ }: Partial<EngineOptions>): PromisePLAY;
  assets(): Promise<PropertiesDefinition<EngineAssets>>;
  assets({ }: Partial<EngineAssets>): PromisePLAY;
  storage(): Promise<PropertiesDefinition<EngineStorage>>;
  storage({ }: Partial<EngineStorage>): PromisePLAY;
  restart(): PromisePLAY;
  destroy(): Promise<void>;
}

export abstract class PromisePLAY extends Promise<EnginePlay> {
  constructor(play: EnginePlay);

  config(): Promise<PropertiesDefinition<EngineConfig>>;
  config({ }: Partial<EngineConfig>): PromisePLAY;
  options(): Promise<PropertiesDefinition<EngineOptions>>;
  options({ }: Partial<EngineOptions>): PromisePLAY;
  assets(): Promise<PropertiesDefinition<EngineAssets>>;
  assets({ }: Partial<EngineAssets>): PromisePLAY;
  storage(): Promise<PropertiesDefinition<EngineStorage>>;
  storage({ }: Partial<EngineStorage>): PromisePLAY;
  restart(): PromisePLAY;
  destroy(): Promise<void>;
}

export type PropertiesDefinition<T> = {
  [K in keyof T]-?: {
    value: T[K];
    description?: string;
    editable: boolean;
    default: T[K];
    enum?: T[K][];
    allowedTypes?: string[];
  };
}

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






