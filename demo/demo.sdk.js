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
				description: "Optional system BIOS firmware file.",
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

			const ctx = canvasEl.getContext("2d");
			if (!ctx) {
				const error = new Error("Could not create 2D canvas context.");
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

			let raf = 0;
			let running = false;
			let t0 = performance.now();
			let lastFrame = t0;

			const fontSize = 30;
			let drops = [];

			const fitCanvasToWindow = () => {
				const dpr = window.devicePixelRatio || 1;
				const rect = canvasEl.getBoundingClientRect();
				const width = Math.max(1, Math.floor(rect.width * dpr));
				const height = Math.max(1, Math.floor(rect.height * dpr));
				canvasEl.width = width;
				canvasEl.height = height;
			};

			const render = (time) => {
				if (!running) {
					return;
				}

				const width = canvasEl.width;
				const height = canvasEl.height;
				const dt = Math.min((time - lastFrame) / 1000, 0.1);
				const fps = Math.max(1, 1000 / Math.max(1, time - lastFrame));
				lastFrame = time;

				const expectedColumns = Math.floor(width / fontSize);
				const maxRows = Math.floor(height / fontSize) + 30;

				if (drops.length !== expectedColumns) {
					drops = [];
					for (let x = 0; x < expectedColumns; x++) {
						drops[x] = {
							y: Math.random() * maxRows,
							speed: Math.random() * 1.5 + 0.5,
							opacity: Math.random() * 0.7 + 0.3,
							length: Math.floor(Math.random() * 20 + 5),
							chars: Array.from({ length: maxRows }, () => String.fromCharCode(0x30A0 + Math.random() * 96))
						};
					}
				}

				// Dark background inside the canvas to contrast with the light UI components
				ctx.fillStyle = "#060910ff";
				ctx.fillRect(0, 0, width, height);

				ctx.font = "bold " + fontSize + "px 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans CJK JP', sans-serif";
				ctx.textAlign = "center";

				for (let x = 0; x < drops.length; x++) {
					let drop = drops[x];

					if (Math.random() > 0.4) {
						let randIdx = Math.floor(Math.random() * drop.chars.length);
						drop.chars[randIdx] = String.fromCharCode(0x30A0 + Math.random() * 96);
					}

					drop.y += drop.speed * (dt * 12);

					let startY = Math.floor(drop.y);

					for (let i = 0; i < drop.length; i++) {
						let charY = startY - i;
						if (charY < 0 || charY >= maxRows) continue;

						let text = drop.chars[charY];
						let alpha = drop.opacity * (1 - (i / drop.length));

						if (i === 0) {
							ctx.fillStyle = `rgba(220, 255, 255, ${drop.opacity})`;
						} else {
							const hue = ((time / 15) + (x * 10)) % 360;
							ctx.fillStyle = `hsla(${hue}, 80%, 65%, ${alpha})`;
						}

						ctx.fillText(text, x * fontSize + fontSize / 2, charY * fontSize);
					}

					if ((drop.y - drop.length) * fontSize > height) {
						drop.y = 0;
						drop.speed = Math.random() * 1.5 + 0.5;
						drop.opacity = Math.random() * 0.7 + 0.3;
						drop.length = Math.floor(Math.random() * 20 + 5);
					}
				}

				ctx.fillStyle = "rgba(255,255,255,0.85)";
				ctx.fillRect(width - 210, 20, 180, 64);
				ctx.fillStyle = "#0f172a";
				ctx.font = "600 36px 'Outfit', system-ui, sans-serif";
				ctx.textAlign = "left";
				ctx.fillText(`FPS ${fps.toFixed(0)}`, width - 182, 65);

				config.onEvent?.({ type: "frame", fps });
				raf = requestAnimationFrame(render);
			};

			fitCanvasToWindow();
			window.addEventListener("resize", fitCanvasToWindow);
			config.onEvent?.({ type: "ready" });

			return {
				start() {
					if (running) {
						return;
					}
					running = true;
					raf = requestAnimationFrame(render);
				},
				pause() {
					running = false;
					cancelAnimationFrame(raf);
				},
				resume() {
					if (running) {
						return;
					}
					running = true;
					raf = requestAnimationFrame(render);
				},
				reset() {
					t0 = performance.now();
					lastFrame = t0;
				},
				setInput() {
					return;
				},
				destroy() {
					running = false;
					cancelAnimationFrame(raf);
					window.removeEventListener("resize", fitCanvasToWindow);
					if (ownsCanvas) {
						canvasEl.remove();
					}
				},
			};
		},
	};
}
