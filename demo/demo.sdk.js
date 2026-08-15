// @ts-check
/**
 * The demo engine, written against the contract in `src/engine-specs.ts`.
 *
 * It is a real implementation, not a mock: the four payloads are closed with named
 * types, every getter returns descriptors, every setter chains, and a factory
 * governs at most one live engine. `demo/tsconfig.json` checks it against the
 * contract, so "the demo conforms" is verified rather than claimed.
 *
 * What used to live in a manifest lives here now:
 * `id`/`version`/`name`/`description` are static on the class, the video geometry is
 * `config`, and what an asset accepts is its descriptor's `allowedTypes`.
 */

import { createCanvasRenderer } from './canvas-renderer.js'

/**
 * @typedef {{ baseWidth: number, baseHeight: number }} DemoConfig
 * @typedef {{ fileName?: string, byteLength?: number }} DemoOptions
 * @typedef {{ rom?: Uint8Array, bios?: Uint8Array }} DemoAssets
 * @typedef {{ namespace: string }} DemoStorage
 * @typedef {{ config: DemoConfig, options: DemoOptions, assets: DemoAssets, storage: DemoStorage }} DemoPayloads
 *
 * @typedef {import('../src/engine-specs.js').EngineInit<DemoPayloads>} DemoInit
 * @typedef {import('../src/engine-specs.js').EnginePlay<DemoPayloads>} DemoPlayContract
 * @typedef {import('../src/engine-specs.js').PromisePlay<DemoPayloads>} DemoPromisePlay
 * @typedef {import('../src/engine-specs.js').EngineSDK<DemoPayloads>} DemoSDKContract
 * @typedef {import('../src/engine-specs.js').EngineSDKConstructor<DemoPayloads>} DemoSDKConstructor
 */

/** @template T @typedef {import('../src/engine-specs.js').PropertiesDefinition<T>} Props */

/**
 * The live engine.
 *
 * `pause()` and `resume()` are **not** part of the contract — they are this engine's
 * own additions, which the demo's ESC menu drives. Anything the contract declares is
 * below them.
 *
 * @implements {DemoPlayContract}
 */
class DemoPlay {
	/** @type {DemoConfig} */
	#config = { baseWidth: 320, baseHeight: 256 }
	/** @type {DemoOptions} */
	#options = {}
	/** @type {DemoAssets} */
	#assets = {}
	/** @type {DemoStorage} */
	#storage = { namespace: 'engine-specs/demo' }
	/** @type {HTMLElement | undefined} */
	#mount
	/** @type {HTMLCanvasElement | undefined} */
	#canvas
	/** @type {ReturnType<typeof createCanvasRenderer> | undefined} */
	#renderer
	/** The engine's own file system, keyed by mount path. */
	#memfs = new Map()

	/** @param {DemoInit} [init] */
	constructor(init) {
		if (init?.config) Object.assign(this.#config, init.config)
		if (init?.options) Object.assign(this.#options, init.options)
		if (init?.assets) Object.assign(this.#assets, init.assets)
		if (init?.storage) Object.assign(this.#storage, init.storage)
		if (init?.mount) this.mount(init.mount)
		this.#copyAssetsToMemfs()
	}

	#copyAssetsToMemfs() {
		for (const [key, data] of Object.entries(this.#assets)) {
			if (!data) continue
			const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
			this.#memfs.set(`/${key}.bin`, bytes)
			console.log(`[MEMFS] ${key} → /${key}.bin (${bytes.byteLength} bytes)`)
		}
	}

	/**
	 * @overload
	 * @returns {Promise<Props<DemoConfig>>}
	 * @overload
	 * @param {Partial<DemoConfig>} patch
	 * @returns {DemoPromisePlay}
	 * @param {Partial<DemoConfig>} [patch]
	 * @returns {any}
	 */
	config(patch) {
		if (arguments.length === 0) {
			return Promise.resolve({
				baseWidth: {
					value: this.#config.baseWidth,
					default: 320,
					description: 'Native render width, in pixels.',
					live: false,
				},
				baseHeight: {
					value: this.#config.baseHeight,
					default: 256,
					description: 'Native render height, in pixels.',
					live: false,
				},
			})
		}
		Object.assign(this.#config, patch)
		return hydrate(Promise.resolve(this))
	}

	/**
	 * @overload
	 * @returns {Promise<Props<DemoOptions>>}
	 * @overload
	 * @param {Partial<DemoOptions>} patch
	 * @returns {DemoPromisePlay}
	 * @param {Partial<DemoOptions>} [patch]
	 * @returns {any}
	 */
	options(patch) {
		if (arguments.length === 0) {
			return Promise.resolve({
				fileName: {
					value: this.#options.fileName,
					description: 'Name of the loaded ROM.',
					live: true,
				},
				byteLength: {
					value: this.#options.byteLength,
					description: 'Size of the loaded ROM, in bytes.',
					live: true,
				},
			})
		}
		Object.assign(this.#options, patch)
		return hydrate(Promise.resolve(this))
	}

	/**
	 * `allowedTypes` is what a host file picker needs: it replaces the manifest's
	 * `AssetSpec.accept`, and now travels with the value it describes.
	 *
	 * @overload
	 * @returns {Promise<Props<DemoAssets>>}
	 * @overload
	 * @param {Partial<DemoAssets>} patch
	 * @returns {DemoPromisePlay}
	 * @param {Partial<DemoAssets>} [patch]
	 * @returns {any}
	 */
	assets(patch) {
		if (arguments.length === 0) {
			return Promise.resolve({
				rom: {
					value: this.#assets.rom,
					description: 'Any game ROM file works in this demo.',
					allowedTypes: ['.rom', '.bin', '.zip', '.dat'],
					live: false,
				},
				bios: {
					value: this.#assets.bios,
					description: 'System BIOS firmware file.',
					allowedTypes: ['.bin', '.rom', '.sys'],
					live: false,
				},
			})
		}
		Object.assign(this.#assets, patch)
		this.#copyAssetsToMemfs()
		return hydrate(Promise.resolve(this))
	}

	/**
	 * @overload
	 * @returns {Promise<Props<DemoStorage>>}
	 * @overload
	 * @param {Partial<DemoStorage>} patch
	 * @returns {DemoPromisePlay}
	 * @param {Partial<DemoStorage>} [patch]
	 * @returns {any}
	 */
	storage(patch) {
		if (arguments.length === 0) {
			return Promise.resolve({
				namespace: {
					value: this.#storage.namespace,
					description: 'Folder the engine owns.',
					live: false,
				},
			})
		}
		Object.assign(this.#storage, patch)
		return hydrate(Promise.resolve(this))
	}

	/**
	 * Where the picture goes. The engine owns the canvas; the host owns the container.
	 * @param {HTMLElement} target
	 * @returns {DemoPromisePlay}
	 */
	mount(target) {
		this.#mount = target
		if (!this.#canvas) {
			this.#canvas = document.createElement('canvas')
		}
		target.appendChild(this.#canvas)
		this.#renderer ??= createCanvasRenderer(this.#canvas)
		return hydrate(Promise.resolve(this))
	}

	/**
	 * Opens or reopens a session. The payload is cumulative, merged flat, one level.
	 * @param {Partial<DemoOptions>} [options]
	 * @returns {DemoPromisePlay}
	 */
	restart(options) {
		if (options) Object.assign(this.#options, options)
		this.#renderer?.reset()
		this.#renderer?.start()
		return hydrate(Promise.resolve(this))
	}

	async destroy() {
		this.#renderer?.destroy()
		this.#renderer = undefined
		this.#canvas?.remove()
		this.#canvas = undefined
		this.#mount = undefined
		this.#memfs.clear()
	}

	// ---- Beyond the contract: this engine's own members ----

	pause() {
		this.#renderer?.pause()
	}

	resume() {
		this.#renderer?.resume()
	}
}

/**
 * Wraps a promise of the engine in the chainable surface.
 *
 * Structural, as the contract allows: not a `Promise` subclass, a delegation to one
 * — plus `[Symbol.toStringTag]`, which is easy to forget and required.
 *
 * @param {Promise<DemoPlay>} inner
 * @returns {DemoPromisePlay}
 */
function hydrate(inner) {
	/** @param {(play: DemoPlay) => unknown} step */
	const chain = (step) => hydrate(inner.then(async (play) => { await step(play); return play }))

	/** @type {any} */
	const hydrated = {
		/** @param {any} onfulfilled @param {any} onrejected */
		then: (onfulfilled, onrejected) => inner.then(onfulfilled, onrejected),
		/** @param {any} onrejected */
		catch: (onrejected) => inner.catch(onrejected),
		/** @param {any} onfinally */
		finally: (onfinally) => inner.finally(onfinally),
		[Symbol.toStringTag]: 'PromisePlay',

		/** @param {Partial<DemoConfig>} [patch] */
		config: (patch) =>
			patch === undefined ? inner.then((p) => p.config()) : chain((p) => p.config(patch)),
		/** @param {Partial<DemoOptions>} [patch] */
		options: (patch) =>
			patch === undefined ? inner.then((p) => p.options()) : chain((p) => p.options(patch)),
		/** @param {Partial<DemoAssets>} [patch] */
		assets: (patch) =>
			patch === undefined ? inner.then((p) => p.assets()) : chain((p) => p.assets(patch)),
		/** @param {Partial<DemoStorage>} [patch] */
		storage: (patch) =>
			patch === undefined ? inner.then((p) => p.storage()) : chain((p) => p.storage(patch)),

		/** @param {HTMLElement} target */
		mount: (target) => chain((p) => p.mount(target)),
		/** @param {Partial<DemoOptions>} [options] */
		restart: (options) => chain((p) => p.restart(options)),
		destroy: () => inner.then((p) => p.destroy()),
	}
	return hydrated
}

/**
 * The factory. Identity is static, so a launcher can list engines without
 * constructing one.
 *
 * @implements {DemoSDKContract}
 */
export class DemoEngineSDK {
	static id = 'dummy-canvas-sdk'
	static version = '0.1.0-demo'
	static name = 'Dummy Canvas Engine'
	static description = 'A placeholder engine that renders animated content on canvas.'

	/** @type {DemoInit} */
	#init = {}
	/** @type {DemoPlay | undefined} */
	#play

	/** @param {DemoInit} [init] */
	constructor(init) {
		if (init) this.#init = { ...init }
	}

	/** Answers a read before there is an engine: the settings the next one will use. */
	#pending() {
		return this.#play ?? new DemoPlay(this.#init)
	}

	/**
	 * @overload
	 * @returns {Promise<Props<DemoConfig>>}
	 * @overload
	 * @param {Partial<DemoConfig>} patch
	 * @returns {this}
	 * @param {Partial<DemoConfig>} [patch]
	 * @returns {any}
	 */
	config(patch) {
		if (arguments.length === 0) return this.#pending().config()
		this.#init.config = { ...this.#init.config, ...patch }
		if (this.#play && patch) this.#play.config(patch)
		return this
	}

	/**
	 * @overload
	 * @returns {Promise<Props<DemoOptions>>}
	 * @overload
	 * @param {Partial<DemoOptions>} patch
	 * @returns {this}
	 * @param {Partial<DemoOptions>} [patch]
	 * @returns {any}
	 */
	options(patch) {
		if (arguments.length === 0) return this.#pending().options()
		this.#init.options = { ...this.#init.options, ...patch }
		if (this.#play && patch) this.#play.options(patch)
		return this
	}

	/**
	 * @overload
	 * @returns {Promise<Props<DemoAssets>>}
	 * @overload
	 * @param {Partial<DemoAssets>} patch
	 * @returns {this}
	 * @param {Partial<DemoAssets>} [patch]
	 * @returns {any}
	 */
	assets(patch) {
		if (arguments.length === 0) return this.#pending().assets()
		this.#init.assets = { ...this.#init.assets, ...patch }
		if (this.#play && patch) this.#play.assets(patch)
		return this
	}

	/**
	 * @overload
	 * @returns {Promise<Props<DemoStorage>>}
	 * @overload
	 * @param {Partial<DemoStorage>} patch
	 * @returns {this}
	 * @param {Partial<DemoStorage>} [patch]
	 * @returns {any}
	 */
	storage(patch) {
		if (arguments.length === 0) return this.#pending().storage()
		this.#init.storage = { ...this.#init.storage, ...patch }
		if (this.#play && patch) this.#play.storage(patch)
		return this
	}

	/**
	 * Recorded now, applied when the engine exists — same as `new SDK({ mount })`.
	 * @param {HTMLElement} target
	 * @returns {this}
	 */
	mount(target) {
		this.#init.mount = target
		if (this.#play) this.#play.mount(target)
		return this
	}

	/**
	 * Bringing the engine up is this engine's own business, not a step the contract
	 * exposes — so it stays private. A factory governs at most one live engine.
	 * @returns {DemoPlay}
	 */
	#boot() {
		this.#play ??= new DemoPlay(this.#init)
		return this.#play
	}

	/**
	 * The only way in. On a live engine it reopens the session rather than
	 * rebuilding one.
	 * @param {Partial<DemoOptions>} [options]
	 * @returns {DemoPromisePlay}
	 */
	start(options) {
		return hydrate(Promise.resolve(this.#boot())).restart(options)
	}
}

/** Conformance, checked by the compiler: does the class satisfy the contract? */
/** @type {DemoSDKConstructor} */
export const DemoEngine = DemoEngineSDK

export default DemoEngine
