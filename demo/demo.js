import { checksumAlgorithms, computeChecksums } from "./checksums.js";
import { loadStoredAsset, saveStoredAsset, clearStoredAsset } from "./storage.js";

let isInitialized = false;
let currentConfig = {};
let currentInstance = null;

const listeners = new Map();
const loadedFiles = {
  rom: null,
  bios: null,
};

const DEFAULT_MESSAGES = {
  // Page / Document
  title: "WASM Gaming Engine Specs Demo",

  // Launcher & Status
  launchButton: "Launch Engine",
  launchingStatus: "Launching with",
  statusReady: "Ready to launch!",
  statusSelectRom: "Ready - Please select a ROM file to launch.",
  statusSelectBoth: "Ready - Please select ROM and BIOS files to launch.",
  statusBiosRequired: "BIOS file is required to launch.",

  // Asset Drop Zones
  dropRomPrompt: "Drop ROM File",
  dropBiosPromptRequired: "Drop BIOS File (Required)",
  dropBiosPromptOptional: "Drop BIOS File (Optional)",
  romAssetHint: "or choose ROM file from computer",
  biosAssetHintOptional: "optional BIOS firmware file",
  biosAssetHintRequired: "required BIOS firmware file",
  pickRomButton: "Pick ROM",
  pickBiosButton: "Pick BIOS",
  changeFileButton: "Change File",
  removeFileButton: "Remove",
  selectedPrefix: "Selected: ",

  // Metadata
  versionPrefix: "Version ",
  assetKeyPrefix: "Asset key: ",

  // ESC Menu
  escMenuTitle: "Settings",
  escMenuBadge: "PAUSED",
  escMenuResume: "Resume",
  escMenuRestoreDefaults: "Restore defaults",
  escMenuReset: "Reset game",
  escMenuSaveState: "Save State",
  escMenuLoadState: "Load State",
  escMenuExit: "Exit to Launcher",
  escMenuNeedsResetTag: "needs reset",
  escMenuKeysHint: "↑ ↓ select · ← → change · Enter apply · Esc close",
};

async function toArrayBuffer(input) {
  if (!input) return null;
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) return input.buffer;
  if (typeof input.arrayBuffer === "function") return await input.arrayBuffer();
  if (input.detail) return await toArrayBuffer(input.detail);
  throw new TypeError("Provided input is not a File, Blob, or ArrayBuffer.");
}

function resolveBiosConfig(biosOption) {
  if (typeof location === "undefined") {
    return { showBIOS: false, requiresBIOS: false };
  }
  const pageUrl = new URL(location.href);
  const scriptUrl = new URL(import.meta.url, location.href);
  const biosParam = scriptUrl.searchParams.get("bios") ?? pageUrl.searchParams.get("bios");

  if (biosOption !== undefined) {
    if (biosOption === "required") {
      return { showBIOS: true, requiresBIOS: true };
    }
    if (biosOption === "optional" || biosOption === true || biosOption === "true") {
      return { showBIOS: true, requiresBIOS: false };
    }
    return { showBIOS: false, requiresBIOS: false };
  }

  const show = biosParam === "true" || biosParam === "optional" || biosParam === "required";
  const req = biosParam === "required";
  return { showBIOS: show, requiresBIOS: req };
}

function getDefaultOptionGroups() {
  return [
    {
      id: "video",
      label: "Video",
      options: [
        {
          key: "filterMode",
          label: "Image filtering",
          description: "Texture sampling used when scaling emulated output. Nearest keeps pixel art crisp; linear softens it.",
          type: "enum",
          value: "Nearest",
          values: [
            { value: "Nearest", label: "Nearest" },
            { value: "Linear", label: "Linear" },
          ],
        },
        {
          key: "aspectRatio",
          label: "Display aspect ratio",
          description: "Output display aspect ratio for emulated console screen.",
          type: "enum",
          value: "4:3",
          values: [
            { value: "4:3", label: "4:3" },
            { value: "8:7", label: "8:7" },
            { value: "1:1", label: "1:1" },
          ],
        },
        {
          key: "autoPrescale",
          label: "Prescaling",
          description: "Integer-prescale the frame before filtering to sharpen upscaled output.",
          type: "boolean",
          value: true,
          requiresReset: false,
        },
      ],
    },
    {
      id: "audio",
      label: "Audio",
      options: [
        {
          key: "lowPassFilter",
          label: "Audio low-pass filter",
          description: "Emulate the console's hardware audio low-pass filter.",
          type: "boolean",
          value: false,
        },
      ],
    },
  ];
}

const demo = {
  on(event, fn) {
    if (!listeners.has(event)) {
      listeners.set(event, []);
    }
    listeners.get(event).push(fn);
    return demo;
  },

  off(event, fn) {
    if (!listeners.has(event)) return demo;
    const list = listeners.get(event).filter((cb) => cb !== fn);
    listeners.set(event, list);
    return demo;
  },

  async emit(event, payload) {
    if (!listeners.has(event)) return [];
    const callbacks = listeners.get(event);
    const results = [];
    for (const cb of callbacks) {
      try {
        const res = await cb(payload);
        results.push(res);
      } catch (err) {
        console.error(`[Demo] Event '${event}' handler error:`, err);
      }
    }
    return results;
  },

  async loadToMEMFS(key, target) {
    if (!key) {
      const assets = {};
      for (const [k, file] of Object.entries(loadedFiles)) {
        if (file) {
          assets[k] = await toArrayBuffer(file);
        }
      }
      return assets;
    }
    const file = loadedFiles[key];
    if (!file) return null;
    const buffer = await toArrayBuffer(file);
    if (target && typeof target === "object") {
      if (typeof target.set === "function") {
        target.set(key, buffer);
      } else if (typeof target.FS?.writeFile === "function") {
        target.FS.writeFile(key, new Uint8Array(buffer));
      }
    }
    return buffer;
  },

  getFile(key) {
    if (!key) return loadedFiles;
    return loadedFiles[key] || null;
  },

  hasFile(key) {
    if (!key) return Boolean(loadedFiles.rom || loadedFiles.bios);
    return Boolean(loadedFiles[key]);
  },

  isLoaded(key) {
    return demo.hasFile(key);
  },

  bindInstance(instance) {
    currentInstance = instance;
    return demo;
  },

  setInstance(instance) {
    return demo.bindInstance(instance);
  },

  init(config = {}) {
    isInitialized = true;
    currentConfig = config;

    const boot = async () => {
      if (typeof window === "undefined" && !config.target) {
        return;
      }
      let jq;
      if (config.jq79) {
        jq = config.jq79;
      } else {
        jq = await import("https://jgermade.github.io/jq79/jq79.js");
      }

      const { $, $create, Component79 } = jq;
      const fetchComponent = (path) => Component79.fetch(new URL(path, import.meta.url).href);

      // Fetch components
      const [CLauncher, CDropArea, CSdkInfo, CEscMenu] = await Promise.all([
        fetchComponent("./components/launcher.html"),
        fetchComponent("./components/drop-area.html"),
        fetchComponent("./components/sdk-info.html"),
        fetchComponent("./components/esc-menu.html"),
      ]);

      let mainEl;
      if (config.target instanceof HTMLElement) {
        mainEl = config.target;
      } else if (typeof config.target === "string") {
        mainEl = document.querySelector(config.target);
      } else {
        mainEl = $("main") || document.body;
      }

      if (!mainEl) {
        throw new Error("Demo page boot failed: missing target element.");
      }

      const messages = { ...DEFAULT_MESSAGES, ...config.messages };
      const escMenuConfig = config.escMenu || {};

      if (typeof document !== "undefined") {
        if (config.messages?.title) {
          document.title = config.messages.title;
        } else if (config.manifest?.name) {
          document.title = `${config.manifest.name} - Demo`;
        } else if (config.sdkInfo?.name) {
          document.title = `${config.sdkInfo.name} - Demo`;
        }
      }

      const { showBIOS, requiresBIOS } = resolveBiosConfig(config.bios);

      const [storedRom, storedBios] = await Promise.all([
        loadStoredAsset("rom"),
        showBIOS ? loadStoredAsset("bios") : null,
      ]);

      loadedFiles.rom = storedRom;
      loadedFiles.bios = storedBios;

      const manifestAssets = config.manifest?.assets || config.sdkInfo?.assets;
      const romSpec = manifestAssets?.find((a) => a.key === "rom") ?? manifestAssets?.[0];
      const biosSpec = manifestAssets?.find((a) => a.key === "bios") ?? manifestAssets?.[1];

      const romAccept = config.romAccept ?? config.accept?.rom ?? (romSpec?.accept ? romSpec.accept.join(",") : ".rom,.bin,.zip,.dat");
      const romAssetHint = config.messages?.romAssetHint ?? (romSpec?.accept ? `Supported: ${romSpec.accept.join(", ")}` : messages.romAssetHint);

      const biosAccept = config.biosAccept ?? config.accept?.bios ?? (biosSpec?.accept ? biosSpec.accept.join(",") : ".bin,.rom,.sys");
      const biosAssetHint = config.messages?.biosAssetHint ?? (biosSpec?.description ?? (biosSpec?.accept ? `Supported: ${biosSpec.accept.join(", ")}` : (requiresBIOS ? messages.biosAssetHintRequired : messages.biosAssetHintOptional)));

      const sdkInfo = config.sdkInfo || (config.manifest ? {
        name: config.manifest.name,
        id: config.manifest.id,
        description: config.manifest.description,
        version: config.manifest.version,
        baseWidth: config.manifest.video?.baseWidth ?? 320,
        baseHeight: config.manifest.video?.baseHeight ?? 240,
        assetKey: romSpec?.key ?? "rom",
      } : {
        name: messages.title || "WASM Gaming Engine Demo",
        id: "engine-demo",
        description: "Standalone Web Interface",
        version: "1.0.0",
        baseWidth: 320,
        baseHeight: 240,
        assetKey: "rom",
      });

      // Handlers bound to a jq79 mount are called as (event, payload) — the
      // DOM CustomEvent first, the emitted value second. `demo.on()` below is
      // a different emitter that passes the payload alone, so the two must not
      // be read the same way.
      const handleSaveRom = (_event, file) => {
        loadedFiles.rom = file;
        saveStoredAsset("rom", file);
        const payload = { file, key: "rom", type: "rom", action: "save" };
        demo.emit("rom:save", payload);
        demo.emit("save:rom", payload);
        demo.emit("rom:select", payload);
        demo.emit("file", payload);
      };

      const handleRemoveRom = () => {
        loadedFiles.rom = null;
        clearStoredAsset("rom");
        const payload = { file: null, key: "rom", type: "rom", action: "remove" };
        demo.emit("rom:remove", payload);
        demo.emit("remove:rom", payload);
        demo.emit("rom:clear", payload);
        demo.emit("file", payload);
      };

      const handleSaveBios = (_event, file) => {
        loadedFiles.bios = file;
        saveStoredAsset("bios", file);
        const payload = { file, key: "bios", type: "bios", action: "save" };
        demo.emit("bios:save", payload);
        demo.emit("save:bios", payload);
        demo.emit("bios:select", payload);
        demo.emit("file", payload);
      };

      const handleRemoveBios = () => {
        loadedFiles.bios = null;
        clearStoredAsset("bios");
        const payload = { file: null, key: "bios", type: "bios", action: "remove" };
        demo.emit("bios:remove", payload);
        demo.emit("remove:bios", payload);
        demo.emit("bios:clear", payload);
        demo.emit("file", payload);
      };

      let currentLauncherMount = null;

      const renderLauncher = () => {
        currentInstance = null;
        if (mainEl.classList?.remove) {
          mainEl.classList.remove("running");
        }
        if (mainEl.replaceChildren) {
          mainEl.replaceChildren();
        }

        currentLauncherMount = CLauncher
          .render({
            CSdkInfo,
            CDropArea,
            sdkInfo,
            initialRomFile: loadedFiles.rom,
            initialBiosFile: loadedFiles.bios,
            romAccept,
            romAssetHint,
            biosAccept,
            biosAssetHint,
            requiresBIOS,
            showBIOS,
            messages,
          })
          .on("save:rom", handleSaveRom)
          .on("remove:rom", handleRemoveRom)
          .on("save:bios", handleSaveBios)
          .on("remove:bios", handleRemoveBios)
          .on("launch", (_event, payload) => bootWithFiles(payload))
          .mount(mainEl);
      };

      const bootWithFiles = async ({ rom, bios }) => {
        loadedFiles.rom = rom;
        loadedFiles.bios = bios;

        mainEl.classList?.add("running");

        const runtimeEl = $create("div", {
          className: "runtime",
        });

        mainEl.replaceChildren(runtimeEl);

        const primaryFile = rom || bios;
        console.log(`[Demo] Loaded file: ${primaryFile?.name} (${primaryFile?.size?.toLocaleString()} bytes)`);

        if (primaryFile) {
          toArrayBuffer(primaryFile).then((bytes) => {
            if (bytes) {
              computeChecksums(bytes).then((checksums) => {
                const checksumMap = checksums.reduce((acc, c) => ({ ...acc, [c.label]: c.value }), {});
                console.log(`[Demo] Checksums for ${primaryFile.name}:`, checksumMap);
              });
            }
          });
        }

        const eventPayload = {
          attachTo: runtimeEl,
          container: runtimeEl,
          target: runtimeEl,
          rom,
          bios,
          fileName: primaryFile?.name,
          byteLength: primaryFile?.size,
          files: { rom, bios },
        };

        const results = await demo.emit("launch", eventPayload);
        const fileResults = await demo.emit("file", { action: "launch", ...eventPayload });

        const allResults = [...results, ...fileResults];
        for (const res of allResults) {
          if (res && typeof res === "object" && (typeof res.start === "function" || typeof res.pause === "function" || typeof res.destroy === "function")) {
            currentInstance = res;
            break;
          }
        }

        if (escMenuConfig.enabled !== false) {
          let isMenuOpen = false;
          let escMenuMount = null;

          const escContainer = $create("div", { className: "esc-container" });
          runtimeEl.appendChild(escContainer);

          const optionGroups = escMenuConfig.optionGroups ||
            (escMenuConfig.options ? [{ id: "settings", label: "Settings", options: escMenuConfig.options }] : getDefaultOptionGroups());

          const exitToLauncher = () => {
            if (typeof window !== "undefined") {
              window.removeEventListener("keydown", handleKeyDown);
            }
            if (escMenuMount) {
              escMenuMount.destroy();
              escMenuMount = null;
            }
            if (currentInstance && typeof currentInstance.destroy === "function") {
              currentInstance.destroy();
            }
            currentInstance = null;
            renderLauncher();
          };

          const updateEscMenu = () => {
            if (escMenuMount) {
              escMenuMount.destroy();
            }
            escMenuMount = CEscMenu
              .renderShadow({
                open: isMenuOpen,
                title: escMenuConfig.title || config.messages?.escMenuTitle || messages.escMenuTitle,
                subtitle: primaryFile?.name || "Game",
                hasSaveStates: Boolean(config.manifest?.capabilities?.saveStates || escMenuConfig.onSaveState || currentInstance?.saveState),
                optionGroups,
                customItems: escMenuConfig.items || [],
                messages,
              })
              .mount(escContainer);
          };

          // Bound once, not per render. The $emit channel lives on the
          // Component79 instance and deliberately survives destroy() — that is
          // what lets it work while detached — so re-registering these inside
          // updateEscMenu() stacked a fresh set of listeners on every open,
          // close and restore-defaults. After N re-renders a single click
          // reached the handler N times, growing without bound.
          const bindEscMenuEvents = () => {
            CEscMenu
              .on("close", () => closeMenu())
              .on("reset", () => {
                closeMenu();
                demo.emit("reset", { instance: currentInstance });
                if (typeof escMenuConfig.onReset === "function") {
                  escMenuConfig.onReset(currentInstance);
                } else if (currentInstance && typeof currentInstance.reset === "function") {
                  currentInstance.reset();
                }
              })
              .on("restore-defaults", () => {
                const defaults = getDefaultOptionGroups();
                for (const group of optionGroups) {
                  const defaultGroup = defaults.find((g) => g.id === group.id);
                  if (!defaultGroup) continue;
                  for (const opt of group.options) {
                    const defaultOpt = defaultGroup.options.find((o) => o.key === opt.key);
                    if (defaultOpt) {
                      opt.value = defaultOpt.value;
                      if (currentInstance && typeof currentInstance.setOption === "function") {
                        currentInstance.setOption(opt.key, opt.value);
                      }
                    }
                  }
                }
                updateEscMenu();
                demo.emit("restoreDefaults", { instance: currentInstance });
                if (typeof escMenuConfig.onRestoreDefaults === "function") {
                  escMenuConfig.onRestoreDefaults(currentInstance);
                }
              })
              .on("option-change", (_event, { key, value, option }) => {
                if (currentInstance && typeof currentInstance.setOption === "function") {
                  currentInstance.setOption(key, value);
                }
                demo.emit("option", { key, value, option, instance: currentInstance });
                if (typeof escMenuConfig.onOptionChange === "function") {
                  escMenuConfig.onOptionChange(key, value, option, currentInstance);
                }
              })
              .on("save-state", () => {
                closeMenu();
                demo.emit("saveState", { instance: currentInstance });
                if (typeof escMenuConfig.onSaveState === "function") {
                  escMenuConfig.onSaveState(currentInstance);
                } else if (currentInstance && typeof currentInstance.saveState === "function") {
                  currentInstance.saveState();
                }
              })
              .on("load-state", () => {
                closeMenu();
                demo.emit("loadState", { instance: currentInstance });
                if (typeof escMenuConfig.onLoadState === "function") {
                  escMenuConfig.onLoadState(currentInstance);
                } else if (currentInstance && typeof currentInstance.loadState === "function") {
                  currentInstance.loadState();
                }
              })
              .on("exit", () => {
                demo.emit("exit", { instance: currentInstance });
                if (typeof escMenuConfig.onExit === "function") {
                  escMenuConfig.onExit(currentInstance);
                }
                exitToLauncher();
              })
              .on("custom-action", (_event, item) => {
                closeMenu();
                demo.emit("customAction", { item, instance: currentInstance });
                if (typeof item?.action === "function") {
                  item.action(currentInstance);
                }
              });
          };

          const openMenu = () => {
            if (isMenuOpen) return;
            isMenuOpen = true;
            demo.emit("pause", { instance: currentInstance });
            demo.emit("esc", { open: true, instance: currentInstance });
            if (currentInstance && typeof currentInstance.pause === "function") {
              currentInstance.pause();
            }
            updateEscMenu();
          };

          const closeMenu = () => {
            if (!isMenuOpen) return;
            isMenuOpen = false;
            demo.emit("resume", { instance: currentInstance });
            demo.emit("esc", { open: false, instance: currentInstance });
            if (currentInstance && typeof currentInstance.resume === "function") {
              currentInstance.resume();
            }
            updateEscMenu();
          };

          const toggleMenu = () => {
            if (isMenuOpen) closeMenu();
            else openMenu();
          };

          const shortcutKey = escMenuConfig.shortcutKey || "Escape";
          const handleKeyDown = (event) => {
            if (event.key === shortcutKey || event.code === shortcutKey) {
              event.preventDefault();
              toggleMenu();
            }
          };

          if (typeof window !== "undefined") {
            window.addEventListener("keydown", handleKeyDown);
          }
          bindEscMenuEvents();
          updateEscMenu();
        }
      };

      renderLauncher();
    };

    boot().catch((err) => {
      console.error("[Demo] Boot failed:", err);
    });

    return demo;
  },
};

// Automatic initialization fallback for legacy script tags (<script type="module" src="./demo.js"></script>)
setTimeout(() => {
  if (!isInitialized && typeof document !== "undefined" && typeof window !== "undefined") {
    demo.init();
  }
}, 0);

export default demo;
export { demo };
