/**
 * The demo's picture, and nothing else.
 *
 * Isolated from the SDK on purpose: it knows about a canvas and a frame callback,
 * not about manifests, assets or the engine contract. Whatever shape the demo SDK
 * takes next, this keeps working untouched — it is the part that was never about
 * the contract.
 *
 * @param {HTMLCanvasElement} canvasEl
 * @param {{ onFrame?: (fps: number) => void }} [options]
 */
export function createCanvasRenderer(canvasEl, { onFrame } = {}) {
	const ctx = canvasEl.getContext("2d");
	if (!ctx) {
		throw new Error("Could not create 2D canvas context.");
	}

	let raf = 0;
	let running = false;
	let lastFrame = performance.now();

	const fontSize = 30;
	let drops = [];

	const fitCanvasToWindow = () => {
		const dpr = window.devicePixelRatio || 1;
		const rect = canvasEl.getBoundingClientRect();
		canvasEl.width = Math.max(1, Math.floor(rect.width * dpr));
		canvasEl.height = Math.max(1, Math.floor(rect.height * dpr));
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
					chars: Array.from({ length: maxRows }, () => String.fromCharCode(0x30A0 + Math.random() * 96)),
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

		onFrame?.(fps);
		raf = requestAnimationFrame(render);
	};

	fitCanvasToWindow();
	window.addEventListener("resize", fitCanvasToWindow);

	return {
		get running() {
			return running;
		},
		start() {
			if (running) {
				return;
			}
			running = true;
			lastFrame = performance.now();
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
			lastFrame = performance.now();
			raf = requestAnimationFrame(render);
		},
		reset() {
			lastFrame = performance.now();
			drops = [];
		},
		destroy() {
			running = false;
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", fitCanvasToWindow);
		},
	};
}
