import { createCanvasRenderer } from "./canvas-renderer.js";

export function createDummySdk() {
	const manifest = {
		id: "dummy-canvas-sdk",
		version: "0.1.0-demo",
		name: "Dummy Canvas Engine",
		description: "A placeholder SDK that renders animated content on canvas.",
		artifacts: {
			wasm: "./dummy.wasm",
			js: "./dummy.js",
		},
		assets: [
			{
				key: "rom",
				mountPath: "/rom.bin",
				required: true,
				accept: [".rom", ".bin", ".zip", ".dat"],
				description: "Any game ROM file works in this demo.",
			},
			{
				key: "bios",
				mountPath: "/bios.bin",
				required: false,
				accept: [".bin", ".rom", ".sys"],
				description: "System BIOS firmware file.",
			},
		],
		input: "keyboard-default",
		video: {
			baseWidth: 320,
			baseHeight: 256,
			aspect: "5:4",
		},
		capabilities: {
			saveStates: false,
			sram: false,
		},
	};

	return {
		manifest,
		async load(config) {
			const ownsCanvas = !config.canvasEl;
			const canvasEl = config.canvasEl ?? document.createElement("canvas");
			if (ownsCanvas) {
				config.attachTo.appendChild(canvasEl);
			}

			let renderer;
			try {
				renderer = createCanvasRenderer(canvasEl, {
					onFrame: (fps) => config.onEvent?.({ type: "frame", fps }),
				});
			} catch (error) {
				config.onEvent?.({ type: "error", error });
				throw error;
			}

			// Copy loaded ROM and BIOS assets to MEMFS (In-Memory Virtual File System)
			const MEMFS = new Map();
			if (config.assets) {
				for (const assetSpec of manifest.assets) {
					const data = config.assets[assetSpec.key];
					if (data) {
						const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
						MEMFS.set(assetSpec.mountPath, bytes);
						console.log(`[MEMFS] Copied asset '${assetSpec.key}' (${bytes.byteLength} bytes) to ${assetSpec.mountPath}`);
					}
				}
			}

			config.onEvent?.({ type: "ready" });

			return {
				start: () => renderer.start(),
				pause: () => renderer.pause(),
				resume: () => renderer.resume(),
				reset: () => renderer.reset(),
				setInput() {
					return;
				},
				destroy() {
					renderer.destroy();
					if (ownsCanvas) {
						canvasEl.remove();
					}
				},
			};
		},
	};
}

export const sdk = createDummySdk();
export default sdk;
