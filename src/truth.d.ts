
export interface PropertiesDefinition {
  [key: string]: {
    value: any;
    description?: string;
    editable: boolean = true;
    default: any;
    enum?: any[];
    allowedTypes?: string[];
  }
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

export abstract class PromisePLAY extends Promise<EnginePlay> {
  constructor();

  set config({ }: EngineConfig): PromisePLAY;
  get config(): Promise<PropertiesDefinition, EngineConfig>;
  set options({ }: EngineOptions): PromisePLAY;
  get options(): Promise<PropertiesDefinition, EngineOptions>;
  set assets({ }: EngineAssets): PromisePLAY;
  get assets(): Promise<PropertiesDefinition, EngineAssets>;
  set storage({ }: EngineStorage): PromisePLAY;
  get storage(): Promise<PropertiesDefinition, EngineStorage>;
  restart(): PromisePLAY;
  destroy(): PromisePLAY;
}
declare abstract class EnginePlay {
  #config: EngineConfig;
  #options: EngineOptions;
  #assets: EngineAssets;
  #storage: EngineStorage;
  constructor({ config, options, assets, storage }?: EnginePlay);
  set config({ }: EngineConfig): PromisePLAY;
  get config(): Promise<PropertiesDefinition, EngineConfig>;
  set options({ }: EngineOptions): PromisePLAY;
  get options(): Promise<PropertiesDefinition, EngineOptions>;
  set assets({ }: EngineAssets): EnginePlay;
  get assets(): Promise<PropertiesDefinition, EngineAssets>;
  set storage({ }: EngineStorage): EnginePlay;
  get storage(): Promise<PropertiesDefinition, EngineStorage>;
  restart(): PromisePLAY;
  destroy(): PromisePLAY;
}

export abstract class EngineSDK {
  #config: EngineConfig;
  #options: EngineOptions;
  #assets: EngineAssets;
  #storage: EngineStorage;
  constructor({ config, options, assets, storage }?: EngineSDK);
  config({ }: EngineConfig): EngineSDK;
  options({ }: EngineOptions): EngineSDK;
  assets({ }: EngineAssets): EngineSDK;
  storage({ }: EngineStorage): EngineSDK;
  boot(): PromisePLAY;
  start(): PromisePLAY;
}