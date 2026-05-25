# Snappd (ScreenGrab) Chrome Extension — Context

This document is the **handoff spec** for the MV3 extension in `screengrab-extension/`. It reflects **Snappd v2** (light UI, hover flyouts, blur, measure, category annotations, live mockup).

**Product naming:** Manifest title is **Snappd** (`manifest.json`). The directory remains `screengrab-extension/` from an older brief. In-app copy uses **Snappd** in the popup, annotator, and privacy policy.

**Git** — Repo root is **`screengrab-extension/`** (branch **`main`**). Remote **`origin`:** `https://github.com/himzkdesign/snapmark-extension.git`.

---

## Purpose (MVP+)

1. **Capture** the active tab: visible viewport or stitched full page.
2. **Annotate** with pins, category-colored cards, smart positioning, and optional drag-to-highlight rects.
3. **Blur** regions with adjustable Gaussian blur (2–30px).
4. **Measure** spacing between detected UI regions (DevTools-style).
5. **Mockup** device frames with live preview (no Apply step).
6. **Export** flattened PNG: download (custom filename) and clipboard copy.

---

## Folder layout

```
screengrab-extension/
├── manifest.json
├── CONTEXT.md
├── lib/
│   ├── screenshot-idb.js
│   └── lucide-icons.js
├── popup/
├── background/service-worker.js
├── content/capture.js
├── annotator/
│   ├── annotator.html
│   ├── annotator.js
│   └── annotator.css
└── icons/
```

---

## Manifest (MV3)

| Field | Value |
|--------|--------|
| Name | Snappd |
| Permissions | `activeTab`, `scripting`, `tabs`, `storage` |
| Host permissions | `<all_urls>` |
| Action | Popup |
| Background | Service worker |
| Content scripts | **Not** declared for capture — **`executeScript`** only |

**CSP:** No inline scripts or event handlers in HTML; all behavior in external `.js` files.

---

## Popup UI

- Wordmark: **Snappd**
- Footer: `Made with ❤️ by a designer for designer` — **designer** links to LinkedIn (`target="_blank"`, `rel="noopener noreferrer"`), font **Bradley Hand** 12px, color **#403F5D**

---

## Annotator shell

### Layout

| Region | Role |
|--------|------|
| **`#top-bar`** | Snappd logo · divider · filename (160px) · undo/redo · divider · help · divider · Copy · Download PNG |
| **`#sidebar-shell`** | **86px** wide, **8px** padding; tools fill **100%** width, **8px** gap, **12px** labels |
| **`#tool-flyouts`** | Hover panels (not click); fixed below top bar, **8px** right of sidebar |
| **`#flyout-bridge`** | Transparent hover bridge between sidebar and flyout (150ms hide delay) |
| **`#canvas-area`** | Scrollable workspace with `#canvas-stack` |

**Tool order:** Select · Annotate · Blur · Measure · Mockup (Lucide icons via `lib/lucide-icons.js`).

**Default on load:** Annotate tool, crosshair cursor.

### Filename

- Default: `Screenshot – [Month Day]` (en-US month name)
- Editable on click; ellipsis when unfocused; saved on blur/Enter
- Download uses sanitized filename + `.png`

### Flyout panels

- Open on **hover**; anchor top of workspace (`top: var(--top-bar-height)`), open downward
- **20px** padding, **1px** `#E8E8ED` border, shadow `0 4px 14px rgba(20,19,37,0.06)`, **16px** radius
- All controls inside are clickable; mouse can move through bridge without closing

---

## Annotate tool

- **One active annotation** while card is open; canvas clicks blocked
- **Enter** saves; **Escape** cancels and removes pin; empty **Enter** removes pin without advancing id counter
- **Categories:** No category, UI (green), Copy (blue), Bug (pink), Question (orange) — pill + pin update immediately
- **Card:** 250px default, `fit-content` when saved, min 180 / max 320px; Lucide ellipsis, x, chevron-down, check
- **Smart positioning:** right → left → bottom → top; connector from correct side; **8px** anti-overlap
- **Pin:** Figtree 11px bold white number on category color

---

## Blur tool

- Click-drag rectangles; default **10px** Gaussian blur (slider + number **2–30** in flyout)
- Hover: move cursor, dashed border, **8** resize handles, trash icon (top-right)
- **Delete/Backspace** removes hovered region; all actions undoable

---

## Measure tool

- Flood-fill region detection on screenshot pixels (tolerance **28**)
- Hover: blue highlight + **W×H** tooltip
- Click pins **A** (blue), hover **B** shows red spacing lines with px values; click pins **B**; **Escape** resets

---

## Mockup tool

- **Live preview** on every control change (no Apply button)
- **Progressive disclosure:** when Device = None, hide Radius, Border Width, Shadow sections (`#mockup-advanced-sections`)
- Border width **0–20px** (default 2), synced range + number
- **Reset** full-width ghost button with Lucide `rotate-ccw`
- Device frame buttons equal width in row
- Composites from **`originalImageData`**; **`applyCanvasContentOffset`** keeps annotations aligned

---

## History / export

- Unified undo/redo: shapes, annotations, blur regions, blur intensity, mockup bitmap + layout
- **`buildExportCanvas()`** flattens base + blur + shapes + annotation rects + pins + connectors + simplified cards

---

## Data flow (unchanged core)

1. Popup → `captureVisibleTab` or full-page inject + `capture.js` → **IndexedDB** `SnapMarkDB` / `screenshots` key `current`
2. Annotator tab loads IDB, clears after read, sizes canvas to image

---

## Files to read first

| Goal | Files |
|------|--------|
| Capture + IDB | `popup/popup.js`, `lib/screenshot-idb.js`, `content/capture.js`, `background/service-worker.js` |
| Shell + theme | `annotator/annotator.html`, `annotator/annotator.css` |
| Tools + logic | `annotator/annotator.js`, `lib/lucide-icons.js` |

---

*Last updated: **Snappd v2 rebuild** — rename, popup footer, hover flyouts, header filename, annotate/blur/measure/mockup tools, CSP-safe HTML, git commit `feat: full Snappd v2 rebuild`.*
