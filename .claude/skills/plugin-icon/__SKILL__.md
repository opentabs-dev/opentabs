# Plugin Icon Skill

Add or update the SVG icon for an OpenTabs plugin. Follow the full workflow below.

---

## How Plugin Icons Work

Plugin icons are **discovered by convention** during `opentabs-plugin build`. The build tool looks for `icon.svg` at the **plugin root directory** (next to `package.json`).

### Icon File Layout

| File | Purpose | If absent |
|---|---|---|
| `icon.svg` | Light mode active icon | Letter avatar fallback |
| `icon-inactive.svg` | Light mode inactive icon | Auto-generated (grayscale via BT.709) |
| `icon-dark.svg` | Dark mode active icon | Auto-generated (lightness inversion for low-contrast colors) |
| `icon-dark-inactive.svg` | Dark mode inactive icon | Auto-generated (grayscale of dark variant) |

### Icon Pipeline

```
icon.svg + icon-dark.svg (plugin root)
  -> opentabs-plugin build (validates, minifies, auto-generates missing variants)
    -> dist/tools.json (iconSvg / iconInactiveSvg / iconDarkSvg / iconDarkInactiveSvg)
      -> MCP server loads from tools.json -> Chrome extension -> side panel
```

### Dark Mode Auto-Generation

When `icon-dark.svg` is not provided, the build tool adapts colors with insufficient WCAG contrast (< 3:1) against the dark card background (`#242424`). Colors with sufficient contrast pass through unchanged — colorful brand icons (Slack, Discord) stay untouched, while monochrome dark icons have their lightness inverted in HSL space.

**Provide explicit `icon-dark.svg` when:** the brand provides official light/dark variants, or auto-generation doesn't produce a satisfactory result.

---

## SVG Requirements

The build tool (`platform/plugin-tools/src/validate-icon.ts`) enforces:

| Constraint | Rule |
|---|---|
| File size | <= 8 KB |
| viewBox | Must be present |
| viewBox shape | Must be **square** (width === height) |
| Forbidden elements | No `<image>`, no `<script>` |
| Forbidden attributes | No event handlers (`onclick`, `onload`, etc.) |

Custom inactive icons must additionally use only achromatic colors (grays, black, white).

---

## Step 1: Obtain the Source SVG

Get the brand SVG from the service's official brand assets page. Prefer:
- The **icon-only** variant (no wordmark/lockup)
- A **single-color** version (works best at small sizes)
- The **dark/black** variant for `icon.svg` (light mode has a light background)
- If the brand provides separate light and dark variants, use dark-colored for `icon.svg` and light-colored for `icon-dark.svg`

**Watch out for fake SVGs**: Some downloads are rasterized PNGs embedded inside SVG wrappers (`<image>` with base64 `data:image/png`). These fail validation. A real vector SVG contains `<path>`, `<circle>`, `<rect>`, etc.

### Fallback: Simple Icons

If official brand assets don't provide a usable vector SVG, use **Simple Icons**:

```
https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/<name>.svg
```

Use WebFetch to download, then clean up:
- Remove `role="img"` from `<svg>`
- Remove `<title>` element
- Add `fill="black"` to the `<path>`
- The viewBox is already square (`0 0 24 24`)

Simple Icons are CC0 (public domain).

---

## Step 2: Prepare the SVG

### Non-Square viewBox (most common issue)

Expand the viewBox to a square and center content using the min-x/min-y offset:

For `0 0 W H` where `W > H`: `viewBox="0 -(W-H)/2 W W"`
For `0 0 W H` where `H > W`: `viewBox="-(H-W)/2 0 H H"`

Example: `0 0 98 96` -> `viewBox="0 -1 98 98"`

### Cleanup

Remove from `<svg>`: `width`, `height`, Figma/Illustrator metadata.
Keep: `xmlns="http://www.w3.org/2000/svg"`, `viewBox`.

### Clip Paths

If a `<clipPath>` clips to the original non-square dimensions and you expanded the viewBox, evaluate whether the clip path is still needed — often it can be removed.

### File Size

If > 8 KB: remove comments/metadata, simplify paths, reduce decimal precision, remove redundant `<g>` wrappers.

---

## Step 3: Place the Icons

```
plugins/<plugin-name>/icon.svg              # Required
plugins/<plugin-name>/icon-dark.svg         # Optional — dark mode active
plugins/<plugin-name>/icon-inactive.svg     # Optional — light mode inactive override
plugins/<plugin-name>/icon-dark-inactive.svg # Optional — dark mode inactive override
```

Only `icon.svg` is required. All other variants are auto-generated if absent.

---

## Step 4: Build

```bash
cd plugins/<plugin-name>
npm run build
```

The build output confirms icon discovery. If validation fails, it reports specific errors.

---

## Step 5: Verify

1. Check all icon variants are in `dist/tools.json`:

```bash
node -e "const m = require('./dist/tools.json'); console.log('iconSvg:', !!m.iconSvg, 'iconInactiveSvg:', !!m.iconInactiveSvg, 'iconDarkSvg:', !!m.iconDarkSvg, 'iconDarkInactiveSvg:', !!m.iconDarkInactiveSvg)"
```

2. Open the Chrome extension side panel and verify the icon renders correctly in both light and dark mode, in both active and inactive states.

---

## Updating This Skill

If you discover new SVG preparation techniques or icon gotchas during this workflow, add them directly to this file (`.claude/skills/plugin-icon/__SKILL__.md`) in the appropriate section.
