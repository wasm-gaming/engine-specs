import { getSdk } from "./sdk.js";
import { checksumAlgorithms, computeChecksums } from "./checksums.js";
import { $, $create, Component79 } from "https://jgermade.github.io/jq79/jq79.js";

// Fetch component HTML templates using import.meta.url for resilient subpath resolution
const fetchComponent = (path) => Component79.fetch(new URL(path, import.meta.url).href);

// Fetch all components at once to leverage http2 request multiplexing.
const [CLauncher, CSdkInfo, CFileInfo] = await Promise.all([
  fetchComponent("./components/launcher.html"),
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

// Compute asset accept filter and hint text from manifest
const acceptedExts = sdk.manifest?.assets?.flatMap((a) => a.accept ?? []) ?? [];
const acceptAttr = acceptedExts.length > 0 ? acceptedExts.join(",") : undefined;
const assetHint = acceptedExts.length > 0
  ? `Supported files: ${acceptedExts.join(", ")}`
  : "or choose one from your computer";

const bootWithFile = async (file) => {
  const bytes = await file.arrayBuffer();

  mainEl.classList.add("running");

  const fileInfoEl = $create("section", { className: "file-info" });
  const runtimeEl = $create("div", {
    className: "runtime",
    children: [fileInfoEl],
  });

  mainEl.replaceChildren(runtimeEl);

  const fileInfoProps = {
    fileName: file.name,
    size: `${bytes.byteLength.toLocaleString()} bytes`,
  };
  const fileInfoPlaceholder = CFileInfo
    .renderShadow({
      ...fileInfoProps,
      checksums: checksumAlgorithms.map((label) => ({ label, value: "computing…" })),
    })
    .mount(fileInfoEl);

  const assetKey = sdk.manifest?.assets?.[0]?.key ?? "rom";
  const instance = await sdk.load({
    attachTo: runtimeEl,
    assets: {
      [assetKey]: bytes,
    },
    options: {
      fileName: file.name,
      byteLength: bytes.byteLength,
    },
    onEvent(event) {
      if (event.type === "error") {
        console.error(event.error);
      }
    },
  });

  instance.start();

  const checksums = await computeChecksums(bytes);
  fileInfoPlaceholder.destroy();

  CFileInfo
    .renderShadow({ ...fileInfoProps, checksums })
    .mount(fileInfoEl);
};

CLauncher
  .render({
    CSdkInfo,
    sdkInfo: {
      name: sdk.manifest.name,
      id: sdk.manifest.id,
      description: sdk.manifest.description,
      version: sdk.manifest.version,
      baseWidth: sdk.manifest.video?.baseWidth ?? 320,
      baseHeight: sdk.manifest.video?.baseHeight ?? 240,
      assetKey: sdk.manifest.assets?.[0]?.key ?? "rom",
    },
    onFile: bootWithFile,
    accept: acceptAttr,
    assetHint,
  })
  .mount(mainEl);
