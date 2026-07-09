// Layer A — the declarative contract.
//
// An EngineManifest describes what an engine subproject ships and needs. It drives
// the host's launcher UI, asset pickers and validation. Everything that differs
// between engines (Data.rsdk vs a ROM zip + BIOS vs baked-in assets) is expressed
// as *data* here, so the imperative interface (Layer B) can stay identical.

/** A loose JSON Schema object (Draft 2020-12 subset). Kept dependency-free. */
export type JSONSchema = Record<string, unknown>;

/** A gamepad→keyboard key map, or the name of a built-in preset (e.g. "rsdkv4"). */
export type KeyMap = Record<string, string>;
export type InputPreset = string;

/** How the host validates a user-provided asset before mounting it. */
export interface AssetValidation {
  /** Exact byte length, if the asset has a fixed size (e.g. a known ROM dump). */
  bytes?: number;
  /** Lowercase hex SHA-1 the asset must match. */
  sha1?: string;
}

/** A file the host must supply at runtime, mounted into the engine's VFS. */
export interface AssetSpec {
  /** Stable key the host uses in `EngineConfig.assets` (e.g. "data", "rom", "bios"). */
  key: string;
  /** Absolute VFS path the engine reads from (e.g. "/Data.rsdk", "/roms/neogeo.zip"). */
  mountPath: string;
  /** If true, `load()` must reject when the asset is absent. */
  required: boolean;
  /** Suggested file extensions for a host file picker (e.g. [".rsdk"]). */
  accept?: string[];
  /** Integrity/shape constraints the host may enforce before mounting. */
  validate?: AssetValidation;
  /** Human-readable note shown in host UI. */
  description?: string;
}

/** Where the CI-built artifacts live (relative paths or URLs; host resolves them). */
export interface EngineArtifacts {
  /** The `.wasm` binary. */
  wasm: string;
  /** The JS glue/loader (an ES module factory). */
  js: string;
  /** Optional preloaded Emscripten `.data` package (engines that bundle assets). */
  data?: string;
}

/** Native render surface geometry. */
export interface VideoSpec {
  baseWidth: number;
  baseHeight: number;
  /** Display aspect ratio, e.g. "16:9" or "4:3". Defaults to baseWidth:baseHeight. */
  aspect?: string;
}

/** Optional features an engine may or may not implement. Gate calls on these. */
export interface EngineCapabilities {
  saveStates?: boolean;
  sram?: boolean;
  /** Part of a swappable set of cores for one platform (e.g. Megadrive: JGenesis/BlastEm). */
  coreSelectable?: boolean;
}

export interface EngineManifest {
  /** Stable engine id, e.g. "rsdkv4" | "fbneo" | "blastem" | "jgenesis" | "smw". */
  id: string;
  /** SemVer of this engine build/contract implementation. */
  version: string;
  /** Human-readable name. */
  name?: string;
  description?: string;
  artifacts: EngineArtifacts;
  /** Files supplied at runtime. May be empty (e.g. engines with baked-in assets). */
  assets: AssetSpec[];
  /** Input preset name or an explicit key map. */
  input: InputPreset | KeyMap;
  video: VideoSpec;
  /** JSON Schema for engine-specific `EngineConfig.options`. */
  options?: JSONSchema;
  capabilities: EngineCapabilities;
}
