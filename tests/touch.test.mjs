// The touch pad without a browser: where the controls go, what a finger presses, and
// how the pad reaches the engines (the Gamepad API) and the menus (the shared input).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOUCH_LAYOUTS,
  TOUCH_PAD_ID,
  placeTouchPad,
  touchDpadAt,
  touchFacesAt,
  createTouchPadCore,
  exposeAsGamepad,
  connectTouchPad,
  createInput,
} from '../dist/engine-specs.js';

const PHONE_PORTRAIT = { width: 390, height: 844, safe: { top: 47, right: 0, bottom: 34, left: 0 } };
const PHONE_LANDSCAPE = { width: 844, height: 390, safe: { top: 0, right: 47, bottom: 21, left: 47 } };
const TABLET_LANDSCAPE = { width: 1180, height: 820 };

const within = (inner, outer) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const centre = (r) => [r.x + r.width / 2, r.y + r.height / 2];

test('one layout per system, every label on a distinct standard button', () => {
  assert.deepEqual(Object.keys(TOUCH_LAYOUTS).sort(), ['gb', 'gba', 'gbc', 'megadrive', 'neogeo', 'snes']);
  for (const layout of Object.values(TOUCH_LAYOUTS)) {
    const indices = [...layout.faces, layout.l, layout.r, layout.select, layout.start]
      .filter(Boolean)
      .map((key) => key.index);
    assert.equal(new Set(indices).size, indices.length, `${layout.system}: two labels on one button`);
    for (const index of indices) assert.ok(index >= 0 && index <= 11, `${layout.system}: ${index} is not a button`);
  }
  // The emulators' own defaults (see the TOUCH_LAYOUTS docs).
  const byLabel = (system) => Object.fromEntries(TOUCH_LAYOUTS[system].faces.map((f) => [f.label, f.index]));
  assert.deepEqual(byLabel('megadrive'), { A: 0, B: 1, C: 5, X: 2, Y: 3, Z: 4 });
  assert.deepEqual(byLabel('neogeo'), { A: 0, B: 1, C: 2, D: 3 });
  assert.deepEqual(byLabel('snes'), { B: 0, A: 1, Y: 2, X: 3 });
  assert.deepEqual(byLabel('gba'), { A: 0, B: 1 });
});

test('portrait: the pad takes the bottom half, the game the top half', () => {
  for (const system of Object.keys(TOUCH_LAYOUTS)) {
    const p = placeTouchPad(TOUCH_LAYOUTS[system], PHONE_PORTRAIT);
    assert.equal(p.orientation, 'portrait');
    assert.equal(p.overlay, false);
    assert.deepEqual(p.zones, [{ x: 0, y: 422, width: 390, height: 422 }]);
    assert.equal(p.gameArea.y, 47, 'below the notch');
    assert.equal(p.gameArea.y + p.gameArea.height, 422, 'down to the half');
    const zone = p.zones[0];
    for (const control of [p.dpad, p.cluster, ...p.keys.map((k) => k.rect)]) {
      assert.ok(within(control, zone), `${system}: ${JSON.stringify(control)} outside the half`);
      assert.ok(control.y + control.height <= 844 - 34, `${system}: under the home indicator`);
    }
    assert.ok(p.dpad.x + p.dpad.width <= p.cluster.x, 'd-pad left of the buttons');
    const keys = p.keys.map((k) => k.rect);
    for (let i = 0; i < keys.length; i++) {
      assert.ok(!overlaps(keys[i], p.dpad) && !overlaps(keys[i], p.cluster), `${system}: a key covers a stick`);
      for (let j = i + 1; j < keys.length; j++) assert.ok(!overlaps(keys[i], keys[j]), `${system}: keys overlap`);
    }
  }
});

test('landscape on a phone: the controls sit on the sides of the game', () => {
  const p = placeTouchPad(TOUCH_LAYOUTS.megadrive, PHONE_LANDSCAPE);
  assert.equal(p.orientation, 'landscape');
  assert.equal(p.overlay, false);
  assert.equal(p.zones.length, 2);
  const [left, right] = p.zones;
  assert.ok(p.dpad.x + p.dpad.width <= p.gameArea.x, 'd-pad left of the picture');
  assert.ok(p.cluster.x >= p.gameArea.x + p.gameArea.width, 'buttons right of the picture');
  assert.ok(within(p.dpad, left) && within(p.cluster, right));
  assert.ok(Math.abs(p.gameArea.width / p.gameArea.height - 4 / 3) < 0.02, 'the game keeps its shape');
  assert.ok(p.gameArea.height >= 0.7 * (390 - 21), 'the game is not shrunk below 70 %');
  assert.ok(p.dpad.x >= 47, 'clear of the notch');
});

test('landscape on a tablet: sides would shrink the game too much, so the controls overlay it', () => {
  const p = placeTouchPad(TOUCH_LAYOUTS.snes, TABLET_LANDSCAPE);
  assert.equal(p.overlay, true);
  assert.deepEqual(p.gameArea, { x: 0, y: 0, width: 1180, height: 820 });
  assert.ok(p.dpad.x < 300 && p.cluster.x > 880, 'still at the edges');
});

test('the d-pad: eight directions by angle, a dead zone on the hub', () => {
  const dpad = { x: 0, y: 0, width: 150, height: 150 };
  const at = (dx, dy) => touchDpadAt(dpad, 75 + dx, 75 + dy).sort((a, b) => a - b);
  assert.deepEqual(at(0, 0), []);
  assert.deepEqual(at(5, 5), [], 'resting on the hub');
  assert.deepEqual(at(0, -60), [12]);
  assert.deepEqual(at(0, 60), [13]);
  assert.deepEqual(at(-60, 0), [14]);
  assert.deepEqual(at(60, 0), [15]);
  assert.deepEqual(at(50, -50), [12, 15]);
  assert.deepEqual(at(-50, 50), [13, 14]);
  assert.deepEqual(at(60, -20), [15], '18° above the axis is still right');
  assert.deepEqual(at(400, 0), [15], 'no outer limit: the thumb may drift');
});

test('face buttons: the gap between two neighbours presses both', () => {
  const p = placeTouchPad(TOUCH_LAYOUTS.megadrive, PHONE_PORTRAIT);
  const face = (label) => p.faces.find((f) => f.label === label);
  const a = face('A');
  const b = face('B');
  assert.deepEqual(touchFacesAt(p, a.cx, a.cy), [0]);
  assert.deepEqual(touchFacesAt(p, (a.cx + b.cx) / 2, (a.cy + b.cy) / 2).sort(), [0, 1]);
  for (const f of p.faces) assert.ok(Math.max(f.r * 1.18, 24) * 2 >= 48, 'every target at least 48 px');
});

function core(layout = TOUCH_LAYOUTS.megadrive, viewport = PHONE_PORTRAIT) {
  let clock = 1000;
  const pad = createTouchPadCore({ now: () => clock, minHold: 50 });
  const placement = placeTouchPad(layout, viewport);
  pad.place(placement);
  const changes = [];
  pad.onChange((down) => changes.push(down));
  return { pad, placement, changes, advance: (ms) => (clock += ms) };
}
const pressed = (pad) => [...pad.pressed()].sort((a, b) => a - b);

test('fingers: d-pad, a button and another button at once', () => {
  const { pad, placement } = core();
  const [dx, dy] = centre(placement.dpad);
  const face = (label) => placement.faces.find((f) => f.label === label);
  assert.equal(pad.down(1, dx, dy - placement.dpad.height * 0.4), 'dpad');
  assert.equal(pad.down(2, face('A').cx, face('A').cy), 'cluster');
  assert.equal(pad.down(3, face('Y').cx, face('Y').cy), 'cluster');
  assert.deepEqual(pressed(pad), [0, 3, 12]);
  assert.equal(pad.gamepad.mapping, 'standard');
  assert.equal(pad.gamepad.id, TOUCH_PAD_ID);
  assert.equal(pad.gamepad.buttons.length, 17);
  assert.equal(pad.gamepad.buttons[0].value, 1);
});

test('a finger slides: across the buttons, around the d-pad, off a key', () => {
  const { pad, placement, advance } = core();
  const face = (label) => placement.faces.find((f) => f.label === label);
  pad.down(1, face('A').cx, face('A').cy);
  advance(100);
  pad.move(1, face('B').cx, face('B').cy);
  assert.deepEqual(pressed(pad), [1], 'slid from A to B without lifting');

  const [dx, dy] = centre(placement.dpad);
  pad.down(2, dx - 60, dy);
  advance(100);
  pad.move(2, dx + 60, dy);
  assert.deepEqual(pressed(pad), [1, 15]);

  const start = placement.keys.find((k) => k.id === 'start');
  pad.down(3, ...centre(start.rect));
  assert.ok(pad.pressed().has(9));
  advance(100);
  pad.move(3, start.rect.x - 100, start.rect.y);
  assert.ok(!pad.pressed().has(9), 'sliding off a key lets it go');
});

test('nothing is ever stuck: releaseAll, and a new placement, let every finger go', () => {
  const { pad, placement } = core();
  pad.down(1, ...centre(placement.dpad).map((v, i) => (i ? v - 50 : v)));
  pad.down(2, placement.faces[0].cx, placement.faces[0].cy);
  assert.ok(pad.pressed().size > 0);
  pad.releaseAll();
  assert.deepEqual(pressed(pad), []);
  pad.down(3, placement.faces[0].cx, placement.faces[0].cy);
  pad.place(placement);
  assert.deepEqual(pressed(pad), []);
});

test('a tap shorter than a frame is held for minHold, then released', () => {
  const { pad, placement, advance, changes } = core();
  const a = placement.faces.find((f) => f.label === 'A');
  pad.down(1, a.cx, a.cy);
  const before = pad.gamepad.timestamp;
  advance(5);
  pad.up(1);
  assert.deepEqual(pressed(pad), [0], 'still down after a 5 ms tap');
  assert.equal(pad.deadline, 1050);
  advance(44);
  pad.tick();
  assert.deepEqual(pressed(pad), [0]);
  advance(1);
  pad.tick();
  assert.deepEqual(pressed(pad), []);
  assert.ok(pad.gamepad.timestamp > before, 'the timestamp moves with every change');
  assert.deepEqual(changes, [[0], []]);
  assert.equal(pad.deadline, null);
});

test('a long press is released at once', () => {
  const { pad, placement, advance } = core();
  const a = placement.faces.find((f) => f.label === 'A');
  pad.down(1, a.cx, a.cy);
  advance(200);
  pad.up(1);
  assert.deepEqual(pressed(pad), []);
});

test('the pause button presses nothing and asks for the menu', () => {
  const { pad, placement } = core();
  let asked = 0;
  pad.onPause(() => asked++);
  const pause = placement.keys.find((k) => k.id === 'pause');
  assert.equal(pad.down(1, ...centre(pause.rect)), 'pause');
  assert.equal(asked, 1);
  assert.deepEqual(pressed(pad), []);
});

test('outside every control a finger takes nothing', () => {
  const { pad } = core();
  assert.equal(pad.down(1, 5, 800), null, 'the corner under the d-pad');
  assert.equal(pad.down(2, 10, 10), null, 'in the game area');
});

test('where the d-pad and the buttons meet, the nearer one takes the finger', () => {
  const { pad, placement } = core(TOUCH_LAYOUTS.snes);
  const y = placement.cluster.y + placement.cluster.height / 2;
  assert.equal(pad.down(1, placement.cluster.x + 2, y), 'cluster', 'the edge of the buttons');
  assert.equal(pad.down(2, placement.dpad.x + placement.dpad.width - 2, y), 'dpad', 'the edge of the d-pad');
});

function fakeNavigator(initial = []) {
  const state = { pads: initial };
  return { state, navigator: { getGamepads: () => state.pads } };
}

test('exposeAsGamepad: index 0 when no physical pad, announced, and released', () => {
  const { navigator } = fakeNavigator([null, null, null, null]);
  const target = new EventTarget();
  const seen = [];
  target.addEventListener('gamepadconnected', (e) => seen.push(['connected', e.gamepad.index]));
  target.addEventListener('gamepaddisconnected', (e) => seen.push(['disconnected', e.gamepad.index]));
  const pad = createTouchPadCore();
  const release = exposeAsGamepad(pad, { navigator, target });
  const pads = navigator.getGamepads();
  assert.equal(pads[0], pad.gamepad);
  assert.equal(pads.filter(Boolean).length, 1);
  assert.equal(pad.gamepad.connected, true);
  release();
  assert.deepEqual(navigator.getGamepads(), [null, null, null, null], 'the original getGamepads is back');
  assert.equal(pad.gamepad.connected, false);
  assert.deepEqual(seen, [['connected', 0], ['disconnected', 0]]);
});

test('exposeAsGamepad: after the physical pads, and moving when one takes its index', async () => {
  const physical = { id: 'Xbox', buttons: [], axes: [] };
  const { state, navigator } = fakeNavigator([physical]);
  const target = new EventTarget();
  const seen = [];
  target.addEventListener('gamepadconnected', (e) => seen.push(`+${e.gamepad.index}`));
  target.addEventListener('gamepaddisconnected', (e) => seen.push(`-${e.gamepad.index}`));
  const pad = createTouchPadCore();
  const release = exposeAsGamepad(pad, { navigator, target });
  assert.equal(pad.gamepad.index, 1);
  assert.deepEqual(navigator.getGamepads(), [physical, pad.gamepad]);
  state.pads = [physical, { id: 'second', buttons: [], axes: [] }];
  navigator.getGamepads();
  await Promise.resolve();
  assert.equal(pad.gamepad.index, 2);
  assert.equal(navigator.getGamepads()[2], pad.gamepad);
  assert.deepEqual(seen, ['+1', '-1', '+2']);
  release();
});

test('createInput reads the exposed pad: Select + Start in game opens the menu', () => {
  const { navigator } = fakeNavigator([]);
  const target = new EventTarget();
  const pad = createTouchPadCore();
  exposeAsGamepad(pad, { navigator, target });
  const input = createInput({ target, gamepads: () => navigator.getGamepads(), schedule: null, now: () => 0 });
  const seen = [];
  input.on((action, detail) => seen.push(`${action}:${detail.source}`));
  pad.gamepad.buttons[0].pressed = true;
  input.poll();
  assert.deepEqual(seen, ['accept:gamepad']);
});

test('connectTouchPad: shown while the game has the controls; the pause button opens the menu', () => {
  const input = createInput({ target: new EventTarget(), gamepads: () => [], schedule: null });
  const calls = [];
  let pause = null;
  const pad = {
    show: () => calls.push('show'),
    hide: () => calls.push('hide'),
    onPause: (listener) => {
      pause = listener;
      return () => (pause = null);
    },
  };
  const seen = [];
  input.on((action, detail) => seen.push(`${action}:${detail.source}`));
  const disconnect = connectTouchPad(pad, input);
  assert.deepEqual(calls, ['hide'], 'menus first');
  input.suspend();
  input.suspend(); // no change, no call
  assert.deepEqual(calls, ['hide', 'show']);
  pause();
  assert.deepEqual(seen, ['menu:touch'], 'the menu opens even in game');
  input.resume();
  assert.deepEqual(calls, ['hide', 'show', 'hide']);
  disconnect();
  input.suspend();
  assert.deepEqual(calls, ['hide', 'show', 'hide'], 'disconnected');
  assert.equal(pause, null);
});

test('no two face buttons are drawn over each other', () => {
  for (const layout of Object.values(TOUCH_LAYOUTS)) {
    const faces = layout.faces;
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        const gap = Math.hypot(faces[i].x - faces[j].x, faces[i].y - faces[j].y) - (faces[i].size + faces[j].size) / 2;
        assert.ok(gap >= 0, `${layout.system}: ${faces[i].label} and ${faces[j].label} overlap`);
      }
      assert.ok(faces[i].x - faces[i].size / 2 >= -0.01 && faces[i].x + faces[i].size / 2 <= 1.01, `${layout.system}: ${faces[i].label} spills out`);
    }
  }
});

test('Neo Geo: the Neo Geo CD pad diamond — D top, C left, B right, A bottom', () => {
  const at = Object.fromEntries(TOUCH_LAYOUTS.neogeo.faces.map((f) => [f.label, f]));
  assert.ok(at.D.y < at.C.y && at.D.y < at.B.y && at.A.y > at.C.y && at.A.y > at.B.y, 'D on top, A at the bottom');
  assert.ok(at.C.x < at.D.x && at.D.x < at.B.x && at.C.x < at.A.x && at.A.x < at.B.x, 'C left, B right');
  assert.equal(at.D.x, at.A.x);
  assert.equal(at.C.y, at.B.y);
});

test('the d-pad is drawn smaller than the buttons, in every layout and orientation', () => {
  for (const layout of Object.values(TOUCH_LAYOUTS)) {
    for (const viewport of [PHONE_PORTRAIT, PHONE_LANDSCAPE, TABLET_LANDSCAPE, { width: 834, height: 1194 }]) {
      const p = placeTouchPad(layout, viewport);
      const ratio = p.dpad.width / p.cluster.width;
      assert.ok(ratio > 0.75 && ratio < 0.85, `${layout.system} ${viewport.width}x${viewport.height}: ${ratio}`);
      assert.equal(p.dpad.width, p.dpad.height);
    }
  }
});
