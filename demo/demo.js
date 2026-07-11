import { createDummySdk } from "./demo.sdk.js";

const pageEl = document.getElementById("page");
const launcherEl = document.getElementById("launcher");
const sdkInfoEl = document.getElementById("sdk-info");
const dropAreaEl = document.getElementById("drop-area");
const statusEl = document.getElementById("status");
const fileInputEl = document.getElementById("file-input");

if (
  !(pageEl instanceof HTMLElement) ||
  !(launcherEl instanceof HTMLElement) ||
  !(sdkInfoEl instanceof HTMLElement) ||
  !(dropAreaEl instanceof HTMLElement) ||
  !(statusEl instanceof HTMLElement) ||
  !(fileInputEl instanceof HTMLInputElement)
) {
  throw new Error("Demo page boot failed: missing required elements.");
}

const sdk = createDummySdk();

sdkInfoEl.innerHTML = `
  <h1>${sdk.manifest.name} (${sdk.manifest.id})</h1>
  <p>${sdk.manifest.description ?? "No description"}</p>
  <div class="row">
    <span class="pill">Version ${sdk.manifest.version}</span>
    <span class="pill">${sdk.manifest.video.baseWidth}x${sdk.manifest.video.baseHeight}</span>
    <span class="pill">Asset key: ${sdk.manifest.assets[0]?.key ?? "rom"}</span>
  </div>
`;

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
