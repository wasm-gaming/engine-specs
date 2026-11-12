// ---- Introspectable property definitions ----

export interface PropertyDefinition<Value = unknown> {
  value: Value;
  default?: Value;
  description?: string;
  live?: boolean; // Absent means `false`. `true` = changing it applies to current play session.
  enum?: readonly Value[];
  allowedTypes?: readonly string[];
}

export type PropertiesDefinition<T> = { [K in keyof T]-?: PropertyDefinition<T[K]> };

// ---- Default open payloads, for an engine that doesn't close its types ----

export interface EngineConfig { [key: string]: unknown }
export interface EngineOptions { [key: string]: unknown }
export interface EngineAssets { [key: string]: unknown }
export interface EngineStorage { [key: string]: unknown }
export interface EngineEvents { [key: string]: unknown }

/**
 * Members are `object`, not the four interfaces above, on purpose: a named
 * `interface MyEngineConfig { … }` has no implicit index signature, so
 * constraining to a type that has one would reject exactly what a closed-type
 * engine will write. Each engine can close its own config/options/assets/storage
 * shapes without an index signature and still satisfy this constraint.
 */
export interface EnginePayloads {
  config: object;
  options: object;
  assets: object;
  storage: object;
  /**
   * The events this engine emits **beyond** {@link CoreEvents}, which every engine
   * emits and no engine declares. Optional, unlike the four above: an engine with
   * nothing of its own to announce omits it.
   */
  events?: object;
}

export interface DefaultPayloads extends EnginePayloads {
  config: EngineConfig;
  options: EngineOptions;
  assets: EngineAssets;
  storage: EngineStorage;
  events: EngineEvents;
}

// ---- Events ----

/**
 * What every engine emits, whatever else it adds. Unioned in by {@link EventsOf}
 * rather than declared in the payload bundle, so an engine can neither forget these
 * nor redefine them away.
 *
 * There is no `ready`: it announced that the engine was up but no session was open,
 * which was what the removed `boot()` meant.
 */
export interface CoreEvents<P extends EnginePayloads = DefaultPayloads> {
  /** The options the session opened with. A `restart()` emits it too. */
  start: Partial<P['options']>;
  /**
   * Emitted **and** rejected. Both, always: a host that does not `await` the chain is
   * not left blind, and a host that does is not forced to subscribe.
   */
  error: Error;
  /** The engine went away — `destroy()` has settled. Fires once, with no detail. */
  exit: void;
  /** Who asked, so a host can tell its own pause from a visibility change. */
  pause: { owner: string };
  resume: { owner: string };
}

/**
 * What a listener receives. The payload travels under `detail`, as `CustomEvent`
 * does it, rather than being the argument itself: an event can then grow a field
 * without changing every listener signature, one listener can serve several types by
 * reading `type`, and — the reason that actually decided it — an engine living in a
 * worker has to put its type on the wire anyway, so `{ type, detail }` is the shape
 * that survives `postMessage` instead of being re-wrapped on arrival.
 *
 * **This is not a DOM event.** Two members, and deliberately no more: it does not
 * bubble, it cannot be cancelled, there is no `target` and no `preventDefault()`.
 * Half-implementing a familiar interface is worse than offering a different one, so
 * the shape stops where its guarantees do.
 *
 * Frozen when emitted, because the same object is handed to every listener in turn —
 * otherwise the first could rewrite what the second reads.
 */
export interface EngineEvent<K = PropertyKey, Detail = unknown> {
  readonly type: K;
  readonly detail: Detail;
}

/** What `on` takes for one event of `E`. */
export type EngineListener<E, K extends keyof E> = (event: EngineEvent<K, E[K]>) => void;

/**
 * Every event the engine emits: the core set, plus whatever it declared.
 *
 * `NonNullable` is what makes `events` optional: with the member absent, `P['events']`
 * is `object | undefined`, and a bare `object` contributes no keys to the
 * intersection. It also covers an engine that writes `events?:` in its own payload
 * interface.
 */
export type EventsOf<P extends EnginePayloads> = CoreEvents<P> & NonNullable<P['events']>;

/** A map of listeners, which is how {@link EngineInit.on} carries them. */
export type EventListeners<E> = { [K in keyof E]?: EngineListener<E, K> };

/**
 * The listener bookkeeping, shipped rather than described — the one piece of runtime
 * code in this package.
 *
 * It is a **convenience, not a requirement**: the contract stays structural, so an
 * engine that already owns an emitter satisfies {@link EngineSurface} without this.
 * What it saves is the part everyone gets subtly wrong — iterating a copy, so a
 * listener that unsubscribes mid-emit does not corrupt the loop; de-duplicating a
 * listener registered twice; and keeping one throwing listener from silencing the
 * rest.
 *
 * Hold it **privately** and hand the same instance to every carrier. That is what
 * makes `sdk.on(…)` and `play.on(…)` one channel rather than two, lets a host
 * subscribe before the engine exists, and keeps `emit` out of the public API — a host
 * must not be able to forge an engine event.
 */
export class EventEmitter<E> {
  readonly #listeners = new Map<keyof E, Set<(event: never) => void>>();

  /** @param listeners Registered immediately — what `EngineInit.on` carries. */
  constructor(listeners?: EventListeners<E>) {
    for (const type of Object.keys(listeners ?? {}) as (keyof E)[]) {
      const listener = listeners?.[type];
      if (listener) this.on(type, listener);
    }
  }

  /** Registering the same listener twice registers it once, as `EventTarget` does. */
  on<K extends keyof E>(type: K, listener: EngineListener<E, K>): this {
    let set = this.#listeners.get(type);
    if (!set) this.#listeners.set(type, (set = new Set()));
    set.add(listener as (event: never) => void);
    return this;
  }

  /**
   * The listener is required, as in `EventTarget`. A convenience `off(type)` dropping
   * every listener for a type is a footgun on a page where two components subscribed
   * independently: one unsubscribing would silence the other.
   */
  off<K extends keyof E>(type: K, listener: EngineListener<E, K>): this {
    const set = this.#listeners.get(type);
    if (set?.delete(listener as (event: never) => void) && set.size === 0) {
      this.#listeners.delete(type);
    }
    return this;
  }

  /**
   * Takes the **detail**, and wraps it. The rest tuple is what lets an event with no
   * detail be emitted as `emit('exit')` while still checking the ones that have one.
   */
  emit<K extends keyof E>(
    type: K,
    ...[detail]: E[K] extends void ? [] : [detail: E[K]]
  ): void {
    const set = this.#listeners.get(type);
    if (!set) return;
    // Built once and frozen: every listener gets this same object, so a mutable one
    // would let the first rewrite what the rest read.
    const event: EngineEvent<K, E[K]> = Object.freeze({ type, detail: detail as E[K] });
    // A copy: a listener may call `off()` — on itself or another — while this runs.
    for (const listener of [...set]) {
      try {
        (listener as EngineListener<E, K>)(event);
      } catch (thrown) {
        // One bad listener must neither silence the rest nor vanish. Rethrowing on a
        // fresh task puts it in front of `window.onerror` with its stack intact.
        queueMicrotask(() => {
          throw thrown;
        });
      }
    }
  }
}

export interface EngineInit<P extends EnginePayloads = DefaultPayloads> {
  config?: Partial<P['config']>;
  options?: Partial<P['options']>;
  assets?: Partial<P['assets']>;
  storage?: Partial<P['storage']>;
  /**
   * Not a `Partial`, unlike the four above: the payloads are patches merged onto a
   * cumulative state, a mount target is a single value that replaces.
   */
  mount?: HTMLElement;
  /**
   * The same subscription as {@link EngineSurface.on}, as a map — the one shape the
   * chain cannot express, because an object literal has nothing to chain onto.
   * `new Sdk({ on: { error } })` and `new Sdk().on('error', error)` are the same call.
   */
  on?: EventListeners<EventsOf<P>>;
}

// ---- The shared fluent surface: the members every carrier exposes ----

export interface EngineSurface<TSelf, P extends EnginePayloads = DefaultPayloads> {
  config(): Promise<PropertiesDefinition<P['config']>>;
  config(patch: Partial<P['config']>): TSelf;
  options(): Promise<PropertiesDefinition<P['options']>>;
  options(patch: Partial<P['options']>): TSelf;
  assets(): Promise<PropertiesDefinition<P['assets']>>;
  assets(patch: Partial<P['assets']>): TSelf;
  storage(): Promise<PropertiesDefinition<P['storage']>>;
  storage(patch: Partial<P['storage']>): TSelf;
  mount(target: HTMLElement): TSelf;
  /**
   * Subscribe. Like `mount`, and unlike the four payloads, this has no getter form:
   * there is no `on()` that hands back a listener list.
   *
   * **Synchronous on every carrier, `PromisePlay` included.** The chain is what the
   * return value continues, never what the registration waits for — otherwise
   * `sdk.start().on('error', report)` would bind after the session opened and miss an
   * error thrown while it was opening, which is the error a host most wants.
   *
   * The factory and the engine it opens share one channel, so subscribing before
   * `start()` is the normal way to do it, not a special case.
   */
  on<K extends keyof EventsOf<P>>(type: K, listener: EngineListener<EventsOf<P>, K>): TSelf;
  /** Takes the listener, not just the type — see {@link EventEmitter.off}. */
  off<K extends keyof EventsOf<P>>(type: K, listener: EngineListener<EventsOf<P>, K>): TSelf;
}

// ---- Public contract each WASM engine must implement ----

export interface EnginePlay<P extends EnginePayloads = DefaultPayloads>
  extends EngineSurface<PromisePlay<P>, P> {
  restart(options?: Partial<P['options']>): PromisePlay<P>;
  destroy(): Promise<void>;
}

/**
 * Structural, not nominal: an engine does NOT need to subclass the real
 * `Promise` to satisfy this. Implementing `then`/`catch`/`finally` with the
 * right signatures — typically by delegating to an internal real `Promise` —
 * is enough. Note that `extends Promise<T>` also pulls in
 * `[Symbol.toStringTag]: string` via lib.es2015.symbol.wellknown, so an
 * implementer needs that member too, not just the three methods.
 */
export interface PromisePlay<P extends EnginePayloads = DefaultPayloads>
  extends Promise<EnginePlay<P>>, EngineSurface<PromisePlay<P>, P> {
  restart(options?: Partial<P['options']>): PromisePlay<P>;
  destroy(): Promise<void>;
}

export interface EngineSDK<P extends EnginePayloads = DefaultPayloads>
  extends EngineSurface<EngineSDK<P>, P> {
  /**
   * Bring the engine up and open a session — the only way in.
   *
   * A factory governs at most one live engine, so calling it again on a live one
   * reopens the session rather than building a second engine; that is exactly
   * {@link EnginePlay.restart}. Whatever an engine has to do before a session can
   * exist is its own business, done here.
   */
  start(options?: Partial<P['options']>): PromisePlay<P>;
}

/**
 * Identity lives on the constructor, not on an instance: a launcher listing engines
 * reads `Rsdkv4SDK.id` from the imported class, without constructing anything.
 */
export interface EngineSDKConstructor<P extends EnginePayloads = DefaultPayloads> {
  /** Stable engine id, e.g. "rsdkv4" | "fbneo" | "blastem" | "jgenesis" | "smw". */
  readonly id: string;
  /** SemVer of this engine build/contract implementation. */
  readonly version: string;
  /** Human-readable name. */
  readonly name?: string;
  readonly description?: string;

  new (init?: EngineInit<P>): EngineSDK<P>;
}

// ---- The contract, implemented once ----
//
// Everything below is optional. The contract is structural: an engine satisfies
// `EngineSDK` by having the right members, not by extending anything here. What these
// exist for is that twelve engines were otherwise going to write the same three
// things — the chainable promise, the getter/setter overload dance, and the channel —
// and get them subtly different.

/**
 * A descriptor with its `value` removed: what an engine *declares*, since the value
 * is state and changes.
 *
 * `default` is declared here and nowhere else. {@link EnginePlayBase} seeds its
 * starting state from it, which is what collapses the two sources of truth every
 * hand-written engine had — an initial `{ region: 'us' }` field alongside a
 * `default: 'us'` in the descriptor, with nothing to catch them drifting apart.
 */
export type PropertySpec<Value> = Omit<PropertyDefinition<Value>, 'value'>;

/** `-?` as in {@link PropertiesDefinition}: an engine cannot forget to describe a key. */
export type PropertiesSpec<T> = { [K in keyof T]-?: PropertySpec<T[K]> };

/** Everything an engine has to say about its four payloads. */
export interface EngineSpec<P extends EnginePayloads = DefaultPayloads> {
  config: PropertiesSpec<P['config']>;
  options: PropertiesSpec<P['options']>;
  assets: PropertiesSpec<P['assets']>;
  storage: PropertiesSpec<P['storage']>;
}

/** The four payload names, which are also the four getter/setter pairs. */
export type PayloadKind = 'config' | 'options' | 'assets' | 'storage';

/**
 * Wrap a promise of a live engine in the chainable surface.
 *
 * Exported because it is the single most duplicated function in an engine, and an
 * engine that does not extend {@link EnginePlayBase} still needs exactly this.
 *
 * `on` and `off` do **not** go through the chain: they reach the channel now, so a
 * listener is live before the promise settles. Routing them through it would bind
 * after the session opened and lose whatever was emitted while it was opening.
 */
export function hydratePlay<P extends EnginePayloads = DefaultPayloads>(
  inner: Promise<EnginePlay<P>>,
  events: EventEmitter<EventsOf<P>>,
): PromisePlay<P> {
  const chain = (step: (play: EnginePlay<P>) => PromisePlay<P>): PromisePlay<P> =>
    hydratePlay(
      inner.then(async (play) => {
        await step(play);
        return play;
      }),
      events,
    );

  const hydrated: PromisePlay<P> = {
    then: (onfulfilled, onrejected) => inner.then(onfulfilled, onrejected),
    catch: (onrejected) => inner.catch(onrejected),
    finally: (onfinally) => inner.finally(onfinally),
    [Symbol.toStringTag]: 'PromisePlay',

    config: ((patch?: Partial<P['config']>) =>
      patch === undefined
        ? inner.then((play) => play.config())
        : chain((play) => play.config(patch))) as PromisePlay<P>['config'],
    options: ((patch?: Partial<P['options']>) =>
      patch === undefined
        ? inner.then((play) => play.options())
        : chain((play) => play.options(patch))) as PromisePlay<P>['options'],
    assets: ((patch?: Partial<P['assets']>) =>
      patch === undefined
        ? inner.then((play) => play.assets())
        : chain((play) => play.assets(patch))) as PromisePlay<P>['assets'],
    storage: ((patch?: Partial<P['storage']>) =>
      patch === undefined
        ? inner.then((play) => play.storage())
        : chain((play) => play.storage(patch))) as PromisePlay<P>['storage'],

    mount: (target: HTMLElement) => chain((play) => play.mount(target)),

    on: <K extends keyof EventsOf<P>>(type: K, listener: EngineListener<EventsOf<P>, K>) => {
      events.on(type, listener);
      return hydrated;
    },
    off: <K extends keyof EventsOf<P>>(type: K, listener: EngineListener<EventsOf<P>, K>) => {
      events.off(type, listener);
      return hydrated;
    },

    restart: (options?: Partial<P['options']>) => chain((play) => play.restart(options)),
    destroy: () => inner.then((play) => play.destroy()),
  };
  return hydrated;
}

/**
 * The live engine, with everything the contract prescribes already written: state,
 * the cumulative merge, the descriptors, the chainable promise, and the channel.
 *
 * A subclass supplies what only it can know — {@link EnginePlayBase.open} and
 * {@link EnginePlayBase.close}, optionally {@link EnginePlayBase.mounted} and
 * {@link EnginePlayBase.patched} — and its properties as an {@link EngineSpec}.
 *
 * The spec arrives as a **constructor argument**, not an abstract field, and that is
 * not a style choice: a subclass field initialiser runs *after* `super()`, so a
 * `protected abstract spec` would still be `undefined` while this constructor seeded
 * state from it. Passing it up makes the ordering trap impossible rather than merely
 * avoided.
 */
export abstract class EnginePlayBase<P extends EnginePayloads = DefaultPayloads>
  implements EnginePlay<P>
{
  readonly #spec: EngineSpec<P>;
  readonly #state: Record<PayloadKind, Record<string, unknown>>;
  readonly #events: EventEmitter<EventsOf<P>>;
  #target: HTMLElement | undefined;
  /** The target {@link EnginePlayBase.mounted} has already been told about. */
  #attached: HTMLElement | undefined;

  /**
   * @param events The factory's channel. Omitted only when a play is built on its
   * own; the factory always passes its own, which is what makes `sdk.on(…)` and
   * `play.on(…)` one channel rather than two.
   */
  constructor(spec: EngineSpec<P>, init?: EngineInit<P>, events?: EventEmitter<EventsOf<P>>) {
    this.#spec = spec;
    this.#events = events ?? new EventEmitter<EventsOf<P>>(init?.on);
    this.#state = {
      config: seed(spec.config, init?.config),
      options: seed(spec.options, init?.options),
      assets: seed(spec.assets, init?.assets),
      storage: seed(spec.storage, init?.storage),
    };
    // Recorded, not applied. `mounted()` is overridable, and a subclass's own fields
    // are still uninitialised while this constructor runs — so the hook is deferred to
    // the first `restart()`, by which point the subclass is whole.
    this.#target = init?.mount;
  }

  // ---- What a subclass implements ----

  /**
   * Open or reopen a session with the options as they now stand. Called by
   * `restart()`, which merges the patch, emits `start` once this resolves, and turns
   * a throw into both a rejection and an `error` event.
   */
  protected abstract open(options: P['options']): void | Promise<void>;

  /** Stop and release. `exit` is emitted once this resolves. */
  protected abstract close(): void | Promise<void>;

  /** The element is already recorded when this runs. */
  protected mounted(target: HTMLElement): void | Promise<void> {
    void target;
  }

  /** A payload changed on a running engine — apply what is `live`, ignore the rest. */
  protected patched(kind: PayloadKind, patch: object): void | Promise<void> {
    void kind;
    void patch;
  }

  /**
   * Emit one of this engine's own events.
   *
   * `protected`, so a typed host cannot forge an engine event — but be exact about
   * what that buys: TypeScript erases `protected`, so this is a compile-time guard,
   * not a capability boundary. Plain JavaScript can still reach it. Only the `#`
   * fields below — the channel and the state — are unreachable at runtime.
   */
  protected emit<K extends keyof EventsOf<P>>(
    type: K,
    ...detail: EventsOf<P>[K] extends void ? [] : [detail: EventsOf<P>[K]]
  ): void {
    this.#events.emit(type, ...detail);
  }

  /** Where the picture is, for a subclass that needs the element after `mounted()`. */
  protected get target(): HTMLElement | undefined {
    return this.#target;
  }

  // ---- The contract ----

  config(): Promise<PropertiesDefinition<P['config']>>;
  config(patch: Partial<P['config']>): PromisePlay<P>;
  config(patch?: Partial<P['config']>): Promise<PropertiesDefinition<P['config']>> | PromisePlay<P> {
    // `arguments.length`, not `patch === undefined`: `config(undefined)` is a write of
    // nothing, not a read.
    if (arguments.length === 0) return Promise.resolve(this.#describe('config'));
    return this.#patch('config', patch);
  }

  options(): Promise<PropertiesDefinition<P['options']>>;
  options(patch: Partial<P['options']>): PromisePlay<P>;
  options(
    patch?: Partial<P['options']>,
  ): Promise<PropertiesDefinition<P['options']>> | PromisePlay<P> {
    if (arguments.length === 0) return Promise.resolve(this.#describe('options'));
    return this.#patch('options', patch);
  }

  assets(): Promise<PropertiesDefinition<P['assets']>>;
  assets(patch: Partial<P['assets']>): PromisePlay<P>;
  assets(patch?: Partial<P['assets']>): Promise<PropertiesDefinition<P['assets']>> | PromisePlay<P> {
    if (arguments.length === 0) return Promise.resolve(this.#describe('assets'));
    return this.#patch('assets', patch);
  }

  storage(): Promise<PropertiesDefinition<P['storage']>>;
  storage(patch: Partial<P['storage']>): PromisePlay<P>;
  storage(
    patch?: Partial<P['storage']>,
  ): Promise<PropertiesDefinition<P['storage']>> | PromisePlay<P> {
    if (arguments.length === 0) return Promise.resolve(this.#describe('storage'));
    return this.#patch('storage', patch);
  }

  mount(target: HTMLElement): PromisePlay<P> {
    this.#target = target;
    return this.#run(() => this.#attach());
  }

  on<K extends keyof EventsOf<P>>(type: K, listener: EngineListener<EventsOf<P>, K>): PromisePlay<P> {
    this.#events.on(type, listener);
    return hydratePlay<P>(Promise.resolve(this), this.#events);
  }

  off<K extends keyof EventsOf<P>>(
    type: K,
    listener: EngineListener<EventsOf<P>, K>,
  ): PromisePlay<P> {
    this.#events.off(type, listener);
    return hydratePlay<P>(Promise.resolve(this), this.#events);
  }

  restart(options?: Partial<P['options']>): PromisePlay<P> {
    return this.#run(async () => {
      if (options) Object.assign(this.#state.options, options);
      // A target supplied to the constructor lands here, which is what makes
      // `new Sdk({ mount: el }).start()` and `new Sdk().mount(el).start()` the same
      // call — the rule the contract states for everything on the surface.
      await this.#attach();
      const opened = { ...this.#state.options } as P['options'];
      await this.open(opened);
      this.#emitCore('start', opened);
    });
  }

  async destroy(): Promise<void> {
    await this.#guard(async () => {
      await this.close();
      this.#target = undefined;
      this.#attached = undefined;
      this.#emitCore('exit', undefined);
    });
  }

  /** Tell the engine where it is, once per distinct target. Reparenting is legal. */
  async #attach(): Promise<void> {
    if (!this.#target || this.#target === this.#attached) return;
    this.#attached = this.#target;
    await this.mounted(this.#target);
  }

  // ---- Shared machinery ----

  /** One getter's answer: the spec, with the current value written into each entry. */
  #describe<K extends PayloadKind>(kind: K): PropertiesDefinition<P[K]> {
    const spec = this.#spec[kind] as Record<string, PropertySpec<unknown>>;
    const state = this.#state[kind];
    const out: Record<string, PropertyDefinition<unknown>> = {};
    for (const key of Object.keys(spec)) {
      out[key] = { ...spec[key], value: state[key] };
    }
    return out as PropertiesDefinition<P[K]>;
  }

  /** Cumulative, merged flat, one level — `undefined` is a value, not "leave alone". */
  #patch(kind: PayloadKind, patch: object | undefined): PromisePlay<P> {
    Object.assign(this.#state[kind], patch);
    return this.#run(async () => {
      await this.patched(kind, patch ?? {});
    });
  }

  /** A step, as a link in the chain — and as an `error` event if it throws. */
  #run(step: () => Promise<void>): PromisePlay<P> {
    return hydratePlay<P>(this.#guard(step), this.#events);
  }

  /**
   * The rule that errors reach a host **both ways**: the promise rejects *and*
   * `error` is emitted. Written once here rather than at every throw site.
   */
  async #guard(step: () => Promise<void>): Promise<this> {
    try {
      await step();
      return this;
    } catch (thrown) {
      const error = thrown instanceof Error ? thrown : new Error(String(thrown));
      this.#emitCore('error', error);
      throw error;
    }
  }

  /**
   * The core events, emitted from here rather than by a subclass.
   *
   * The cast is the one thing TypeScript will not check here: `emit` takes a rest
   * tuple that is conditional on the detail type, and that conditional stays
   * unresolved while `P` is still a type parameter. It is sound — `EventsOf<P>`
   * always contains `CoreEvents<P>` by construction — and confining it to this one
   * method is why the three call sites above read plainly.
   */
  #emitCore<K extends keyof CoreEvents<P>>(type: K, detail: CoreEvents<P>[K]): void {
    // Cast the channel, not the method: pulling `emit` out into a variable would call
    // it unbound, and it reads its listeners off `this`.
    const events = this.#events as unknown as { emit(type: K, detail: CoreEvents<P>[K]): void };
    events.emit(type, detail);
  }
}

/** Starting state: every `default` the spec declares, then whatever `init` overrides. */
function seed(spec: object, patch: object | undefined): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(spec as Record<string, PropertySpec<unknown>>)) {
    if (property.default !== undefined) state[key] = property.default;
  }
  return Object.assign(state, patch);
}

/**
 * The factory, with everything the contract prescribes already written: the
 * cumulative init, the synchronous chain, the channel that outlives every session,
 * and one live engine per factory.
 *
 * A subclass supplies its static identity and {@link EngineSDKBase.createPlay}.
 */
export abstract class EngineSDKBase<P extends EnginePayloads = DefaultPayloads>
  implements EngineSDK<P>
{
  readonly #init: EngineInit<P>;
  #play: EnginePlayBase<P> | undefined;

  /**
   * Created before any engine exists and handed to every carrier downstream. That is
   * what lets a host subscribe to an error thrown while the first session opens.
   */
  protected readonly events: EventEmitter<EventsOf<P>>;

  constructor(init?: EngineInit<P>) {
    this.#init = { ...init };
    this.events = new EventEmitter<EventsOf<P>>(init?.on);
  }

  /** Build the live engine. The channel is passed in, never created here. */
  protected abstract createPlay(
    init: EngineInit<P>,
    events: EventEmitter<EventsOf<P>>,
  ): EnginePlayBase<P>;

  config(): Promise<PropertiesDefinition<P['config']>>;
  config(patch: Partial<P['config']>): this;
  config(patch?: Partial<P['config']>): Promise<PropertiesDefinition<P['config']>> | this {
    if (arguments.length === 0) return this.#pending().config();
    return this.#patch('config', patch);
  }

  options(): Promise<PropertiesDefinition<P['options']>>;
  options(patch: Partial<P['options']>): this;
  options(patch?: Partial<P['options']>): Promise<PropertiesDefinition<P['options']>> | this {
    if (arguments.length === 0) return this.#pending().options();
    return this.#patch('options', patch);
  }

  assets(): Promise<PropertiesDefinition<P['assets']>>;
  assets(patch: Partial<P['assets']>): this;
  assets(patch?: Partial<P['assets']>): Promise<PropertiesDefinition<P['assets']>> | this {
    if (arguments.length === 0) return this.#pending().assets();
    return this.#patch('assets', patch);
  }

  storage(): Promise<PropertiesDefinition<P['storage']>>;
  storage(patch: Partial<P['storage']>): this;
  storage(patch?: Partial<P['storage']>): Promise<PropertiesDefinition<P['storage']>> | this {
    if (arguments.length === 0) return this.#pending().storage();
    return this.#patch('storage', patch);
  }

  /** Recorded now, applied when the engine exists — same call as `new Sdk({ mount })`. */
  mount(target: HTMLElement): this {
    this.#init.mount = target;
    this.#play?.mount(target);
    return this;
  }

  on<K extends keyof EventsOf<P>>(type: K, listener: EngineListener<EventsOf<P>, K>): this {
    this.events.on(type, listener);
    return this;
  }

  off<K extends keyof EventsOf<P>>(type: K, listener: EngineListener<EventsOf<P>, K>): this {
    this.events.off(type, listener);
    return this;
  }

  /**
   * The only way in. On a live engine it reopens the session rather than building a
   * second one: a factory governs at most one engine.
   */
  start(options?: Partial<P['options']>): PromisePlay<P> {
    this.#play ??= this.createPlay(this.#init, this.events);
    return this.#play.restart(options);
  }

  /** Answers a read before there is an engine: the settings the next one will use. */
  #pending(): EnginePlayBase<P> {
    return this.#play ?? this.createPlay(this.#init, this.events);
  }

  #patch(kind: PayloadKind, patch: object | undefined): this {
    this.#init[kind] = { ...this.#init[kind], ...patch };
    // A live engine gets it too, so the factory does not silently describe a state
    // the engine is not in.
    if (this.#play && patch) this.#play[kind](patch as never);
    return this;
  }
}

// ============================================================================
// ---- The usability scheme: one input model for every menu (UX.md) ----
// ============================================================================
//
// Every engine ships its own app — start screen, load-game, pause menu, options —
// and the launcher has its own menus. They must feel identical under a gamepad, so
// the mapping, the repeat timing and the focus rules live here, beside the contract
// every engine already depends on. Normative description: UX.md.

/** What a menu reacts to. Never raw keys or buttons. */
export type UiAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'accept'
  | 'back'
  | 'menu'
  | 'more'
  | 'prev'
  | 'next';

export type UiDirection = 'up' | 'down' | 'left' | 'right';

/** Keyboard → action (`KeyboardEvent.key`). */
export const UI_KEYMAP: Readonly<Record<string, UiAction>> = Object.freeze({
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'accept',
  ' ': 'accept',
  Escape: 'back',
  Backspace: 'back',
  Tab: 'more',
  v: 'more',
  V: 'more',
  ContextMenu: 'more',
  q: 'prev',
  Q: 'prev',
  e: 'next',
  E: 'next',
  F1: 'menu',
});

/**
 * Gamepad button index (W3C "standard" mapping) → action. A = 0, B = 1, X = 2, Y = 3,
 * LB = 4, RB = 5, Select = 8, Start = 9, d-pad = 12–15. Select + Start together is
 * `menu` as well (see {@link createInput}).
 */
export const UI_PADMAP: Readonly<Record<number, UiAction>> = Object.freeze({
  0: 'accept',
  1: 'back',
  2: 'more',
  3: 'more',
  4: 'prev',
  5: 'next',
  9: 'menu',
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right',
});

/** Hold-to-repeat for directions: first repeat after `delay` ms, then every `interval` ms. */
export const UI_REPEAT = Object.freeze({ delay: 380, interval: 110, axis: 0.6 });

/** How an action reached the listener. */
export interface UiActionDetail {
  source: 'keyboard' | 'gamepad';
  /** True for a held key or button repeating. */
  repeat: boolean;
}

export type UiActionListener = (action: UiAction, detail: UiActionDetail) => void;

/** The minimum of the Gamepad API {@link createInput} reads, so tests can fake it. */
export interface UiGamepadLike {
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean }>;
  readonly axes: ReadonlyArray<number>;
}

export interface UiInputOptions {
  /** Where key events are heard. Default: `globalThis` (the window). */
  target?: EventTarget;
  /** Listen in the capture phase, ahead of the engine's own keyboard handlers. Default true. */
  capture?: boolean;
  /**
   * `preventDefault()` + `stopPropagation()` on keys that map to an action, so a
   * menu's keys never reach the game underneath. Default true.
   */
  swallow?: boolean;
  keymap?: Readonly<Record<string, UiAction>>;
  padmap?: Readonly<Record<number, UiAction>>;
  /** Gamepad source. Default: `navigator.getGamepads()`. */
  gamepads?: () => ReadonlyArray<UiGamepadLike | null>;
  /** Clock in ms. Default: `performance.now()`. */
  now?: () => number;
  /** Frame scheduler for gamepad polling. Default: `requestAnimationFrame`; `null` = poll manually. */
  schedule?: ((poll: () => void) => unknown) | null;
}

export interface UiInput {
  /** Subscribe; returns the unsubscribe function. */
  on(listener: UiActionListener): () => void;
  /** Stop delivering (e.g. while the game runs); keys are no longer swallowed. */
  suspend(): void;
  resume(): void;
  readonly suspended: boolean;
  /** Read the gamepads once. Called every frame by the default scheduler. */
  poll(): void;
  /** Remove every listener and stop polling. */
  destroy(): void;
}

const DIRECTIONS: ReadonlySet<UiAction> = new Set<UiAction>(['up', 'down', 'left', 'right']);

const isEditable = (target: EventTarget | null): boolean => {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT';
};

/**
 * The scheme's runtime: keyboard and gamepads become {@link UiAction}s.
 *
 * Keyboard: `keydown` mapped through {@link UI_KEYMAP} (keys typed into form fields
 * are left alone). Gamepads: polled each frame through {@link UI_PADMAP} and the left
 * stick; directions repeat with {@link UI_REPEAT}; Select + Start together is `menu`
 * (and then neither fires on its own). While {@link UiInput.suspend | suspended}
 * nothing is delivered and nothing is swallowed — the game gets every input.
 */
export function createInput(options: UiInputOptions = {}): UiInput {
  const target = options.target ?? (globalThis as unknown as EventTarget);
  const capture = options.capture ?? true;
  const swallow = options.swallow ?? true;
  const keymap = options.keymap ?? UI_KEYMAP;
  const padmap = options.padmap ?? UI_PADMAP;
  const now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  const gamepads =
    options.gamepads ??
    (() => (globalThis.navigator?.getGamepads?.() ?? []) as ReadonlyArray<UiGamepadLike | null>);
  const schedule =
    options.schedule === undefined
      ? (globalThis.requestAnimationFrame?.bind(globalThis) ?? null)
      : options.schedule;

  const listeners = new Set<UiActionListener>();
  let suspended = false;
  let destroyed = false;
  let polling = false;
  const held = new Map<UiAction, { since: number; last: number }>();

  const fire = (action: UiAction, detail: UiActionDetail): void => {
    for (const listener of listeners) listener(action, detail);
  };

  const onKey = (event: Event): void => {
    if (suspended || destroyed) return;
    const key = event as KeyboardEvent;
    if (isEditable(key.target) && key.key !== 'Escape') return;
    const action = keymap[key.key];
    if (!action) return;
    if (swallow) {
      key.preventDefault();
      key.stopPropagation();
    }
    fire(action, { source: 'keyboard', repeat: key.repeat === true });
  };

  const pressed = (pad: UiGamepadLike): Set<UiAction> => {
    const actions = new Set<UiAction>();
    const select = pad.buttons[8]?.pressed === true;
    const start = pad.buttons[9]?.pressed === true;
    if (select && start) actions.add('menu');
    pad.buttons.forEach((button, index) => {
      if (!button.pressed) return;
      if ((index === 8 || index === 9) && select && start) return;
      const action = padmap[index];
      if (action) actions.add(action);
    });
    const [x = 0, y = 0] = pad.axes;
    if (x < -UI_REPEAT.axis) actions.add('left');
    if (x > UI_REPEAT.axis) actions.add('right');
    if (y < -UI_REPEAT.axis) actions.add('up');
    if (y > UI_REPEAT.axis) actions.add('down');
    return actions;
  };

  const poll = (): void => {
    if (destroyed) return;
    const t = now();
    const active = new Set<UiAction>();
    for (const pad of gamepads()) if (pad) for (const action of pressed(pad)) active.add(action);

    for (const action of active) {
      const state = held.get(action);
      if (!state) {
        held.set(action, { since: t, last: t });
        if (!suspended) fire(action, { source: 'gamepad', repeat: false });
      } else if (
        DIRECTIONS.has(action) &&
        t - state.since >= UI_REPEAT.delay &&
        t - state.last >= UI_REPEAT.interval
      ) {
        state.last = t;
        if (!suspended) fire(action, { source: 'gamepad', repeat: true });
      }
    }
    for (const action of [...held.keys()]) if (!active.has(action)) held.delete(action);
  };

  const loop = (): void => {
    if (destroyed || !schedule) return;
    poll();
    schedule(loop);
  };
  const startPolling = (): void => {
    if (polling || !schedule) return;
    polling = true;
    schedule(loop);
  };

  target.addEventListener('keydown', onKey, { capture });
  target.addEventListener('gamepadconnected', startPolling);
  if (gamepads().some(Boolean)) startPolling();

  return {
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    suspend() {
      suspended = true;
    },
    resume() {
      suspended = false;
    },
    get suspended() {
      return suspended;
    },
    poll,
    destroy() {
      destroyed = true;
      listeners.clear();
      held.clear();
      target.removeEventListener('keydown', onKey, { capture });
      target.removeEventListener('gamepadconnected', startPolling);
    },
  };
}

/** Anything with a layout box (an `Element`, or a test double). */
export interface UiFocusable {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

/**
 * Spatial navigation: the candidate a direction leads to from `from`, or null.
 *
 * Only candidates whose centre lies ahead in that direction count; among them the
 * nearest wins, with sideways distance weighted double so "down" prefers the item
 * straight below over a closer one off to the side.
 */
export function nextFocus<T extends UiFocusable>(
  from: UiFocusable,
  candidates: Iterable<T>,
  direction: UiDirection,
): T | null {
  const centre = (el: UiFocusable) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const origin = centre(from);
  let best: T | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    if ((candidate as UiFocusable) === from) continue;
    const c = centre(candidate);
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;
    const ahead = direction === 'up' ? -dy : direction === 'down' ? dy : direction === 'left' ? -dx : dx;
    if (ahead <= 0.5) continue;
    const side = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
    const score = ahead + side * 2;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * The look every menu shares, as CSS custom properties: the focus ring, radii, type
 * faces, colours and spacing. Apps read them with `var(--wg-…)`; {@link uiTokensCss}
 * writes them into a stylesheet.
 */
export const UI_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  '--wg-bg': '#07080c',
  '--wg-surface': 'rgb(18 20 28 / 0.78)',
  '--wg-line': 'rgb(255 255 255 / 0.12)',
  '--wg-text': '#f4f6fb',
  '--wg-muted': '#8e97a9',
  '--wg-ok': '#4ade80',
  '--wg-danger': '#f87171',
  '--wg-focus': '#ffffff',
  '--wg-focus-ring': '0 0 0 3px #ffffff',
  '--wg-radius': '22px',
  '--wg-radius-small': '12px',
  '--wg-gap': '16px',
  '--wg-font-display': "'Unbounded Variable', 'Unbounded', system-ui, sans-serif",
  '--wg-font-ui': "'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  '--wg-ease': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  '--wg-safe-top': 'env(safe-area-inset-top, 0px)',
  '--wg-safe-bottom': 'env(safe-area-inset-bottom, 0px)',
});

/** `UI_TOKENS` as a CSS rule, e.g. for a `<style>` an app injects. */
export function uiTokensCss(selector = ':root'): string {
  const body = Object.entries(UI_TOKENS)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `${selector} {\n${body}\n}\n`;
}

// ============================================================================
// ---- The engine app: the screen an engine ships next to its SDK ----
// ============================================================================

/** What the host (the launcher's route page) hands an engine app. */
export interface EngineAppHost {
  /** The game being played, as the host's catalog describes it. */
  game: {
    slug: string;
    title: string;
    accent?: string;
    art?: string;
  };
  /** Pass to the SDK's `storage({ namespace })`; the engine prefixes its own id. */
  storage: { namespace: string };
  /** The game's files, each read only when the engine asks (keyed by the SDK's asset names). */
  assets: Record<string, () => Promise<Uint8Array>>;
  /** The shared input; the app suspends it while the game itself has the controls. */
  input: UiInput;
  /** Leave: the host navigates back (to its library or home). Call after `unmount()` work is done. */
  exit(): void;
}

/** What `mount()` returns: the way to take the app down. */
export interface EngineAppHandle {
  unmount(): Promise<void>;
}

/**
 * An engine app module (`<id>/app/app.js`): mounts the engine's own screens — start
 * / load game, pause, options — into `target` and runs the game, following UX.md.
 */
export interface EngineApp {
  mount(target: HTMLElement, host: EngineAppHost): Promise<EngineAppHandle>;
}
