# SnapMark (ScreenGrab) Chrome Extension — Context

This document is the **handoff spec** for the MV3 extension in `screengrab-extension/`. It reflects the **code as it exists today** (annotator shell, sidebar, contextual panel, pins, cards, capture pipeline) so a new session can continue without rediscovering the repo or past design threads.

**Product naming:** Manifest title is **SnapMark** (`manifest.json`). The directory is still `screengrab-extension/` from an older “ScreenGrab” brief. In-app copy uses **SnapMark** in the popup and annotator.

**Git** — Repo root is **`screengrab-extension/`** (branch **`main`**). **`.gitignore`:** `.DS_Store`, `*.log`, `node_modules/`, `.cursorrules`. Remote **`origin`:** `https://github.com/himzkdesign/snapmark-extension.git`. Initial commit message: **feat: SnapMark v1.0 MVP - screenshot capture, annotation, and mockup**. If **`git push -u origin main`** has not completed (e.g. host needs GitHub auth), run it from **`screengrab-extension/`** after signing in (HTTPS + PAT, **`gh`**, or SSH remote).

**Repository note (clones / no `.git`):** In environments without a local **`.git`** directory, you cannot use **`git checkout`** to time-travel; use this file + file reads instead.

---

## Purpose (MVP)

1. **Capture** the active tab: visible viewport or stitched full page.
2. **Annotate** in a dedicated tab: **Select** (legacy vector shapes) + **Annotate** (pins, optional drag-to-highlight rect, floating HTML cards, SVG connectors).
3. **Optional mockup** (**Mockup** tool): frame, radius, shadow, background, padding — live preview on `#board`, then **Apply** / **Reset** against the stored original bitmap.
4. **Export** flattened output: **PNG download** and **clipboard** (copy as PNG), including mockup base + annotations when a mockup is active.

---

## Folder layout

```
screengrab-extension/
├── .gitignore
├── manifest.json
├── CONTEXT.md
├── lib/
│   └── screenshot-idb.js
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
| Name | SnapMark |
| Permissions | `activeTab`, `scripting`, `tabs`, `storage` |
| Host permissions | `<all_urls>` |
| Action | Popup |
| Background | Service worker |
| Content scripts | **Not** declared for capture — **`executeScript`** only |

**Clipboard:** `navigator.clipboard.write` for PNG may fail on some Chrome builds without `clipboardWrite`; the annotator shows a **copy failure toast** when copy errors.

---

## Data flow (high level)

1. **Popup** — User picks visible vs full page.
2. **Visible** — `chrome.tabs.captureVisibleTab` → **`saveScreenshotToIdb`** in `lib/screenshot-idb.js` (and legacy `snapmark_*` keys removed from `chrome.storage.local` if present) → new tab `annotator/annotator.html`.
3. **Full page** — Active tab validated (not `chrome://`, etc.); **`chrome.scripting.executeScript`** injects `content/capture.js`; **200ms** delay; **`chrome.tabs.sendMessage({ action: "captureFullPage" })`** (with timeout); content script scroll-stitches and requests **`captureChunk`** from the service worker; **`chrome.tabs.captureVisibleTab(sender.tab.windowId)`** per chunk; result saved via **`saveScreenshotToIdb`** → annotator tab.
4. **Annotator** — **`loadScreenshotFromIdb()`** (optional one-time read from `chrome.storage.local` for old captures); **`clearScreenshotFromIdb`** after load; sizes `#board` to image natural dimensions; canvas listeners in **`init()`** after load. Pins + rects on canvas; **cards** in DOM; **connectors** as SVG overlay.

---

## Popup, background, content script

- **Popup (`popup/popup.js` + `popup.html`)** — Loads **`../lib/screenshot-idb.js`**. Full page: tab URL guard, **`executeScript`** for `content/capture.js`, **200ms** wait, **`tabs.update`** to focus target tab, **`sendMessage`** with **30s** timeout and user-visible status strings on failure. **`captureChunk`** responses must include `ok` + `dataUrl`.
- **Background (`background/service-worker.js`)** — `captureChunk` uses **`chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" })`** (not `null`); listener returns **`true`** and **`sendResponse`** after async capture.
- **Content (`content/capture.js`)** — **`captureFullPage(sendResponse)`** + **`return true`** on the message listener for async reply. Scroll dimensions from `documentElement` / `body`; **`#snapmark-fix`** stylesheet for common fixed headers; **`snapshotFixedAndStickyStyles`** for computed `fixed`/`sticky`; **150ms** settle per step; **`MAX_CANVAS_HEIGHT`** clamp. Restricted URLs still cannot be injected/captured.

IndexedDB **`SnapMarkDB`** / store **`screenshots`** holds `{ dataUrl, type }` at key **`current`** — avoids **`chrome.storage.local`** **~5MB** quota on large full-page PNGs.

---

## Annotator — current UI (Canva-style shell)

### High-level layout (`annotator.html`)

| Region | Role |
|--------|------|
| **`#top-bar`** | **52px** fixed strip: **SnapMark** wordmark + **Undo** / **Redo** (left), spacer, **Copy** + **Download PNG** (right). `z-index: 30`. |
| **`#annotate-context-panel`** | **Fixed** panel (`left: 68px`, `top: 52px`, **220px** wide). **Only when Annotate is active** (class `annotate-context-panel--open`, not `inert`). Overlays the canvas — **does not** change `#canvas-area` width. `z-index: 25`. |
| **`#mockup-context-panel`** | **Fixed** (`left: 68px`, `top: 52px`), **~378px** wide (`annotator.css`), `z-index: 25`, same slide animation as Annotate. **Only when Mockup is active** (`mockup-context-panel--open`). Sections (top → bottom): **DEVICE FRAME** (None / Browser / Border), **RADIUS**, **`#mockup-border-width-section`** (**BORDER WIDTH** slider, **only when Border** is selected), **SHADOW**, **BACKGROUND**, **PADDING**, **Apply Mockup**, **`#mockup-reset-row`** with **Reset** (visible when `mockupState.applied`). Delegated **`click`** on the panel + **`input`** on **`#mockup-border-width`** (see **Mockup** below). |
| **`#app-main`** | **Flex row**: **`#sidebar-shell`** (68px) + **`#canvas-area`** (flex 1). |
| **`#sidebar-shell`** | Wraps **`#sidebar-tools`** only (no color strip inside the rail). |
| **`#sidebar-tools`** | **68px** rail: **Select**, **Mockup**, **Annotate** (stacked) + **`.sidebar-tools__spacer`** (`flex: 1`) + **feedback** (bottom). Class **`sidebar-tools--select-active`** when **Select** is active. |
| **`#canvas-area`** | Scrollable workspace; `z-index: 1` so the fixed panel can sit above it. |

**`#canvas-stack`:** `#board` (canvas) → `#annotation-connectors` (SVG) → `#annotation-cards` (DOM cards).

**Toast:** `#copy-toast` — bottom center, Geist Mono, success/error styling.

There is **no** separate full-height left sidebar beyond this **68px** tool rail. **Pin colors** and help copy live in **`#annotate-context-panel`**, not beside the tools.

---

## Sidebar tools (`annotator.css` + `annotator.js`)

- **Width:** `var(--sidebar-width)` = **68px**; background `#141414`, right border `1px #1e1e1e`.
- **Tools:** **56×56px** “pill / chip” buttons (Figma-like), **8px** gap, **12px** top padding on the rail.
- **Content per tool:** **20px** SVG icon + **9px Geist Mono** label (**Select** / **Mockup** / **Annotate**) + **`aria-keyshortcuts`** (`v` / `m` / `a`); visible shortcut glyphs are not duplicated for screen readers.
- **Select icon:** Stroke-based **four-way move** cross (not the old filled cursor arrow).
- **Active state:** `rgba(255,255,255,0.08)` fill, `1px rgba(255,255,255,0.1)` border, **10px** radius, light shadow; icon/label **white**, label **font-weight 600**.
- **Inactive:** Transparent; icon/label `#555`; **hover** slightly brighter background/border (`#888` text).
- **Feedback (bottom):** **`#btn-feedback`** — **36×36px**, transparent, **16px** question-mark icon **`#444`**, hover bg **`#1a1a1a`** / icon **`#888`**; tooltip **“Give feedback”** after **400ms** (Geist Mono chip at **`left: 76px`**, vertically centered); click runs **`window.open(FEEDBACK_FORM_URL, '_blank')`** (**`FEEDBACK_FORM_URL`** → Google Form SnapMark feedback).
- **Removed:** Inset **`--accent-color`** bar on tools; hover **tooltips** on the main three tools (on-rail **labels** made them redundant). **Exception:** **feedback** button — delayed **“Give feedback”** tooltip only.

**`setTool()`** in `annotator.js` toggles **`sidebar-tools--select-active`** when `next === "select"`, updates **`annotate-context-panel--open`** / **`inert`** / **`aria-hidden`** only for Annotate, updates **`mockup-context-panel--open`** / **`inert`** / **`aria-hidden`** only for Mockup, and clears annotate drag state when leaving Annotate.

---

## Mockup (`#mockup-context-panel` + `annotator.js` + `annotator.css`)

### Tool & shortcuts

- Third sidebar tool (**Mockup**), shortcut **`M`**. **`Escape`** → **Select** when Annotate or Mockup is active.
- **`setTool('mockup')`** runs **`previewMockup()`** once so the canvas reflects current options when opening the tool.

### State (`mockupState`)

| Field | Values / notes |
|--------|------------------|
| **`device`** | **`none`** — padding + background only; screenshot drawn with optional radius + shadow (clipped). **`browser`** — 52px chrome bar, traffic lights, URL pill + “snapmark.design”, white shell; screenshot below bar. **`border`** — white shell + stroke frame (`drawMockupBorderFrame`): stroke **`rgba(0,0,0,0.85)`**, **`lineWidth`** = **`borderWidth`**; **`applyShadow`** beneath the white fill. |
| **`radius`** | **0 / 8 / 16 / 24** px (UI: None, Small, Medium, iOS). Used for clip path and frame corners; browser outer corners use **`radius` if > 0, else 10px**. |
| **`shadow`** | **`none`** \| **`soft`** `0 8px 30px rgba(0,0,0,0.08)` \| **`medium`** `0 16px 48px rgba(0,0,0,0.16)` \| **`hard`** `0 24px 60px rgba(0,0,0,0.35)` (canvas **`shadowOffsetY`** / **`shadowBlur`** / **`shadowColor`**). |
| **`background`** | Hex (`#ffffff`, `#f5f5f5`, `#e0e0e0`, `#1a1a1a`) or **`gradient-blue`** \| **`gradient-pink`** (135° gradients per `drawBackground`). |
| **`padding`** | **24 / 48 / 80** (S / M / L); default **48**. |
| **`borderWidth`** | **1–20** px (range **`#mockup-border-width`**); default **2**. UI row **`#mockup-border-width-section`** **hidden** unless **`device === 'border'`**. |
| **`applied`** | Set **`true`** only after **Apply Mockup** (history checkpoint); controls **`#mockup-reset-row`** visibility via **`updateMockupResetRow()`**. |

### Original bitmap

- After load, **`ctx.drawImage`** once → **`originalImageData = canvas.toDataURL('image/png')`**. Every **`previewMockup()`** composites from this URL (not from the current **`baseImage`**), so repeated previews do not stack edits.

### Layout math

- **`computeMockupLayout(device, sw, sh, pad)`** — Uses effective padding **`pad + borderWidth`** when **`device === 'border'`** (otherwise **`borderWidth`** is treated as **0**), so the canvas margin absorbs the frame. For **`browser`**, canvas height includes **`MOCKUP_BAR_H` (52)** and screenshot **`y`** is **`padEff + 52`**. For **`none`** / **`border`**, **`totalW/H = sw/sh + 2×padEff`**, screenshot at **`(padEff, padEff)`** with **`padEff = pad + (border ? borderWidth : 0)`**.
- **`lastMockupScreenshotOrigin`** — Top-left of the screenshot content in canvas space; **`applyCanvasContentOffset(dx,dy)`** shifts pins / legacy **`shapes`** when **`(screenshotX, screenshotY)`** changes between previews.

### Rendering pipeline (`previewMockup`)

1. Load **`originalImageData`** into a fresh **`Image`**; guard **`compositeStarted`** so sync + async decode do not double-run.
2. Offscreen canvas **`mc`**: **`drawBackground`** → **`applyShadow`** → by **`device`**: **`none`** (clip + **`drawImage`**), **`browser`** (**`drawMockupBrowserFrame`** then clip + **`drawImage`**), **`border`** (**`drawMockupBorderFrame`** then clip + **`drawImage`**). Helpers: **`roundRect`** / **`roundRectTop`** (support **`r === 0`**), **`clipRoundRect`**, **`clearCtxShadow`**.
3. **`mc.toDataURL`** → new **`Image`** → assign **`baseImage`**, resize **`#board`**, **`redraw()`**, **`updateConnectorsSVG()`**, **`positionAllCards()`**.
4. **`previewMockup` does not call `commitHistory`** (live tweaks); **`applyMockup`** / **`resetMockup`** do.

### Apply / reset

- **`applyMockup()`** — **`previewMockup(() => { applied = true; commitHistory(); updateMockupResetRow(); setTimeout(() => setTool('select'), 300) })`**. After apply completes, **300ms** later **`setTool('select')`** closes the mockup panel so the full canvas is visible and the user can annotate immediately.
- **`resetMockup()`** — Undo screenshot-origin shift, reset **`mockupState`** to defaults (**none**, radius **0**, shadow **none**, bg **`#f5f5f5`**, padding **48**, **`borderWidth` 2**, **`applied` false**), reload **`originalImageData`** into **`baseImage`**, **`syncMockupPanelFromState()`**, **`commitHistory()`**, **`updateMockupResetRow()`**.

### Panel UI (`annotator.css`)

- **Device row:** three **110×56px** chips; active **`#252525`**, border **`#555`**, label white.
- **Border width:** **`#mockup-border-width-section`** after **RADIUS** (**`margin-top: 16px`** vs **RADIUS** row), **`hidden`** unless **Border** is selected; label **BORDER WIDTH** (**9px** mono **`#444`**); **`input[type=range]#mockup-border-width`** (**1–20**, step **1**, default **2**) — **4px** tall track **`#2a2a2a`**, filled portion white (WebKit via **`updateMockupBorderWidthSliderFill`**; Firefox **`::-moz-range-progress`**); **14px** white thumb, **`scale(1.2)`** on hover; **`#mockup-border-width-value`** — **11px** mono **`#888`**, **32px** wide, **`{n}px`**.
- **Radius / shadow / padding:** **`.mockup-context-panel__pill-row`** + **`.pill-btn`** — **32px** tall, **`flex: 1`**, **6px** radius, same active colors as device row.
- **Background:** **24px** circles; light swatches **`inset 1px #ddd`**; active **2px white ring** (`box-shadow`).
- **Dividers:** **`1px #1e1e1e`**, **`margin: 12px 0`**.
- **Apply:** full width **36px**, white fill, **`#e8e8e8`** hover.
- **Reset row:** centered **11px** link **`#555`**, hover white.

### Events

- **`#mockup-context-panel`** delegated **`click`**: **`#mockup-apply-btn`** → **`applyMockup()`**; **`#mockup-reset-link`** → **`resetMockup()`**; **`[data-device]`** / **`[data-radius]`** / **`[data-shadow]`** / **`[data-bg]`** / **`[data-padding]`** → update **`mockupState`** → **`syncMockupPanelFromState()`** → **`previewMockup()`**.
- **`#mockup-border-width`** **`input`**: update **`mockupState.borderWidth`** → value label → **`previewMockup()`** (**`syncMockupPanelFromState()`** toggles section visibility when **`[data-device]`** changes).

### Layering & export

- **`redraw()`** draws **`baseImage`** then shapes + annotation layers (unchanged).
- **`buildExportCanvas()`** — Mockup is baked into **`baseImage`**; export still adds annotations, connectors, simplified cards.

### Undo / redo

- **`captureState()`** includes **`baseDataUrl`**, **`canvasW`/`canvasH`**, **`mockupApplied`**, **`mockupOriginX`/`mockupOriginY`** so undo restores canvas size and baked mockup bitmap consistently.

### Removed from mockup (history)

- **iPhone** and **MacBook** device options and their drawing paths were removed; mockup is **None / Browser / Border** only.

---

## Annotate contextual panel (`#annotate-context-panel`)

- **Fixed** geometry: `left: var(--sidebar-width)`, `top: var(--top-bar-height)`.
- **Content:** “HOW TO USE” copy, **PIN COLOR** row (**20px** swatches, **6px** gap, active = white ring + slight **scale**), helper line, **KEYBOARD** rows (badges + labels).
- **Animation:** Hidden → `translateX(-12px)` + `opacity: 0`; open → `translateX(0)` + `opacity: 1`, **200ms ease**; `visibility` delayed on close so the transition can finish.
- **Pin color:** **`setColor()`** updates swatch `is-active` / `aria-selected` and the **`color`** variable used for **new** annotations. Swatches use class **`.annotate-context-panel__swatch[data-color]`**.

---

## Canvas: pins, rects, connectors

### Pins (`drawAnnotationPinOnCtx` in `annotator.js`)

- **Inner disk (annotation color):** radius **`PIN_R` = 16** (32px diameter).
- **White ring:** filled circle first at **`PIN_RING_R` = 19**, then the color disk on top.
- **Shadow** on the rings: **`rgba(0,0,0,0.4)`**, blur **10**, offsets **0**, then cleared before drawing text.
- **Number:** **14px**, **800**, Geist Mono, **white**, centered on pin.
- **Hit test / hover near pin:** **`PIN_HIT_DIST` = 22** (canvas coords).

### Drag-to-highlight (annotate rect)

- **Live preview** and **committed** annotation rects: **`ctx.roundRect`** when available, else **`rect`**.
- **Stroke:** annotation color, **2px**, dash **`[6, 4]`**, round caps/joins.
- **Fill:** **`hexWithAlphaByte(color, "1f")`** (~12% opacity via `#RRGGBB1f`).
- Helper **`beginAnnotationRoundRectPath`**, constant **`ANNOTATE_RECT_RADIUS` = 6**.
- **Pin placement (drag-to-area):** Pin sits on the **left or right edge** of the drawn rect (vertical center), not rect center — whichever keeps the highlight’s **center** in the left vs right half of the canvas (`addAnnotationAt`). Card branches **away** from the pin (Figma-style); see **Card layout math**.

### Connectors

- **`updateConnectorsSVG()`** — one dashed `<line>` per annotation, **`ann.color`**.
- **Drag-to-area (`ann.hasRect`):** **Horizontal** segment only — from **pin** to the **nearest vertical edge** of the card at **`y`** clamped to the card (`connectorEndOnCard`); **`buildExportCanvas()`** uses the same rule for flattened lines.
- **Click-only annotations:** Connector end uses **`nearestPointOnRectBorder`** (may be diagonal).

### Card layout math

- **`CARD_WIDTH_STACK_PX = 220`** must match **`.annotation-card { width }`** in CSS.
- **`annotationCardBranchLeft(ann)`** — If **`hasRect`**, branch from **highlight center** vs canvas midline; else from **`pinX`** (click-only).
- **`computeSmartCardOffsets`** / **`positionCard`** — Card offset from pin: **16px** viewport gap for drag-to-area, **20px** for click-only; **`pinScreen*`** from **`canvas.getBoundingClientRect()`** × scale; card **`left`/`top`** clamped inside **`canvasRect`** with **8px** margin; **`cardOffsetX/Y`** nudged when clamp applies.
- **`getCardRectCanvas`**, **`positionCard`**, **`repositionCard`** — DOM + canvas mapping; pin-drag end can **`repositionCard(ann, { animate: true })`** (`left`/`top` **200ms** transition on **`.annotation-card--pin-move`**).

---

## Annotation cards (DOM) — **current** design

**Intentionally *not* the experimental “Figma-style” full card redesign** (large pill category, no menu, inline-only text, etc.). That redesign **broke / regressed UX** in practice and was **reverted** to the **previous working card** pattern.

**Current card (`buildCardElement` in `annotator.js` + `.annotation-card*` in CSS):**

- **220px** wide, **14px** padding, white background, **1px** `#f0f0f0` border, **16px** radius, soft shadow.
- **Header row:** drag strip (**pin grip** + category **`<select>`** with chevron via **`syncCategoryStyle`** / **`categoryChevronUrl`** / **`badgeTextColor`**), **⋯** menu (Edit / Delete) + **×** close (removes annotation).
- **Body:** **`contenteditable`**, placeholder “Add an annotation…”, confirm on **Enter** → **preview** line + green **status dot**; **click** confirmed card (outside header chrome) re-expands editor.
- **Drag card:** **`mousedown`** on **`.annotation-card__drag-handle`** updates **`cardOffsetX/Y`**, **`commitHistory`** on mouseup.
- **Global click:** closes any **`.annotation-card__menu-dropdown.is-open`**.

**Removed from cards:** A **DOM number badge** on the card (small circle with id) was added during pin polish then **removed per product request**. The **numbered pin remains on the canvas only** (`drawAnnotationPinOnCtx`).

---

## Logic highlights (`annotator.js`)

- **History:** `captureState` / `restoreState` / `commitHistory` — shapes + serialized annotations + `nextAnnotationId`. Undo/redo in top bar + keyboard.
- **Keyboard:** `V` / `M` / `A` (not while focus in card body), `Meta/Ctrl+Z` / `+Shift+Z`, `Escape` from Annotate or Mockup → Select.
- **Mockup:** **`originalImageData`** after first paint; **`previewMockup`** composites into **`baseImage`** (no duplicate stacking); **`computeMockupLayout`**, **`applyCanvasContentOffset`** vs **`lastMockupScreenshotOrigin`**; **`applyMockup`** / **`resetMockup`** + **`updateMockupResetRow`**; delegated clicks on **`#mockup-context-panel`**; **`syncMockupPanelFromState`** keeps pills/swatches in sync.
- **Export:** **`buildExportCanvas()`** — Flattens **Download PNG** / **Copy** output: base image, shapes, annotation highlight rects, pins, connector segments (same connector rules as live), and **`drawSimplifiedCardOnCtx`** for simplified card chrome (scaled text/padding/shadow vs layout scale). **`pillR` / export pill** bug fixed: badge capsule uses **`badgePillRadius`** in **`drawSimplifiedCardOnCtx`** (no stray **`pillR`** reference).

---

## Shapes vs annotations

- **`shapes`** — Legacy `{ type: 'rect'|'arrow'|'text', ... }` (render + select only; no create UI for new ones).
- **`annotations`** — `{ id, pinX, pinY, color, category, text, confirmed?, hasRect?, rect*, cardOffset*, ... }` + runtime **`_el`**.

---

## What was tried and reverted / removed (history)

| Item | Outcome |
|------|--------|
| **Narrow sidebar + full-height color strip** (`:has()` / slide strip) | Replaced by **fixed contextual panel** + swatches only in panel. |
| **Sidebar tool tooltips** (main three) | Removed; on-rail **labels** + **`aria-keyshortcuts`** suffice. **Exception:** **feedback** link uses a delayed **“Give feedback”** chip (see **Sidebar tools**). |
| **`--accent-color` inset** on active tool | Removed for **Figma-like pill** tool states (no colored bar on tools). |
| **Experimental Figma-style annotation card** (wide card, pill category cycling, no menu, etc.) | **Reverted** — restored **select + ⋯ menu + preview** card. |
| **DOM pin number badge on card** | **Removed** — number **only** on canvas pin. |
| **Mockup device presets** (iPhone / MacBook) | **Removed** — mockup is **None / Browser / Border** only (see **Mockup** section). |

---

## Architecture decisions (still valid)

| Decision | Rationale |
|----------|-----------|
| Large PNG handoff | **IndexedDB** (`SnapMarkDB` / `screenshots` in `lib/screenshot-idb.js`) avoids **`chrome.storage.local`** **~5MB** quota; legacy `snapmark_*` keys removed on save when present. |
| No manifest `content_scripts` for capture | Inject before `sendMessage`. |
| Canvas listeners after `init` | Correct dimensions after image load. |
| SVG connectors | DOM cards move without rasterizing lines each frame. |
| `cardOffsetX/Y` in canvas space | Stable when `#canvas-stack` scales. |
| Unified history stack | Single undo/redo for shapes + annotations + mockup checkpoints (**`baseDataUrl`**, **`mockupApplied`**, **`mockupOriginX/Y`**). |
| Fixed `#annotate-context-panel` | Overlays canvas; layout stays **68px rail + flex canvas**. |
| Fixed **`#mockup-context-panel`** (~**378px**) | Same overlay pattern as Annotate; wider panel for three device chips + pill rows. |
| **`originalImageData`** source of truth | **`previewMockup`** always composites from the captured bitmap URL so tweaks do not accumulate. |

---

## Known issues / risks

1. **Clipboard** — May need `clipboardWrite` in manifest for reliable PNG copy on some Chrome versions.
2. **Full-page capture** — Wide pages (scroll width > viewport) are vertical-stitch only; timing / DPR / **`MAX_CANVAS_HEIGHT`** in **`content/capture.js`** remain tuning knobs.
3. **`roundRect`** — Used for annotation highlight rects when supported; fallback is axis-aligned `rect`.
4. **Accessibility** — Cards, panel, and shortcuts could use more **`aria-*`**, focus order, and live regions for export errors.
5. **Clone / no `.git`** — Same as the **Repository note** at the top: without a local repo, rely on this spec or obtain the source from **GitHub** (`himzkdesign/snapmark-extension`).
6. **IndexedDB** — Lives on the **extension origin** (popup + annotator only); content scripts do not read/write **`SnapMarkDB`**.
7. **Narrow viewports** — **Mockup** panel is **~378px** wide; verify overlap with scaled **`#canvas-stack`** on small windows.

---

## Next tasks (suggested priority)

1. **Browser QA** — Include **Mockup**: device/radius/shadow/bg/padding, **Apply** / **Reset**, undo/redo after mockup, export with mockup base. Also sidebar pills, Annotate panel, pin drag, drag-to-area vs click-only cards, connectors, copy/download, keyboard, toast, narrow viewports, IndexedDB handoff.
2. **Optional:** Add `clipboardWrite` and retest copy.
3. **Persistence** — Optional session restore (e.g. annotations + screenshot handle) if users should reopen the same capture.
4. **Naming** — Align manifest / export filename if shipping under a name other than SnapMark (`snapmark-export.png` today).

---

## Files to read first when continuing

| Goal | Files |
|------|--------|
| Capture pipeline + IDB | `popup/popup.js`, `popup/popup.html`, `lib/screenshot-idb.js`, `content/capture.js`, `background/service-worker.js` |
| Annotator shell & theme | `annotator/annotator.html`, `annotator/annotator.css` (`:root` vars, `#top-bar`, `#sidebar-shell`, `#annotate-context-panel`, **`#mockup-context-panel`**, `#app-main`, `.annotation-card*`) |
| Tools, panel, pins, mockup, positioning, export | `annotator/annotator.js` (`setTool`, `setColor`, **`previewMockup`**, **`applyMockup`**, **`resetMockup`**, **`syncMockupPanelFromState`**, **`updateMockupResetRow`**, **`computeMockupLayout`**, **`captureState`/`restoreState`** mockup fields, `drawAnnotationPinOnCtx`, `annotationCardBranchLeft`, `connectorEndOnCard`, `drawLiveAnnotateRectPreview`, `drawCommittedAnnotationRect`, `buildCardElement`, `buildExportCanvas`, `commitHistory`) |

---

*Last updated: **Sidebar** — **`#btn-feedback`** + **`window.open(FEEDBACK_FORM_URL, '_blank')`** (Google Form). **Git** — repo in **`screengrab-extension/`**, **`main`**, **`.gitignore`**, remote **`https://github.com/himzkdesign/snapmark-extension.git`**, initial **feat: SnapMark v1.0 MVP** commit; complete **`git push -u origin main`** on a machine with GitHub credentials if needed. **Mockup** radius **0 / 8 / 16 / 24**; **BORDER WIDTH** **`margin-top: 16px`**. **Purpose** and **Mockup** sections as above. **Next tasks** prioritize QA including mockup.*
