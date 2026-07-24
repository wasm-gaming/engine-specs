import { getSdk as getLocalSdk } from "./sdk.js";
import { checksumAlgorithms, computeChecksums } from "./checksums.js";
import { loadStoredAsset, saveStoredAsset, clearStoredAsset } from "./storage.js";

let isInitialized = false;

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

async function resolveSdk(sdkOption) {
  if (typeof sdkOption === "function") {
    return await sdkOption();
  }
  if (sdkOption && typeof sdkOption.load === "function") {
    return sdkOption;
  }
  if (sdkOption && typeof sdkOption.getSdk === "function") {
    return await sdkOption.getSdk();
  }
  if (sdkOption && sdkOption.default) {
    return await resolveSdk(sdkOption.default);
  }
  return await getLocalSdk();
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
  async init(config = {}) {
    isInitialized = true;

    let jq;
    if (config.jq79) {
      jq = config.jq79;
    } else {
      jq = await import("https://jgermade.github.io/jq79/jq79.js");
    }

    const { $, $create, Component79 } = jq;
    const fetchComponent = (path) => Component79.fetch(new URL(path, import.meta.url).href);

    // Fetch all components at once to leverage http2 request multiplexing.
    const [CLauncher, CDropArea, CSdkInfo, CEscMenu] = await Promise.all([
      fetchComponent("./components/launcher.html"),
      fetchComponent("./components/drop-area.html"),
      fetchComponent("./components/sdk-info.html"),
      fetchComponent("./components/esc-menu.html"),
    ]);

    // Resolve target element for mounting launcher
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

    const sdk = await resolveSdk(config.sdk);
    const messages = { ...DEFAULT_MESSAGES, ...config.messages };
    const escMenuConfig = config.escMenu || {};

    if (typeof document !== "undefined") {
      if (config.messages?.title) {
        document.title = config.messages.title;
      } else if (sdk.manifest?.name) {
        document.title = `${sdk.manifest.name} - Demo`;
      }
    }

    // Compute asset accept filters and hints from manifest
    const romSpec = sdk.manifest?.assets?.find((a) => a.key === "rom") ?? sdk.manifest?.assets?.[0];
    const biosSpec = sdk.manifest?.assets?.find((a) => a.key === "bios") ?? sdk.manifest?.assets?.[1];

    const { showBIOS, requiresBIOS } = resolveBiosConfig(config.bios);

    // Load stored ROM & BIOS from OPFS if available
    const [storedRom, storedBios] = await Promise.all([
      loadStoredAsset("rom"),
      showBIOS ? loadStoredAsset("bios") : null,
    ]);

    const romAccept = romSpec?.accept?.join(",");
    const romAssetHint = config.messages?.romAssetHint ?? (romSpec?.accept ? `Supported: ${romSpec.accept.join(", ")}` : messages.romAssetHint);

    const biosAccept = biosSpec?.accept?.join(",");
    const biosAssetHint = config.messages?.biosAssetHint ?? (biosSpec?.description ?? (biosSpec?.accept ? `Supported: ${biosSpec.accept.join(", ")}` : (requiresBIOS ? messages.biosAssetHintRequired : messages.biosAssetHintOptional)));

    let currentLauncherMount = null;

    const renderLauncher = () => {
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
          sdkInfo: {
            name: sdk.manifest.name,
            id: sdk.manifest.id,
            description: sdk.manifest.description,
            version: sdk.manifest.version,
            baseWidth: sdk.manifest.video?.baseWidth ?? 320,
            baseHeight: sdk.manifest.video?.baseHeight ?? 240,
            assetKey: romSpec?.key ?? "rom",
          },
          initialRomFile: storedRom,
          initialBiosFile: storedBios,
          onSaveRom: (file) => saveStoredAsset("rom", file),
          onSaveBios: (file) => saveStoredAsset("bios", file),
          onRemoveRom: () => clearStoredAsset("rom"),
          onRemoveBios: () => clearStoredAsset("bios"),
          onLaunchFiles: bootWithFiles,
          romAccept,
          romAssetHint,
          biosAccept,
          biosAssetHint,
          requiresBIOS,
          showBIOS,
          messages,
        })
        .mount(mainEl);
    };

    const bootWithFiles = async ({ rom, bios }) => {
      const romBytes = await toArrayBuffer(rom);
      const biosBytes = await toArrayBuffer(bios);

      mainEl.classList?.add("running");

      const runtimeEl = $create("div", {
        className: "runtime",
      });

      mainEl.replaceChildren(runtimeEl);

      const primaryFile = rom || bios;
      console.log(`[Demo] Loaded file: ${primaryFile.name} (${primaryFile.size.toLocaleString()} bytes)`);

      const assets = {};
      if (romBytes && romSpec) {
        assets[romSpec.key] = romBytes;
      }
      if (biosBytes && biosSpec) {
        assets[biosSpec.key] = biosBytes;
      }
      if (Object.keys(assets).length === 0 && romBytes) {
        assets.rom = romBytes;
      }

      const instance = await sdk.load({
        attachTo: runtimeEl,
        assets,
        options: {
          fileName: primaryFile.name,
          byteLength: primaryFile.size,
        },
        onEvent(event) {
          if (event.type === "error") {
            console.error(event.error);
          }
        },
      });

      instance.start();

      // Compute and log checksums to console asynchronously
      computeChecksums(romBytes || biosBytes).then((checksums) => {
        const checksumMap = checksums.reduce((acc, c) => ({ ...acc, [c.label]: c.value }), {});
        console.log(`[Demo] Checksums for ${primaryFile.name}:`, checksumMap);
      });

      // Customizable In-Game ESC Menu integration
      if (escMenuConfig.enabled !== false) {
        let isMenuOpen = false;
        let escMenuMount = null;

        // Create a dedicated container div for ESC menu shadow root so runtimeEl light DOM children (canvasEl) are never hidden
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
          if (typeof instance.destroy === "function") {
            instance.destroy();
          }
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
              subtitle: sdk.manifest?.name || primaryFile.name,
              hasSaveStates: Boolean(sdk.manifest?.capabilities?.saveStates || escMenuConfig.onSaveState),
              optionGroups,
              customItems: escMenuConfig.items || [],
              messages,
              onOpen: () => openMenu(),
              onClose: () => closeMenu(),
              onReset: () => {
                closeMenu();
                if (typeof escMenuConfig.onReset === "function") {
                  escMenuConfig.onReset(instance);
                } else if (typeof instance.reset === "function") {
                  instance.reset();
                }
              },
              onRestoreDefaults: () => {
                const defaults = getDefaultOptionGroups();
                for (const group of optionGroups) {
                  const defaultGroup = defaults.find((g) => g.id === group.id);
                  if (!defaultGroup) continue;
                  for (const opt of group.options) {
                    const defaultOpt = defaultGroup.options.find((o) => o.key === opt.key);
                    if (defaultOpt) {
                      opt.value = defaultOpt.value;
                      if (typeof instance.setOption === "function") {
                        instance.setOption(opt.key, opt.value);
                      }
                    }
                  }
                }
                updateEscMenu();
                if (typeof escMenuConfig.onRestoreDefaults === "function") {
                  escMenuConfig.onRestoreDefaults(instance);
                }
              },
              onOptionChange: (key, value, option) => {
                if (typeof instance.setOption === "function") {
                  instance.setOption(key, value);
                }
                if (typeof escMenuConfig.onOptionChange === "function") {
                  escMenuConfig.onOptionChange(key, value, option, instance);
                }
              },
              onSaveState: () => {
                closeMenu();
                if (typeof escMenuConfig.onSaveState === "function") {
                  escMenuConfig.onSaveState(instance);
                } else if (typeof instance.saveState === "function") {
                  instance.saveState();
                }
              },
              onLoadState: () => {
                closeMenu();
                if (typeof escMenuConfig.onLoadState === "function") {
                  escMenuConfig.onLoadState(instance);
                } else if (typeof instance.loadState === "function") {
                  instance.loadState();
                }
              },
              onExit: () => {
                if (typeof escMenuConfig.onExit === "function") {
                  escMenuConfig.onExit(instance);
                }
                exitToLauncher();
              },
              onCustomAction: (item) => {
                closeMenu();
                if (typeof item?.action === "function") {
                  item.action(instance);
                }
              },
            })
            .mount(escContainer);
        };

        const openMenu = () => {
          if (isMenuOpen) return;
          isMenuOpen = true;
          if (typeof instance.pause === "function") {
            instance.pause();
          }
          updateEscMenu();
        };

        const closeMenu = () => {
          if (!isMenuOpen) return;
          isMenuOpen = false;
          if (typeof instance.resume === "function") {
            instance.resume();
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
        updateEscMenu();
      }
    };

    renderLauncher();

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
