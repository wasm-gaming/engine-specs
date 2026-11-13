// The usability scheme's runtime: what a key or a button turns into, when it repeats,
// and where focus goes. Fake clock, fake gamepads, fake layout — no browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput, nextFocus, uiTokensCss, UI_REPEAT } from '../dist/engine-specs.js';

const keyEvent = (key, extra = {}) => {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { key, repeat: false, ...extra });
  return event;
};

function setup({ pads = [] } = {}) {
  const target = new EventTarget();
  let clock = 0;
  const state = { pads };
  const input = createInput({ target, gamepads: () => state.pads, now: () => clock, schedule: null });
  const seen = [];
  input.on((action, detail) => seen.push(`${action}:${detail.source}${detail.repeat ? ':repeat' : ''}`));
  return { input, target, seen, state, tick: (ms) => { clock += ms; input.poll(); } };
}

const pad = (pressed = [], axes = [0, 0]) => ({
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
  axes,
});

test('keyboard keys map to actions and are swallowed', () => {
  const { target, seen } = setup();
  const enter = keyEvent('Enter');
  target.dispatchEvent(enter);
  target.dispatchEvent(keyEvent('Escape'));
  target.dispatchEvent(keyEvent('ArrowLeft', { repeat: true }));
  target.dispatchEvent(keyEvent('x')); // unmapped: ignored
  assert.deepEqual(seen, ['accept:keyboard', 'back:keyboard', 'left:keyboard:repeat']);
  assert.equal(enter.defaultPrevented, true);
});

test('in game (suspended): only the menu combo gets through', () => {
  const { input, target, seen, state, tick } = setup();
  input.suspend();
  const enter = keyEvent('Enter');
  target.dispatchEvent(enter);
  assert.deepEqual(seen, []);
  assert.equal(enter.defaultPrevented, false);
  const escape = keyEvent('Escape');
  target.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  state.pads = [pad([9])]; // plain Start: the game's
  tick(0);
  state.pads = [pad([])];
  tick(16);
  state.pads = [pad([8, 9])]; // Select + Start: the menu
  tick(16);
  state.pads = [pad([])];
  tick(16);
  assert.deepEqual(seen, ['menu:keyboard', 'menu:gamepad']);
  seen.length = 0;
  input.resume();
  target.dispatchEvent(keyEvent('Enter'));
  assert.deepEqual(seen, ['accept:keyboard']);
});

test('typing in a field is left alone, except Escape', () => {
  // A form field as the event target (a real <input> in the browser).
  class Field extends EventTarget { tagName = 'INPUT'; }
  const field = new Field();
  const input = createInput({ target: field, gamepads: () => [], schedule: null });
  const seen = [];
  input.on((action) => seen.push(action));
  const typed = keyEvent('v');
  field.dispatchEvent(typed);
  field.dispatchEvent(keyEvent('Escape'));
  assert.deepEqual(seen, ['back']);
  assert.equal(typed.defaultPrevented, false);
});

test('gamepad: press fires once, held directions repeat on schedule', () => {
  const { seen, state, tick } = setup();
  state.pads = [pad([13])]; // d-pad down
  tick(0);
  tick(UI_REPEAT.delay - 1); // not yet
  tick(1); // first repeat at delay
  tick(UI_REPEAT.interval - 1); // too soon
  tick(1); // second repeat
  state.pads = [pad([])];
  tick(16);
  assert.deepEqual(seen, ['down:gamepad', 'down:gamepad:repeat', 'down:gamepad:repeat']);
});

test('gamepad: buttons do not repeat, the stick moves', () => {
  const { seen, state, tick } = setup();
  state.pads = [pad([0])];
  tick(0);
  tick(1000);
  state.pads = [pad([], [0.9, 0])];
  tick(16);
  assert.deepEqual(seen, ['accept:gamepad', 'right:gamepad']);
});

test('Select + Start is menu, and neither fires alone meanwhile', () => {
  const { seen, state, tick } = setup();
  state.pads = [pad([8, 9])];
  tick(0);
  state.pads = [pad([])];
  tick(16);
  state.pads = [pad([9])];
  tick(16);
  assert.deepEqual(seen, ['menu:gamepad', 'menu:gamepad']);
});

const box = (left, top, width = 100, height = 100) => ({
  name: `${left},${top}`,
  getBoundingClientRect: () => ({ left, top, width, height }),
});

test('nextFocus: straight ahead beats closer but sideways', () => {
  const from = box(0, 0);
  const below = box(0, 300);
  const diagonal = box(180, 150);
  const right = box(200, 0);
  const all = [from, below, diagonal, right];
  assert.equal(nextFocus(from, all, 'down'), below);
  assert.equal(nextFocus(from, all, 'right'), right);
  assert.equal(nextFocus(from, all, 'up'), null);
  assert.equal(nextFocus(from, all, 'left'), null);
});

test('tokens render as one CSS rule', () => {
  const css = uiTokensCss('.app');
  assert.match(css, /^\.app \{/);
  assert.match(css, /--wg-focus-ring: 0 0 0 3px #ffffff;/);
});

test('a listener added while an action is delivered gets the next one, not that one', () => {
  const { input, target } = setup();
  const second = [];
  const offFirst = input.on((action) => {
    if (action !== 'accept') return;
    offFirst(); // the home screen closes…
    input.on((next) => second.push(next)); // …and the console screen subscribes
  });
  target.dispatchEvent(keyEvent('Enter'));
  assert.deepEqual(second, []);
  target.dispatchEvent(keyEvent('Enter'));
  assert.deepEqual(second, ['accept']);
});

test('a listener removed by an earlier one in the same dispatch is not called', () => {
  const { input, target } = setup();
  const calls = [];
  let offLater;
  input.on((action) => { calls.push(`first:${action}`); offLater(); });
  offLater = input.on((action) => calls.push(`later:${action}`));
  target.dispatchEvent(keyEvent('Escape'));
  assert.deepEqual(calls, ['first:back']);
});
