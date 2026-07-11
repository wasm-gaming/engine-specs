import { createDummySdk } from "./demo.sdk.js";
import { checksumAlgorithms, computeChecksums } from "./checksums.js";
import { $, fetchEJS } from "./e.js";

const [launcher, sdkInfo, fileInfo] = await Promise.all([
  fetchEJS('./components/launcher.html'),
  fetchEJS('./components/sdk-info.html'),
  fetchEJS('./components/file-info.html'),
]);

const pageEl = $("div.page");
if (!(pageEl instanceof HTMLElement)) {
  throw new Error("Demo page boot failed: missing required elements.");
}

const sdk = createDummySdk();

const bootWithFile = async (file) => {
  const bytes = await file.arrayBuffer();

  pageEl.classList.add("running");

  const runtimeEl = document.createElement("div");
  runtimeEl.className = "runtime";

  const fileInfoEl = document.createElement("section");
  fileInfoEl.className = "file-info";
  runtimeEl.appendChild(fileInfoEl);

  pageEl.replaceChildren(runtimeEl);

  const info = {
    fileName: file.name,
    size: `${bytes.byteLength.toLocaleString()} bytes`,
    checksums: checksumAlgorithms.map((label) => ({ label, value: "computing…" })),
  };
  await fileInfo.mountShadow(fileInfoEl, info);

  const instance = await sdk.load({
    attachTo: runtimeEl,
    assets: {
      rom: bytes,
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

  info.checksums = await computeChecksums(bytes);
  await fileInfo.mountShadow(fileInfoEl, info);
};

await launcher.mount(pageEl, { onFile: bootWithFile });

const sdkInfoEl = pageEl.querySelector("section.sdk");
if (!(sdkInfoEl instanceof HTMLElement)) {
  throw new Error("Demo page boot failed: missing required launcher elements.");
}

await sdkInfo.mountShadow(sdkInfoEl, {
  name: sdk.manifest.name,
  id: sdk.manifest.id,
  description: sdk.manifest.description,
  version: sdk.manifest.version,
  baseWidth: sdk.manifest.video.baseWidth,
  baseHeight: sdk.manifest.video.baseHeight,
  assetKey: sdk.manifest.assets[0]?.key ?? "rom",
});
