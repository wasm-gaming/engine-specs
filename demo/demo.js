import { createDummySdk } from "./demo.sdk.js";
import { ejs } from "./e.js";

await ejs.loadTemplates(new URL("./demo.partials.html", import.meta.url));

const pageEl = document.querySelector("div.page");
if (!(pageEl instanceof HTMLElement)) {
  throw new Error("Demo page boot failed: missing required elements.");
}

const sdk = createDummySdk();

pageEl.innerHTML = ejs.fromNamedTemplate("launcher");

const launcherEl = pageEl.querySelector("form.launcher");
const sdkInfoEl = pageEl.querySelector("section.sdk");
const dropAreaEl = pageEl.querySelector("section.drop");
const statusEl = pageEl.querySelector("div.status");
const fileInputEl = pageEl.querySelector("input[type='file']");

if (
  !(launcherEl instanceof HTMLElement) ||
  !(sdkInfoEl instanceof HTMLElement) ||
  !(dropAreaEl instanceof HTMLElement) ||
  !(statusEl instanceof HTMLElement) ||
  !(fileInputEl instanceof HTMLInputElement)
) {
  throw new Error("Demo page boot failed: missing required launcher elements.");
}

sdkInfoEl.innerHTML = ejs.fromNamedTemplate("sdk-info", {
  name: sdk.manifest.name,
  id: sdk.manifest.id,
  description: sdk.manifest.description,
  version: sdk.manifest.version,
  baseWidth: sdk.manifest.video.baseWidth,
  baseHeight: sdk.manifest.video.baseHeight,
  assetKey: sdk.manifest.assets[0]?.key ?? "rom",
});

const setStatus = (message) => {
  statusEl.textContent = message;
};

const bootWithFile = async (file) => {
  setStatus(`Loading ${file.name}...`);
  const bytes = await file.arrayBuffer();

  launcherEl.replaceWith();
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

const onFileList = async (files) => {
  const file = files.item(0);
  if (!file) {
    return;
  }
  try {
    await bootWithFile(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to load file: ${message}`);
  }
};

dropAreaEl.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropAreaEl.classList.add("active");
});

dropAreaEl.addEventListener("dragleave", () => {
  dropAreaEl.classList.remove("active");
});

dropAreaEl.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropAreaEl.classList.remove("active");
  if (event.dataTransfer?.files) {
    await onFileList(event.dataTransfer.files);
  }
});

fileInputEl.addEventListener("change", async () => {
  if (fileInputEl.files) {
    await onFileList(fileInputEl.files);
  }
});

setStatus("Waiting for ROM/asset file...");
