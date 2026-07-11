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
				description: "Any file works in this demo; data is not executed.",
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
			const ctx = config.canvasEl.getContext("2d");
			if (!ctx) {
				const error = new Error("Could not create 2D canvas context.");
				config.onEvent?.({ type: "error", error });
				throw error;
			}

			let raf = 0;
			let running = false;
			let t0 = performance.now();
			let lastFrame = t0;

			const fitCanvasToWindow = () => {
				const dpr = window.devicePixelRatio || 1;
				const rect = config.canvasEl.getBoundingClientRect();
				const width = Math.max(1, Math.floor(rect.width * dpr));
				const height = Math.max(1, Math.floor(rect.height * dpr));
				config.canvasEl.width = width;
				config.canvasEl.height = height;
			};

			const render = (time) => {
				if (!running) {
					return;
				}

				const width = config.canvasEl.width;
				const height = config.canvasEl.height;
				const seconds = (time - t0) / 1000;
				const fps = Math.max(1, 1000 / Math.max(1, time - lastFrame));
				lastFrame = time;

				const grad = ctx.createLinearGradient(0, 0, width, height);
				grad.addColorStop(0, "#0d1b2a");
				grad.addColorStop(1, "#1b263b");
				ctx.fillStyle = grad;
				ctx.fillRect(0, 0, width, height);

				for (let i = 0; i < 18; i += 1) {
					const y = Math.sin(seconds * 1.6 + i * 0.4) * 24 + (i * height) / 18;
					ctx.strokeStyle = `hsla(${150 + i * 7}, 75%, 55%, 0.25)`;
					ctx.lineWidth = 2;
					ctx.beginPath();
					ctx.moveTo(0, y);
					ctx.lineTo(width, y + Math.sin(seconds + i) * 18);
					ctx.stroke();
				}

				const fileName = String(config.options?.fileName ?? "unknown");
				const byteLength = Number(config.options?.byteLength ?? 0);

				ctx.fillStyle = "#ffffff";
				ctx.font = "600 28px 'Avenir Next', sans-serif";
				ctx.fillText("Dummy Engine Placeholder", 26, 46);

				ctx.font = "500 17px 'Avenir Next', sans-serif";
				ctx.fillStyle = "#b0c6ff";
				ctx.fillText(`Loaded: ${fileName}`, 26, 78);
				ctx.fillText(`Size: ${byteLength.toLocaleString()} bytes`, 26, 104);

				ctx.fillStyle = "#82f4c5";
				ctx.fillText(`FPS ${fps.toFixed(0)}`, width - 96, 34);

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
				},
			};
		},
	};
}
