import test from 'node:test';
import assert from 'node:assert/strict';

import { validateManifest, assertManifest } from '../dist/validate.js';

function makeValidManifest() {
  return {
    id: 'rsdkv4',
    version: '1.0.0',
    artifacts: {
      wasm: 'engine.wasm',
      js: 'engine.js',
    },
    assets: [
      {
        key: 'data',
        mountPath: '/Data.rsdk',
        required: true,
        accept: ['.rsdk'],
      },
    ],
    input: 'rsdkv4',
    video: {
      baseWidth: 424,
      baseHeight: 240,
    },
    capabilities: {
      saveStates: true,
    },
  };
}

function expectInvalid(manifest, expectedText) {
  const result = validateManifest(manifest);
  assert.equal(result.valid, false);
  if (expectedText) {
    assert.ok(result.errors.some((e) => e.includes(expectedText)), `Expected an error containing: ${expectedText}`);
  }
}

test('validateManifest accepts a valid manifest', () => {
  const manifest = makeValidManifest();
  const result = validateManifest(manifest);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('assertManifest returns parsed manifest for valid input', () => {
  const manifest = makeValidManifest();
  const parsed = assertManifest(manifest);

  assert.equal(parsed.id, 'rsdkv4');
  assert.equal(parsed.video.baseWidth, 424);
});

test('validateManifest accepts input key-map object', () => {
  const manifest = {
    ...makeValidManifest(),
    input: {
      up: 'ArrowUp',
      down: 'ArrowDown',
      a: 'KeyZ',
    },
  };

  const result = validateManifest(manifest);
  assert.equal(result.valid, true);
});

test('validateManifest accepts empty assets array', () => {
  const manifest = {
    ...makeValidManifest(),
    assets: [],
  };

  const result = validateManifest(manifest);
  assert.equal(result.valid, true);
});

test('validateManifest accepts options object', () => {
  const manifest = {
    ...makeValidManifest(),
    options: {
      type: 'object',
      properties: {
        difficulty: { type: 'string' },
      },
    },
  };

  const result = validateManifest(manifest);
  assert.equal(result.valid, true);
});

test('validateManifest accepts optional capabilities booleans', () => {
  const manifest = {
    ...makeValidManifest(),
    capabilities: {
      saveStates: true,
      sram: false,
      coreSelectable: true,
    },
  };

  const result = validateManifest(manifest);
  assert.equal(result.valid, true);
});

test('rejects non-object top-level manifest', () => {
  expectInvalid('not-an-object', 'manifest');
});

test('rejects missing required top-level fields', () => {
  const manifest = makeValidManifest();
  delete manifest.id;
  expectInvalid(manifest, 'manifest.id');
});

test('rejects empty id', () => {
  const manifest = {
    ...makeValidManifest(),
    id: '',
  };
  expectInvalid(manifest, 'manifest.id');
});

test('rejects empty version', () => {
  const manifest = {
    ...makeValidManifest(),
    version: '',
  };
  expectInvalid(manifest, 'manifest.version');
});

test('rejects additional top-level properties', () => {
  const manifest = {
    ...makeValidManifest(),
    unknownField: true,
  };
  expectInvalid(manifest, 'unknownField');
});

test('rejects additional properties in artifacts', () => {
  const manifest = makeValidManifest();
  manifest.artifacts.extra = 'x';
  expectInvalid(manifest, 'manifest.artifacts');
});

test('rejects missing artifacts.js', () => {
  const manifest = makeValidManifest();
  delete manifest.artifacts.js;
  expectInvalid(manifest, 'manifest.artifacts.js');
});

test('rejects invalid asset mountPath without leading slash', () => {
  const manifest = makeValidManifest();
  manifest.assets[0].mountPath = 'Data.rsdk';
  expectInvalid(manifest, 'manifest.assets[0].mountPath');
});

test('rejects additional properties in asset item', () => {
  const manifest = makeValidManifest();
  manifest.assets[0].extra = true;
  expectInvalid(manifest, 'manifest.assets[0]');
});

test('rejects additional properties in asset.validate', () => {
  const manifest = makeValidManifest();
  manifest.assets[0].validate = {
    bytes: 10,
    md5: 'not-allowed',
  };
  expectInvalid(manifest, 'manifest.assets[0].validate');
});

test('rejects non-integer validate.bytes', () => {
  const manifest = makeValidManifest();
  manifest.assets[0].validate = { bytes: 10.5 };
  expectInvalid(manifest, 'manifest.assets[0].validate.bytes');
});

test('rejects negative validate.bytes', () => {
  const manifest = makeValidManifest();
  manifest.assets[0].validate = { bytes: -1 };
  expectInvalid(manifest, 'manifest.assets[0].validate.bytes');
});

test('rejects key-map input with non-string values', () => {
  const manifest = {
    ...makeValidManifest(),
    input: {
      up: 'ArrowUp',
      a: 123,
    },
  };
  expectInvalid(manifest, 'manifest.input');
});

test('rejects non-integer video dimensions', () => {
  const manifest = makeValidManifest();
  manifest.video.baseWidth = 320.5;
  expectInvalid(manifest, 'manifest.video.baseWidth');
});

test('rejects non-positive video dimensions', () => {
  const manifest = makeValidManifest();
  manifest.video.baseHeight = 0;
  expectInvalid(manifest, 'manifest.video.baseHeight');
});

test('rejects additional properties in video', () => {
  const manifest = makeValidManifest();
  manifest.video.overscan = true;
  expectInvalid(manifest, 'manifest.video');
});

test('rejects options when it is not an object', () => {
  const manifest = {
    ...makeValidManifest(),
    options: 'not-an-object',
  };
  expectInvalid(manifest, 'manifest.options');
});

test('rejects non-boolean capability value', () => {
  const manifest = makeValidManifest();
  manifest.capabilities.sram = 'yes';
  expectInvalid(manifest, 'manifest.capabilities.sram');
});

test('rejects additional properties in capabilities', () => {
  const manifest = makeValidManifest();
  manifest.capabilities.experimental = true;
  expectInvalid(manifest, 'manifest.capabilities');
});

test('assertManifest throws readable error on invalid input', () => {
  const manifest = {
    ...makeValidManifest(),
    id: '',
  };

  assert.throws(
    () => assertManifest(manifest),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('Invalid EngineManifest'));
      assert.ok(err.message.includes('manifest.id'));
      return true;
    },
  );
});
