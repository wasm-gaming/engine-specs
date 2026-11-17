# The usability scheme

Every wasm-gaming screen — the launcher's menus and each engine's own app (start screen, load
game, pause menu, options) — follows these rules, so moving between them never changes how the
controls behave. The runtime is in `@wasm-gaming/engine-specs`: `createInput()`, `nextFocus()`,
`UI_TOKENS`, and for touch screens `createTouchPad()`. Gamepad first; the keyboard and the touch
pad mirror it.

## Actions

Menus react to actions, never to raw keys or buttons.

| action | gamepad (standard mapping) | keyboard |
| --- | --- | --- |
| `up` `down` `left` `right` | d-pad, left stick | arrows |
| `accept` | A (0) | Enter, Space |
| `back` | B (1) | Escape, Backspace |
| `more` — secondary menu, details | Y (3), X (2) | Tab, V, ContextMenu |
| `menu` — pause / main menu | Start (9) in menus; Select + Start always | F1; Escape in game |
| `prev` / `next` — tabs, pages | LB (4) / RB (5) | Q / E |

**The keys bound to the pad's buttons work too.** An engine app hands the launcher's input the
keys of its controls (`menuKeyAliases()` → `input.setKeyAliases()`): the key bound to the game's A
accepts like the pad's A, the one bound to B goes back, and so on. A key the table above already
uses keeps its meaning. Hints show the pad button with its key next to it (`menuKeyHint()`).

Directions repeat while held: first after **380 ms**, then every **110 ms**. Buttons never repeat.
Select + Start pressed together is `menu`, and then neither fires on its own.

## Rules

1. **One element is always focused** while a menu is open, and the focus is always visible: the
   white ring (`--wg-focus-ring`), with a slight lift or scale. Opening a menu focuses its most
   likely choice (Continue, the last slot used, the newest version).
2. **Directions move spatially** (`nextFocus()`): to the nearest element ahead, preferring the one
   straight in line. Grids wrap only where the layout makes the wrap obvious.
3. **`accept` acts on the focused element. `back` goes up one level.** At the top level of a game's
   menus, `back` asks before leaving the game; it never loses progress silently.
4. **`menu` opens and closes the pause menu** from anywhere in the game. In game that is
   **Select + Start** (gamepad) or **Escape** (keyboard) — plain Start belongs to the game (it starts
   it, pauses it natively…). The pause menu always offers, in this order: Continue, the engine's own
   entries (load / save state…), **Settings**, **Fullscreen**, and Exit to the library.
5. **While a menu is open the game gets no input**, and while the game runs the menus get nothing
   but the menu combo: `input.suspend()` / `input.resume()`; the engine is paused
   (`play.pause(owner)`) whenever a menu is open.
6. **`more` opens what is secondary** for the focused element (versions, details, delete). It never
   performs a destructive action directly; deletion asks for confirmation, defaulting to No.
7. **Text never needs a keyboard to proceed.** Anything typed (names, filters) has a gamepad path.
8. **Readable at a distance:** body ≥ 16 px at 1080p, focusable targets ≥ 48 px, titles in
   `--wg-font-display`, the rest in `--wg-font-ui`; content inside the safe areas.
9. **Hints show the gamepad glyph first** (A / B / Y with their colours), then the key.

## Touch (phones and tablets)

On a touch screen the game gets an on-screen gamepad, `createTouchPad()`, and the menus are
tapped.

- **One layout per console** (`TOUCH_LAYOUTS`: Mega Drive, Neo Geo, SNES, GBA, GBC, GB), with
  the console's own button names and shapes. Each label presses the standard-mapping button
  the console's emulator already reads for it, so the pad is a gamepad like any other.
- **Portrait: the pad takes the bottom half**, the game the top half. **Landscape: the pad
  sits on the sides** of the game. When sides wide enough would shrink the game below 70 % of
  the screen's height (a 4:3 tablet), the game keeps the screen and the controls overlay its
  edges, more transparent.
- **The pause button** (two bars) replaces Select + Start: top of the pad in portrait, top
  right in landscape. It opens the pause menu — `input.trigger('menu')` — and never reaches
  the game.
- **The pad is there only while the game has the controls.** It shows when the shared input is
  suspended and goes when a menu opens (`connectTouchPad(pad, input)`); in a menu, every
  focusable element answers a tap: it takes the focus and acts as `accept`.
- **It appears on the first touch and goes when a key is pressed or a physical gamepad
  connects**, and comes back with the next touch.
- **Fingers**: any number at once. A finger keeps what it landed on: it slides around the
  d-pad (eight directions by angle, a dead zone on the hub) or across the buttons (the gap
  between two neighbours presses both); it lets a key go by sliding off it. Nothing stays
  pressed after a lift, a cancelled touch, a lost focus or a hidden page. A tap shorter than a
  frame is held 50 ms, so the game sees it.
- **Targets ≥ 48 px** (rule 8), inside the safe areas; a short vibration on press where the
  device has one. Hints show touch glyphs when the last action came from `'touch'`.

## Languages

Every screen speaks **English and Spanish**, and falls back to English. The host passes its
language (`EngineAppHost.locale`); without it the app uses `resolveLocale()` (the browser's,
else English). Player-facing text is `Localized` (`{ en, es }`) and read through `localize()`.
Code, comments and SDK error messages are English only: the app shows its own words and keeps the
SDK's message as a detail.

## Settings

"Settings" in the pause menu opens `createSettingsScreen()`. What it shows comes from the
engine's own descriptors: every property with a `label` is a setting (`settingsModel()`).

- **Sections**, in this order, each shown only when it has rows: Video, Audio, Emulation, Game,
  Controls.
- **A row** shows its label and its value. A setting that is not `live` says "Applies on
  restart".
- **`up` / `down`** move. **`left` / `right`** change the value, and so does **`accept`**:
  enums and switches wrap around; a numeric scale (volume) stops at its ends. On touch, a tap
  steps forward.
- **`more`** shows the row's description. **`back`** closes the screen, back to the pause menu.
- A change applies at once when it is live, and is **saved either way**, per engine, for all its
  games (`saveSettings()`, OPFS `settings/<engine>.json`). The game stays paused behind the
  screen; the picture shows a video change under it.
- The last row, **"Reset to defaults"**, asks first, with No focused (rule 6).
- The shared settings, offered by every engine that can honour them:
  - Video → "Keep the screen on" (on by default): a Wake Lock while playing, released on pause.
  - Video → "Show performance": frames per second, frame time, dropped frames.
  - Emulation → "Sync: display / audio", where the app drives the frame loop: the audio clock
    keeps the speed steady on 120 Hz screens.

## Controls

The "Controls" section lists the engine's buttons, each with its key and its gamepad button.

- `accept` on a row waits for the next key or button (the shared input is suspended meanwhile);
  **Escape cancels**.
- A key or button another row already had is **swapped** with it, never shared.
- Saved with the settings; "Reset to defaults" restores them too.

## Fullscreen

- **Keyboard: Cmd+Enter on macOS, Alt+Enter on Windows and Linux.** F11 is the browser's own.
  It is ignored in text fields.
- **Gamepad: Select + Y.** Select + Start stays the menu.
- It works in game and in menus, and the pause menu has the entry too: some browsers grant
  fullscreen only to a click or a key, not to a pad press.
- **Escape keeps opening the pause menu in fullscreen.** Where the browser lets a page lock
  Escape (Keyboard Lock: Chrome, Edge), it is locked while fullscreen: Escape is the menu, and
  **holding** Escape leaves fullscreen (the browser says so). Where it does not (Firefox, Safari),
  Escape leaves fullscreen and that Escape is given back to the page, so the pause menu opens too.

## Engine apps

An engine app (`<id>/app/app.js`) implements `EngineApp`: `mount(target, host)` draws the engine's
screens into `target` and runs the game; the host passes `game`, `storage.namespace`, `assets`
(thunks), the shared `input`, and `exit()`. The app owns everything between "the player chose this
game" and "the player left it".
