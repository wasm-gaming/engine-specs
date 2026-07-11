# Usage

This package defines the shared contract between a frontend host and a WASM engine package.

The host usually does three things:

1. Reads the engine manifest.
2. Validates the manifest before showing the game in the UI.
3. Loads the engine into a `<canvas>` and forwards input, pause/resume, and save-state actions.

`sdk.load()` accepts `canvasEl`, `attachTo`, or both, but requires at least one.

## 1) Load and validate the manifest

Use the runtime validator before rendering any engine-specific UI. This keeps a broken manifest from reaching the player.

```ts
import { validateManifest, assertManifest } from '@wasm-gaming/engine-specs';

const response = await fetch('/engines/sonic/manifest.json');
const manifestJson = await response.json();

const result = validateManifest(manifestJson);

if (!result.valid) {
  console.error('Invalid engine manifest', result.errors);
  throw new Error('Cannot start engine');
}

const manifest = assertManifest(manifestJson);
```

## 2) Vanilla frontend bootstrap

This is the smallest host integration: create a container and canvas, load the engine package, and mount the runtime assets the engine asks for.

Minimal host markup:

```html
<div id="game-root">
  <canvas id="game-canvas" width="320" height="240"></canvas>
</div>
```

```ts
import type { EngineSDK } from '@wasm-gaming/engine-specs';

async function startEngine() {
  const mountEl = document.querySelector<HTMLElement>('#game-root');
  if (!mountEl) {
    throw new Error('Missing #game-root');
  }

  const canvasEl = document.querySelector<HTMLCanvasElement>('#game-canvas');
  if (!canvasEl) {
    throw new Error('Missing #game-canvas');
  }

  const engineModule = await import('@acme/sonic-engine');
  const sdk = engineModule.default as EngineSDK;

  const romResponse = await fetch('/roms/sonic.bin');
  const rom = await romResponse.arrayBuffer();

  const instance = await sdk.load({
    attachTo: mountEl,
    canvasEl,
    assets: {
      rom,
    },
    options: {
      region: 'auto',
    },
    persist: 'opfs',
    storageNamespace: 'sonic1',
    onEvent(event) {
      if (event.type === 'error') {
        console.error(event.error);
      }
    },
  });

  instance.start();

  return instance;
}
```

## 3) React host component

In React, keep the engine instance outside render state and initialize it from a `ref`.

```tsx
import { useEffect, useRef } from 'react';
import type { EngineInstance } from '@wasm-gaming/engine-specs';

type PlayerProps = {
  engineUrl: string;
  romUrl: string;
};

export function Player({ engineUrl, romUrl }: PlayerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const instanceRef = useRef<EngineInstance | null>(null);

  useEffect(() => {
    let disposed = false;

    async function boot() {
      const mountEl = mountRef.current;
      const canvasEl = canvasRef.current;
      if (!mountEl || !canvasEl) {
        return;
      }

      const engineModule = await import(engineUrl);
      const sdk = engineModule.default;

      const romResponse = await fetch(romUrl);
      const rom = await romResponse.arrayBuffer();

      if (disposed) {
        return;
      }

      instanceRef.current = await sdk.load({
        attachTo: mountEl,
        canvasEl,
        assets: { rom },
        persist: 'idbfs',
        storageNamespace: 'session-1',
      });

      instanceRef.current.start();
    }

    void boot();

    return () => {
      disposed = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [engineUrl, romUrl]);

  return (
    <div ref={mountRef} id="game-root">
      <canvas ref={canvasRef} id="game-canvas" width={320} height={240} />
    </div>
  );
}
```

## 4) Forward UI actions to the engine

The host can wire buttons and keyboard shortcuts directly to the engine instance.

```ts
function wireControls(instance: { pause(): void; resume(): void; reset(): void; setInput(map: Record<string, string>): void }) {
  document.querySelector('#pause')?.addEventListener('click', () => instance.pause());
  document.querySelector('#resume')?.addEventListener('click', () => instance.resume());
  document.querySelector('#reset')?.addEventListener('click', () => instance.reset());

  window.addEventListener('keydown', (event) => {
    if (event.key === 'F1') {
      instance.setInput({
        up: 'ArrowUp',
        down: 'ArrowDown',
        left: 'ArrowLeft',
        right: 'ArrowRight',
        a: 'KeyZ',
        b: 'KeyX',
      });
    }
  });
}
```

## 5) Save states and screenshots

Only call capability-gated methods when the engine manifest says they are supported.

```ts
if (manifest.capabilities.saveStates && instance.saveState) {
  const blob = await instance.saveState();
  console.log('Save state size', blob.byteLength);
}

if (instance.screenshot) {
  const screenshot = await instance.screenshot();
  const url = URL.createObjectURL(screenshot);
  // Use the screenshot in the UI, then revoke the object URL when done.
  URL.revokeObjectURL(url);
}
```

## Recommended host flow

1. Fetch the engine manifest.
2. Validate it with `validateManifest()` or `assertManifest()`.
3. Show the asset requirements from `manifest.assets` in the file picker UI.
4. Create a container element plus the `<canvas>`, then load the engine package.
5. Pass at least one mount target (`attachTo`, `canvasEl`, or both), plus runtime assets, options, and persistence mode into `sdk.load()`.
6. Keep the returned instance in a ref or controller object and tear it down with `destroy()` when leaving the player.

## Notes

- `@wasm-gaming/engine-specs` is ESM-only and ships type exports plus runtime validation helpers.
- Engine packages are expected to default-export `{ manifest, load }`.
- Hosts should treat `manifest.assets` as the source of truth for file pickers and validation hints.
