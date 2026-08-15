// A complete, working engine written against the contract — nothing is stubbed with
// `as never`. It exists to answer one question the types alone cannot: is this
// contract implementable at all? If a rule cannot be satisfied by an engine that has
// nothing else to do, twelve real engines will not fare better.
//
// It is also the measurement of what `EngineSDKBase` / `EnginePlayBase` are worth.
// This file used to hand-write the four getter/setter pairs twice over, a `hydrate()`
// identical to the demo's, the channel plumbing, and a `default` in every descriptor
// duplicating the field that held the same value. All of that is now inherited, and
// what is left below is the part that is genuinely this engine's own.
//
// It is type-checked, not executed: `make typecheck-tests` compiles it, and
// `tests/types.test-d.ts` drives it the way a host would.

import { EnginePlayBase, EngineSDKBase, EventEmitter } from '../src/engine-specs.js';
import type {
  EngineInit,
  EnginePayloads,
  EngineSDKConstructor,
  EngineSpec,
  EventsOf,
} from '../src/engine-specs.js';

// ---- The engine closes its four payloads with named interfaces ----

export interface DummyConfig {
  region: 'us' | 'eu' | 'jp';
  scanlines?: boolean;
}
export interface DummyOptions {
  player: 'sonic' | 'tails';
  slot: number;
}
export interface DummyAssets {
  pack: Uint8Array;
}
export interface DummyStorage {
  namespace: string;
}
/** An event of this engine's own, on top of the core set it gets for free. */
export interface DummyEventsOwn {
  levelLoaded: { zone: string };
}
export interface DummyPayloads extends EnginePayloads {
  config: DummyConfig;
  options: DummyOptions;
  assets: DummyAssets;
  storage: DummyStorage;
  events: DummyEventsOwn;
}

/** The core set unioned with this engine's own — what `on`/`off` accept. */
export type DummyEvents = EventsOf<DummyPayloads>;

// ---- What the engine declares: its properties, as data ----
//
// `default` appears here and nowhere else. The base class seeds its starting state
// from it, so there is no second copy to drift.

const spec: EngineSpec<DummyPayloads> = {
  config: {
    region: {
      default: 'us',
      enum: ['us', 'eu', 'jp'],
      description: 'Region the engine boots in',
      // Not changeable on a running engine: the engine re-reads it at boot.
      live: false,
    },
    scanlines: { default: false, live: true },
  },
  options: {
    player: { default: 'sonic', enum: ['sonic', 'tails'], live: true },
    slot: { default: 0, live: true },
  },
  assets: {
    // No `default`: an asset the host has not handed over reads back as unset, which
    // is what a launcher needs to know before it offers a file picker.
    pack: { description: 'The game data pack', allowedTypes: ['.bin', '.dat'], live: false },
  },
  storage: {
    namespace: { default: 'dummy', live: false },
  },
};

// ---- The live engine ----

class DummyPlay extends EnginePlayBase<DummyPayloads> {
  constructor(init?: EngineInit<DummyPayloads>, events?: EventEmitter<DummyEvents>) {
    // The spec goes up rather than being declared as a field: a subclass field
    // initialiser runs after `super()`, which would be too late for the base to seed
    // state from it.
    super(spec, init, events);
  }

  /**
   * A session opens. There is nothing to boot in a dummy engine, so this is where its
   * own event goes — emitted with the `protected` `emit`, which is why a host holding
   * this object cannot forge one.
   */
  protected override open(options: DummyOptions): void {
    this.emit('levelLoaded', { zone: `zone-${options.slot}` });
  }

  protected override close(): void {
    // Nothing to release. `exit` is emitted by the base once this returns.
  }

  protected override mounted(target: HTMLElement): void {
    // Reparenting a live engine is legal; re-mounting is not.
    void target;
  }
}

// ---- The factory ----

class DummySDK extends EngineSDKBase<DummyPayloads> {
  static readonly id = 'dummy';
  static readonly version = '1.0.0';
  static readonly name = 'Dummy engine';
  static readonly description = 'Reference implementation of the engine-specs contract.';

  /** The one thing the factory cannot infer: which engine to build. */
  protected override createPlay(
    init: EngineInit<DummyPayloads>,
    events: EventEmitter<DummyEvents>,
  ): DummyPlay {
    return new DummyPlay(init, events);
  }
}

/** The line an engine puts in its own CI: does the class satisfy the constructor type? */
export const DummyEngine: EngineSDKConstructor<DummyPayloads> = DummySDK;
