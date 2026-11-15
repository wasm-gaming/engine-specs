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
  /** `'touch'`: from the on-screen controls ({@link createTouchPad}), through {@link UiInput.trigger}. */
  source: 'keyboard' | 'gamepad' | 'touch';
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
  /** Keys that still open the menu while suspended (in game). Default `['Escape', 'F1']`. */
  menuKeys?: readonly string[];
}

export interface UiInput {
  /** Subscribe; returns the unsubscribe function. */
  on(listener: UiActionListener): () => void;
  /**
   * The game has the controls: nothing is delivered or swallowed, except the in-game
   * menu combo — Select + Start, and the `menuKeys` (Escape) — which arrives as `menu`.
   */
  suspend(): void;
  resume(): void;
  readonly suspended: boolean;
  /**
   * Hear every change of {@link suspended} (not repeated calls that change nothing);
   * returns the unsubscribe function. A host follows it to show its on-screen
   * controls while the game has them, and to hide them while a menu is open.
   */
  onSuspend(listener: (suspended: boolean) => void): () => void;
  /**
   * Deliver an action that did not come from a key or a button — the touch pad's
   * pause button, an on-screen "back". The same rule as everything else: while
   * suspended only `menu` gets through. Default detail: `{ source: 'touch', repeat: false }`.
   */
  trigger(action: UiAction, detail?: UiActionDetail): void;
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
 * (and then neither fires on its own). While {@link UiInput.suspend | suspended} (in
 * game) the game gets every input except the menu combo: Select + Start and the
 * `menuKeys` (Escape, F1) still arrive, as `menu`, so the pause menu can always open.
 */
export function createInput(options: UiInputOptions = {}): UiInput {
  const target = options.target ?? (globalThis as unknown as EventTarget);
  const capture = options.capture ?? true;
  const swallow = options.swallow ?? true;
  const keymap = options.keymap ?? UI_KEYMAP;
  const menuKeys = new Set(options.menuKeys ?? ['Escape', 'F1']);
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
  const suspendListeners = new Set<(suspended: boolean) => void>();
  let suspended = false;
  let destroyed = false;
  let polling = false;
  const held = new Map<UiAction, { since: number; last: number }>();

  // A snapshot: a listener that subscribes another one (a screen opening the next)
  // must not hand it the same action — a Set also visits entries added while it is
  // being iterated, so one Enter would open a screen and activate its focused item.
  // A listener removed by an earlier one in the same dispatch is skipped.
  const fire = (action: UiAction, detail: UiActionDetail): void => {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener(action, detail);
    }
  };

  const onKey = (event: Event): void => {
    if (destroyed) return;
    const key = event as KeyboardEvent;
    if (suspended) {
      if (!menuKeys.has(key.key) || key.repeat) return;
      key.preventDefault();
      key.stopPropagation();
      fire('menu', { source: 'keyboard', repeat: false });
      return;
    }
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
        // In game only the Select + Start combo gets through (plain Start is the game's).
        const combo = action === 'menu' && gamepads().some((p) => p?.buttons[8]?.pressed && p.buttons[9]?.pressed);
        if (!suspended || combo) fire(action, { source: 'gamepad', repeat: false });
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

  const setSuspended = (value: boolean): void => {
    if (destroyed || suspended === value) return;
    suspended = value;
    for (const listener of [...suspendListeners]) {
      if (suspendListeners.has(listener)) listener(value);
    }
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
      setSuspended(true);
    },
    resume() {
      setSuspended(false);
    },
    get suspended() {
      return suspended;
    },
    onSuspend(listener) {
      suspendListeners.add(listener);
      return () => suspendListeners.delete(listener);
    },
    trigger(action, detail = { source: 'touch', repeat: false }) {
      if (destroyed) return;
      if (suspended && action !== 'menu') return;
      fire(action, detail);
    },
    poll,
    destroy() {
      destroyed = true;
      listeners.clear();
      suspendListeners.clear();
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

// ============================================================================
// ---- On-screen controls: a virtual gamepad for phones and tablets (UX.md) ----
// ============================================================================
//
// A phone has no keyboard and usually no gamepad. The touch pad draws one, and shows
// up in `navigator.getGamepads()` as a W3C *standard* gamepad, which is what every
// engine's gamepad code (SDL, or its own `getGamepads()` loop) and `createInput()`
// already read — so no engine changes to be played by touch.
//
// Layering: `placeTouchPad()` (geometry) and `createTouchPadCore()` (fingers →
// buttons) are pure and tested without a browser; `createTouchPad()` draws them and
// feeds them pointer events; `exposeAsGamepad()` and `connectTouchPad()` are the
// bridges to the engines and to the shared input.

/** A system with a touch layout. Keys are the launcher catalog's `system` ids. */
export type TouchSystem = 'megadrive' | 'neogeo' | 'snes' | 'gba' | 'gbc' | 'gb';

/** A button outside the face cluster: shoulders, Start, Select. */
export interface TouchKey {
  /** What it shows: the console's own name for it. */
  label: string;
  /** The standard-mapping button it presses. */
  index: number;
}

/** A face button, placed inside the cluster's square. */
export interface TouchFaceButton extends TouchKey {
  /** Centre, as fractions (0–1) of the cluster's side. */
  x: number;
  y: number;
  /** Diameter, as a fraction of the cluster's side. */
  size: number;
  /** Tint, for consoles whose buttons have colours. */
  color?: string;
}

/** One console's pad. */
export interface TouchLayout {
  system: TouchSystem;
  /** Shown to people (settings, the demo). */
  title: string;
  /** The game picture's aspect ratio (width / height), to place the controls around it. */
  aspect: number;
  faces: readonly TouchFaceButton[];
  l?: TouchKey;
  r?: TouchKey;
  select?: TouchKey;
  start?: TouchKey;
}

/** Standard-mapping indices the pad uses. */
const PAD = Object.freeze({ up: 12, down: 13, left: 14, right: 15 });
const PAD_BUTTONS = 17;
const PAD_AXES = 4;

/**
 * One layout per system. Each label presses the standard button that the system's
 * emulator binds to that console button by default, so no emulator is reconfigured:
 *
 * - Mega Drive (BlastEm `default.cfg`): A=0, B=1, C=5 (right shoulder), X=2, Y=3,
 *   Z=4 (left shoulder), Mode=8, Start=9. Six buttons: the launcher plugs 6-button
 *   pads, and a 3-button game ignores X Y Z.
 * - Neo Geo (FBNeo: "fire N" is joystick button N-1): A=0, B=1, C=2, D=3.
 * - SNES (snes9x, by position): B=0, A=1, Y=2, X=3, L=4, R=5.
 * - GBA / GBC / GB (mGBA): A=0, B=1, L=4, R=5.
 *
 * Everywhere Select = 8 and Start = 9.
 */
export const TOUCH_LAYOUTS: Readonly<Record<TouchSystem, TouchLayout>> = Object.freeze({
  megadrive: {
    system: 'megadrive',
    title: 'Mega Drive',
    aspect: 4 / 3,
    faces: [
      { label: 'X', index: 2, x: 0.18, y: 0.32, size: 0.25 },
      { label: 'Y', index: 3, x: 0.5, y: 0.26, size: 0.25 },
      { label: 'Z', index: 4, x: 0.82, y: 0.2, size: 0.25 },
      { label: 'A', index: 0, x: 0.18, y: 0.7, size: 0.3 },
      { label: 'B', index: 1, x: 0.5, y: 0.64, size: 0.3 },
      { label: 'C', index: 5, x: 0.82, y: 0.58, size: 0.3 },
    ],
    start: { label: 'Start', index: 9 },
  },
  neogeo: {
    system: 'neogeo',
    title: 'Neo Geo',
    aspect: 4 / 3,
    faces: [
      { label: 'A', index: 0, x: 0.13, y: 0.74, size: 0.25, color: '#ef4444' },
      { label: 'B', index: 1, x: 0.37, y: 0.6, size: 0.25, color: '#facc15' },
      { label: 'C', index: 2, x: 0.62, y: 0.48, size: 0.25, color: '#22c55e' },
      { label: 'D', index: 3, x: 0.87, y: 0.38, size: 0.25, color: '#3b82f6' },
    ],
    select: { label: 'Select', index: 8 },
    start: { label: 'Start', index: 9 },
  },
  snes: {
    system: 'snes',
    title: 'Super Nintendo',
    aspect: 4 / 3,
    faces: [
      { label: 'X', index: 3, x: 0.5, y: 0.18, size: 0.32, color: '#3b82f6' },
      { label: 'Y', index: 2, x: 0.18, y: 0.5, size: 0.32, color: '#22c55e' },
      { label: 'A', index: 1, x: 0.82, y: 0.5, size: 0.32, color: '#ef4444' },
      { label: 'B', index: 0, x: 0.5, y: 0.82, size: 0.32, color: '#facc15' },
    ],
    l: { label: 'L', index: 4 },
    r: { label: 'R', index: 5 },
    select: { label: 'Select', index: 8 },
    start: { label: 'Start', index: 9 },
  },
  gba: {
    system: 'gba',
    title: 'Game Boy Advance',
    aspect: 3 / 2,
    faces: [
      { label: 'B', index: 1, x: 0.28, y: 0.64, size: 0.38 },
      { label: 'A', index: 0, x: 0.72, y: 0.4, size: 0.38 },
    ],
    l: { label: 'L', index: 4 },
    r: { label: 'R', index: 5 },
    select: { label: 'Select', index: 8 },
    start: { label: 'Start', index: 9 },
  },
  gbc: {
    system: 'gbc',
    title: 'Game Boy Color',
    aspect: 10 / 9,
    faces: [
      { label: 'B', index: 1, x: 0.28, y: 0.64, size: 0.38 },
      { label: 'A', index: 0, x: 0.72, y: 0.4, size: 0.38 },
    ],
    select: { label: 'Select', index: 8 },
    start: { label: 'Start', index: 9 },
  },
  gb: {
    system: 'gb',
    title: 'Game Boy',
    aspect: 10 / 9,
    faces: [
      { label: 'B', index: 1, x: 0.28, y: 0.64, size: 0.38 },
      { label: 'A', index: 0, x: 0.72, y: 0.4, size: 0.38 },
    ],
    select: { label: 'Select', index: 8 },
    start: { label: 'Start', index: 9 },
  },
});

/** A rectangle in CSS pixels, relative to the viewport. */
export interface TouchRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TouchInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TouchViewport {
  width: number;
  height: number;
  /** `env(safe-area-inset-*)`: notches, rounded corners, the home indicator. */
  safe?: TouchInsets;
}

/** Where everything goes, for one layout on one viewport. */
export interface TouchPlacement {
  orientation: 'portrait' | 'landscape';
  /**
   * The controls are drawn over the picture: landscape, when giving them sides of
   * their own would shrink the game below `minGameScale`.
   */
  overlay: boolean;
  /** Where the game may draw. The host fits the engine's target into it. */
  gameArea: TouchRect;
  /** The areas that take touches: the pad's half (portrait), or each side. */
  zones: TouchRect[];
  dpad: TouchRect;
  cluster: TouchRect;
  /** Face buttons in viewport pixels: centre and radius. */
  faces: Array<{ label: string; index: number; cx: number; cy: number; r: number; color?: string }>;
  /** Shoulders, Start, Select — and the pause button (`index: null`). */
  keys: Array<{ id: 'l' | 'r' | 'select' | 'start' | 'pause'; label: string; index: number | null; rect: TouchRect }>;
}

export interface TouchPlaceOptions {
  /** Size of the controls, 0.75–1.4. Default 1. */
  scale?: number;
  /** Below this fraction of its full height, the game keeps its size and the controls overlay it. Default 0.7. */
  minGameScale?: number;
}

/** Smallest touch target (UX.md rule 8). */
const TOUCH_MIN = 48;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const rect = (x: number, y: number, width: number, height: number): TouchRect => ({
  x: Math.round(x),
  y: Math.round(y),
  width: Math.round(width),
  height: Math.round(height),
});

/**
 * Lays a pad out. **Portrait**: the pad takes the bottom half — shoulders and the
 * pause button along its top, the d-pad left, the buttons right, Select / Start
 * along its bottom — and the game gets the top half. **Landscape**: the game is
 * centred and the controls sit on its sides — L and the d-pad and Select on the
 * left; pause, R, the buttons and Start on the right. When sides wide enough would
 * shrink the game below `minGameScale` of the screen's height (a 4:3 tablet), the
 * game keeps the whole screen and the controls overlay its edges.
 */
export function placeTouchPad(
  layout: TouchLayout,
  viewport: TouchViewport,
  options: TouchPlaceOptions = {},
): TouchPlacement {
  const scale = clamp(options.scale ?? 1, 0.75, 1.4);
  const minGameScale = options.minGameScale ?? 0.7;
  const { width: W, height: H } = viewport;
  const safe = viewport.safe ?? { top: 0, right: 0, bottom: 0, left: 0 };

  const faces = (cluster: TouchRect): TouchPlacement['faces'] =>
    layout.faces.map((face) => ({
      label: face.label,
      index: face.index,
      cx: Math.round(cluster.x + face.x * cluster.width),
      cy: Math.round(cluster.y + face.y * cluster.height),
      r: Math.round((face.size * cluster.width) / 2),
      ...(face.color ? { color: face.color } : {}),
    }));
  const key = (
    id: 'l' | 'r' | 'select' | 'start',
    spec: TouchKey | undefined,
    at: TouchRect,
  ): TouchPlacement['keys'] => (spec ? [{ id, label: spec.label, index: spec.index, rect: at }] : []);

  if (H >= W) {
    // ---- portrait: the bottom half
    const half = Math.round(H / 2);
    const zone = rect(0, half, W, H - half);
    const inner = rect(safe.left, half, W - safe.left - safe.right, H - half - safe.bottom);
    const m = Math.round(clamp(inner.width * 0.04, 10, 24));
    const rowH = TOUCH_MIN;
    const top = inner.y + m;
    const bottom = inner.y + inner.height - m - rowH;
    const middleTop = top + rowH + Math.round(m / 2);
    const middleH = bottom - Math.round(m / 2) - middleTop;
    // The d-pad and the cluster are squares of the same side: as big as the half
    // allows, capped for tablets, then scaled — never beyond the room there is.
    const side = Math.round(
      Math.min(middleH, inner.width * 0.47, Math.min(middleH, inner.width * 0.44, 240) * scale),
    );
    const dpad = rect(inner.x + m, middleTop + (middleH - side) / 2, side, side);
    const cluster = rect(inner.x + inner.width - m - side, middleTop + (middleH - side) / 2, side, side);
    const shoulderW = clamp(inner.width * 0.28, 88, 160);
    const pillW = clamp(inner.width * 0.2, 72, 112);
    const pauseW = 56;
    const centre = inner.x + inner.width / 2;
    return {
      orientation: 'portrait',
      overlay: false,
      gameArea: rect(safe.left, safe.top, W - safe.left - safe.right, half - safe.top),
      zones: [zone],
      dpad,
      cluster,
      faces: faces(cluster),
      keys: [
        ...key('l', layout.l, rect(inner.x + m, top, shoulderW, rowH)),
        ...key('r', layout.r, rect(inner.x + inner.width - m - shoulderW, top, shoulderW, rowH)),
        { id: 'pause', label: 'Pause', index: null, rect: rect(centre - pauseW / 2, top, pauseW, rowH) },
        ...key('select', layout.select, rect(centre - 8 - pillW, bottom, pillW, rowH)),
        ...key('start', layout.start, rect(layout.select ? centre + 8 : centre - pillW / 2, bottom, pillW, rowH)),
      ],
    };
  }

  // ---- landscape: the sides
  const fullH = H - safe.top - safe.bottom;
  const usableW = W - safe.left - safe.right;
  const m = Math.round(clamp(fullH * 0.035, 8, 20));
  const rowH = TOUCH_MIN;
  const control = Math.round(clamp(Math.min(fullH * 0.42, 200), 112, 200) * scale);
  const sideNeeded = control + 2 * m;
  const gameWFull = Math.min(usableW, fullH * layout.aspect);
  let gameW = gameWFull;
  let overlay = false;
  if ((usableW - gameWFull) / 2 < sideNeeded) {
    const shrunkW = usableW - 2 * sideNeeded;
    const shrunkScale = shrunkW / layout.aspect / fullH;
    if (shrunkScale >= minGameScale) gameW = shrunkW;
    else overlay = true;
  }
  const sideW = overlay ? sideNeeded : (usableW - gameW) / 2;
  const gameH = overlay ? fullH : Math.min(fullH, gameW / layout.aspect);
  const gameArea = overlay
    ? rect(safe.left, safe.top, usableW, fullH)
    : rect(safe.left + sideW, safe.top + (fullH - gameH) / 2, gameW, gameH);
  const leftX = safe.left;
  const rightX = W - safe.right - sideW;
  const top = safe.top + m;
  const bottom = H - safe.bottom - m - rowH;
  // The top row always exists — it holds the pause button, and the shoulders when
  // the console has them.
  const middleTop = top + rowH + m;
  const middleH = bottom - m - middleTop;
  const side = Math.round(Math.min(control, middleH, sideW - 2 * m));
  const dpad = rect(leftX + (sideW - side) / 2, middleTop + (middleH - side) / 2, side, side);
  const cluster = rect(rightX + (sideW - side) / 2, middleTop + (middleH - side) / 2, side, side);
  const pauseW = 48;
  const shoulderW = clamp(sideW - 2 * m - (pauseW + m), 64, 140);
  const pillW = clamp(sideW * 0.5, 72, 112);
  return {
    orientation: 'landscape',
    overlay,
    gameArea,
    zones: [rect(0, 0, leftX + sideW, H), rect(rightX, 0, W - rightX, H)],
    dpad,
    cluster,
    faces: faces(cluster),
    keys: [
      ...key('l', layout.l, rect(leftX + m, top, shoulderW, rowH)),
      ...key('r', layout.r, rect(rightX + m, top, shoulderW, rowH)),
      { id: 'pause', label: 'Pause', index: null, rect: rect(rightX + sideW - m - pauseW, top, pauseW, rowH) },
      ...key('select', layout.select, rect(leftX + (sideW - pillW) / 2, bottom, pillW, rowH)),
      ...key('start', layout.start, rect(rightX + (sideW - pillW) / 2, bottom, pillW, rowH)),
    ],
  };
}

/** The pad as the Gamepad API shows it: a W3C *standard* gamepad. */
export interface VirtualGamepad extends UiGamepadLike {
  readonly id: string;
  index: number;
  connected: boolean;
  readonly mapping: 'standard';
  /**
   * Moved on every change. Emscripten's SDL backend re-reads a pad only when its
   * timestamp moved, so a pad whose timestamp stood still would look frozen.
   */
  timestamp: number;
  readonly buttons: Array<{ pressed: boolean; touched: boolean; value: number }>;
  readonly axes: number[];
  readonly vibrationActuator: null;
}

/** The pad's `Gamepad.id`. */
export const TOUCH_PAD_ID = 'wasm-gaming touch pad (STANDARD GAMEPAD)';

/** What a finger took when it landed. */
export type TouchControl = 'dpad' | 'cluster' | 'l' | 'r' | 'select' | 'start' | 'pause';

export interface TouchPadCoreOptions {
  /** Clock in ms. Default: `performance.now()`. */
  now?: () => number;
  /**
   * A press is held at least this long (ms), so a tap shorter than a frame still
   * reaches whoever polls once per frame. Default 50.
   */
  minHold?: number;
}

/** Fingers → standard buttons, without a DOM. {@link createTouchPad} draws it. */
export interface TouchPadCore {
  readonly gamepad: VirtualGamepad;
  readonly placement: TouchPlacement | null;
  /** New geometry; every finger is released. */
  place(placement: TouchPlacement | null): void;
  /** A finger lands; returns what it took, or null (nothing there). */
  down(pointerId: number, x: number, y: number): TouchControl | null;
  /** A finger slides: within the d-pad, across the buttons, off a key. */
  move(pointerId: number, x: number, y: number): void;
  /** A finger lifts, or the browser took it away (`pointercancel`). */
  up(pointerId: number): void;
  /** Every finger at once: blur, hidden page, hidden pad. Never a stuck button. */
  releaseAll(): void;
  /** Standard indices pressed now, latching included. */
  pressed(): ReadonlySet<number>;
  /** When (ms, the core's clock) a latched press is due to end, or null. Call {@link tick} then. */
  readonly deadline: number | null;
  /** Apply releases that came due. */
  tick(): void;
  /** Buttons changed; `pressed` lists the ones that went down. */
  onChange(listener: (pressed: number[]) => void): () => void;
  /** The pause button was touched. */
  onPause(listener: () => void): () => void;
}

/** A finger landing this close to a key (px) still takes it. */
const KEY_SLOP = 8;

/** Standard d-pad indices for a point, from its angle around the d-pad's centre. */
export function touchDpadAt(dpad: TouchRect, x: number, y: number): number[] {
  const dx = x - (dpad.x + dpad.width / 2);
  const dy = y - (dpad.y + dpad.height / 2);
  // A dead zone in the middle: resting the thumb on the hub presses nothing.
  if (Math.hypot(dx, dy) < dpad.width * 0.11) return [];
  // Eight sectors of 45°, the cardinal ones centred on their axis.
  const sector = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  return [
    [PAD.right],
    [PAD.right, PAD.down],
    [PAD.down],
    [PAD.down, PAD.left],
    [PAD.left],
    [PAD.left, PAD.up],
    [PAD.up],
    [PAD.up, PAD.right],
  ][sector] as number[];
}

/**
 * Face buttons under a point. Each takes a circle a little larger than it is drawn
 * (never under the 48 px minimum), so the gap between two neighbours presses both —
 * the arcade "roll" — and a thumb slides from one to the next without lifting.
 */
export function touchFacesAt(placement: TouchPlacement, x: number, y: number): number[] {
  const out: number[] = [];
  for (const face of placement.faces) {
    const reach = Math.max(face.r * 1.18, TOUCH_MIN / 2);
    if (Math.hypot(x - face.cx, y - face.cy) <= reach) out.push(face.index);
  }
  return out;
}

const inside = (r: TouchRect, x: number, y: number, slop = 0): boolean =>
  x >= r.x - slop && x <= r.x + r.width + slop && y >= r.y - slop && y <= r.y + r.height + slop;

const grow = (r: TouchRect, by: number): TouchRect => ({
  x: r.x - r.width * by,
  y: r.y - r.height * by,
  width: r.width * (1 + 2 * by),
  height: r.height * (1 + 2 * by),
});

export function createTouchPadCore(options: TouchPadCoreOptions = {}): TouchPadCore {
  const now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  const minHold = options.minHold ?? 50;
  const gamepad: VirtualGamepad = {
    id: TOUCH_PAD_ID,
    index: 0,
    connected: false,
    mapping: 'standard',
    timestamp: 0,
    buttons: Array.from({ length: PAD_BUTTONS }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: Array.from({ length: PAD_AXES }, () => 0),
    vibrationActuator: null,
  };
  let placement: TouchPlacement | null = null;
  const fingers = new Map<number, { control: TouchControl; indices: number[] }>();
  /** When each pressed index went down. */
  const since = new Map<number, number>();
  /** Latched: released early, held until then. */
  const latched = new Map<number, number>();
  const changeListeners = new Set<(pressed: number[]) => void>();
  const pauseListeners = new Set<() => void>();

  const live = (): Set<number> => {
    const set = new Set<number>();
    for (const finger of fingers.values()) for (const index of finger.indices) set.add(index);
    return set;
  };

  const sync = (): void => {
    const t = now();
    const held = live();
    for (const [index, until] of [...latched]) if (until <= t || held.has(index)) latched.delete(index);
    for (const index of [...since.keys()]) {
      if (held.has(index)) continue;
      const start = since.get(index) ?? t;
      if (t < start + minHold) latched.set(index, start + minHold);
      since.delete(index);
    }
    const effective = new Set([...held, ...latched.keys()]);
    const wentDown: number[] = [];
    let changed = false;
    gamepad.buttons.forEach((button, index) => {
      const on = effective.has(index);
      if (on === button.pressed) return;
      changed = true;
      button.pressed = on;
      button.touched = on;
      button.value = on ? 1 : 0;
      if (on) wentDown.push(index);
    });
    for (const index of held) if (!since.has(index)) since.set(index, t);
    if (!changed) return;
    gamepad.timestamp = t;
    for (const listener of [...changeListeners]) listener(wentDown);
  };

  const indicesFor = (control: TouchControl, x: number, y: number): number[] => {
    if (!placement) return [];
    if (control === 'dpad') return touchDpadAt(placement.dpad, x, y);
    if (control === 'cluster') return touchFacesAt(placement, x, y);
    const key = placement.keys.find((k) => k.id === control);
    if (!key || key.index === null) return [];
    return inside(key.rect, x, y, KEY_SLOP) ? [key.index] : [];
  };

  const controlAt = (x: number, y: number): TouchControl | null => {
    if (!placement) return null;
    for (const key of placement.keys) if (inside(key.rect, x, y, KEY_SLOP)) return key.id;
    const { dpad, cluster } = placement;
    const nearDpad = inside(grow(dpad, 0.2), x, y);
    const nearCluster = inside(grow(cluster, 0.12), x, y) || touchFacesAt(placement, x, y).length > 0;
    if (nearDpad && nearCluster) {
      // On a narrow phone the two margins meet: the nearer one, by its own size.
      const reach = (r: TouchRect): number =>
        Math.hypot(x - (r.x + r.width / 2), y - (r.y + r.height / 2)) / (r.width / 2);
      return reach(dpad) <= reach(cluster) ? 'dpad' : 'cluster';
    }
    if (nearDpad) return 'dpad';
    if (nearCluster) return 'cluster';
    return null;
  };

  return {
    gamepad,
    get placement() {
      return placement;
    },
    place(next) {
      placement = next;
      // A new geometry is a clean slate: nothing latched survives it.
      fingers.clear();
      latched.clear();
      since.clear();
      sync();
    },
    down(pointerId, x, y) {
      const control = controlAt(x, y);
      if (!control) return null;
      fingers.set(pointerId, { control, indices: indicesFor(control, x, y) });
      if (control === 'pause') for (const listener of [...pauseListeners]) listener();
      sync();
      return control;
    },
    move(pointerId, x, y) {
      const finger = fingers.get(pointerId);
      if (!finger || finger.control === 'pause') return;
      finger.indices = indicesFor(finger.control, x, y);
      sync();
    },
    up(pointerId) {
      if (!fingers.delete(pointerId)) return;
      sync();
    },
    releaseAll() {
      fingers.clear();
      latched.clear();
      since.clear();
      sync();
    },
    pressed() {
      const set = new Set<number>();
      gamepad.buttons.forEach((button, index) => button.pressed && set.add(index));
      return set;
    },
    get deadline() {
      return latched.size ? Math.min(...latched.values()) : null;
    },
    tick: sync,
    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    onPause(listener) {
      pauseListeners.add(listener);
      return () => pauseListeners.delete(listener);
    },
  };
}

/** The minimum of `navigator` {@link exposeAsGamepad} touches, so tests can fake it. */
export interface TouchNavigatorLike {
  getGamepads?: () => ArrayLike<unknown | null>;
}

export interface ExposeOptions {
  /** Default: `globalThis.navigator`. */
  navigator?: TouchNavigatorLike;
  /** Where `gamepadconnected` / `gamepaddisconnected` are announced. Default: `globalThis` (the window). */
  target?: EventTarget;
}

/**
 * Puts the pad in `navigator.getGamepads()`, at the first index no physical pad
 * holds (index 0 when there is none — snes9x and mGBA read only that one), and
 * announces it with `gamepadconnected`. Install it **before** the engine starts, so
 * SDL's start-up enumeration finds it. If a physical pad later takes its index, the
 * pad moves to the next free one (disconnected, then connected again).
 *
 * The events are plain `Event`s carrying a `gamepad` property — a `GamepadEvent`
 * cannot be built around an object that is not a real `Gamepad` — which is the shape
 * Emscripten's handler and `createInput()` read. Returns `release()`, which restores
 * `getGamepads` and announces the pad gone.
 */
export function exposeAsGamepad(
  source: VirtualGamepad | { readonly gamepad: VirtualGamepad },
  options: ExposeOptions = {},
): () => void {
  const pad: VirtualGamepad = 'gamepad' in source ? source.gamepad : source;
  const nav = (options.navigator ?? globalThis.navigator) as TouchNavigatorLike | undefined;
  const target = options.target ?? (globalThis as unknown as EventTarget);
  if (!nav) return () => {};
  const own = Object.getOwnPropertyDescriptor(nav, 'getGamepads');
  const original = nav.getGamepads ? nav.getGamepads.bind(nav) : () => [];
  const announce = (type: 'gamepadconnected' | 'gamepaddisconnected'): void => {
    const event = new Event(type);
    Object.defineProperty(event, 'gamepad', { value: pad, enumerable: true });
    target.dispatchEvent(event);
  };
  const physical = (): Array<unknown | null> =>
    Array.from(original() ?? [], (entry) => (entry === pad ? null : entry ?? null));
  const freeIndex = (pads: Array<unknown | null>): number => {
    let index = 0;
    while (pads[index]) index++;
    return index;
  };

  let moving = false;
  const wrapped = (): Array<unknown | null> => {
    const pads = physical();
    if (pads[pad.index] && !moving) {
      // A physical pad took our slot. Move, announcing outside the caller's poll.
      moving = true;
      queueMicrotask(() => {
        announce('gamepaddisconnected');
        pad.index = freeIndex(physical());
        moving = false;
        announce('gamepadconnected');
      });
    }
    const out = pads.slice();
    if (!moving) {
      while (out.length <= pad.index) out.push(null);
      out[pad.index] = pad;
    }
    return out;
  };

  pad.index = freeIndex(physical());
  pad.connected = true;
  Object.defineProperty(nav, 'getGamepads', { value: wrapped, configurable: true, writable: true });
  announce('gamepadconnected');

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (own) Object.defineProperty(nav, 'getGamepads', own);
    else delete (nav as { getGamepads?: unknown }).getGamepads;
    pad.connected = false;
    announce('gamepaddisconnected');
  };
}

export interface TouchPadOptions extends TouchPlaceOptions {
  /** The console, or its layout. */
  layout: TouchSystem | TouchLayout;
  /** How much the controls show through, 0.2–1. Default 0.6. */
  opacity?: number;
  /** See {@link TouchPadCoreOptions.minHold}. Default 50 ms. */
  minHold?: number;
  /** A short vibration on every press, where the browser has one (Android). Default true. */
  haptics?: boolean;
  /**
   * `'auto'` (default): drawn on touch screens, from the first touch; gone again when
   * a key is pressed or a physical gamepad connects, back on the next touch.
   * `'always'`: whenever shown.
   */
  mode?: 'auto' | 'always';
  /** Start shown — the game has the controls. Default false: the host shows it (see {@link connectTouchPad}). */
  shown?: boolean;
}

export interface TouchPad {
  readonly gamepad: VirtualGamepad;
  readonly layout: TouchLayout;
  setLayout(layout: TouchSystem | TouchLayout): void;
  /** The game has the controls. */
  show(): void;
  /** A menu is open: the controls go away and the menu is tapped. */
  hide(): void;
  /** Shown, and in use on a touch screen. */
  readonly visible: boolean;
  /** Null while not visible. */
  readonly placement: TouchPlacement | null;
  /** Where the game may draw: the whole viewport while the pad is not visible. */
  readonly gameArea: TouchRect;
  /** Hear every change of {@link gameArea} (rotation, resize, the pad showing or going). */
  onLayout(listener: (gameArea: TouchRect, placement: TouchPlacement | null) => void): () => void;
  onPause(listener: () => void): () => void;
  destroy(): void;
}

const TOUCH_STYLE_ID = 'wg-touch-pad-style';
const TOUCH_CSS = `
.wg-tp { position: fixed; inset: 0; z-index: 9000; pointer-events: none; display: none;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  font-family: var(--wg-font-ui, system-ui, sans-serif); color: #fff; }
.wg-tp.is-visible { display: block; }
.wg-tp-zone { position: absolute; pointer-events: auto; touch-action: none; overscroll-behavior: none;
  -webkit-tap-highlight-color: transparent; }
.wg-tp-art { position: absolute; inset: 0; opacity: var(--wg-tp-opacity, 0.6); }
.wg-tp.is-overlay .wg-tp-art { opacity: calc(var(--wg-tp-opacity, 0.6) * 0.75); }
.wg-tp-face, .wg-tp-key, .wg-tp-arm, .wg-tp-hub { position: absolute; box-sizing: border-box;
  background: rgb(255 255 255 / 0.12); border: 1.5px solid rgb(255 255 255 / 0.55);
  display: grid; place-items: center; font-weight: 700; letter-spacing: 0.02em;
  text-shadow: 0 1px 2px rgb(0 0 0 / 0.6); }
.wg-tp-face { border-radius: 50%; --c: #ffffff; border-color: color-mix(in srgb, var(--c) 70%, white);
  background: color-mix(in srgb, var(--c) 22%, transparent); }
.wg-tp-key { border-radius: 999px; font-size: 13px; font-weight: 600; }
.wg-tp-key.is-shoulder { border-radius: 14px; font-size: 16px; font-weight: 700; }
.wg-tp-key.is-pause::before, .wg-tp-key.is-pause::after { content: ''; position: absolute; top: 34%; bottom: 34%;
  width: 4px; border-radius: 2px; background: currentColor; }
.wg-tp-key.is-pause::before { left: calc(50% - 7px); }
.wg-tp-key.is-pause::after { right: calc(50% - 7px); }
.wg-tp-arm { border-radius: 6px; }
.wg-tp-hub { border-radius: 4px; border-width: 0; background: rgb(255 255 255 / 0.12); }
.wg-tp .is-on { background: rgb(255 255 255 / 0.55); transform: scale(0.96); color: #0b0d12; text-shadow: none; }
.wg-tp-face.is-on { background: color-mix(in srgb, var(--c) 70%, white); }
`;

/**
 * The touch pad: draws {@link TOUCH_LAYOUTS | a console's pad} over `target`'s
 * viewport and turns fingers into a {@link VirtualGamepad}. Pair it with
 * {@link exposeAsGamepad} (the engines) and {@link connectTouchPad} (the shared
 * input). Pointer Events, any number of fingers; a finger keeps the control it
 * landed on — it slides around the d-pad, or across the buttons — and every finger
 * is let go on blur, on a hidden page, and when the pad hides: never a stuck button.
 */
export function createTouchPad(target: HTMLElement, options: TouchPadOptions): TouchPad {
  const doc = target.ownerDocument;
  const win = doc.defaultView ?? (globalThis as unknown as Window);
  const resolve = (layout: TouchSystem | TouchLayout): TouchLayout =>
    typeof layout === 'string' ? TOUCH_LAYOUTS[layout] : layout;
  let layout = resolve(options.layout);
  const haptics = options.haptics ?? true;
  const mode = options.mode ?? 'auto';
  const placeOptions: TouchPlaceOptions = {
    ...(options.scale !== undefined ? { scale: options.scale } : {}),
    ...(options.minGameScale !== undefined ? { minGameScale: options.minGameScale } : {}),
  };
  const core = createTouchPadCore(options.minHold !== undefined ? { minHold: options.minHold } : {});

  if (!doc.getElementById(TOUCH_STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = TOUCH_STYLE_ID;
    style.textContent = TOUCH_CSS;
    doc.head.appendChild(style);
  }

  const root = doc.createElement('div');
  root.className = 'wg-tp';
  root.style.setProperty('--wg-tp-opacity', String(clamp(options.opacity ?? 0.6, 0.2, 1)));
  const art = doc.createElement('div');
  art.className = 'wg-tp-art';
  // Reads `env(safe-area-inset-*)` back as pixels.
  const probe = doc.createElement('div');
  probe.style.cssText =
    'position:fixed;inset:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  root.append(art, probe);
  target.appendChild(root);

  let shown = options.shown ?? false;
  let active = mode === 'always' || (win.matchMedia?.('(pointer: coarse)').matches ?? false);
  let destroyed = false;
  let zones: HTMLElement[] = [];
  let arms: Record<'up' | 'down' | 'left' | 'right', HTMLElement> | null = null;
  const parts = new Map<number, HTMLElement[]>();
  const layoutListeners = new Set<(gameArea: TouchRect, placement: TouchPlacement | null) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const visible = (): boolean => shown && active && !destroyed;
  const viewport = (): TouchViewport => {
    const css = win.getComputedStyle(probe);
    const px = (value: string): number => Number.parseFloat(value) || 0;
    return {
      width: win.innerWidth,
      height: win.innerHeight,
      safe: { top: px(css.paddingTop), right: px(css.paddingRight), bottom: px(css.paddingBottom), left: px(css.paddingLeft) },
    };
  };
  const gameArea = (): TouchRect =>
    core.placement?.gameArea ?? { x: 0, y: 0, width: win.innerWidth, height: win.innerHeight };

  const box = (el: HTMLElement, r: TouchRect): void => {
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
  };
  const register = (index: number, el: HTMLElement): void => {
    parts.set(index, [...(parts.get(index) ?? []), el]);
  };

  const paint = (): void => {
    const on = core.pressed();
    for (const [index, els] of parts) for (const el of els) el.classList.toggle('is-on', on.has(index));
    if (arms) {
      arms.up.classList.toggle('is-on', on.has(PAD.up));
      arms.down.classList.toggle('is-on', on.has(PAD.down));
      arms.left.classList.toggle('is-on', on.has(PAD.left));
      arms.right.classList.toggle('is-on', on.has(PAD.right));
    }
  };

  const build = (placement: TouchPlacement): void => {
    for (const zone of zones) zone.remove();
    art.replaceChildren();
    parts.clear();
    root.classList.toggle('is-overlay', placement.overlay);

    // The d-pad: a cross of four arms around a hub.
    const d = placement.dpad;
    const third = d.width / 3;
    const arm = (dir: 'up' | 'down' | 'left' | 'right', x: number, y: number): HTMLElement => {
      const el = doc.createElement('div');
      el.className = 'wg-tp-arm';
      box(el, rect(d.x + x * third, d.y + y * third, third, third));
      art.appendChild(el);
      return el;
    };
    arms = { up: arm('up', 1, 0), left: arm('left', 0, 1), right: arm('right', 2, 1), down: arm('down', 1, 2) };
    const hub = doc.createElement('div');
    hub.className = 'wg-tp-hub';
    box(hub, rect(d.x + third, d.y + third, third, third));
    art.appendChild(hub);

    for (const face of placement.faces) {
      const el = doc.createElement('div');
      el.className = 'wg-tp-face';
      el.textContent = face.label;
      el.style.fontSize = `${Math.round(clamp(face.r * 0.7, 14, 28))}px`;
      if (face.color) el.style.setProperty('--c', face.color);
      box(el, rect(face.cx - face.r, face.cy - face.r, face.r * 2, face.r * 2));
      art.appendChild(el);
      register(face.index, el);
    }
    for (const key of placement.keys) {
      const el = doc.createElement('div');
      el.className = `wg-tp-key is-${key.id}${key.id === 'l' || key.id === 'r' ? ' is-shoulder' : ''}`;
      if (key.id === 'pause') el.setAttribute('aria-label', key.label);
      else el.textContent = key.label;
      box(el, key.rect);
      art.appendChild(el);
      if (key.index !== null) register(key.index, el);
    }

    zones = placement.zones.map((r) => {
      const zone = doc.createElement('div');
      zone.className = 'wg-tp-zone';
      box(zone, r);
      zone.addEventListener('pointerdown', onDown);
      zone.addEventListener('pointermove', onMove);
      zone.addEventListener('pointerup', onUp);
      zone.addEventListener('pointercancel', onUp);
      zone.addEventListener('lostpointercapture', onUp);
      root.appendChild(zone);
      return zone;
    });
  };

  const relayout = (): void => {
    if (destroyed) return;
    root.classList.toggle('is-visible', visible());
    if (visible()) {
      const placement = placeTouchPad(layout, viewport(), placeOptions);
      core.place(placement);
      build(placement);
    } else {
      core.place(null);
    }
    paint();
    const area = gameArea();
    for (const listener of [...layoutListeners]) listener(area, core.placement);
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    const due = core.deadline;
    if (due === null) return;
    timer = setTimeout(() => {
      timer = null;
      core.tick();
      paint();
      schedule();
    }, Math.max(0, due - (win.performance?.now() ?? Date.now())));
  };

  function onDown(event: PointerEvent): void {
    event.preventDefault();
    const zone = event.currentTarget as HTMLElement;
    if (core.down(event.pointerId, event.clientX, event.clientY) === null) return;
    try {
      zone.setPointerCapture(event.pointerId);
    } catch {
      /* a synthetic pointer cannot be captured; it still works, minus sliding off the zone */
    }
    paint();
    schedule();
  }
  function onMove(event: PointerEvent): void {
    core.move(event.pointerId, event.clientX, event.clientY);
    paint();
  }
  function onUp(event: PointerEvent): void {
    core.up(event.pointerId);
    paint();
    schedule();
  }

  const releaseAll = (): void => {
    core.releaseAll();
    paint();
  };
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') releaseAll();
  };
  const onAnyPointer = (event: PointerEvent): void => {
    if (mode === 'auto' && event.pointerType === 'touch' && !active) {
      active = true;
      relayout();
    }
  };
  const onAnyKey = (): void => {
    if (mode === 'auto' && active) {
      active = false;
      relayout();
    }
  };
  const onPadConnected = (event: Event): void => {
    if ((event as Event & { gamepad?: unknown }).gamepad !== core.gamepad) onAnyKey();
  };
  let frame = 0;
  const onResize = (): void => {
    if (frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      if (visible()) relayout();
    });
  };
  const preventMenu = (event: Event): void => event.preventDefault();

  core.onChange((wentDown) => {
    if (haptics && wentDown.length) (win.navigator as Navigator & { vibrate?: (ms: number) => boolean }).vibrate?.(8);
  });

  win.addEventListener('blur', releaseAll);
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pointerdown', onAnyPointer, { capture: true, passive: true });
  win.addEventListener('keydown', onAnyKey, { capture: true, passive: true });
  win.addEventListener('gamepadconnected', onPadConnected);
  win.addEventListener('resize', onResize);
  win.addEventListener('orientationchange', onResize);
  root.addEventListener('contextmenu', preventMenu);

  relayout();

  return {
    gamepad: core.gamepad,
    get layout() {
      return layout;
    },
    setLayout(next) {
      layout = resolve(next);
      relayout();
    },
    show() {
      if (shown) return;
      shown = true;
      relayout();
    },
    hide() {
      if (!shown) return;
      shown = false;
      relayout();
    },
    get visible() {
      return visible();
    },
    get placement() {
      return core.placement;
    },
    get gameArea() {
      return gameArea();
    },
    onLayout(listener) {
      layoutListeners.add(listener);
      return () => layoutListeners.delete(listener);
    },
    onPause: (listener) => core.onPause(listener),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      core.place(null);
      if (timer) clearTimeout(timer);
      if (frame) win.cancelAnimationFrame(frame);
      win.removeEventListener('blur', releaseAll);
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('pointerdown', onAnyPointer, { capture: true });
      win.removeEventListener('keydown', onAnyKey, { capture: true });
      win.removeEventListener('gamepadconnected', onPadConnected);
      win.removeEventListener('resize', onResize);
      win.removeEventListener('orientationchange', onResize);
      layoutListeners.clear();
      root.remove();
    },
  };
}

/**
 * The host's one-liner: the pad shows while the game has the controls (the shared
 * input is suspended) and hides while a menu is open, and its pause button opens
 * the menu. Returns the function that undoes it.
 */
export function connectTouchPad(
  pad: Pick<TouchPad, 'show' | 'hide' | 'onPause'>,
  input: Pick<UiInput, 'suspended' | 'onSuspend' | 'trigger'>,
): () => void {
  const follow = (suspended: boolean): void => (suspended ? pad.show() : pad.hide());
  follow(input.suspended);
  const offSuspend = input.onSuspend(follow);
  const offPause = pad.onPause(() => input.trigger('menu', { source: 'touch', repeat: false }));
  return () => {
    offSuspend();
    offPause();
  };
}
