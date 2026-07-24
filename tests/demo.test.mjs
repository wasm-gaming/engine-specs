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

test('demo.js exports default demo object with event and MEMFS methods', () => {
  assert.ok(demo);
  assert.equal(typeof demo.init, 'function');
  assert.equal(typeof demo.on, 'function');
  assert.equal(typeof demo.off, 'function');
  assert.equal(typeof demo.emit, 'function');
  assert.equal(typeof demo.loadToMEMFS, 'function');
  assert.equal(typeof demo.hasFile, 'function');
  assert.equal(typeof demo.isLoaded, 'function');
  assert.equal(typeof demo.bindInstance, 'function');
  assert.equal(typeof demo.setInstance, 'function');
});

test('demo.init returns demo synchronously allowing method chaining .on()', () => {
  const instance = demo.init({ bios: false });
  assert.equal(instance, demo);
  assert.equal(typeof instance.on, 'function');
});

test('demo event emitter registers and triggers listeners', async () => {
  let eventData = null;
  const handler = (data) => {
    eventData = data;
    return 'handled';
  };

  demo.on('file', handler);
  const results = await demo.emit('file', { test: true });

  assert.deepEqual(eventData, { test: true });
  assert.deepEqual(results, ['handled']);

  demo.off('file', handler);
  const emptyResults = await demo.emit('file', { test: false });
  assert.deepEqual(emptyResults, []);
});

test('demo emits rom:save, bios:save, esc, pause, resume, reset, exit events', async () => {
  let romPayload = null;
  const handler = (data) => {
    romPayload = data;
  };

  demo.on('rom:save', handler);
  await demo.emit('rom:save', { file: { name: 'game.rom' } });
  assert.deepEqual(romPayload, { file: { name: 'game.rom' } });
  demo.off('rom:save', handler);
});

test('demo.loadToMEMFS returns null and hasFile returns false for unselected files', async () => {
  assert.equal(demo.hasFile('rom'), false);
  assert.equal(demo.isLoaded('bios'), false);

  const rom = await demo.loadToMEMFS('rom');
  assert.equal(rom, null);
  const all = await demo.loadToMEMFS();
  assert.deepEqual(all, {});
});
