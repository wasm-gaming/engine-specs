// ---- Introspectable property definitions ----

export interface PropertyDefinition<Value = unknown> {
  value: Value;
  default?: Value;
  description?: string;
  live?: boolean; // Absent means `false`. `true` = changing it applies to current play session.
  enum?: readonly Value[];
  allowedTypes?: readonly string[];
  /**
   * The name a player reads. A property with a `label` is a **setting**: the settings
   * screen ({@link settingsModel}) shows it; one without stays internal.
   */
  label?: Localized;
  /** The settings screen's section. Absent: `'game'`. */
  group?: SettingGroup;
  /** The names of the {@link enum} values, in the same order. */
  valueLabels?: readonly Localized[];
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
  /**
   * Silence everything, the menu combo included, until the returned function is
   * called: keys pass through untouched and no action fires. For {@link captureBinding},
   * which needs the very next key or button for itself. Optional on the type (added in
   * 0.6.0); {@link createInput} always has it.
   */
  mute?(): () => void;
  /**
   * More keys for the menus, by `KeyboardEvent.code`: the keys a player bound to the pad
   * buttons the menus use ({@link menuKeyAliases}), so the key bound to the game's A accepts
   * like the pad's A. Heard after the keymap, with the same rules (not while suspended,
   * muted or typing). Replaces the previous set; `{}` clears it. Optional on the type
   * (added in 0.6.2); {@link createInput} always has it.
   */
  setKeyAliases?(aliases: Readonly<Record<string, UiAction>>): void;
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
  let muted = 0;
  let aliases: Readonly<Record<string, UiAction>> = {};
  const held = new Map<UiAction, { since: number; last: number }>();
  // Slots (positions in getGamepads()) whose Y was pressed as part of Select + Y.
  const comboY = new Set<number>();
  // Slots holding Select + Start, last poll: the combo fires on its own edge, so it works
  // whichever of the two buttons goes down first.
  const comboMenu = new Set<number>();

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
    if (destroyed || muted > 0) return;
    const key = event as KeyboardEvent;
    if (suspended) {
      if (!menuKeys.has(key.key) || key.repeat) return;
      key.preventDefault();
      key.stopPropagation();
      fire('menu', { source: 'keyboard', repeat: false });
      return;
    }
    if (isEditable(key.target) && key.key !== 'Escape') return;
    const action = keymap[key.key] ?? (key.code ? aliases[key.code] : undefined);
    if (!action) return;
    if (swallow) {
      key.preventDefault();
      key.stopPropagation();
    }
    fire(action, { source: 'keyboard', repeat: key.repeat === true });
  };

  const pressed = (pad: UiGamepadLike, slot: number): Set<UiAction> => {
    const actions = new Set<UiAction>();
    if (pad.buttons[3]?.pressed !== true) comboY.delete(slot);
    const select = pad.buttons[8]?.pressed === true;
    const start = pad.buttons[9]?.pressed === true;
    if (select && start) actions.add('menu');
    pad.buttons.forEach((button, index) => {
      if (!button.pressed) return;
      if ((index === 8 || index === 9) && select && start) return;
      // Select + Y is the fullscreen combo (createFullscreenToggle): Y stays quiet until
      // it is let go, even if Select is let go first.
      if (index === 3 && (select || comboY.has(slot))) {
        comboY.add(slot);
        return;
      }
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
    let comboEdge = false;
    gamepads().forEach((pad, slot) => {
      const combo = pad?.buttons[8]?.pressed === true && pad.buttons[9]?.pressed === true;
      if (combo && !comboMenu.has(slot)) comboEdge = true;
      if (combo) comboMenu.add(slot);
      else comboMenu.delete(slot);
      if (pad) for (const action of pressed(pad, slot)) active.add(action);
    });

    for (const action of active) {
      const state = held.get(action);
      if (!state) {
        held.set(action, { since: t, last: t });
        // In game only the Select + Start combo gets through (plain Start is the game's).
        const combo = action === 'menu' && gamepads().some((p) => p?.buttons[8]?.pressed && p.buttons[9]?.pressed);
        if (muted > 0) continue;
        if (!suspended || combo) fire(action, { source: 'gamepad', repeat: false });
      } else if (action === 'menu' && comboEdge && suspended && muted === 0) {
        // Start first, then Select: plain Start was already held as `menu` but, in game,
        // not delivered (it is the game's). The combo arriving is the press that counts.
        // Resumed, plain Start has already delivered `menu`: nothing more.
        fire(action, { source: 'gamepad', repeat: false });
      } else if (
        DIRECTIONS.has(action) &&
        t - state.since >= UI_REPEAT.delay &&
        t - state.last >= UI_REPEAT.interval
      ) {
        state.last = t;
        if (!suspended && muted === 0) fire(action, { source: 'gamepad', repeat: true });
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
      if (destroyed || muted > 0) return;
      if (suspended && action !== 'menu') return;
      fire(action, detail);
    },
    poll,
    mute() {
      muted += 1;
      let undone = false;
      return () => {
        if (undone) return;
        undone = true;
        muted -= 1;
      };
    },
    setKeyAliases(next) {
      aliases = { ...next };
    },
    destroy() {
      destroyed = true;
      listeners.clear();
      suspendListeners.clear();
      held.clear();
      comboMenu.clear();
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
  /**
   * The language of the host's UI. The app speaks it; without it, the app calls
   * {@link resolveLocale} (the browser's language, else English).
   */
  locale?: Locale;
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
 * - Neo Geo (FBNeo: "fire N" is joystick button N-1): A=0, B=1, C=2, D=3 — drawn
 *   as the Neo Geo CD pad's diamond (A bottom, B right, C left, D top), which is
 *   where those indices sit on a standard pad.
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
      // The Neo Geo CD pad's diamond: D top, C left, B right, A bottom.
      { label: 'D', index: 3, x: 0.5, y: 0.18, size: 0.32, color: '#3b82f6' },
      { label: 'C', index: 2, x: 0.18, y: 0.5, size: 0.32, color: '#22c55e' },
      { label: 'B', index: 1, x: 0.82, y: 0.5, size: 0.32, color: '#facc15' },
      { label: 'A', index: 0, x: 0.5, y: 0.82, size: 0.32, color: '#ef4444' },
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
/** The d-pad is drawn at this fraction of its slot, centred; the buttons fill theirs. */
const DPAD_SCALE = 0.8;

/** A square of `fraction` of `slot`'s side, centred in it. */
const shrink = (slot: TouchRect, fraction: number): TouchRect => {
  const side = Math.round(slot.width * fraction);
  return rect(slot.x + (slot.width - side) / 2, slot.y + (slot.height - side) / 2, side, side);
};

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
    const dpad = shrink(rect(inner.x + m, middleTop + (middleH - side) / 2, side, side), DPAD_SCALE);
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
  const dpad = shrink(rect(leftX + (sideW - side) / 2, middleTop + (middleH - side) / 2, side, side), DPAD_SCALE);
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
      // Cancelling the touch itself is what stops the browser's click after it.
      zone.addEventListener('touchstart', cancelTouch, { passive: false });
      zone.addEventListener('touchmove', cancelTouch, { passive: false });
      zone.addEventListener('touchend', cancelTouch, { passive: false });
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

  /**
   * Where and when the pad last handled a finger. A touch that opens a menu (the pause
   * button) hides the pad, and the click the browser sends after the lift would land on
   * whatever the menu put under the finger — and pick it. Clicks right there, right
   * then, are the pad's and are dropped.
   */
  let lastTouch = { at: -Infinity, x: 0, y: 0 };
  const now = (): number => win.performance?.now() ?? Date.now();
  const remember = (event: PointerEvent): void => {
    lastTouch = { at: now(), x: event.clientX, y: event.clientY };
  };
  const cancelTouch = (event: Event): void => {
    if (event.cancelable) event.preventDefault();
  };
  const dropGhostClick = (event: MouseEvent): void => {
    if (now() - lastTouch.at > 400) return;
    if (Math.hypot(event.clientX - lastTouch.x, event.clientY - lastTouch.y) > TOUCH_MIN) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  function onDown(event: PointerEvent): void {
    event.preventDefault();
    remember(event);
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
    remember(event);
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
  const onAnyKey = (event?: Event): void => {
    // Only a real keyboard hides the pad: an SDK that drives its engine with synthetic key
    // events (jgenesis reads the keyboard only) must not hide the pad it is listening to.
    if (event?.type === 'keydown' && !event.isTrusted) return;
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
  win.addEventListener('click', dropGhostClick, { capture: true });
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
      win.removeEventListener('click', dropGhostClick, { capture: true });
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

// ============================================================================
// ---- Languages: English and Spanish, English when in doubt ----
// ============================================================================
//
// Every screen of the ecosystem speaks English and Spanish and falls back to English.
// Code and SDK error messages stay English: they are for developers.

/** The languages every screen speaks. */
export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

/** Player-facing text: a plain string is English; an object carries each language. */
export type Localized = string | { readonly en: string; readonly es?: string };

/** The text in `locale`, else in English. */
export function localize(text: Localized, locale: Locale): string {
  if (typeof text === 'string') return text;
  return text[locale] ?? text.en;
}

const isLocale = (value: unknown): value is Locale => (LOCALES as readonly unknown[]).includes(value);

/**
 * The language to speak: `preferred` (the host's) when it is one of {@link LOCALES},
 * else the first of the browser's languages that is (matched on the primary subtag,
 * so `es-419` is `es`), else English.
 */
export function resolveLocale(
  preferred?: string | null,
  languages: readonly string[] = (globalThis.navigator?.languages as readonly string[] | undefined) ?? [],
): Locale {
  for (const tag of [preferred, ...languages]) {
    const primary = tag?.toLowerCase().split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return 'en';
}

/** What engine-specs' own screens say. Apps may reuse these keys. */
export const UI_STRINGS = Object.freeze({
  'settings.title': { en: 'Settings', es: 'Ajustes' },
  'settings.group.video': { en: 'Video', es: 'Vídeo' },
  'settings.group.audio': { en: 'Audio', es: 'Audio' },
  'settings.group.emulation': { en: 'Emulation', es: 'Emulación' },
  'settings.group.game': { en: 'Game', es: 'Juego' },
  'settings.group.controls': { en: 'Controls', es: 'Controles' },
  'settings.yes': { en: 'Yes', es: 'Sí' },
  'settings.no': { en: 'No', es: 'No' },
  'settings.restart': { en: 'Applies on restart', es: 'Se aplica al reiniciar' },
  'settings.reset': { en: 'Reset to defaults', es: 'Restablecer' },
  'settings.resetAsk': { en: 'Put every setting back to its default?', es: '¿Volver a dejar todos los ajustes como venían?' },
  'settings.hints': { en: 'A / ◀ ▶ Change · Y Details · B Back', es: 'A / ◀ ▶ Cambiar · Y Detalles · B Volver' },
  'controls.capture': { en: 'Press a key or a button… (Escape cancels)', es: 'Pulsa una tecla o un botón… (Escape cancela)' },
  'controls.none': { en: '—', es: '—' },
  'fullscreen.toggle': { en: 'Fullscreen', es: 'Pantalla completa' },
  'perf.fps': { en: '{fps} fps', es: '{fps} fps' },
  'perf.frame': { en: '{avg} ms (worst {worst})', es: '{avg} ms (peor {worst})' },
  'perf.dropped': { en: '{dropped} dropped', es: '{dropped} perdidos' },
} satisfies Record<string, { en: string; es: string }>);

export type UiStringKey = keyof typeof UI_STRINGS;

/** One of {@link UI_STRINGS} in `locale`, with `{name}` placeholders filled. */
export function uiText(key: UiStringKey, locale: Locale, params: Record<string, string | number> = {}): string {
  return localize(UI_STRINGS[key], locale).replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

// ============================================================================
// ---- Settings: the player-facing properties, a model, storage and a screen ----
// ============================================================================
//
// A setting is a property with a `label` (see PropertyDefinition). The model turns
// the descriptors an SDK already returns into rows; the screen draws the rows and
// follows UX.md; the app applies a live change and saves (per engine, in OPFS
// `settings/<engineId>.json`, shared by all its games).

/** The settings screen's sections, in the order they are shown. */
export const SETTING_GROUPS = ['video', 'audio', 'emulation', 'game', 'controls'] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

/** What {@link settingsModel} reads of a property: a definition, or a spec (no `value`). */
export type SettingDescriptor = Omit<PropertyDefinition<unknown>, 'value'> & { value?: unknown };

/** One row of the settings screen. */
export interface SettingRow {
  key: string;
  label: string;
  group: SettingGroup;
  value: unknown;
  valueLabel: string;
  /** The values it steps through: the `enum`, or `[false, true]`. */
  choices: readonly unknown[];
  choiceLabels: readonly string[];
  /** True when the change applies to the current session; else "applies on restart". */
  live: boolean;
  description?: string;
}

export interface SettingsSection {
  group: SettingGroup;
  title: string;
  rows: SettingRow[];
}

const settingChoices = (descriptor: SettingDescriptor): readonly unknown[] | undefined => {
  if (descriptor.enum && descriptor.enum.length > 0) return descriptor.enum;
  const sample = descriptor.value ?? descriptor.default;
  return typeof sample === 'boolean' ? [false, true] : undefined;
};

const choiceLabel = (descriptor: SettingDescriptor, value: unknown, index: number, locale: Locale): string => {
  const named = descriptor.valueLabels?.[index];
  if (named !== undefined) return localize(named, locale);
  if (typeof value === 'boolean') return uiText(value ? 'settings.yes' : 'settings.no', locale);
  return String(value);
};

/**
 * The settings screen's content: every property with a `label` and something to step
 * through (an `enum`, or a boolean), grouped in {@link SETTING_GROUPS} order. The
 * current value is the saved one, else the descriptor's `value`, else its `default`.
 * Properties without a `label`, or that cannot be stepped, are left out.
 */
export function settingsModel(
  described: Readonly<Record<string, SettingDescriptor>>,
  saved: Readonly<Record<string, unknown>> = {},
  locale: Locale = 'en',
): SettingsSection[] {
  const sections = new Map<SettingGroup, SettingRow[]>();
  for (const [key, descriptor] of Object.entries(described)) {
    if (descriptor.label === undefined) continue;
    const choices = settingChoices(descriptor);
    if (!choices) continue;
    const group = descriptor.group ?? 'game';
    const current = key in saved ? saved[key] : (descriptor.value ?? descriptor.default ?? choices[0]);
    const choiceLabels = choices.map((choice, index) => choiceLabel(descriptor, choice, index, locale));
    const at = choices.indexOf(current);
    const row: SettingRow = {
      key,
      label: localize(descriptor.label, locale),
      group,
      value: current,
      valueLabel: choiceLabels[at] ?? String(current),
      choices,
      choiceLabels,
      live: descriptor.live === true,
      ...(descriptor.description ? { description: descriptor.description } : {}),
    };
    sections.set(group, [...(sections.get(group) ?? []), row]);
  }
  return SETTING_GROUPS.filter((group) => sections.has(group)).map((group) => ({
    group,
    title: uiText(`settings.group.${group}`, locale),
    rows: sections.get(group)!,
  }));
}

/**
 * The value a step takes a row to: `+1` forward, `-1` back. Enums and booleans wrap
 * around; an enum of numbers (a volume) stops at its ends.
 */
export function stepSetting(row: Pick<SettingRow, 'value' | 'choices'>, direction: 1 | -1): unknown {
  const { choices } = row;
  if (choices.length === 0) return row.value;
  const at = choices.indexOf(row.value);
  if (at === -1) return choices[0];
  const numeric = choices.every((choice) => typeof choice === 'number');
  const next = at + direction;
  if (numeric) return choices[Math.min(choices.length - 1, Math.max(0, next))];
  return choices[(next + choices.length) % choices.length];
}

/** A row with another value, its label updated. */
export function withSettingValue(row: SettingRow, value: unknown): SettingRow {
  const at = row.choices.indexOf(value);
  return { ...row, value, valueLabel: row.choiceLabels[at] ?? String(value) };
}

/** The defaults of every setting (the properties with a `label` and a `default`), for "Reset". */
export function settingsDefaults(described: Readonly<Record<string, SettingDescriptor>>): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(described)) {
    if (descriptor.label !== undefined && descriptor.default !== undefined) defaults[key] = descriptor.default;
  }
  return defaults;
}

/**
 * The settings engine-specs itself provides, for an app to merge into what it shows:
 * the screen Wake Lock ({@link createWakeLock}) and the counter ({@link createPerfCounter}).
 */
export const SHARED_SETTINGS = Object.freeze({
  keepScreenOn: {
    default: true,
    live: true,
    group: 'video',
    label: { en: 'Keep the screen on', es: 'Mantener la pantalla encendida' },
    description: 'Holds a screen Wake Lock while the game runs, released when it is paused or hidden.',
  },
  showPerformance: {
    default: false,
    live: true,
    group: 'video',
    label: { en: 'Show performance', es: 'Mostrar rendimiento' },
    description: 'An overlay with frames per second, frame time and dropped frames.',
  },
} satisfies Record<string, SettingDescriptor>);

/** For an engine whose frame loop the app drives: what paces it ({@link createFrameClock}). */
export const FRAME_SYNC_SETTING = Object.freeze({
  frameSync: {
    default: 'display',
    enum: ['display', 'audio'],
    valueLabels: [
      { en: 'Display', es: 'Pantalla' },
      { en: 'Audio', es: 'Audio' },
    ],
    live: true,
    group: 'emulation',
    label: { en: 'Sync', es: 'Sincronización' },
    description: 'What paces the frames: the display refresh, or the audio clock (steady on 120 Hz screens).',
  },
} satisfies Record<string, SettingDescriptor>);

/** What `settings/<engineId>.json` holds. */
export interface SavedSettings {
  version: 1;
  values: Record<string, unknown>;
  controls: ControlBindings;
}

const emptySettings = (): SavedSettings => ({ version: 1, values: {}, controls: {} });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A settings file's text, read leniently: missing or broken reads as "nothing saved". */
export function parseSettings(text: string | null | undefined): SavedSettings {
  if (!text) return emptySettings();
  try {
    const data: unknown = JSON.parse(text);
    if (!isRecord(data)) return emptySettings();
    const controls: ControlBindings = {};
    if (isRecord(data.controls)) {
      for (const [id, binding] of Object.entries(data.controls)) {
        if (!isRecord(binding)) continue;
        controls[id] = {
          ...(typeof binding.key === 'string' ? { key: binding.key } : {}),
          ...(typeof binding.code === 'string' ? { code: binding.code } : {}),
          ...(Number.isInteger(binding.button) ? { button: binding.button as number } : {}),
        };
      }
    }
    return { version: 1, values: isRecord(data.values) ? { ...data.values } : {}, controls };
  } catch {
    return emptySettings();
  }
}

/** The parts of an OPFS directory handle the storage uses (so tests can fake it). */
export interface SettingsDirectory {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<SettingsDirectory>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<{
    getFile(): Promise<{ text(): Promise<string> }>;
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  }>;
}

const ENGINE_ID = /^[a-z0-9][a-z0-9._-]*$/i;

const settingsRoot = async (root?: SettingsDirectory): Promise<SettingsDirectory> => {
  if (root) return root;
  const storage = globalThis.navigator?.storage as { getDirectory?: () => Promise<unknown> } | undefined;
  if (!storage?.getDirectory) throw new Error('OPFS is not available');
  return (await storage.getDirectory()) as SettingsDirectory;
};

/** The player's settings for an engine (OPFS `settings/<engineId>.json`). Never throws. */
export async function loadSettings(engineId: string, root?: SettingsDirectory): Promise<SavedSettings> {
  if (!ENGINE_ID.test(engineId)) throw new Error(`Invalid engine id: ${engineId}`);
  try {
    const dir = await (await settingsRoot(root)).getDirectoryHandle('settings');
    const file = await (await dir.getFileHandle(`${engineId}.json`)).getFile();
    return parseSettings(await file.text());
  } catch {
    return emptySettings();
  }
}

/** Writes the player's settings for an engine. */
export async function saveSettings(engineId: string, settings: SavedSettings, root?: SettingsDirectory): Promise<void> {
  if (!ENGINE_ID.test(engineId)) throw new Error(`Invalid engine id: ${engineId}`);
  const dir = await (await settingsRoot(root)).getDirectoryHandle('settings', { create: true });
  const writable = await (await dir.getFileHandle(`${engineId}.json`, { create: true })).createWritable();
  await writable.write(JSON.stringify({ version: 1, values: settings.values, controls: settings.controls }, null, 2));
  await writable.close();
}

// ---- Controls: remapping the engine's buttons ----

/** A button of the engine, as its app lists it. */
export interface ControlButton {
  id: string;
  label: Localized;
}

/**
 * What presses a button: a key and / or a gamepad button (standard mapping). A key is
 * `KeyboardEvent.code` (the physical key, whatever the layout: what emulators bind) and
 * / or `KeyboardEvent.key` (the character); a captured one carries both.
 */
export interface ControlBinding {
  key?: string;
  code?: string;
  button?: number;
}

export type ControlBindings = Record<string, ControlBinding>;

/** The standard-mapping gamepad buttons by index, as UX.md names them. */
export const PAD_BUTTON_NAMES: readonly string[] = Object.freeze([
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start', 'L3', 'R3', '↑', '↓', '←', '→', 'Home',
]);

const KEY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
});

const CODE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  ShiftLeft: 'Shift (L)',
  ShiftRight: 'Shift (R)',
  ControlLeft: 'Ctrl (L)',
  ControlRight: 'Ctrl (R)',
  AltLeft: 'Alt (L)',
  AltRight: 'Alt (R)',
  MetaLeft: 'Meta (L)',
  MetaRight: 'Meta (R)',
});

/** How a physical key (`KeyboardEvent.code`) is written on screen: `KeyX` → `X`. */
export function codeLabel(code: string | undefined): string {
  if (code === undefined) return '';
  const named = CODE_NAMES[code];
  if (named !== undefined) return named;
  const match = /^(?:Key|Digit)(.)$/.exec(code);
  if (match?.[1]) return match[1];
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/** The `key` a physical key types on a US layout, as far as the menus' keymap needs it. */
function keyOfCode(code: string): string | undefined {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter) return letter.toLowerCase();
  const digit = /^Digit(\d)$/.exec(code)?.[1];
  if (digit) return digit;
  if (code === 'Space') return ' ';
  if (code === 'NumpadEnter') return 'Enter';
  return code; // Enter, Escape, Backspace, Tab, ArrowUp…, F1… are their own key
}

/**
 * The keys a player bound to the pad buttons the menus use, for
 * {@link UiInput.setKeyAliases}: a pause menu's hints say "A" and "B", and the key bound to
 * the game's A should then accept like the pad's A.
 *
 * `controls` are the game's buttons, each with its current key (`code`) and the pad button
 * the menus read it as (`button`): the engine's default layout, which is what an engine
 * that remaps the pad shows the menus. A key the menus already use (`keymap`: Enter, Space,
 * Escape, Q, E, V, the arrows…) keeps its meaning and is left out.
 */
export function menuKeyAliases(
  controls: Iterable<{ code?: string; button?: number }>,
  options: { keymap?: Readonly<Record<string, UiAction>>; padmap?: Readonly<Record<number, UiAction>> } = {},
): Record<string, UiAction> {
  const keymap = options.keymap ?? UI_KEYMAP;
  const padmap = options.padmap ?? UI_PADMAP;
  const out: Record<string, UiAction> = {};
  for (const { code, button } of controls) {
    if (!code || button === undefined) continue;
    const action = padmap[button];
    if (!action) continue;
    const key = keyOfCode(code);
    if (key !== undefined && (keymap[key] !== undefined || keymap[key.toUpperCase()] !== undefined)) continue;
    out[code] = action;
  }
  return out;
}

/**
 * The key a hint shows next to a pad button ("B · S"): the key bound to the game button the
 * menus read as `button` (see {@link menuKeyAliases}), when it works in the menus; `''` if none.
 */
export function menuKeyHint(
  controls: Iterable<{ code?: string; button?: number }>,
  button: number,
  options: { keymap?: Readonly<Record<string, UiAction>>; padmap?: Readonly<Record<number, UiAction>> } = {},
): string {
  const list = [...controls];
  const aliases = menuKeyAliases(list, options);
  const found = list.find((control) => control.button === button && control.code && aliases[control.code]);
  return found?.code ? codeLabel(found.code) : '';
}

/** How a binding's key is written: by its `code` when it has one, else by its `key`. */
export function bindingKeyLabel(binding: ControlBinding): string {
  return binding.code !== undefined ? codeLabel(binding.code) : keyLabel(binding.key);
}

/** How a key is written on screen. */
export function keyLabel(key: string | undefined): string {
  if (key === undefined) return '';
  const named = KEY_NAMES[key];
  if (named !== undefined) return named;
  return key.length === 1 ? key.toUpperCase() : key;
}

/** A row of the "Controls" group. */
export interface ControlRow {
  id: string;
  label: string;
  binding: ControlBinding;
  keyLabel: string;
  buttonLabel: string;
}

/** The controls rows: each button with its binding (saved, else default). */
export function controlsModel(
  buttons: readonly ControlButton[],
  defaults: Readonly<ControlBindings>,
  saved: Readonly<ControlBindings> = {},
  locale: Locale = 'en',
): ControlRow[] {
  const none = uiText('controls.none', locale);
  return buttons.map(({ id, label }) => {
    const binding = { ...(defaults[id] ?? {}), ...(saved[id] ?? {}) };
    return {
      id,
      label: localize(label, locale),
      binding,
      keyLabel: bindingKeyLabel(binding) || none,
      buttonLabel: binding.button === undefined ? none : (PAD_BUTTON_NAMES[binding.button] ?? `#${binding.button}`),
    };
  });
}

/**
 * The bindings with `id` given a new key and / or button. Another button that had it
 * gets `id`'s old one in exchange, so no two buttons ever share a key or a button.
 * Keys are the same key when their `code`s match (or, without codes, their `key`s);
 * `key` and `code` move together.
 */
export function bindControl(bindings: Readonly<ControlBindings>, id: string, change: ControlBinding): ControlBindings {
  const next: ControlBindings = {};
  for (const [other, binding] of Object.entries(bindings)) next[other] = { ...binding };
  const mine = (next[id] ??= {});
  const keyOf = (binding: ControlBinding): { key?: string; code?: string } => ({
    ...(binding.key !== undefined ? { key: binding.key } : {}),
    ...(binding.code !== undefined ? { code: binding.code } : {}),
  });
  const sameKey = (a: ControlBinding, b: ControlBinding): boolean =>
    a.code !== undefined && b.code !== undefined ? a.code === b.code : a.key !== undefined && a.key === b.key;
  const setKey = (binding: ControlBinding, value: { key?: string; code?: string }): void => {
    delete binding.key;
    delete binding.code;
    Object.assign(binding, value);
  };

  if (change.key !== undefined || change.code !== undefined) {
    const old = keyOf(mine);
    const value = keyOf(change);
    for (const [other, binding] of Object.entries(next)) {
      if (other !== id && sameKey(binding, value)) setKey(binding, old);
    }
    setKey(mine, value);
  }
  if (change.button !== undefined) {
    const old = mine.button;
    for (const [other, binding] of Object.entries(next)) {
      if (other === id || binding.button !== change.button) continue;
      if (old === undefined) delete binding.button;
      else binding.button = old;
    }
    mine.button = change.button;
  }
  return next;
}

export interface CaptureOptions {
  /** Where keys are heard. Default: the window. */
  target?: EventTarget;
  gamepads?: () => ReadonlyArray<UiGamepadLike | null>;
  schedule?: ((poll: () => void) => unknown) | null;
  signal?: AbortSignal;
}

/**
 * The next key or gamepad button pressed, for a binding. Escape cancels (resolves
 * `undefined`), as does `signal`. Buttons held when it starts are ignored until let
 * go. The shared `input` is muted meanwhile ({@link UiInput.mute}), so the press
 * neither moves a menu nor opens one.
 */
export function captureBinding(input?: Pick<UiInput, 'mute'>, options: CaptureOptions = {}): Promise<ControlBinding | undefined> {
  const target = options.target ?? (globalThis as unknown as EventTarget);
  const gamepads =
    options.gamepads ??
    (() => (globalThis.navigator?.getGamepads?.() ?? []) as ReadonlyArray<UiGamepadLike | null>);
  const schedule =
    options.schedule === undefined ? (globalThis.requestAnimationFrame?.bind(globalThis) ?? null) : options.schedule;
  const unmute = input?.mute?.() ?? (() => undefined);

  return new Promise((resolve) => {
    let done = false;
    const ignored = new Set<number>();
    for (const pad of gamepads()) pad?.buttons.forEach((button, index) => button.pressed && ignored.add(index));

    const finish = (binding: ControlBinding | undefined): void => {
      if (done) return;
      done = true;
      target.removeEventListener('keydown', onKey, { capture: true });
      options.signal?.removeEventListener('abort', onAbort);
      unmute();
      resolve(binding);
    };
    const onKey = (event: Event): void => {
      const key = event as KeyboardEvent;
      key.preventDefault();
      key.stopPropagation();
      if (key.repeat) return;
      finish(key.key === 'Escape' ? undefined : { key: key.key, ...(key.code ? { code: key.code } : {}) });
    };
    const onAbort = (): void => finish(undefined);
    const poll = (): void => {
      if (done) return;
      const down = new Set<number>();
      for (const pad of gamepads()) pad?.buttons.forEach((button, index) => button.pressed && down.add(index));
      for (const index of [...ignored]) if (!down.has(index)) ignored.delete(index);
      const fresh = [...down].find((index) => !ignored.has(index));
      if (fresh !== undefined) return finish({ button: fresh });
      schedule?.(poll);
    };

    if (options.signal?.aborted) return finish(undefined);
    options.signal?.addEventListener('abort', onAbort);
    target.addEventListener('keydown', onKey, { capture: true });
    schedule?.(poll);
  });
}

// ---- The screen ----

export interface SettingsScreenOptions {
  sections: SettingsSection[];
  /** The "Controls" group, when the engine's buttons can be remapped. */
  controls?: ControlRow[];
  /** The shared input; the screen listens while it is open (the input is not suspended in a menu). */
  input: UiInput;
  locale?: Locale;
  /** A setting changed: apply it when `row.live`, and save either way. */
  onChange(key: string, value: unknown, row: SettingRow): void;
  /**
   * A button was given a new binding. `bindings` is every button's, after the swap with
   * any other that had it: the thing to save.
   */
  onControl?(id: string, binding: ControlBinding, bindings: ControlBindings): void;
  /** "Reset" was confirmed: put the defaults back and save; then call `update()`. */
  onReset(): void;
  /** `back` at the top level. */
  onClose(): void;
  /** How a binding is captured. Default: {@link captureBinding}. */
  capture?: (input: UiInput) => Promise<ControlBinding | undefined>;
}

export interface SettingsScreen {
  readonly element: HTMLElement;
  /** Repaint with new rows (after a reset, or a value changed elsewhere), keeping the focus. */
  update(sections: SettingsSection[], controls?: ControlRow[]): void;
  destroy(): void;
}

const SETTINGS_STYLE_ID = 'wg-settings-style';
const SETTINGS_CSS = `
.wg-settings { box-sizing: border-box; width: min(560px, 100%); max-height: 100%; overflow-y: auto;
  display: grid; gap: var(--wg-gap, 16px); padding: 20px; color: var(--wg-text, #f4f6fb);
  background: var(--wg-surface, rgb(18 20 28 / 0.92)); border: 1px solid var(--wg-line, rgb(255 255 255 / 0.12));
  border-radius: var(--wg-radius, 22px); font: 16px/1.4 var(--wg-font-ui, system-ui, sans-serif); }
.wg-settings * { box-sizing: border-box; }
.wg-settings h2 { margin: 0; font: 600 22px/1.2 var(--wg-font-display, system-ui, sans-serif); }
.wg-settings h3 { margin: 4px 0 0; color: var(--wg-muted, #8e97a9); font-size: 13px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase; }
.wg-settings-list { display: grid; gap: 6px; }
.wg-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;
  min-height: 48px; padding: 8px 14px; border: 1px solid transparent; border-radius: var(--wg-radius-small, 12px);
  background: rgb(255 255 255 / 0.05); color: inherit; font: inherit; text-align: left; cursor: pointer;
  transition: transform 120ms var(--wg-ease, ease), box-shadow 120ms var(--wg-ease, ease); }
.wg-settings-row:focus { outline: none; }
.wg-settings-row.is-focused { box-shadow: var(--wg-focus-ring, 0 0 0 3px #fff); transform: scale(1.01); }
.wg-settings-label { display: grid; gap: 2px; min-width: 0; }
.wg-settings-note, .wg-settings-desc { color: var(--wg-muted, #8e97a9); font-size: 13px; }
.wg-settings-value { flex: none; font-weight: 600; }
.wg-settings-value::before { content: '◀ '; opacity: 0.5; }
.wg-settings-value::after { content: ' ▶'; opacity: 0.5; }
.wg-settings-binding { flex: none; display: flex; gap: 8px; font-weight: 600; }
.wg-settings-binding span { min-width: 2.5em; padding: 2px 8px; border-radius: 8px; background: rgb(255 255 255 / 0.08); text-align: center; }
.wg-settings-reset { color: var(--wg-danger, #f87171); }
.wg-settings-ask { display: grid; gap: 10px; padding: 12px 14px; border-radius: var(--wg-radius-small, 12px); background: rgb(255 255 255 / 0.05); }
.wg-settings-ask div { display: flex; gap: 8px; }
.wg-settings-ask .wg-settings-row { justify-content: center; }
.wg-settings-capture { padding: 10px 14px; border-radius: var(--wg-radius-small, 12px); background: rgb(255 255 255 / 0.08); }
.wg-settings-hints { margin: 0; color: var(--wg-muted, #8e97a9); font-size: 13px; }
`;

type FocusTarget =
  | { kind: 'setting'; row: SettingRow; el: HTMLElement }
  | { kind: 'control'; row: ControlRow; el: HTMLElement }
  | { kind: 'reset' | 'yes' | 'no'; el: HTMLElement };

/**
 * The settings screen, following UX.md: one row always focused; `up` / `down` move;
 * `left` / `right` / `accept` change a value (`accept` on a control row waits for the
 * new key or button); `more` shows a row's description; `back` closes. A last row
 * resets to the defaults after asking (No first). A tap on a row acts as `accept`.
 *
 * It changes nothing but its own rows: the app applies, saves and, after a reset,
 * calls `update()`.
 */
export function createSettingsScreen(target: HTMLElement, options: SettingsScreenOptions): SettingsScreen {
  const doc = target.ownerDocument;
  const locale = options.locale ?? 'en';
  const capture = options.capture ?? ((input: UiInput) => captureBinding(input));
  if (!doc.getElementById(SETTINGS_STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = SETTINGS_STYLE_ID;
    style.textContent = SETTINGS_CSS;
    doc.head.appendChild(style);
  }

  const root = doc.createElement('section');
  root.className = 'wg-settings';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', uiText('settings.title', locale));
  target.appendChild(root);

  let sections = options.sections;
  let controls = options.controls ?? [];
  let focusAt = 0;
  let asking = false;
  let capturing = false;
  let details = false;
  let destroyed = false;
  let targets: FocusTarget[] = [];

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const render = (): void => {
    const focused = targets[focusAt];
    const focusKey = focused ? (focused.kind === 'setting' || focused.kind === 'control' ? focused.row.label : focused.kind) : undefined;
    root.replaceChildren();
    targets = [];
    root.append(el('h2', undefined, uiText('settings.title', locale)));

    const rowButton = (onClick: () => void): HTMLButtonElement => {
      const button = el('button', 'wg-settings-row');
      button.type = 'button';
      button.tabIndex = -1;
      button.addEventListener('click', () => {
        if (capturing) return;
        focusAt = targets.findIndex((t) => t.el === button);
        onClick();
      });
      return button;
    };

    for (const section of sections) {
      root.append(el('h3', undefined, section.title));
      const list = el('div', 'wg-settings-list');
      for (const row of section.rows) {
        const button = rowButton(() => change(1));
        const label = el('span', 'wg-settings-label');
        label.append(el('span', undefined, row.label));
        if (!row.live) label.append(el('span', 'wg-settings-note', uiText('settings.restart', locale)));
        button.append(label, el('span', 'wg-settings-value', row.valueLabel));
        button.setAttribute('aria-label', `${row.label}: ${row.valueLabel}`);
        list.append(button);
        targets.push({ kind: 'setting', row, el: button });
        if (details && focusKey === row.label && row.description) list.append(el('p', 'wg-settings-desc', row.description));
      }
      root.append(list);
    }

    if (controls.length > 0) {
      root.append(el('h3', undefined, uiText('settings.group.controls', locale)));
      const list = el('div', 'wg-settings-list');
      for (const row of controls) {
        const button = rowButton(() => void rebind(row));
        const binding = el('span', 'wg-settings-binding');
        binding.append(el('span', undefined, row.keyLabel), el('span', undefined, row.buttonLabel));
        button.append(el('span', 'wg-settings-label', row.label), binding);
        list.append(button);
        targets.push({ kind: 'control', row, el: button });
        if (capturing && focusKey === row.label) list.append(el('p', 'wg-settings-capture', uiText('controls.capture', locale)));
      }
      root.append(list);
    }

    const reset = rowButton(() => ask());
    reset.classList.add('wg-settings-reset');
    reset.textContent = uiText('settings.reset', locale);
    root.append(reset);
    targets.push({ kind: 'reset', el: reset });

    if (asking) {
      const box = el('div', 'wg-settings-ask');
      box.append(el('span', undefined, uiText('settings.resetAsk', locale)));
      const buttons = el('div');
      const no = rowButton(() => answer(false));
      no.textContent = uiText('settings.no', locale);
      const yes = rowButton(() => answer(true));
      yes.textContent = uiText('settings.yes', locale);
      buttons.append(no, yes);
      box.append(buttons);
      root.append(box);
      targets.push({ kind: 'no', el: no }, { kind: 'yes', el: yes });
    }

    root.append(el('p', 'wg-settings-hints', uiText('settings.hints', locale)));

    // Keep the focus on the same row across a repaint.
    if (focusKey !== undefined) {
      const again = targets.findIndex((t) =>
        t.kind === 'setting' || t.kind === 'control' ? t.row.label === focusKey : t.kind === focusKey,
      );
      if (again !== -1) focusAt = again;
    }
    focusAt = Math.min(Math.max(0, focusAt), targets.length - 1);
    paintFocus();
  };

  const paintFocus = (): void => {
    targets.forEach((t, index) => t.el.classList.toggle('is-focused', index === focusAt));
    const current = targets[focusAt]?.el;
    current?.focus({ preventScroll: true });
    current?.scrollIntoView?.({ block: 'nearest' });
  };

  const change = (direction: 1 | -1): void => {
    const current = targets[focusAt];
    if (current?.kind !== 'setting') return;
    const value = stepSetting(current.row, direction);
    if (value === current.row.value) return;
    const row = withSettingValue(current.row, value);
    sections = sections.map((section) => ({ ...section, rows: section.rows.map((r) => (r.key === row.key ? row : r)) }));
    render();
    options.onChange(row.key, value, row);
  };

  const rebind = async (row: ControlRow): Promise<void> => {
    if (capturing) return;
    capturing = true;
    render();
    const binding = await capture(options.input);
    capturing = false;
    if (destroyed) return;
    if (binding) {
      const bindings: ControlBindings = Object.fromEntries(controls.map((c) => [c.id, c.binding]));
      const next = bindControl(bindings, row.id, binding);
      controls = controls.map((c) => {
        const b = next[c.id] ?? {};
        const none = uiText('controls.none', locale);
        return {
          ...c,
          binding: b,
          keyLabel: bindingKeyLabel(b) || none,
          buttonLabel: b.button === undefined ? none : (PAD_BUTTON_NAMES[b.button] ?? `#${b.button}`),
        };
      });
      options.onControl?.(row.id, next[row.id] ?? {}, next);
    }
    render();
  };

  const ask = (): void => {
    asking = true;
    render();
    focusAt = targets.findIndex((t) => t.kind === 'no');
    paintFocus();
  };

  const answer = (yes: boolean): void => {
    asking = false;
    render();
    focusAt = targets.findIndex((t) => t.kind === 'reset');
    paintFocus();
    if (yes) options.onReset();
  };

  const move = (direction: 1 | -1): void => {
    const next = focusAt + direction;
    if (asking) {
      const kinds = targets[next]?.kind;
      if (kinds === 'yes' || kinds === 'no') focusAt = next;
    } else if (targets[next] && targets[next].kind !== 'yes' && targets[next].kind !== 'no') {
      focusAt = next;
      if (details) {
        details = false;
        render();
        return;
      }
    }
    paintFocus();
  };

  const off = options.input.on((action) => {
    if (destroyed || capturing) return;
    const current = targets[focusAt];
    switch (action) {
      case 'up':
        return move(-1);
      case 'down':
        return move(1);
      case 'left':
      case 'right':
        if (asking) return move(action === 'left' ? -1 : 1);
        return change(action === 'left' ? -1 : 1);
      case 'accept':
        return current?.el.click();
      case 'more':
        if (current?.kind === 'setting' && current.row.description) {
          details = !details;
          render();
        }
        return;
      case 'back':
        if (asking) return answer(false);
        if (details) {
          details = false;
          return render();
        }
        return options.onClose();
      default:
        return;
    }
  });

  render();

  return {
    element: root,
    update(nextSections, nextControls) {
      sections = nextSections;
      if (nextControls) controls = nextControls;
      render();
    },
    destroy() {
      destroyed = true;
      off();
      root.remove();
    },
  };
}

// ============================================================================
// ---- Fullscreen: Cmd+Enter (macOS) / Alt+Enter, and Select + Y ----
// ============================================================================

export type Platform = 'mac' | 'other';

/** macOS (and iPadOS) or anything else, from the user agent's platform. */
export function platformOf(nav: { userAgentData?: { platform?: string }; platform?: string } | undefined = globalThis.navigator as never): Platform {
  const name = nav?.userAgentData?.platform || nav?.platform || '';
  return /mac|iphone|ipad|ipod/i.test(name) ? 'mac' : 'other';
}

/** A key with its modifiers. */
export interface KeyShortcut {
  key: string;
  alt?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
}

/** The fullscreen key: Cmd+Enter on macOS, Alt+Enter elsewhere (the owner's choice). */
export function fullscreenShortcut(platform: Platform = platformOf()): KeyShortcut {
  return platform === 'mac' ? { key: 'Enter', meta: true } : { key: 'Enter', alt: true };
}

/** Select + Y (standard mapping 8 + 3). Select + Start stays the menu. */
export const FULLSCREEN_PAD_COMBO: readonly number[] = Object.freeze([8, 3]);

/** Whether a keydown is `shortcut` (exact modifiers; never inside a text field). */
export function isShortcut(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey'> & { target?: EventTarget | null },
  shortcut: KeyShortcut,
): boolean {
  if (isEditable(event.target ?? null)) return false;
  return (
    event.key === shortcut.key &&
    event.altKey === Boolean(shortcut.alt) &&
    event.metaKey === Boolean(shortcut.meta) &&
    event.ctrlKey === Boolean(shortcut.ctrl) &&
    event.shiftKey === Boolean(shortcut.shift)
  );
}

export interface FullscreenToggleOptions {
  /** Where keys are heard (capture phase, ahead of the engine). Default: the window. */
  target?: EventTarget;
  shortcut?: KeyShortcut;
  /** Gamepad buttons pressed together. Default {@link FULLSCREEN_PAD_COMBO}. */
  combo?: readonly number[];
  gamepads?: () => ReadonlyArray<UiGamepadLike | null>;
  schedule?: ((poll: () => void) => unknown) | null;
  /**
   * The Keyboard Lock API (`navigator.keyboard`, Chromium). While fullscreen, Escape is locked
   * so it reaches the page (the pause menu) and the player leaves by holding it. `null` turns it
   * off. Default: `navigator.keyboard` when there is one.
   */
  keyboard?: KeyboardLockLike | null;
  /**
   * When fullscreen ends without this toggle asking (the browser took Escape, where Escape
   * could not be locked), dispatch that Escape `keydown` on {@link target}, so
   * {@link createInput} hears it: `menu` in game, `back` in a menu. Default `true`.
   */
  giveBackEscape?: boolean;
}

/** The parts of the Keyboard Lock API used (so tests can fake it). */
export interface KeyboardLockLike {
  lock(keyCodes?: string[]): Promise<void>;
  unlock(): void;
}

export interface FullscreenToggle {
  /** Enter or leave fullscreen on the root (also the pause-menu entry). */
  toggle(): Promise<void>;
  readonly active: boolean;
  /** Hear every change; returns the unsubscribe function. */
  onChange(listener: (active: boolean) => void): () => void;
  /** Read the gamepads once (called every frame by the default scheduler). */
  poll(): void;
  destroy(): void;
}

/**
 * The fullscreen toggle of an engine app: {@link fullscreenShortcut} on the keyboard
 * and {@link FULLSCREEN_PAD_COMBO} on any gamepad, in game and in menus. Browsers
 * allow fullscreen only from a user gesture; a pad press counts in Chromium but not
 * everywhere, which is why the pause menu has the entry too.
 */
export function createFullscreenToggle(root: Element, options: FullscreenToggleOptions = {}): FullscreenToggle {
  const doc = root.ownerDocument;
  const target = options.target ?? (globalThis as unknown as EventTarget);
  const shortcut = options.shortcut ?? fullscreenShortcut();
  const combo = options.combo ?? FULLSCREEN_PAD_COMBO;
  const gamepads =
    options.gamepads ??
    (() => (globalThis.navigator?.getGamepads?.() ?? []) as ReadonlyArray<UiGamepadLike | null>);
  const schedule =
    options.schedule === undefined ? (globalThis.requestAnimationFrame?.bind(globalThis) ?? null) : options.schedule;
  const keyboard =
    options.keyboard === undefined
      ? ((globalThis.navigator as { keyboard?: KeyboardLockLike } | undefined)?.keyboard ?? null)
      : options.keyboard;
  const giveBackEscape = options.giveBackEscape ?? true;
  const listeners = new Set<(active: boolean) => void>();
  let destroyed = false;
  let polling = false;
  let held = false;
  let leaving = false; // this toggle asked to leave
  let locked = false; // Escape is locked (it reaches the page)
  let wasActive = false;

  const active = (): boolean => doc.fullscreenElement === root;
  const toggle = async (): Promise<void> => {
    try {
      if (active()) {
        leaving = true;
        await doc.exitFullscreen();
      } else await root.requestFullscreen();
    } catch {
      // Refused (no user gesture, or not allowed): nothing changes.
      leaving = false;
    }
  };
  /** The Escape the browser kept, back to the page: what the player pressed. */
  const escapeEvent = (): Event => {
    const init = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true };
    if (typeof KeyboardEvent === 'function') return new KeyboardEvent('keydown', init);
    return Object.assign(new Event('keydown', init), { key: 'Escape', code: 'Escape', repeat: false });
  };
  const entered = (): void => {
    if (!keyboard) return;
    keyboard.lock(['Escape']).then(
      () => {
        // Still fullscreen? (it may have ended while the lock was being granted)
        if (active() && !destroyed) locked = true;
        else keyboard.unlock();
      },
      () => {
        locked = false; // refused: the browser keeps Escape, it is given back on leaving
      },
    );
  };
  const left = (): void => {
    const byUs = leaving;
    const hadLock = locked;
    leaving = false;
    locked = false;
    if (keyboard && hadLock) keyboard.unlock();
    if (!byUs && !hadLock && giveBackEscape && !destroyed) target.dispatchEvent(escapeEvent());
  };
  const onKey = (event: Event): void => {
    const key = event as KeyboardEvent;
    if (destroyed || key.repeat || !isShortcut(key, shortcut)) return;
    key.preventDefault();
    key.stopPropagation();
    void toggle();
  };
  const onChange = (): void => {
    const now = active();
    if (now && !wasActive) entered();
    else if (!now && wasActive) left();
    wasActive = now;
    for (const listener of [...listeners]) listener(now);
  };
  const poll = (): void => {
    if (destroyed) return;
    const down = gamepads().some((pad) => pad && combo.every((index) => pad.buttons[index]?.pressed));
    if (down && !held) void toggle();
    held = down;
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

  target.addEventListener('keydown', onKey, { capture: true });
  target.addEventListener('gamepadconnected', startPolling);
  doc.addEventListener('fullscreenchange', onChange);
  if (gamepads().some(Boolean)) startPolling();

  return {
    toggle,
    get active() {
      return active();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    poll,
    destroy() {
      destroyed = true;
      listeners.clear();
      if (locked) keyboard?.unlock();
      locked = false;
      target.removeEventListener('keydown', onKey, { capture: true });
      target.removeEventListener('gamepadconnected', startPolling);
      doc.removeEventListener('fullscreenchange', onChange);
    },
  };
}

// ============================================================================
// ---- Performance: Wake Lock, a frame counter, an audio-paced clock ----
// ============================================================================

/** The parts of `navigator.wakeLock` used (so tests can fake it). */
export interface WakeLockLike {
  request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(type: 'release', listener: () => void): void }>;
}

export interface WakeLockOptions {
  wakeLock?: WakeLockLike;
  document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
}

export interface WakeLockHandle {
  /** Wanted while the game runs (and the setting is on); not while paused. */
  setActive(active: boolean): void;
  /** Whether a lock is held right now. */
  readonly held: boolean;
  destroy(): void;
}

/**
 * The screen kept on while playing: a Wake Lock held while `setActive(true)` and the
 * page is visible, taken again when it comes back into view (the browser drops it on
 * hide). Without the API it does nothing.
 */
export function createWakeLock(options: WakeLockOptions = {}): WakeLockHandle {
  const api = options.wakeLock ?? (globalThis.navigator as unknown as { wakeLock?: WakeLockLike } | undefined)?.wakeLock;
  const doc = options.document ?? (globalThis.document as Document | undefined);
  let wanted = false;
  let destroyed = false;
  let sentinel: { release(): Promise<void> } | null = null;
  let pending = false;

  const visible = (): boolean => !doc || doc.visibilityState === 'visible';
  const acquire = async (): Promise<void> => {
    if (!api || sentinel || pending || !wanted || !visible() || destroyed) return;
    pending = true;
    try {
      const lock = await api.request('screen');
      sentinel = lock;
      lock.addEventListener('release', () => {
        if (sentinel === lock) sentinel = null;
      });
      if (!wanted || destroyed) await release();
    } catch {
      // Refused (battery saver, not visible): try again on the next chance.
    } finally {
      pending = false;
    }
  };
  const release = async (): Promise<void> => {
    const lock = sentinel;
    sentinel = null;
    await lock?.release().catch(() => undefined);
  };
  const onVisibility = (): void => {
    if (visible()) void acquire();
  };
  doc?.addEventListener('visibilitychange', onVisibility);

  return {
    setActive(active) {
      wanted = active;
      if (active) void acquire();
      else void release();
    },
    get held() {
      return sentinel !== null;
    },
    destroy() {
      destroyed = true;
      wanted = false;
      doc?.removeEventListener('visibilitychange', onVisibility);
      void release();
    },
  };
}

/** Frames per second, frame time and dropped frames over a window of frame times. */
export interface FrameStats {
  fps: number;
  /** Mean frame time, ms. */
  avg: number;
  /** Longest frame, ms. */
  worst: number;
  /** Frames lost in gaps longer than 1.5 frames at `expectedFps`. */
  dropped: number;
}

/** The stats of frame timestamps (ms, ascending) — usually the last second's. */
export function frameStats(times: readonly number[], expectedFps = 60): FrameStats {
  if (times.length < 2) return { fps: 0, avg: 0, worst: 0, dropped: 0 };
  const expected = 1000 / expectedFps;
  let worst = 0;
  let dropped = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i] ?? 0) - (times[i - 1] ?? 0);
    worst = Math.max(worst, gap);
    if (gap > expected * 1.5) dropped += Math.round(gap / expected) - 1;
  }
  const span = (times[times.length - 1] ?? 0) - (times[0] ?? 0);
  const avg = span / (times.length - 1);
  return { fps: avg > 0 ? 1000 / avg : 0, avg, worst, dropped };
}

export interface PerfCounterOptions {
  locale?: Locale;
  expectedFps?: number;
  now?: () => number;
  schedule?: ((step: () => void) => unknown) | null;
}

export interface PerfCounter {
  /** Call once per emulated frame. Without calls, display frames are counted instead. */
  frame(): void;
  show(): void;
  hide(): void;
  readonly visible: boolean;
  readonly stats: FrameStats;
  destroy(): void;
}

/**
 * The "Show performance" overlay: frames per second, frame time (mean and worst over
 * the last second) and dropped frames, in a corner of `target`.
 */
export function createPerfCounter(target: HTMLElement, options: PerfCounterOptions = {}): PerfCounter {
  const doc = target.ownerDocument;
  const locale = options.locale ?? 'en';
  const expectedFps = options.expectedFps ?? 60;
  const now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  const schedule =
    options.schedule === undefined ? (globalThis.requestAnimationFrame?.bind(globalThis) ?? null) : options.schedule;
  const box = doc.createElement('div');
  box.className = 'wg-perf';
  box.style.cssText =
    'position:absolute;top:calc(8px + var(--wg-safe-top, 0px));left:8px;z-index:10;padding:4px 8px;border-radius:8px;' +
    'background:rgb(0 0 0 / 0.65);color:#fff;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;pointer-events:none;white-space:pre';
  box.hidden = true;
  target.appendChild(box);

  let times: number[] = [];
  let fed = false;
  let lastPaint = 0;
  let stats: FrameStats = { fps: 0, avg: 0, worst: 0, dropped: 0 };
  let destroyed = false;
  let looping = false;

  const paint = (): void => {
    if (box.hidden) return;
    box.textContent = [
      uiText('perf.fps', locale, { fps: stats.fps.toFixed(0) }),
      uiText('perf.frame', locale, { avg: stats.avg.toFixed(1), worst: stats.worst.toFixed(1) }),
      uiText('perf.dropped', locale, { dropped: stats.dropped }),
    ].join('\n');
  };
  const record = (t: number): void => {
    times.push(t);
    const from = t - 1000;
    let cut = 0;
    while (cut < times.length && (times[cut] ?? 0) < from) cut++;
    if (cut > 0) times = times.slice(cut);
    if (t - lastPaint >= 250) {
      lastPaint = t;
      stats = frameStats(times, expectedFps);
      paint();
    }
  };
  const loop = (): void => {
    if (destroyed || box.hidden || !schedule) {
      looping = false;
      return;
    }
    if (!fed) record(now());
    schedule(loop);
  };

  return {
    frame() {
      fed = true;
      record(now());
    },
    show() {
      box.hidden = false;
      lastPaint = -Infinity;
      paint();
      if (!looping && schedule) {
        looping = true;
        schedule(loop);
      }
    },
    hide() {
      box.hidden = true;
    },
    get visible() {
      return !box.hidden;
    },
    get stats() {
      return stats;
    },
    destroy() {
      destroyed = true;
      box.remove();
    },
  };
}

/** How many frames are due after `elapsed` ms at `fps`, and the remainder carried to the next call. */
export function framesDue(elapsed: number, fps: number, carried = 0): { frames: number; carried: number } {
  const frame = 1000 / fps;
  const total = Math.max(0, elapsed) + carried;
  const frames = Math.floor(total / frame);
  return { frames, carried: total - frames * frame };
}

export type FrameSync = 'display' | 'audio';

/** The parts of an `AudioContext` the clock reads. */
export interface AudioClockLike {
  readonly currentTime: number;
  readonly state: string;
}

export interface FrameClockOptions {
  fps?: number;
  mode?: FrameSync;
  /** The clock in `'audio'` mode (while it runs; else the display clock is used). */
  audioContext?: AudioClockLike;
  /** Most frames run in one tick; beyond it the backlog is dropped (no spiral after a stall). Default 4. */
  maxFrames?: number;
  now?: () => number;
  schedule?: ((step: () => void) => unknown) | null;
}

export interface FrameClock {
  /** Calls `tick(frames)` each display frame with the number of emulated frames due (0 or more). */
  start(tick: (frames: number) => void): void;
  stop(): void;
  mode: FrameSync;
  /** Advance by hand (when `schedule` is `null`). */
  step(): void;
}

/**
 * The frame loop of an engine the app drives. `'display'` counts time on the page
 * clock; `'audio'` on the `AudioContext`'s, so the game runs at `fps` whatever the
 * screen's refresh rate, and stays in step with its sound.
 */
export function createFrameClock(options: FrameClockOptions = {}): FrameClock {
  const fps = options.fps ?? 60;
  const maxFrames = options.maxFrames ?? 4;
  const now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  const schedule =
    options.schedule === undefined ? (globalThis.requestAnimationFrame?.bind(globalThis) ?? null) : options.schedule;
  let mode: FrameSync = options.mode ?? 'display';
  let tick: ((frames: number) => void) | null = null;
  let last: number | null = null;
  let carried = 0;
  let source: FrameSync = mode;

  const clock = (): { at: number; source: FrameSync } => {
    const audio = options.audioContext;
    if (mode === 'audio' && audio && audio.state === 'running') return { at: audio.currentTime * 1000, source: 'audio' };
    return { at: now(), source: 'display' };
  };
  const step = (): void => {
    if (!tick) return;
    const reading = clock();
    // A switch of clock (audio started or stopped, or the mode changed) restarts the count.
    if (last === null || reading.source !== source) {
      last = reading.at;
      source = reading.source;
      carried = 0;
      tick(0);
      return;
    }
    const due = framesDue(reading.at - last, fps, carried);
    last = reading.at;
    if (due.frames > maxFrames) {
      carried = 0;
      tick(maxFrames);
    } else {
      carried = due.carried;
      tick(due.frames);
    }
  };
  const loop = (): void => {
    if (!tick) return;
    step();
    schedule?.(loop);
  };

  return {
    start(next) {
      const running = tick !== null;
      tick = next;
      last = null;
      if (!running) schedule?.(loop);
    },
    stop() {
      tick = null;
    },
    get mode() {
      return mode;
    },
    set mode(value) {
      mode = value;
    },
    step,
  };
}
