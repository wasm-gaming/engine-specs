import test from 'node:test';
import assert from 'node:assert/strict';

import sdk, { createDummySdk } from '../demo/demo.sdk.js';
import demo from '../demo/demo.js';

test('demo.sdk.js exports createDummySdk function and default sdk instance', () => {
  assert.equal(typeof createDummySdk, 'function');
  const dummy = createDummySdk();
  assert.ok(dummy.manifest);
  assert.equal(dummy.manifest.id, 'dummy-canvas-sdk');

  assert.ok(sdk);
  assert.ok(sdk.manifest);
  assert.equal(sdk.manifest.id, 'dummy-canvas-sdk');
});

test('demo.js exports default demo object with init method', () => {
  assert.ok(demo);
  assert.equal(typeof demo.init, 'function');
});
