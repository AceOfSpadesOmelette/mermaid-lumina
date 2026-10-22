# Mermaid Lumina

Open Mermaid diagrams in a zoomable lightbox with a bright white canvas. Works in **Reading view** on desktop and mobile. Live Preview keeps Obsidian’s click-to-edit for mermaid source.

## Features

- Tap or click any Mermaid diagram in Reading view to open the lightbox
- In Live Preview / editing mode, click a diagram to edit its fence as usual
- White background in the lightbox (ignores vault dark theme)
- Light-theme diagram colors so shapes and label text stay readable
- Pinch to zoom, drag to pan, double-tap to toggle fit / 2×
- Type a zoom percentage in the toolbar for exact scale
- Mouse wheel zoom and on-screen controls
- Esc or click outside the diagram to close

## Install (manual)

1. Copy `main.js`, `manifest.json`, and `styles.css` into  
   `<vault>/.obsidian/plugins/mermaid-lumina/`
2. Enable **Mermaid Lumina** in Obsidian Settings → Community plugins

**Export settings** and **Import settings** in the plugin settings save or restore the configuration as `mermaid-lumina-settings.json`.



## Develop

```bash
npm install
npm run build
npm test
```

CI runs build + Jest on push/PR. Tag a version matching `manifest.json` (for example `1.0.0`) to create a draft GitHub release with `main.js`, `manifest.json`, and `styles.css` when present.
