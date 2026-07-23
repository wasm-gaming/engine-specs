import { getSdk } from "./sdk.js";
import { checksumAlgorithms, computeChecksums } from "./checksums.js";
import { loadStoredAsset, saveStoredAsset } from "./storage.js";
import { $, $create, Component79 } from "https://jgermade.github.io/jq79/jq79.js";

// Safe URL parameter resolution from script URL & page URL
const pageUrl = new URL(location.href);
const scriptUrl = new URL(import.meta.url, location.href);
const biosParam = scriptUrl.searchParams.get("bios") ?? pageUrl.searchParams.get("bios");

// Fetch component HTML templates using import.meta.url for resilient subpath resolution
const fetchComponent = (path) => Component79.fetch(new URL(path, import.meta.url).href);

// Fetch all components at once to leverage http2 request multiplexing.
const [CLauncher, CDropArea, CSdkInfo, CFileInfo] = await Promise.all([
  fetchComponent("./components/launcher.html"),
  fetchComponent("./components/drop-area.html"),
  fetchComponent("./components/sdk-info.html"),
  fetchComponent("./components/file-info.html"),
]);

const mainEl = $("main");
if (!(mainEl instanceof HTMLElement)) {
  throw new Error("Demo page boot failed: missing required elements.");
}

const sdk = await getSdk();

if (sdk.manifest?.name) {
  document.title = `${sdk.manifest.name} - Demo`;
}

// Compute asset accept filters and hints from manifest
const romSpec = sdk.manifest?.assets?.find((a) => a.key === "rom") ?? sdk.manifest?.assets?.[0];
const biosSpec = sdk.manifest?.assets?.find((a) => a.key === "bios") ?? sdk.manifest?.assets?.[1];

// Determine BIOS visibility and requirement rules
const hasBiosSpec = Boolean(biosSpec);
const showBIOS = biosParam !== "false" && (hasBiosSpec || biosParam === "required" || biosParam === "true" || biosParam === "optional");
const requiresBIOS = biosParam === "required" || (biosParam !== "optional" && Boolean(biosSpec?.required));

// Load previously stored ROM & BIOS from OPFS if available
const [storedRom, storedBios] = await Promise.all([
  loadStoredAsset("rom"),
  showBIOS ? loadStoredAsset("bios") : null,
]);

const romAccept = romSpec?.accept?.join(",");
const romAssetHint = romSpec?.accept ? `Supported: ${romSpec.accept.join(", ")}` : "or choose ROM file from computer";

const biosAccept = biosSpec?.accept?.join(",");
const biosAssetHint = biosSpec?.description ?? (biosSpec?.accept ? `Supported: ${biosSpec.accept.join(", ")}` : (requiresBIOS ? "required BIOS firmware file" : "optional BIOS firmware file"));

async function toArrayBuffer(input) {
  if (!input) return null;
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) return input.buffer;
  if (typeof input.arrayBuffer === "function") return await input.arrayBuffer();
  if (input.detail) return await toArrayBuffer(input.detail);
  throw new TypeError("Provided input is not a File, Blob, or ArrayBuffer.");
}

const bootWithFiles = async ({ rom, bios }) => {
  const romBytes = await toArrayBuffer(rom);
  const biosBytes = await toArrayBuffer(bios);

  mainEl.classList.add("running");

  const fileInfoEl = $create("section", { className: "file-info" });
  const runtimeEl = $create("div", {
    className: "runtime",
    children: [fileInfoEl],
  });

  mainEl.replaceChildren(runtimeEl);

  const primaryFile = rom || bios;
  const fileInfoProps = {
    fileName: primaryFile.name,
    size: `${primaryFile.size.toLocaleString()} bytes`,
  };
  const fileInfoPlaceholder = CFileInfo
    .renderShadow({
      ...fileInfoProps,
      checksums: checksumAlgorithms.map((label) => ({ label, value: "computing…" })),
    })
    .mount(fileInfoEl);

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

  const checksums = await computeChecksums(romBytes || biosBytes);
  fileInfoPlaceholder.destroy();

  CFileInfo
    .renderShadow({ ...fileInfoProps, checksums })
    .mount(fileInfoEl);
};

CLauncher
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
    onLaunchFiles: bootWithFiles,
    romAccept,
    romAssetHint,
    biosAccept,
    biosAssetHint,
    requiresBIOS,
    showBIOS,
  })
  .mount(mainEl);
