// 0.6.0: languages, settings, controls, fullscreen and performance. The pure parts, plus
// the runtime ones against fakes (event targets, gamepads, a Wake Lock, a clock).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localize,
  resolveLocale,
  uiText,
  settingsModel,
  stepSetting,
  withSettingValue,
  settingsDefaults,
  SHARED_SETTINGS,
  FRAME_SYNC_SETTING,
  parseSettings,
  loadSettings,
  saveSettings,
  controlsModel,
  bindControl,
  keyLabel,
  codeLabel,
  captureBinding,
  platformOf,
  fullscreenShortcut,
  isShortcut,
  createFullscreenToggle,
  menuKeyAliases,
  menuKeyHint,
  createWakeLock,
  frameStats,
  framesDue,
  createFrameClock,
  createInput,
} from '../dist/engine-specs.js';

test('localize falls back to English; resolveLocale prefers the host, then the browser', () => {
  assert.equal(localize('Smoothing', 'es'), 'Smoothing');
  assert.equal(localize({ en: 'Smoothing', es: 'Suavizado' }, 'es'), 'Suavizado');
  assert.equal(localize({ en: 'Smoothing' }, 'es'), 'Smoothing');
  assert.equal(resolveLocale('es', ['en-US']), 'es');
  assert.equal(resolveLocale('fr', ['fr-FR', 'es-419', 'en']), 'es');
  assert.equal(resolveLocale(undefined, ['de-DE']), 'en');
  assert.equal(uiText('perf.dropped', 'es', { dropped: 3 }), '3 perdidos');
});

const DESCRIBED = {
  renderFilter: {
    value: 'pixelated',
    default: 'pixelated',
    enum: ['pixelated', 'smooth'],
    valueLabels: [{ en: 'Sharp pixels', es: 'Píxeles nítidos' }, { en: 'Smooth', es: 'Suavizado' }],
    label: { en: 'Smoothing', es: 'Suavizado' },
    group: 'video',
    live: true,
  },
  volume: { default: 100, enum: [0, 25, 50, 75, 100], label: 'Volume', group: 'audio', live: true },
  region: { default: 'auto', enum: ['auto', 'ntsc', 'pal'], label: 'Region', group: 'emulation', description: 'Console region.' },
  romUrl: { value: 'x.bin', description: 'internal' },
  ...SHARED_SETTINGS,
};

test('settingsModel: labelled properties, grouped in order, current values and their labels', () => {
  const sections = settingsModel(DESCRIBED, { volume: 50 }, 'es');
  assert.deepEqual(sections.map((s) => [s.group, s.title, s.rows.map((r) => r.key)]), [
    ['video', 'Vídeo', ['renderFilter', 'keepScreenOn', 'showPerformance']],
    ['audio', 'Audio', ['volume']],
    ['emulation', 'Emulación', ['region']],
  ]);
  const [filter, keepOn] = sections[0].rows;
  assert.equal(filter.label, 'Suavizado');
  assert.equal(filter.valueLabel, 'Píxeles nítidos');
  assert.equal(keepOn.value, true);
  assert.equal(keepOn.valueLabel, 'Sí');
  assert.equal(sections[1].rows[0].value, 50);
  assert.equal(sections[2].rows[0].live, false);
  assert.equal(sections[2].rows[0].description, 'Console region.');
});

test('stepSetting: enums and booleans wrap, numeric enums stop at their ends', () => {
  const [video, audio, emulation] = settingsModel(DESCRIBED, { volume: 100 });
  assert.equal(stepSetting(video.rows[0], 1), 'smooth');
  assert.equal(stepSetting(withSettingValue(video.rows[0], 'smooth'), 1), 'pixelated');
  assert.equal(stepSetting(video.rows[1], 1), false);
  assert.equal(stepSetting(audio.rows[0], 1), 100);
  assert.equal(stepSetting(audio.rows[0], -1), 75);
  assert.equal(stepSetting(emulation.rows[0], -1), 'pal');
  assert.equal(withSettingValue(video.rows[0], 'smooth').valueLabel, 'Smooth');
});

test('settingsDefaults: the defaults of the settings only', () => {
  assert.deepEqual(settingsDefaults(DESCRIBED), {
    renderFilter: 'pixelated', volume: 100, region: 'auto', keepScreenOn: true, showPerformance: false,
  });
  assert.equal(settingsModel(FRAME_SYNC_SETTING, {}, 'es')[0].rows[0].valueLabel, 'Pantalla');
});

test('parseSettings reads a broken or missing file as nothing saved', () => {
  const empty = { version: 1, values: {}, controls: {} };
  assert.deepEqual(parseSettings(undefined), empty);
  assert.deepEqual(parseSettings('{not json'), empty);
  assert.deepEqual(parseSettings('[1,2]'), empty);
  assert.deepEqual(
    parseSettings('{"version":1,"values":{"volume":50},"controls":{"jump":{"key":"z","code":"KeyZ","button":0},"bad":3,"run":{"button":"x"}}}'),
    { version: 1, values: { volume: 50 }, controls: { jump: { key: 'z', code: 'KeyZ', button: 0 }, run: {} } },
  );
});

/** An OPFS directory in memory. */
function fakeDirectory() {
  const files = new Map();
  const dir = (prefix) => ({
    async getDirectoryHandle(name, { create } = {}) {
      const path = `${prefix}${name}/`;
      if (!create && ![...files.keys()].some((key) => key.startsWith(path))) throw new Error('NotFoundError');
      return dir(path);
    },
    async getFileHandle(name, { create } = {}) {
      const path = `${prefix}${name}`;
      if (!create && !files.has(path)) throw new Error('NotFoundError');
      return {
        async getFile() { return { text: async () => files.get(path) }; },
        async createWritable() {
          let data = '';
          return { async write(chunk) { data += chunk; }, async close() { files.set(path, data); } };
        },
      };
    },
  });
  return { root: dir(''), files };
}

test('loadSettings / saveSettings: settings/<engineId>.json, per engine', async () => {
  const { root, files } = fakeDirectory();
  assert.deepEqual(await loadSettings('snes9x', root), { version: 1, values: {}, controls: {} });
  await saveSettings('snes9x', { version: 1, values: { volume: 75 }, controls: { a: { key: 'x' } } }, root);
  assert.ok(files.has('settings/snes9x.json'));
  assert.deepEqual((await loadSettings('snes9x', root)).values, { volume: 75 });
  assert.deepEqual((await loadSettings('mgba', root)).values, {});
  await assert.rejects(loadSettings('../x', root), /Invalid engine id/);
});

const BUTTONS = [
  { id: 'jump', label: { en: 'Jump', es: 'Saltar' } },
  { id: 'run', label: 'Run' },
];
const DEFAULTS = { jump: { key: 'z', button: 0 }, run: { key: 'x', button: 2 } };

test('controlsModel: saved over defaults, with key and button names', () => {
  const rows = controlsModel(BUTTONS, DEFAULTS, { run: { key: ' ' } }, 'es');
  assert.deepEqual(rows.map((r) => [r.label, r.keyLabel, r.buttonLabel]), [['Saltar', 'Z', 'A'], ['Run', 'Space', 'X']]);
  assert.equal(keyLabel('ArrowUp'), '↑');
});

test('bindControl swaps a key or a button another one had, never duplicates', () => {
  const next = bindControl(DEFAULTS, 'jump', { key: 'x' });
  assert.deepEqual(next, { jump: { key: 'x', button: 0 }, run: { key: 'z', button: 2 } });
  const pad = bindControl(next, 'run', { button: 0 });
  assert.deepEqual(pad, { jump: { key: 'x', button: 2 }, run: { key: 'z', button: 0 } });
  assert.deepEqual(bindControl({ a: { key: 'q' } }, 'b', { key: 'q' }), { a: {}, b: { key: 'q' } });
});

const keyEvent = (key, extra = {}) => {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { key, repeat: false, altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, ...extra });
  return event;
};
const pad = (pressed = []) => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })), axes: [0, 0] });

test('captureBinding: the next key, Escape cancels, and the input is muted meanwhile', async () => {
  const target = new EventTarget();
  const input = createInput({ target, gamepads: () => [], schedule: null });
  input.suspend(); // in game, Escape would open the menu…
  const seen = [];
  input.on((action) => seen.push(action));
  const pending = captureBinding(input, { target, gamepads: () => [], schedule: null });
  const key = keyEvent('k', { code: 'KeyK' });
  target.dispatchEvent(key);
  assert.deepEqual(await pending, { key: 'k', code: 'KeyK' });
  assert.equal(key.defaultPrevented, true);

  const cancelled = captureBinding(input, { target, gamepads: () => [], schedule: null });
  target.dispatchEvent(keyEvent('Escape'));
  assert.equal(await cancelled, undefined);
  assert.deepEqual(seen, []); // …but not while a binding is captured
  target.dispatchEvent(keyEvent('Escape'));
  assert.deepEqual(seen, ['menu']);
});

test('captureBinding: a gamepad button, ignoring one held when it started', async () => {
  const state = { pads: [pad([0])] };
  let step;
  const pending = captureBinding(undefined, { target: new EventTarget(), gamepads: () => state.pads, schedule: (fn) => (step = fn) });
  step();
  state.pads = [pad([0, 3])];
  step();
  assert.deepEqual(await pending, { button: 3 });
});

test('the fullscreen key: Cmd+Enter on macOS, Alt+Enter elsewhere, never in a text field', () => {
  assert.equal(platformOf({ userAgentData: { platform: 'macOS' } }), 'mac');
  assert.equal(platformOf({ platform: 'Win32' }), 'other');
  const mac = fullscreenShortcut('mac');
  const other = fullscreenShortcut('other');
  assert.equal(isShortcut(keyEvent('Enter', { metaKey: true }), mac), true);
  assert.equal(isShortcut(keyEvent('Enter', { altKey: true }), mac), false);
  assert.equal(isShortcut(keyEvent('Enter', { altKey: true }), other), true);
  assert.equal(isShortcut(keyEvent('Enter', { altKey: true, shiftKey: true }), other), false);
  assert.equal(isShortcut({ ...keyEvent('Enter', { altKey: true }), key: 'Enter', altKey: true, metaKey: false, ctrlKey: false, shiftKey: false, target: { tagName: 'INPUT' } }, other), false);
});

test('createFullscreenToggle: the key and Select + Y toggle the root', async () => {
  const doc = new EventTarget();
  doc.fullscreenElement = null;
  const root = { ownerDocument: doc, async requestFullscreen() { doc.fullscreenElement = root; } };
  doc.exitFullscreen = async () => { doc.fullscreenElement = null; };
  const target = new EventTarget();
  const state = { pads: [pad()] };
  const toggle = createFullscreenToggle(root, { target, shortcut: fullscreenShortcut('other'), gamepads: () => state.pads, schedule: null });
  target.dispatchEvent(keyEvent('Enter', { altKey: true }));
  await new Promise((r) => setTimeout(r));
  assert.equal(toggle.active, true);
  state.pads = [pad([8, 3])];
  toggle.poll();
  toggle.poll(); // held: once only
  await new Promise((r) => setTimeout(r));
  assert.equal(toggle.active, false);
  toggle.destroy();
});

test('createFullscreenToggle: Escape is locked while fullscreen, and given back when it could not be', async () => {
  const setup = (keyboard) => {
    const doc = new EventTarget();
    doc.fullscreenElement = null;
    const change = (el) => { doc.fullscreenElement = el; doc.dispatchEvent(new Event('fullscreenchange')); };
    const root = { ownerDocument: doc, async requestFullscreen() { change(root); } };
    doc.exitFullscreen = async () => change(null);
    const target = new EventTarget();
    const escapes = [];
    target.addEventListener('keydown', (e) => { if (e.key === 'Escape') escapes.push(e); });
    const toggle = createFullscreenToggle(root, { target, keyboard, schedule: null, gamepads: () => [] });
    return { toggle, root, browserExit: () => change(null), escapes };
  };
  const tick = () => new Promise((r) => setTimeout(r));

  // Keyboard Lock granted: Escape locked on entering, unlocked on leaving, nothing dispatched.
  const calls = [];
  const kb = { async lock(keys) { calls.push(['lock', keys]); }, unlock() { calls.push(['unlock']); } };
  const a = setup(kb);
  await a.toggle.toggle();
  await tick();
  assert.deepEqual(calls, [['lock', ['Escape']]]);
  a.browserExit(); // held Escape: the browser leaves
  assert.deepEqual(calls, [['lock', ['Escape']], ['unlock']]);
  assert.equal(a.escapes.length, 0);
  a.toggle.destroy();

  // No Keyboard Lock: a browser exit gives Escape back; our own toggle does not.
  const b = setup(null);
  await b.toggle.toggle();
  b.browserExit();
  assert.equal(b.escapes.length, 1);
  await b.toggle.toggle();
  await b.toggle.toggle(); // our own exit
  assert.equal(b.escapes.length, 1);
  b.toggle.destroy();

  // Lock refused: the same as no lock.
  const c = setup({ lock: async () => { throw new Error('no'); }, unlock() {} });
  await c.toggle.toggle();
  await tick();
  c.browserExit();
  assert.equal(c.escapes.length, 1);
  c.toggle.destroy();

  // Opt out.
  const doc = new EventTarget();
  doc.fullscreenElement = null;
  const root = { ownerDocument: doc, async requestFullscreen() { doc.fullscreenElement = root; doc.dispatchEvent(new Event('fullscreenchange')); } };
  const target = new EventTarget();
  let heard = 0;
  target.addEventListener('keydown', () => heard++);
  const d = createFullscreenToggle(root, { target, keyboard: null, giveBackEscape: false, schedule: null, gamepads: () => [] });
  await d.toggle();
  doc.fullscreenElement = null;
  doc.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(heard, 0);
  d.destroy();
});

// BlastEm's layout: the game's buttons, their keys, and the pad button each one is.
const MD = [
  { id: 'a', code: 'KeyA', button: 0 },
  { id: 'b', code: 'KeyS', button: 1 },
  { id: 'c', code: 'KeyD', button: 5 },
  { id: 'x', code: 'KeyQ', button: 2 },
  { id: 'y', code: 'KeyW', button: 3 },
  { id: 'z', code: 'KeyE', button: 4 },
  { id: 'start', code: 'Enter', button: 9 },
  { id: 'up', code: 'ArrowUp', button: 12 },
];

test('menuKeyAliases: the keys of the pad buttons the menus use, minus the menus\' own keys', () => {
  assert.deepEqual(menuKeyAliases(MD), { KeyA: 'accept', KeyS: 'back', KeyD: 'next', KeyW: 'more' });
  assert.deepEqual(menuKeyAliases([{ code: 'KeyJ', button: 0 }, { code: 'KeyK' }, { button: 1 }]), { KeyJ: 'accept' });
});

test('menuKeyHint: the key shown next to a pad button', () => {
  assert.equal(menuKeyHint(MD, 0), 'A');
  assert.equal(menuKeyHint(MD, 1), 'S');
  assert.equal(menuKeyHint(MD, 2), ''); // Q is the menus' prev
  assert.equal(menuKeyHint(MD, 9), ''); // Enter is the menus' accept
});

test('createInput: key aliases act in menus, not in game, not while muted or typing', () => {
  const target = new EventTarget();
  const input = createInput({ target, schedule: null, gamepads: () => [] });
  const heard = [];
  input.on((action) => heard.push(action));
  const press = (code, { field = false } = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key: code.replace(/^Key/, '').toLowerCase(), code, repeat: false });
    // Typing in a field: the event's target is the field (read-only on an Event, so shadowed).
    if (field) Object.defineProperty(event, 'target', { value: { tagName: 'INPUT' } });
    target.dispatchEvent(event);
    return event;
  };
  press('KeyS');
  assert.deepEqual(heard, []);
  input.setKeyAliases(menuKeyAliases(MD));
  const ev = press('KeyS');
  assert.deepEqual(heard, ['back']);
  assert.equal(ev.defaultPrevented, true);
  press('KeyA');
  assert.deepEqual(heard, ['back', 'accept']);
  input.suspend();
  press('KeyA');
  input.resume();
  const unmute = input.mute();
  press('KeyA');
  unmute();
  press('KeyA', { field: true });
  assert.deepEqual(heard, ['back', 'accept']);
  input.setKeyAliases({});
  press('KeyA');
  assert.deepEqual(heard, ['back', 'accept']);
  input.destroy();
});

test('createWakeLock: held while active and visible, taken again on return', async () => {
  const locks = [];
  const wakeLock = {
    async request() {
      const listeners = [];
      const lock = { released: false, async release() { lock.released = true; listeners.forEach((l) => l()); }, addEventListener: (_t, l) => listeners.push(l) };
      locks.push(lock);
      return lock;
    },
  };
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const handle = createWakeLock({ wakeLock, document: doc });
  handle.setActive(true);
  await new Promise((r) => setTimeout(r));
  assert.equal(handle.held, true);
  await locks[0].release(); // the browser drops it on hide
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  await new Promise((r) => setTimeout(r));
  assert.equal(locks.length, 2);
  assert.equal(handle.held, true);
  handle.setActive(false);
  await new Promise((r) => setTimeout(r));
  assert.equal(handle.held, false);
  assert.equal(locks[1].released, true);
});

test('frameStats: fps, mean and worst frame time, dropped frames', () => {
  const times = [0, 16.7, 33.3, 50, 100, 116.7];
  const stats = frameStats(times, 60);
  assert.equal(stats.dropped, 2);
  assert.equal(stats.worst, 50);
  assert.ok(Math.abs(stats.avg - 116.7 / 5) < 0.01);
  assert.deepEqual(frameStats([5]), { fps: 0, avg: 0, worst: 0, dropped: 0 });
});

test('framesDue and createFrameClock: frames counted on the audio clock, not the display', () => {
  assert.deepEqual(framesDue(50, 60, 0).frames, 3);
  const { frames, carried } = framesDue(10, 60, 10);
  assert.equal(frames, 1);
  assert.ok(Math.abs(carried - (20 - 1000 / 60)) < 1e-9);

  let page = 0;
  const audio = { currentTime: 0, state: 'running' };
  const clock = createFrameClock({ fps: 60, mode: 'audio', audioContext: audio, now: () => page, schedule: null });
  const ticks = [];
  clock.start((n) => ticks.push(n));
  clock.step(); // first reading
  // A 120 Hz display: two page frames per audio frame.
  for (let i = 0; i < 4; i++) {
    page += 1000 / 120;
    audio.currentTime += 1 / 120;
    clock.step();
  }
  assert.deepEqual(ticks.slice(1).reduce((a, b) => a + b, 0), 2);
  // A stall: the backlog is capped.
  audio.currentTime += 1;
  clock.step();
  assert.equal(ticks.at(-1), 4);
});

test('createInput: Y does not fire while Select is held (Select + Y is fullscreen)', () => {
  const state = { pads: [pad([8, 3])] };
  const input = createInput({ target: new EventTarget(), gamepads: () => state.pads, now: () => 0, schedule: null });
  const seen = [];
  input.on((action) => seen.push(action));
  input.poll();
  state.pads = [pad([3])];
  input.poll();
  assert.deepEqual(seen, []); // still held from the combo: no new press
  state.pads = [pad()];
  input.poll();
  state.pads = [pad([3])];
  input.poll();
  assert.deepEqual(seen, ['more']);
});

test('0.6.1: bindings by physical key — labels, swaps, and key + code moving together', () => {
  assert.deepEqual(['KeyX', 'Digit1', 'ArrowUp', 'ShiftRight', 'Numpad4', 'Space', 'F2'].map(codeLabel), ['X', '1', '↑', 'Shift (R)', 'Num 4', 'Space', 'F2']);
  const defaults = { a: { code: 'KeyX', button: 0 }, b: { code: 'KeyZ', button: 1 } };
  assert.deepEqual(controlsModel([{ id: 'a', label: 'A' }], defaults).map((r) => r.keyLabel), ['X']);
  // B takes X (captured: key and code): A gets Z.
  assert.deepEqual(bindControl(defaults, 'b', { key: 'x', code: 'KeyX' }), {
    a: { code: 'KeyZ', button: 0 },
    b: { key: 'x', code: 'KeyX', button: 1 },
  });
  // Without codes, keys still compare by key.
  assert.deepEqual(bindControl({ a: { key: 'q' } }, 'b', { key: 'q' }), { a: {}, b: { key: 'q' } });
});
