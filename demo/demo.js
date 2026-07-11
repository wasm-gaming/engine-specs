import { createDummySdk } from "./demo.sdk.js";
import { ejs } from "./e.js";

await ejs.loadComponents(
  new URL("./components/launcher.html", import.meta.url),
  new URL("./components/sdk-info.html", import.meta.url),
);

const pageEl = document.querySelector("div.page");
if (!(pageEl instanceof HTMLElement)) {
  throw new Error("Demo page boot failed: missing required elements.");
}

const sdk = createDummySdk();

const bootWithFile = async (file) => {
  const bytes = await file.arrayBuffer();

  pageEl.classList.add("running");

  const runtimeEl = document.createElement("div");
  runtimeEl.className = "runtime";

  const canvasEl = document.createElement("canvas");
  runtimeEl.appendChild(canvasEl);
  pageEl.replaceChildren(runtimeEl);

  const instance = await sdk.load({
    canvasEl,
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
};

await ejs.mount("launcher", pageEl, { onFile: bootWithFile });

const sdkInfoEl = pageEl.querySelector("section.sdk");
if (!(sdkInfoEl instanceof HTMLElement)) {
  throw new Error("Demo page boot failed: missing required launcher elements.");
}

await ejs.mount("sdk-info", sdkInfoEl, {
  name: sdk.manifest.name,
  id: sdk.manifest.id,
  description: sdk.manifest.description,
  version: sdk.manifest.version,
  baseWidth: sdk.manifest.video.baseWidth,
  baseHeight: sdk.manifest.video.baseHeight,
  assetKey: sdk.manifest.assets[0]?.key ?? "rom",
});
