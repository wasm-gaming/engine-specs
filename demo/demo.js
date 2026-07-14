import { createDummySdk } from "./demo.sdk.js";
import { checksumAlgorithms, computeChecksums } from "./checksums.js";
// import { $, $create, fetchEJS } from "./e.js";

import { $, $create, Component79 } from "https://esm.sh/jq79"

const [cLauncher, cSdkInfo, cFileInfo] = await Promise.all([
  Component79.fetch('./components/launcher.html'),
  Component79.fetch('./components/sdk-info.html'),
  Component79.fetch('./components/file-info.html'),
]);

const mainEl = $("main");
if (!(mainEl instanceof HTMLElement)) {
  throw new Error("Demo page boot failed: missing required elements.");
}

const sdk = createDummySdk();

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
  const fileInfoPlaceholder = cFileInfo
    .renderShadow({
      ...fileInfoProps,
      checksums: checksumAlgorithms.map((label) => ({ label, value: "computing…" })),
    })
    .mount(fileInfoEl);

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

  const checksums = await computeChecksums(bytes);
  fileInfoPlaceholder.destroy();
  
  cFileInfo
    .renderShadow({ ...fileInfoProps, checksums })
    .mount(fileInfoEl);
};

cLauncher
  .render({ onFile: bootWithFile })
  .mount(mainEl);

const sdkInfoEl = mainEl.querySelector("section.sdk");
if (!(sdkInfoEl instanceof HTMLElement)) {
  throw new Error("Demo page boot failed: missing required launcher elements.");
}

cSdkInfo
  .renderShadow({
    name: sdk.manifest.name,
    id: sdk.manifest.id,
    description: sdk.manifest.description,
    version: sdk.manifest.version,
    baseWidth: sdk.manifest.video.baseWidth,
    baseHeight: sdk.manifest.video.baseHeight,
    assetKey: sdk.manifest.assets[0]?.key ?? "rom",
  })
  .mount(sdkInfoEl);
