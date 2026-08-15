// Compile-time conformance. There is nothing to run: this file passing `tsc` IS the
// assertion. Run it with `make typecheck-tests`.
//
// Negative cases are guarded by `@ts-expect-error`, which is self-policing in both
// directions: the line must error, and if it ever stops erroring tsc fails on the
// unused directive. A rule that quietly stops being enforced cannot pass here.

import type {
  EngineInit,
  EnginePayloads,
  EnginePlay,
  EngineSDK,
  EngineSDKConstructor,
  PromisePlay,
  PropertiesDefinition,
  PropertyDefinition,
} from '../src/engine-specs.js';
import { DummyEngine } from './engine.conformance.js';
import type { DummyConfig, DummyOptions, DummyPayloads } from './engine.conformance.js';

// ---- Assertion helpers ----

/** Exact type equality, not mere assignability — catches literal widening. */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

// ---------------------------------------------------------------------------
// The descriptor map mirrors the payload
// ---------------------------------------------------------------------------

type ConfigProps = PropertiesDefinition<DummyConfig>;

// Every key of the payload is a key of the map, and only those.
type _keys = Assert<Equals<keyof ConfigProps, keyof DummyConfig>>;

// Each value is wrapped in its own descriptor, carrying the payload's type.
type _wrapped = Assert<Equals<ConfigProps['region'], PropertyDefinition<'us' | 'eu' | 'jp'>>>;

// `-?` at work: `scanlines` is optional in the payload, but its descriptor is not.
// Without it, every host would need `props.scanlines?.value` for a key the engine
// always resolves.
type _required = Assert<Equals<undefined extends ConfigProps['scanlines'] ? true : false, false>>;
// The optionality moves inside, where it belongs: the value may be unset.
type _inner = Assert<Equals<ConfigProps['scanlines']['value'], boolean | undefined>>;

// ---------------------------------------------------------------------------
// A host drives the engine
// ---------------------------------------------------------------------------

async function host() {
  // Identity is read off the class — a launcher lists engines without constructing
  // one, which is the whole reason it does not live on the instance.
  type _id = Assert<Equals<typeof DummyEngine.id, string>>;
  type _version = Assert<Equals<typeof DummyEngine.version, string>>;

  // Init takes a patch, not the whole payload: `region` alone, no `scanlines`.
  const sdk = new DummyEngine({ config: { region: 'eu' } });

  // Reading: exact types survive the round trip.
  const config = await sdk.config();
  type _read = Assert<Equals<typeof config.region.value, 'us' | 'eu' | 'jp'>>;
  type _enum = Assert<Equals<typeof config.region.enum, readonly ('us' | 'eu' | 'jp')[] | undefined>>;

  // Writing chains, and keeps the factory type.
  const chained = sdk.config({ scanlines: true }).options({ slot: 1 });
  type _chain = Assert<Equals<typeof chained, EngineSDK<DummyPayloads>>>;

  // `mount` is part of the same fluent surface, so it chains on both carriers — and
  // each one returns its own: the factory stays synchronous, the live engine does not.
  const stage = document.createElement('div');
  type _mountSdk = Assert<Equals<ReturnType<EngineSDK<DummyPayloads>['mount']>, EngineSDK<DummyPayloads>>>;
  type _mountPlay = Assert<Equals<ReturnType<EnginePlay<DummyPayloads>['mount']>, PromisePlay<DummyPayloads>>>;
  sdk.mount(stage).config({ region: 'jp' });

  // And the rule holds in both directions: whatever the chain takes, the constructor
  // takes. These two are the same call.
  const mountedUpFront = new DummyEngine({ mount: stage, config: { region: 'jp' } });
  const mountedByChain = new DummyEngine({ config: { region: 'jp' } }).mount(stage);
  type _init = Assert<Equals<typeof mountedUpFront, EngineSDK<DummyPayloads>>>;
  type _same = Assert<Equals<typeof mountedByChain, EngineSDK<DummyPayloads>>>;

  // The chain crosses into the live engine and keeps going.
  const play: EnginePlay<DummyPayloads> = await sdk.start({ player: 'tails' });
  const promise: PromisePlay<DummyPayloads> = play
    .restart({ slot: 2 })
    .mount(stage)
    .options({ player: 'sonic' });

  // Reading closes the chain: a plain promise of descriptors, not another link.
  const options = await promise.options();
  type _closes = Assert<Equals<typeof options, PropertiesDefinition<DummyOptions>>>;

  // `PromisePlay` is a real promise: awaited, and chainable through catch/finally.
  const awaited: EnginePlay<DummyPayloads> = await promise;
  await promise.catch(() => undefined).finally(() => undefined);
  await promise.finally(() => undefined).catch(() => undefined);

  // Teardown ends the chain rather than continuing it.
  const gone: void = await play.destroy();

  return [config, chained, awaited, options, gone] as const;
}

// ---------------------------------------------------------------------------
// An engine that closes nothing still works
// ---------------------------------------------------------------------------

async function openEngine(sdk: EngineSDK) {
  sdk.config({ anything: 1, goes: 'here' });
  const props = await sdk.config();
  // Open keys are unknown, not `any`: the host has to narrow before using them.
  type _open = Assert<Equals<(typeof props)[string]['value'], unknown>>;
  return props;
}

// ---------------------------------------------------------------------------
// What the contract must reject
// ---------------------------------------------------------------------------

declare const sdk: EngineSDK<DummyPayloads>;
declare const props: PropertiesDefinition<DummyConfig>;

// A value outside the closed union.
// @ts-expect-error
sdk.config({ region: 'br' });

// A key the engine never declared.
// @ts-expect-error
sdk.config({ inventado: true });

// The wrong type for a declared key.
// @ts-expect-error
sdk.options({ slot: 'three' });

// The getter's shape is not accepted by the setter — the asymmetry is deliberate,
// and it is what keeps a write unambiguous the day a value is itself an object.
// @ts-expect-error
sdk.config({ region: { value: 'eu' } });

// Session options are not engine config: the payloads do not leak into each other.
// @ts-expect-error
sdk.config({ player: 'sonic' });

// A descriptor is read-only vocabulary, not a mutable array the host may extend.
// @ts-expect-error
props.region.enum?.push('br');

// `mount` takes the element, not a selector: resolving it is the host's job, and a
// typo in a string would only surface at runtime.
// @ts-expect-error
sdk.mount('#stage');

// `destroy()` resolves to nothing: it closes the chain instead of continuing it.
// @ts-expect-error
const _dead: EnginePlay<DummyPayloads> = await sdk.boot().destroy();

// Init is a patch too, and it is still type-checked.
// @ts-expect-error
const _bad: EngineInit<DummyPayloads> = { config: { region: 'br' } };

// The payload bundle cannot be satisfied by something that is not an object.
// @ts-expect-error
interface _BadPayloads extends EnginePayloads { config: string }

// Identity is not on the instance. Reading it there is the mistake this move exists
// to prevent: it would mean constructing an engine just to ask its name.
// @ts-expect-error
sdk.id;

// And a constructor without it does not satisfy the contract, so an engine cannot
// quietly forget to declare who it is.
declare const bare: new (init?: EngineInit<DummyPayloads>) => EngineSDK<DummyPayloads>;
// @ts-expect-error
const _needsIdentity: EngineSDKConstructor<DummyPayloads> = bare;

export { host, openEngine };
