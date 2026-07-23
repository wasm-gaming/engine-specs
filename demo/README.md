# Themable Engine Demo Template

This directory contains a standalone, themable web interface template for hosting interactive WASM gaming engine demos.

## 🚀 How to use in another engine repository

1. **Copy the `demo/` folder** into your engine repository.

2. **Connect your engine SDK in `demo/sdk.js`**:
   Open `demo/sdk.js` and point it to your engine SDK build:
   ```javascript
   import sdk from "../src/index.js"; // or "../dist/index.js"

   export async function getSdk() {
     return sdk;
   }
   ```
   *Alternatively*, if embedding in HTML without modifying `sdk.js`, set `window.SDK = myEngineSdk;` before `demo.js` runs.

3. **Serve the demo**:
   Serve `demo/index.html` using any local development server (e.g. `npx serve demo` or Vite).

---

## 🎨 Customizing & Theming

The demo visual design system is fully controlled via **CSS Custom Properties** defined in `demo.css`.

### Overriding CSS Variables

To apply your custom branding, override any of the `:root` variables in `demo.css` or in your own custom stylesheet:

```css
:root {
  /* Brand colors */
  --demo-bg-a: #1e1b4b;
  --demo-bg-b: #0f172a;
  --demo-text: #f8fafc;
  --demo-muted: #94a3b8;

  /* Accent highlights */
  --demo-accent: #00ffcc;
  --demo-accent-rgb: 0, 255, 204;
  --demo-accent2: #38bdf8;
  --demo-accent2-rgb: 56, 189, 248;

  /* Glassmorphism panels */
  --demo-panel-bg: rgba(15, 23, 42, 0.75);
  --demo-panel-border: rgba(255, 255, 255, 0.1);
  --demo-subpanel-bg: rgba(30, 41, 59, 0.6);
  --demo-subpanel-border: rgba(255, 255, 255, 0.1);

  /* Buttons & Dropzone */
  --demo-drop-bg: rgba(30, 41, 59, 0.4);
  --demo-picker-bg: rgba(255, 255, 255, 0.1);
  --demo-picker-hover-bg: rgba(255, 255, 255, 0.2);
  --demo-picker-text: #ffffff;

  /* Launch button */
  --demo-launch-bg: var(--demo-accent);
  --demo-launch-text: #ffffff;
}
```

### Full Token Reference

| Variable | Description | Default |
|---|---|---|
| `--demo-bg-a` | Gradient background stop 1 | `#d8b4fe` |
| `--demo-bg-b` | Gradient background stop 2 | `#7dd3fc` |
| `--demo-text` | Primary text color | `#0f172a` |
| `--demo-muted` | Secondary/muted text color | `#475569` |
| `--demo-accent` | Primary accent color | `#ff007f` |
| `--demo-accent-rgb` | Primary accent RGB channels | `255, 0, 127` |
| `--demo-accent2` | Secondary accent color | `#0284c7` |
| `--demo-accent2-rgb` | Secondary accent RGB channels | `2, 132, 199` |
| `--demo-panel-bg` | Main card/launcher background | `rgba(255, 255, 255, 0.25)` |
| `--demo-panel-border` | Main card border color | `rgba(255, 255, 255, 0.4)` |
| `--demo-panel-radius` | Main card corner rounding | `12px` |
| `--demo-panel-blur` | Backdrop glass blur effect | `24px` |
| `--demo-subpanel-bg` | Inner info section background | `rgba(255, 255, 255, 0.35)` |
| `--demo-drop-bg` | Dropzone background | `rgba(255, 255, 255, 0.15)` |
| `--demo-drop-active-bg` | Drag-over active background | `rgba(255, 255, 255, 0.4)` |
| `--demo-picker-bg` | Pick File button background | `rgba(255, 255, 255, 0.5)` |
| `--demo-pill-bg` | Metadata badge background | `rgba(var(--demo-accent-rgb), 0.1)` |
| `--demo-file-info-bg` | Canvas overlay panel background | `rgba(255, 255, 255, 0.7)` |
| `--demo-launch-bg` | Launch button background color | `var(--demo-accent)` |
| `--demo-launch-text` | Launch button text color | `#ffffff` |
| `--demo-font-sans` | Primary sans-serif font family | `"Outfit", system-ui, sans-serif` |
| `--demo-font-mono` | Monospace code font family | `"Space Mono", monospace` |

---

## 🛠 Features

- **OPFS Asset Persistence**: Automatically stores selected ROM and BIOS files in the Origin Private File System (`navigator.storage.getDirectory()`), restoring them automatically across page reloads.
- **Split Asset Drop Zones**: Independent drop/picker areas for optional **BIOS** firmware and game **ROM** assets.
- **Dedicated Launch Trigger**: Prominent launch button that activates once required game assets are selected.
- **Automated Manifest Integration**: Page title, SDK info, asset key mapping, and file type (`accept`) filters are automatically loaded from `sdk.manifest`.
- **Checksum Calculation**: Computes MD5, SHA-1, and SHA-256 hashes of loaded files asynchronously in the background.
- **Shadow DOM Isolation**: UI components are isolated using Shadow DOM to prevent style leakage.
- **Subpath Hosting Ready**: Uses `import.meta.url` for component templates to work seamlessly on subpaths (e.g. GitHub Pages).
