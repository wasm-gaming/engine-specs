// @ts-check
/**
 * The demo engine, written against the contract in `src/engine-specs.ts`.
 *
 * It is a real implementation, not a mock, and it is now written the way an engine is
 * meant to be written: `EnginePlayBase` and `EngineSDKBase` carry the state, the
 * descriptors, the cumulative merge, the chainable promise and the channel, and what
 * is left here is the part that is actually about drawing on a canvas.
 *
 * `demo/tsconfig.json` checks it against the contract with `checkJs`, so "the demo
 * conforms" is verified rather than claimed — and it is also the check that the base
 * classes are usable from plain JS with JSDoc, not only from TypeScript.
 *
 * What used to live in a manifest lives here now: `id`/`version`/`name`/`description`
 * are static on the class, the video geometry is `config`, and what an asset accepts
 * is its descriptor's `allowedTypes`.
 */

import { EnginePlayBase, EngineSDKBase } from '../src/engine-specs.js'
import { createCanvasRenderer } from './canvas-renderer.js'

/**
 * This engine omits `events` from its payload bundle, unlike the reference engine in
 * `tests/engine.conformance.ts` which declares one of its own. Both are legal, and
 * between the two they cover both branches of `EventsOf`: here it resolves to the
 * core set alone.
 *
 * @typedef {{ baseWidth: number, baseHeight: number }} DemoConfig
 * @typedef {{ fileName?: string, byteLength?: number }} DemoOptions
 * @typedef {{ rom?: Uint8Array, bios?: Uint8Array }} DemoAssets
 * @typedef {{ namespace: string }} DemoStorage
 * @typedef {{ config: DemoConfig, options: DemoOptions, assets: DemoAssets, storage: DemoStorage }} DemoPayloads
 *
 * @typedef {import('../src/engine-specs.js').EventsOf<DemoPayloads>} DemoEvents
 * @typedef {import('../src/engine-specs.js').EngineInit<DemoPayloads>} DemoInit
 * @typedef {import('../src/engine-specs.js').EngineSpec<DemoPayloads>} DemoSpec
 * @typedef {import('../src/engine-specs.js').EventEmitter<DemoEvents>} DemoChannel
 * @typedef {import('../src/engine-specs.js').EngineSDKConstructor<DemoPayloads>} DemoSDKConstructor
 */

/**
 * What this engine declares about its properties. `default` appears here and nowhere
 * else — the base class seeds its starting state from it, so the initial value and
 * the advertised default cannot drift apart.
 *
 * @type {DemoSpec}
 */
const spec = {
	config: {
		baseWidth: { default: 320, description: 'Native render width, in pixels.', live: false },
		baseHeight: { default: 256, description: 'Native render height, in pixels.', live: false },
	},
	options: {
		fileName: { description: 'Name of the loaded ROM.', live: true },
		byteLength: { description: 'Size of the loaded ROM, in bytes.', live: true },
	},
	assets: {
		// `allowedTypes` is what a host file picker needs: it replaces the manifest's
		// `AssetSpec.accept`, and now travels with the value it describes.
		rom: {
			description: 'Any game ROM file works in this demo.',
			allowedTypes: ['.rom', '.bin', '.zip', '.dat'],
			live: false,
		},
		bios: {
			description: 'System BIOS firmware file.',
			allowedTypes: ['.bin', '.rom', '.sys'],
			live: false,
		},
	},
	storage: {
		namespace: { default: 'engine-specs/demo', description: 'Folder the engine owns.', live: false },
	},
}

/**
 * The live engine.
 *
 * Everything the contract prescribes is inherited. What is below is this engine and
 * nothing else: a canvas, a renderer, and a pretend file system.
 *
 * `pause()` and `resume()` are **not** part of the contract — they are this engine's
 * own methods, which the demo's ESC menu drives. What *is* in the contract is what
 * they emit: `pause` and `resume` are core events, so a host can react to the ESC
 * menu without knowing this class has those methods.
 *
 * @extends {EnginePlayBase<DemoPayloads>}
 */
class DemoPlay extends EnginePlayBase {
	/** @type {HTMLCanvasElement | undefined} */
	#canvas
	/** @type {ReturnType<typeof createCanvasRenderer> | undefined} */
	#renderer
	/** The engine's own file system, keyed by mount path. */
	#memfs = new Map()

	/**
	 * The spec goes up to the base rather than being a field here: a subclass field
	 * initialiser runs after `super()`, which would be too late to seed state from.
	 *
	 * @param {DemoInit} [init]
	 * @param {DemoChannel} [events]
	 */
	constructor(init, events) {
		super(spec, init, events)
	}

	/**
	 * Where the picture goes. The engine owns the canvas; the host owns the container.
	 * The element is already recorded by the base when this runs.
	 *
	 * @protected
	 * @param {HTMLElement} target
	 */
	mounted(target) {
		this.#canvas ??= document.createElement('canvas')
		target.appendChild(this.#canvas)
		this.#renderer ??= createCanvasRenderer(this.#canvas)
	}

	/**
	 * A session opens — or reopens. The assets are read back through the contract
	 * rather than kept in a second field here, which is the point of the base owning
	 * the state.
	 *
	 * @protected
	 * @param {DemoOptions} options
	 */
	async open(options) {
		void options
		const assets = await this.assets()
		for (const [key, property] of Object.entries(assets)) {
			const data = property.value
			if (!data) continue
			this.#memfs.set(`/${key}.bin`, data)
			console.log(`[MEMFS] ${key} → /${key}.bin (${data.byteLength} bytes)`)
		}
		this.#renderer?.reset()
		this.#renderer?.start()
	}

	/**
	 * Stop and release. `exit` is emitted by the base once this returns.
	 * @protected
	 */
	close() {
		this.#renderer?.destroy()
		this.#renderer = undefined
		this.#canvas?.remove()
		this.#canvas = undefined
		this.#memfs.clear()
	}

	// ---- Beyond the contract: this engine's own members ----

	pause() {
		this.#renderer?.pause()
		this.emit('pause', { owner: 'demo-esc-menu' })
	}

	resume() {
		this.#renderer?.resume()
		this.emit('resume', { owner: 'demo-esc-menu' })
	}
}

/**
 * The factory. Identity is static, so a launcher can list engines without
 * constructing one — and the only thing it has to say beyond that is which engine to
 * build.
 *
 * @extends {EngineSDKBase<DemoPayloads>}
 */
export class DemoEngineSDK extends EngineSDKBase {
	static id = 'dummy-canvas-sdk'
	static version = '0.1.0-demo'
	static name = 'Dummy Canvas Engine'
	static description = 'A placeholder engine that renders animated content on canvas.'

	/**
	 * @protected
	 * @param {DemoInit} init
	 * @param {DemoChannel} events
	 * @returns {DemoPlay}
	 */
	createPlay(init, events) {
		return new DemoPlay(init, events)
	}
}

/** Conformance, checked by the compiler: does the class satisfy the contract? */
/** @type {DemoSDKConstructor} */
export const DemoEngine = DemoEngineSDK

export default DemoEngine
