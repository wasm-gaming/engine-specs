// What a package can get wrong regardless of what its code says: shipping the wrong
// files.
//
// This exists because the previous suite passed 32 tests green against `dist/`
// artifacts whose sources had been deleted — and `make publish` is gated on exactly
// this suite. Every assertion here is a failure mode that has already happened once.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Every `exports` target, flattened to a list of [label, relative path]. */
function exportTargets(node, label = 'exports') {
  if (typeof node === 'string') return [[label, node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) => exportTargets(value, `${label}.${key}`));
}

test('every exports target exists on disk', () => {
  const targets = exportTargets(pkg.exports);
  assert.ok(targets.length > 0, 'package.json declares no exports');
  for (const [label, target] of targets) {
    assert.ok(existsSync(join(root, target)), `${label} → ${target} does not exist`);
  }
});

test('the types entry point exists', () => {
  assert.ok(pkg.types, 'package.json declares no "types"');
  assert.ok(existsSync(join(root, pkg.types)), `types → ${pkg.types} does not exist`);
});

test('every published file entry exists', () => {
  for (const entry of pkg.files ?? []) {
    assert.ok(existsSync(join(root, entry.replace(/\/$/, ''))), `files → ${entry} does not exist`);
  }
});

// The one that matters: `tsc` does not remove output whose source is gone, so a
// deleted module survives in `dist/` and gets published as if it were still real.
test('dist holds no artifact whose source has been deleted', () => {
  const dist = join(root, 'dist');
  assert.ok(existsSync(dist), 'dist/ is missing — run `make build` first');

  const stale = readdirSync(dist)
    .filter((file) => file.endsWith('.js'))
    .map((file) => file.replace(/\.js$/, ''))
    .filter((name) => !existsSync(join(root, 'src', `${name}.ts`)));

  assert.deepEqual(stale, [], `dist/ contains artifacts with no source in src/: ${stale.join(', ')}`);
});

// The contract is almost entirely types, and the one class it ships has no
// dependencies. Twelve engines depend on this; anything it pulls in, they pull in too.
test('the package declares no runtime dependencies', () => {
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
});

test('the built contract exposes the documented surface', async () => {
  const types = readFileSync(join(root, pkg.types), 'utf8');
  for (const name of [
    'PropertyDefinition',
    'PropertiesDefinition',
    'EnginePayloads',
    'EngineInit',
    'EngineSurface',
    'EnginePlay',
    'PromisePlay',
    'EngineSDK',
    'EngineSDKConstructor',
    'CoreEvents',
    'EventsOf',
    'EventListeners',
    'EngineEvent',
    'EngineListener',
    'EventEmitter',
    'PropertySpec',
    'PropertiesSpec',
    'EngineSpec',
    'EnginePlayBase',
    'EngineSDKBase',
    'hydratePlay',
  ]) {
    assert.match(types, new RegExp(`\\b${name}\\b`), `${name} is missing from ${pkg.types}`);
  }
});

// These are the members that have to survive compilation as *code*. Everything else
// in this package erases to nothing, so a regression turning one back into a type —
// or a build emitting only declarations — would leave every other test in this file
// green while engines importing them got `undefined`.
test('the runtime members are emitted as code, not erased', async () => {
  const js = join(root, pkg.exports['.'].import);
  const source = readFileSync(js, 'utf8');
  const module = await import(js);

  for (const name of ['EventEmitter', 'EnginePlayBase', 'EngineSDKBase']) {
    assert.match(source, new RegExp(`class ${name}\\b`), `${js} has no ${name} class`);
    assert.equal(typeof module[name], 'function', `${name} is not exported as a value`);
  }
  assert.equal(typeof module.hydratePlay, 'function');

  const events = new module.EventEmitter();
  assert.equal(typeof events.on, 'function');
  assert.equal(typeof events.off, 'function');
  assert.equal(typeof events.emit, 'function');
});
