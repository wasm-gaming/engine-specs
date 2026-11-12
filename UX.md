# The usability scheme

Every wasm-gaming screen — the launcher's menus and each engine's own app (start screen, load
game, pause menu, options) — follows these rules, so moving between them never changes how the
controls behave. The runtime is in `@wasm-gaming/engine-specs`: `createInput()`, `nextFocus()`,
`UI_TOKENS`. Gamepad first; the keyboard mirrors it.

## Actions

Menus react to actions, never to raw keys or buttons.

| action | gamepad (standard mapping) | keyboard |
| --- | --- | --- |
| `up` `down` `left` `right` | d-pad, left stick | arrows |
| `accept` | A (0) | Enter, Space |
| `back` | B (1) | Escape, Backspace |
| `more` — secondary menu, details | Y (3), X (2) | Tab, V, ContextMenu |
| `menu` — pause / main menu | Start (9), Select + Start | F1 |
| `prev` / `next` — tabs, pages | LB (4) / RB (5) | Q / E |

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
4. **`menu` opens and closes the pause menu** from anywhere in the game. The pause menu always
   offers, in this order: Continue, the engine's own entries (load / save state, options…), and
   Exit to the library.
5. **While a menu is open the game gets no input**, and while the game runs the menus get none:
   `input.suspend()` / `input.resume()`; the engine is paused (`play.pause(owner)`).
6. **`more` opens what is secondary** for the focused element (versions, details, delete). It never
   performs a destructive action directly; deletion asks for confirmation, defaulting to No.
7. **Text never needs a keyboard to proceed.** Anything typed (names, filters) has a gamepad path.
8. **Readable at a distance:** body ≥ 16 px at 1080p, focusable targets ≥ 48 px, titles in
   `--wg-font-display`, the rest in `--wg-font-ui`; content inside the safe areas.
9. **Hints show the gamepad glyph first** (A / B / Y with their colours), then the key.

## Engine apps

An engine app (`<id>/app/app.js`) implements `EngineApp`: `mount(target, host)` draws the engine's
screens into `target` and runs the game; the host passes `game`, `storage.namespace`, `assets`
(thunks), the shared `input`, and `exit()`. The app owns everything between "the player chose this
game" and "the player left it".
