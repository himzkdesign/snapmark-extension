(() => {
  const STORAGE_SCREENSHOT = "snapmark_screenshot";
  const STORAGE_TYPE = "snapmark_type";
  const FEEDBACK_FORM_URL =
    "https://docs.google.com/forms/d/e/1FAIpQLScJZ2tJnltWvPLGOu0JIXio7V6lReIwOWa4-fRC8_k7YwB1EA/viewform?usp=dialog";

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const canvasStack = document.getElementById("canvas-stack");
  const svgConnectors = document.getElementById("annotation-connectors");
  const annotationCardsRoot = document.getElementById("annotation-cards");
  const measureOverlay = document.getElementById("measure-overlay");

  const filenameInput = document.getElementById("filename-input");
  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  const btnCopy = document.getElementById("btn-copy");
  const btnDownload = document.getElementById("btn-download");
  const btnHelp = document.getElementById("btn-help");
  const copyToast = document.getElementById("copy-toast");
  const sidebarTools = document.getElementById("sidebar-tools");
  const flyoutBridge = document.getElementById("flyout-bridge");
  const toolFlyouts = document.getElementById("tool-flyouts");
  const mockupAdvancedSections = document.getElementById("mockup-advanced-sections");
  const mockupBorderWidthSection = document.getElementById("mockup-border-width-section");
  const mockupBorderWidthInput = document.getElementById("mockup-border-width");
  const mockupBorderWidthNum = document.getElementById("mockup-border-width-num");
  const mockupResetBtn = document.getElementById("mockup-reset-btn");
  const blurIntensityInput = document.getElementById("blur-intensity");
  const blurIntensityNum = document.getElementById("blur-intensity-num");

  const CATEGORY_OPTIONS = [
    { value: "", label: "No category", color: "#9CA3AF" },
    { value: "UI", label: "UI", color: "#22C55E" },
    { value: "Copy", label: "Copy", color: "#3B82F6" },
    { value: "Bug", label: "Bug", color: "#EC4899" },
    { value: "Question", label: "Question", color: "#F97316" },
  ];

  const SVG_NS = "http://www.w3.org/2000/svg";
  const PIN_R = 16;
  const PIN_RING_R = 19;
  const PIN_HIT_DIST = 22;
  const CARD_WIDTH_EDIT_PX = 250;
  const CARD_GAP_PX = 8;
  const BLUR_INTENSITY_MIN = 2;
  const BLUR_INTENSITY_MAX = 30;
  const BLUR_INTENSITY_DEFAULT = 10;
  const BLUR_HANDLE_HIT = 8;
  const MEASURE_TOLERANCE = 28;

  /** @type {HTMLImageElement | null} */
  let baseImage = null;
  /** @type {Array<Record<string, unknown>>} */
  let shapes = [];
  /** @type {Array<object>} */
  let annotations = [];
  let nextAnnotationId = 1;
  /** @type {number | null} */
  let editingAnnotationId = null;

  /** @type {'select'|'annotate'|'blur'|'measure'|'mockup'} */
  let currentTool = "annotate";

  let mockupState = {
    device: /** @type {'none'|'browser'|'border'} */ ("none"),
    radius: 0,
    shadow: /** @type {'none'|'soft'|'medium'|'hard'} */ ("none"),
    background: "#f5f5f5",
    padding: 48,
    borderWidth: 2,
  };

  /** @type {Array<{id:number,x:number,y:number,w:number,h:number}>} */
  let blurRegions = [];
  let nextBlurRegionId = 1;
  let blurIntensity = BLUR_INTENSITY_DEFAULT;
  /** @type {number | null} */
  let hoveredBlurRegionId = null;
  /** @type {number | null} */
  let selectedBlurRegionId = null;
  let blurDragActive = false;
  let blurDragStartX = 0;
  let blurDragStartY = 0;
  let blurDragCurX = 0;
  let blurDragCurY = 0;
  /** @type {'move'|'resize-nw'|'resize-ne'|'resize-sw'|'resize-se'|'resize-n'|'resize-s'|'resize-e'|'resize-w'|null} */
  let blurHandleMode = null;
  /** @type {{id:number,startX:number,startY:number,startRect:{x:number,y:number,w:number,h:number}}|null} */
  let blurEditState = null;

  /** @type {Uint8ClampedArray|null} */
  let measurePixelData = null;
  let measurePixelW = 0;
  let measurePixelH = 0;
  /** @type {{x:number,y:number,w:number,h:number}|null} */
  let measureHoverBounds = null;
  /** @type {{x:number,y:number,w:number,h:number}|null} */
  let measurePinA = null;
  /** @type {{x:number,y:number,w:number,h:number}|null} */
  let measurePinB = null;
  /** @type {{x:number,y:number,w:number,h:number}|null} */
  let measureHoverB = null;

  let flyoutHideTimer = 0;
  let flyoutHoverCount = 0;
  /** @type {HTMLElement|null} */
  let blurTrashEl = null;

  /** Canonical original screenshot PNG (from canvas after first paint) — mockup preview/reset source. */
  let originalImageData = "";
  let originalCaptureW = 0;
  let originalCaptureH = 0;
  /** Top-left of screenshot content in canvas space for current mockup preview (offset for annotations). */
  let lastMockupScreenshotOrigin = { x: 0, y: 0 };
  let strokeWidth = 1;
  /** @type {number | null} */
  let selectedIndex = null;

  let isSelectDragging = false;
  /** @type {{dx:number,dy:number} | null} */
  let selectOffset = null;

  let annotatePlaceActive = false;
  let annotatePlaceDragging = false;
  let annotateStartX = 0;
  let annotateStartY = 0;
  let annotateCurX = 0;
  let annotateCurY = 0;

  let isDraggingPin = false;
  /** @type {number | null} */
  let draggedAnnotationId = null;

  let canvasListenersAttached = false;

  let isRestoringHistory = false;
  /** @type {Array<{ shapes: Record<string, unknown>[]; annData: object[]; nextId: number }>} */
  let history = [];
  let historyIndex = -1;
  let selectDragMoved = false;

  function getCanvasCoords(ev) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (ev.clientX - rect.left) * scaleX,
      y: (ev.clientY - rect.top) * scaleY,
    };
  }

  function normalizeRect(x0, y0, x1, y1) {
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    return { x, y, width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
  }

  function normalizeBlurRect(x0, y0, x1, y1) {
    const n = normalizeRect(x0, y0, x1, y1);
    return { x: n.x, y: n.y, w: n.width, h: n.height };
  }

  function injectLucideIcons() {
    if (typeof lucideIcon !== "function") return;
    document.querySelectorAll("[data-lucide]").forEach((el) => {
      const name = el.getAttribute("data-lucide");
      if (!name) return;
      const size = el.classList.contains("sidebar-tool__icon") ? 20 : 16;
      el.innerHTML = lucideIcon(name, size);
    });
  }

  function defaultExportFilename() {
    const d = new Date();
    const month = d.toLocaleString("en-US", { month: "long" });
    const day = d.getDate();
    return `Screenshot – ${month} ${day}`;
  }

  function sanitizeFilename(name) {
    const trimmed = (name || "").trim() || defaultExportFilename();
    return trimmed
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Screenshot";
  }

  function categoryColor(cat) {
    const found = CATEGORY_OPTIONS.find((c) => c.value === (cat || ""));
    return found ? found.color : "#9CA3AF";
  }

  function categoryLabel(cat) {
    const found = CATEGORY_OPTIONS.find((c) => c.value === (cat || ""));
    return found ? found.label : "No category";
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
      if (img.complete && img.naturalWidth) resolve(img);
    });
  }

  /** @param {object} ann */
  function serializeAnnotation(ann) {
    return {
      id: ann.id,
      pinX: ann.pinX,
      pinY: ann.pinY,
      color: ann.color,
      category: ann.category ?? "",
      text: ann.text || "",
      saved: !!ann.saved,
      hasRect: !!ann.hasRect,
      rectX: ann.rectX,
      rectY: ann.rectY,
      rectW: ann.rectW,
      rectH: ann.rectH,
      cardSide: ann.cardSide || "right",
      cardOffsetX: ann.cardOffsetX,
      cardOffsetY: ann.cardOffsetY,
    };
  }

  function serializeBlurRegion(b) {
    return { id: b.id, x: b.x, y: b.y, w: b.w, h: b.h };
  }

  function captureState() {
    return {
      shapes: JSON.parse(JSON.stringify(shapes)),
      annData: annotations.map(serializeAnnotation),
      nextId: nextAnnotationId,
      blurRegions: blurRegions.map(serializeBlurRegion),
      nextBlurRegionId,
      blurIntensity,
      mockupState: JSON.parse(JSON.stringify(mockupState)),
      baseDataUrl: baseImage && baseImage.src ? baseImage.src : "",
      canvasW: canvas.width,
      canvasH: canvas.height,
      mockupOriginX: lastMockupScreenshotOrigin.x,
      mockupOriginY: lastMockupScreenshotOrigin.y,
    };
  }

  function rebuildAnnotationsFromData(annData) {
    editingAnnotationId = null;
    annotationCardsRoot.replaceChildren();
    annotations = annData.map((d) => {
      const ann = { ...d };
      ann.saved = ann.saved ?? ann.confirmed ?? false;
      ann.category = ann.category ?? "";
      ann.color = ann.color || categoryColor(ann.category);
      const el = buildCardElement(ann);
      ann._el = el;
      annotationCardsRoot.appendChild(el);
      return ann;
    });
    for (const ann of annotations) {
      positionCard(ann);
    }
  }

  function restoreState(snap) {
    if (snap.mockupState && typeof snap.mockupState === "object") {
      mockupState = { ...mockupState, ...snap.mockupState };
    }
    lastMockupScreenshotOrigin = {
      x: typeof snap.mockupOriginX === "number" ? snap.mockupOriginX : 0,
      y: typeof snap.mockupOriginY === "number" ? snap.mockupOriginY : 0,
    };
    blurRegions = Array.isArray(snap.blurRegions)
      ? snap.blurRegions.map((b) => ({ ...b }))
      : [];
    nextBlurRegionId =
      typeof snap.nextBlurRegionId === "number" ? snap.nextBlurRegionId : nextBlurRegionId;
    syncBlurIntensityControls(snap.blurIntensity);

    const cw =
      typeof snap.canvasW === "number"
        ? snap.canvasW
        : baseImage?.naturalWidth || canvas.width || originalCaptureW;
    const ch =
      typeof snap.canvasH === "number"
        ? snap.canvasH
        : baseImage?.naturalHeight || canvas.height || originalCaptureH;
    const url = typeof snap.baseDataUrl === "string" ? snap.baseDataUrl : "";

    canvas.width = cw;
    canvas.height = ch;

    isRestoringHistory = true;
    try {
      shapes = JSON.parse(JSON.stringify(snap.shapes));
      nextAnnotationId = snap.nextId;
      rebuildAnnotationsFromData(snap.annData);
    } finally {
      isRestoringHistory = false;
    }
    selectedIndex = null;
    selectedBlurRegionId = null;
    hoveredBlurRegionId = null;
    annotatePlaceActive = false;
    annotatePlaceDragging = false;
    isDraggingPin = false;
    draggedAnnotationId = null;
    resetMeasureState();

    let restored = false;
    function finishRestore() {
      if (restored) return;
      restored = true;
      rebuildMeasurePixelCache();
      redraw();
      updateConnectorsSVG();
      positionAllCards();
      updateUndoRedoButtons();
      applyCanvasCursorLast();
      syncMockupPanelFromState();
      renderMeasureOverlay();
      hideBlurTrash();
    }

    if (!url) {
      baseImage = null;
      finishRestore();
      return;
    }

    const img = new Image();
    img.onload = () => {
      baseImage = img;
      finishRestore();
    };
    img.onerror = () => {
      baseImage = null;
      finishRestore();
    };
    img.src = url;
    if (img.complete && img.naturalWidth) {
      baseImage = img;
      finishRestore();
    }
  }

  function commitHistory() {
    if (isRestoringHistory) return;
    const snap = captureState();
    history = history.slice(0, historyIndex + 1);
    history.push(snap);
    historyIndex = history.length - 1;
    updateUndoRedoButtons();
  }

  function performUndo() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    restoreState(history[historyIndex]);
  }

  function performRedo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    restoreState(history[historyIndex]);
  }

  function updateUndoRedoButtons() {
    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;
    if (btnUndo) {
      btnUndo.classList.toggle("is-disabled", !canUndo);
      btnUndo.setAttribute("aria-disabled", String(!canUndo));
    }
    if (btnRedo) {
      btnRedo.classList.toggle("is-disabled", !canRedo);
      btnRedo.setAttribute("aria-disabled", String(!canRedo));
    }
  }

  function clampBlurIntensity(raw) {
    const n = Number(raw);
    return Math.max(
      BLUR_INTENSITY_MIN,
      Math.min(BLUR_INTENSITY_MAX, Number.isFinite(n) ? n : BLUR_INTENSITY_DEFAULT)
    );
  }

  function syncBlurIntensityControls(raw) {
    const v = clampBlurIntensity(raw ?? blurIntensity);
    blurIntensity = v;
    if (blurIntensityInput) blurIntensityInput.value = String(v);
    if (blurIntensityNum) blurIntensityNum.value = String(v);
  }

  function showFlyout(tool) {
    window.clearTimeout(flyoutHideTimer);
    if (flyoutBridge) {
      flyoutBridge.hidden = false;
      flyoutBridge.setAttribute("aria-hidden", "false");
    }
    document.querySelectorAll(".tool-flyout[data-flyout]").forEach((el) => {
      el.hidden = el.getAttribute("data-flyout") !== tool;
    });
  }

  function scheduleHideFlyout() {
    window.clearTimeout(flyoutHideTimer);
    flyoutHideTimer = window.setTimeout(() => {
      if (flyoutHoverCount > 0) return;
      document.querySelectorAll(".tool-flyout[data-flyout]").forEach((el) => {
        el.hidden = true;
      });
      if (flyoutBridge) {
        flyoutBridge.hidden = true;
        flyoutBridge.setAttribute("aria-hidden", "true");
      }
    }, 150);
  }

  function onFlyoutZoneEnter() {
    flyoutHoverCount += 1;
    window.clearTimeout(flyoutHideTimer);
  }

  function onFlyoutZoneLeave() {
    flyoutHoverCount = Math.max(0, flyoutHoverCount - 1);
    scheduleHideFlyout();
  }

  function setupFlyoutHover() {
    if (sidebarTools) {
      sidebarTools.addEventListener("mouseenter", (e) => {
        const btn = e.target instanceof Element ? e.target.closest(".sidebar-tool[data-tool]") : null;
        if (btn && btn.dataset.tool) showFlyout(btn.dataset.tool);
      });
    }
    if (flyoutBridge) {
      flyoutBridge.addEventListener("mouseenter", onFlyoutZoneEnter);
      flyoutBridge.addEventListener("mouseleave", onFlyoutZoneLeave);
    }
    if (toolFlyouts) {
      toolFlyouts.addEventListener("mouseenter", onFlyoutZoneEnter);
      toolFlyouts.addEventListener("mouseleave", onFlyoutZoneLeave);
    }
  }

  function resetMeasureState() {
    measurePinA = null;
    measurePinB = null;
    measureHoverBounds = null;
    measureHoverB = null;
    renderMeasureOverlay();
  }

  function rebuildMeasurePixelCache() {
    measurePixelData = null;
    if (!originalImageData || !originalCaptureW || !originalCaptureH) return;
    const tmp = document.createElement("canvas");
    tmp.width = originalCaptureW;
    tmp.height = originalCaptureH;
    const tctx = tmp.getContext("2d");
    if (!tctx) return;
    const img = new Image();
    img.onload = () => {
      tctx.drawImage(img, 0, 0);
      const data = tctx.getImageData(0, 0, originalCaptureW, originalCaptureH);
      measurePixelData = data.data;
      measurePixelW = originalCaptureW;
      measurePixelH = originalCaptureH;
    };
    img.src = originalImageData;
  }

  function measureColorAt(px, py) {
    if (!measurePixelData) return null;
    const i = (py * measurePixelW + px) * 4;
    return [measurePixelData[i], measurePixelData[i + 1], measurePixelData[i + 2], measurePixelData[i + 3]];
  }

  function colorDist(a, b) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]);
  }

  function floodFillBounds(canvasX, canvasY) {
    if (!measurePixelData || !measurePixelW) return null;
    const ox = lastMockupScreenshotOrigin.x;
    const oy = lastMockupScreenshotOrigin.y;
    const cw = Math.max(1, canvas.width - ox);
    const ch = Math.max(1, canvas.height - oy);
    const px = Math.max(
      0,
      Math.min(measurePixelW - 1, Math.floor(((canvasX - ox) / cw) * measurePixelW))
    );
    const py = Math.max(
      0,
      Math.min(measurePixelH - 1, Math.floor(((canvasY - oy) / ch) * measurePixelH))
    );
    const seed = measureColorAt(px, py);
    if (!seed || seed[3] < 8) return null;
    const visited = new Uint8Array(measurePixelW * measurePixelH);
    const stack = [px, py];
    let minX = px;
    let maxX = px;
    let minY = py;
    let maxY = py;
    let count = 0;
    const maxPixels = measurePixelW * measurePixelH;
    while (stack.length && count < maxPixels) {
      const y = stack.pop();
      const x = stack.pop();
      if (x == null || y == null) continue;
      const idx = y * measurePixelW + x;
      if (visited[idx]) continue;
      const c = measureColorAt(x, y);
      if (!c || colorDist(c, seed) > MEASURE_TOLERANCE) continue;
      visited[idx] = 1;
      count += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0) stack.push(x - 1, y);
      if (x < measurePixelW - 1) stack.push(x + 1, y);
      if (y > 0) stack.push(x, y - 1);
      if (y < measurePixelH - 1) stack.push(x, y + 1);
    }
    const bx = ox + (minX / measurePixelW) * cw;
    const by = oy + (minY / measurePixelH) * ch;
    const bw = ((maxX - minX + 1) / measurePixelW) * cw;
    const bh = ((maxY - minY + 1) / measurePixelH) * ch;
    return { x: bx, y: by, w: bw, h: bh };
  }

  function boundsToOverlayStyle(b) {
    if (!canvasStack || !b) return {};
    const stack = canvasStack.getBoundingClientRect();
    const sw = stack.width / canvas.width;
    const sh = stack.height / canvas.height;
    return {
      left: `${b.x * sw}px`,
      top: `${b.y * sh}px`,
      width: `${b.w * sw}px`,
      height: `${b.h * sh}px`,
    };
  }

  function renderMeasureOverlay() {
    if (!measureOverlay) return;
    measureOverlay.replaceChildren();
    if (currentTool !== "measure") {
      measureOverlay.setAttribute("aria-hidden", "true");
      return;
    }
    measureOverlay.setAttribute("aria-hidden", "false");
    const addHighlight = (b, extraClass) => {
      const el = document.createElement("div");
      el.className = `measure-overlay__highlight${extraClass ? ` ${extraClass}` : ""}`;
      Object.assign(el.style, boundsToOverlayStyle(b));
      measureOverlay.appendChild(el);
    };
    const addTooltip = (b, text) => {
      const tip = document.createElement("div");
      tip.className = "measure-overlay__tooltip";
      tip.textContent = text;
      const st = boundsToOverlayStyle(b);
      tip.style.left = `calc(${st.left} + ${parseFloat(st.width) / 2}px)`;
      tip.style.top = st.top;
      measureOverlay.appendChild(tip);
    };
    if (measureHoverBounds && !measurePinA) {
      addHighlight(measureHoverBounds, "");
      addTooltip(
        measureHoverBounds,
        `${Math.round(measureHoverBounds.w)}×${Math.round(measureHoverBounds.h)}`
      );
    }
    if (measurePinA) addHighlight(measurePinA, "");
    if (measureHoverB && measurePinA && !measurePinB) {
      addHighlight(measureHoverB, "measure-overlay__highlight--b");
      drawMeasureSpacing(measurePinA, measureHoverB);
    }
    if (measurePinA && measurePinB) {
      addHighlight(measurePinB, "measure-overlay__highlight--b");
      drawMeasureSpacing(measurePinA, measurePinB);
    }
  }

  function drawMeasureSpacing(a, b) {
    if (!measureOverlay || !canvasStack) return;
    const stack = canvasStack.getBoundingClientRect();
    const sw = stack.width / canvas.width;
    const sh = stack.height / canvas.height;
    const ax = a.x + a.w / 2;
    const ay = a.y + a.h / 2;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const wrap = document.createElement("div");
    wrap.className = "measure-overlay__spacing";
    wrap.style.left = "0";
    wrap.style.top = "0";
    wrap.style.width = `${stack.width}px`;
    wrap.style.height = `${stack.height}px`;
    const hGap = Math.abs(bx - ax);
    const vGap = Math.abs(by - ay);
    if (hGap >= 2) {
      const line = document.createElement("div");
      line.className = "measure-overlay__spacing-line";
      const left = Math.min(ax, bx) * sw;
      const top = ay * sh;
      line.style.left = `${left}px`;
      line.style.top = `${top}px`;
      line.style.width = `${hGap * sw}px`;
      line.style.height = "2px";
      wrap.appendChild(line);
      const lbl = document.createElement("div");
      lbl.className = "measure-overlay__spacing-label";
      lbl.textContent = `${Math.round(hGap)}px`;
      lbl.style.left = `${left + (hGap * sw) / 2}px`;
      lbl.style.top = `${top - 18}px`;
      lbl.style.transform = "translateX(-50%)";
      wrap.appendChild(lbl);
    }
    if (vGap >= 2) {
      const line = document.createElement("div");
      line.className = "measure-overlay__spacing-line";
      const left = ax * sw;
      const top = Math.min(ay, by) * sh;
      line.style.left = `${left}px`;
      line.style.top = `${top}px`;
      line.style.width = "2px";
      line.style.height = `${vGap * sh}px`;
      wrap.appendChild(line);
      const lbl = document.createElement("div");
      lbl.className = "measure-overlay__spacing-label";
      lbl.textContent = `${Math.round(vGap)}px`;
      lbl.style.left = `${left + 8}px`;
      lbl.style.top = `${top + (vGap * sh) / 2}px`;
      lbl.style.transform = "translateY(-50%)";
      wrap.appendChild(lbl);
    }
    measureOverlay.appendChild(wrap);
  }

  function removeBlurRegion(id) {
    const i = blurRegions.findIndex((b) => b.id === id);
    if (i >= 0) blurRegions.splice(i, 1);
    if (selectedBlurRegionId === id) selectedBlurRegionId = null;
    if (hoveredBlurRegionId === id) hoveredBlurRegionId = null;
    hideBlurTrash();
    redraw();
    commitHistory();
  }

  function hideBlurTrash() {
    if (blurTrashEl) {
      blurTrashEl.remove();
      blurTrashEl = null;
    }
  }

  function showBlurTrash(region) {
    hideBlurTrash();
    if (!canvasStack || currentTool !== "blur") return;
    const stack = canvasStack.getBoundingClientRect();
    const sw = stack.width / canvas.width;
    const sh = stack.height / canvas.height;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "blur-trash-btn";
    btn.setAttribute("aria-label", "Delete blur region");
    if (typeof lucideIcon === "function") {
      btn.innerHTML = lucideIcon("trash-2", 16, "#ef4444");
    }
    btn.style.left = `${(region.x + region.w) * sw - 14}px`;
    btn.style.top = `${region.y * sh - 14}px`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeBlurRegion(region.id);
    });
    canvasStack.appendChild(btn);
    blurTrashEl = btn;
  }

  function pickBlurRegion(px, py) {
    for (let i = blurRegions.length - 1; i >= 0; i--) {
      const r = blurRegions[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r.id;
    }
    return null;
  }

  function blurHandleAt(px, py, r) {
    const hs = [
      { mode: "resize-nw", x: r.x, y: r.y },
      { mode: "resize-ne", x: r.x + r.w, y: r.y },
      { mode: "resize-sw", x: r.x, y: r.y + r.h },
      { mode: "resize-se", x: r.x + r.w, y: r.y + r.h },
      { mode: "resize-n", x: r.x + r.w / 2, y: r.y },
      { mode: "resize-s", x: r.x + r.w / 2, y: r.y + r.h },
      { mode: "resize-w", x: r.x, y: r.y + r.h / 2 },
      { mode: "resize-e", x: r.x + r.w, y: r.y + r.h / 2 },
    ];
    for (const h of hs) {
      if (Math.hypot(px - h.x, py - h.y) <= BLUR_HANDLE_HIT) return h.mode;
    }
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return "move";
    return null;
  }

  function drawBlurChrome(c, r, hovered) {
    c.save();
    c.setLineDash([6, 4]);
    c.strokeStyle = hovered ? "#6d28d9" : "rgba(109,40,217,0.6)";
    c.lineWidth = 2;
    c.strokeRect(r.x, r.y, r.w, r.h);
    c.setLineDash([]);
    if (hovered || selectedBlurRegionId === r.id) {
      const pts = [
        [r.x, r.y],
        [r.x + r.w, r.y],
        [r.x, r.y + r.h],
        [r.x + r.w, r.y + r.h],
        [r.x + r.w / 2, r.y],
        [r.x + r.w / 2, r.y + r.h],
        [r.x, r.y + r.h / 2],
        [r.x + r.w, r.y + r.h / 2],
      ];
      c.fillStyle = "#ffffff";
      c.strokeStyle = "#6d28d9";
      for (const [hx, hy] of pts) {
        c.fillRect(hx - 4, hy - 4, 8, 8);
        c.strokeRect(hx - 4, hy - 4, 8, 8);
      }
    }
    c.restore();
  }

  function drawBaseLayersBeforeBlur(c) {
    c.clearRect(0, 0, canvas.width, canvas.height);
    if (baseImage) c.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
    for (const s of shapes) drawCommittedShape(s, c);
    for (const ann of annotations) drawCommittedAnnotationRect(c, ann);
  }

  function applyBlurRegionToCtx(destCtx, sourceCanvas, region) {
    const { x, y, w, h } = region;
    if (w < 1 || h < 1) return;
    destCtx.save();
    destCtx.beginPath();
    destCtx.rect(x, y, w, h);
    destCtx.clip();
    destCtx.filter = `blur(${blurIntensity}px)`;
    destCtx.drawImage(sourceCanvas, 0, 0);
    destCtx.restore();
  }

  function applyAllBlurRegionsToCtx(destCtx, sourceCanvas) {
    for (const region of blurRegions) {
      applyBlurRegionToCtx(destCtx, sourceCanvas, region);
    }
  }

  let lastCanvasPointer = { x: 0, y: 0, valid: false };

  function applyCanvasCursorFromCoords(px, py) {
    if (!baseImage) return;
    lastCanvasPointer = { x: px, y: py, valid: true };
    if (currentTool === "mockup") {
      canvas.style.cursor = "default";
      return;
    }
    if (currentTool === "blur") {
      const id = pickBlurRegion(px, py);
      if (id != null) {
        const r = blurRegions.find((b) => b.id === id);
        if (r && blurHandleAt(px, py, r)) {
          canvas.style.cursor = "pointer";
          return;
        }
      }
      canvas.style.cursor = "crosshair";
      return;
    }
    if (currentTool === "measure") {
      canvas.style.cursor = "crosshair";
      return;
    }
    if (currentTool === "select") {
      canvas.style.cursor = "default";
      return;
    }
    if (currentTool === "annotate") {
      if (editingAnnotationId != null) {
        canvas.style.cursor = "default";
        return;
      }
      if (isDraggingPin) {
        canvas.style.cursor = "grabbing";
        return;
      }
      if (annotatePlaceActive) {
        canvas.style.cursor = "crosshair";
        return;
      }
      for (let i = annotations.length - 1; i >= 0; i--) {
        const ann = annotations[i];
        if (Math.hypot(px - ann.pinX, py - ann.pinY) <= PIN_HIT_DIST) {
          canvas.style.cursor = "grab";
          return;
        }
      }
      canvas.style.cursor = "crosshair";
    }
  }

  function applyCanvasCursorLast() {
    if (!baseImage) return;
    if (!lastCanvasPointer.valid) {
      canvas.style.cursor = "";
      return;
    }
    applyCanvasCursorFromCoords(lastCanvasPointer.x, lastCanvasPointer.y);
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const bigint = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /** 6-digit hex + 2-digit alpha (e.g. `1f` ≈ 12%) for canvas fillStyle. */
  function hexWithAlphaByte(hex, alphaByte) {
    let h = (hex || "#000000").replace(/^#/, "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6) return hexToRgba(hex, parseInt(alphaByte, 16) / 255);
    return `#${h}${alphaByte}`;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (!r || r <= 0) {
      ctx.rect(x, y, w, h);
      return;
    }
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  /** Top corners rounded; bottom edge square (for browser chrome). */
  function roundRectTop(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (!r || r <= 0) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      return;
    }
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function clipRoundRect(ctx, x, y, w, h, r) {
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();
  }

  function clearCtxShadow(ctx) {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  /** @param {string} bg hex or gradient-blue | gradient-pink */
  function drawBackground(ctx, w, h, bg) {
    if (bg === "gradient-blue") {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#667eea");
      g.addColorStop(1, "#764ba2");
      ctx.fillStyle = g;
    } else if (bg === "gradient-pink") {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#f093fb");
      g.addColorStop(1, "#f5576c");
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = bg;
    }
    ctx.fillRect(0, 0, w, h);
  }

  /** @param {'none'|'soft'|'medium'|'hard'} type */
  function applyShadow(ctx, type) {
    clearCtxShadow(ctx);
    switch (type) {
      case "soft":
        ctx.shadowColor = "rgba(0,0,0,0.08)";
        ctx.shadowBlur = 30;
        ctx.shadowOffsetY = 8;
        break;
      case "medium":
        ctx.shadowColor = "rgba(0,0,0,0.16)";
        ctx.shadowBlur = 48;
        ctx.shadowOffsetY = 16;
        break;
      case "hard":
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 60;
        ctx.shadowOffsetY = 24;
        break;
      default:
        break;
    }
  }

  const MOCKUP_BAR_H = 52;

  /** Browser chrome; outer corners use radius `r` when set, else 10px. */
  function drawMockupBrowserFrame(ctx, x, y, sw, sh, r) {
    const barH = MOCKUP_BAR_H;
    const totalW = sw;
    const totalH = sh + barH;
    const cornerR = r > 0 ? r : 10;

    ctx.fillStyle = "#ffffff";
    roundRect(ctx, x, y, totalW, totalH, cornerR);
    ctx.fill();

    clearCtxShadow(ctx);

    ctx.fillStyle = "#f2f2f2";
    roundRectTop(ctx, x, y, totalW, barH, cornerR);
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + barH);
    ctx.lineTo(x + totalW, y + barH);
    ctx.stroke();

    const tlY = y + barH / 2;
    const colors = ["#ff5f57", "#febc2e", "#28c840"];
    colors.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x + 18 + i * 20, tlY, 5.5, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "#e4e4e4";
    roundRect(ctx, x + totalW / 2 - 100, y + barH / 2 - 10, 200, 20, 10);
    ctx.fill();

    ctx.fillStyle = "#999999";
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("snappd.app", x + totalW / 2, y + barH / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function drawMockupBorderFrame(ctx, x, y, sw, sh, r) {
    const bw = Math.max(0, Math.min(20, Number(mockupState.borderWidth) || 2));
    const rr = r > 0 ? r : 0;
    const outerR = rr > 0 ? rr + bw : 0;

    ctx.fillStyle = "#ffffff";
    roundRect(ctx, x - bw, y - bw, sw + bw * 2, sh + bw * 2, outerR);
    ctx.fill();

    clearCtxShadow(ctx);

    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = bw;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (rr <= 0) {
      ctx.strokeRect(x - bw / 2, y - bw / 2, sw + bw, sh + bw);
    } else {
      const strokeR = rr + bw / 2;
      roundRect(ctx, x - bw / 2, y - bw / 2, sw + bw, sh + bw, strokeR);
      ctx.stroke();
    }
  }

  function applyCanvasContentOffset(ox, oy) {
    for (const ann of annotations) {
      ann.pinX += ox;
      ann.pinY += oy;
      if (ann.hasRect) {
        ann.rectX += ox;
        ann.rectY += oy;
      }
    }
    for (const b of blurRegions) {
      b.x += ox;
      b.y += oy;
    }
    for (const s of shapes) {
      if (s.type === "rect" || s.type === "text") {
        s.x += ox;
        s.y += oy;
      } else if (s.type === "arrow") {
        s.x1 += ox;
        s.y1 += oy;
        s.x2 += ox;
        s.y2 += oy;
      }
    }
  }

  function computeMockupLayout(device, screenshotW, screenshotH, padding) {
    const bw =
      device === "border"
        ? Math.max(0, Math.min(20, Number(mockupState.borderWidth) || 2))
        : 0;
    const pad = padding + bw;
    if (device === "browser") {
      return {
        totalW: screenshotW + pad * 2,
        totalH: screenshotH + pad * 2 + MOCKUP_BAR_H,
        screenshotX: pad,
        screenshotY: pad + MOCKUP_BAR_H,
      };
    }
    return {
      totalW: screenshotW + pad * 2,
      totalH: screenshotH + pad * 2,
      screenshotX: pad,
      screenshotY: pad,
    };
  }

  /**
   * Live mockup preview from {@link originalImageData}; adjusts annotation offsets when placement changes.
   * @param {(() => void) | undefined} onDone
   */
  function previewMockup(onDone) {
    if (!originalImageData) return;

    const img = new Image();
    let compositeStarted = false;

    function run() {
      if (compositeStarted) return;

      const screenshotW = img.naturalWidth;
      const screenshotH = img.naturalHeight;
      if (!screenshotW || !screenshotH) return;

      const padding = mockupState.padding;
      const { totalW, totalH, screenshotX, screenshotY } = computeMockupLayout(
        mockupState.device,
        screenshotW,
        screenshotH,
        padding
      );

      const mc = document.createElement("canvas");
      mc.width = totalW;
      mc.height = totalH;
      const mctx = mc.getContext("2d");
      if (!mctx) return;

      compositeStarted = true;

      const dx = screenshotX - lastMockupScreenshotOrigin.x;
      const dy = screenshotY - lastMockupScreenshotOrigin.y;
      if (dx !== 0 || dy !== 0) {
        applyCanvasContentOffset(dx, dy);
      }
      lastMockupScreenshotOrigin = { x: screenshotX, y: screenshotY };

      const bg = mockupState.background;
      drawBackground(mctx, totalW, totalH, typeof bg === "string" ? bg : "#f5f5f5");

      const r = mockupState.radius;
      const sw = screenshotW;
      const sh = screenshotH;
      const sx = screenshotX;
      const sy = screenshotY;
      const pad = padding;
      const dev = mockupState.device;
      const shadowType = mockupState.shadow;

      function clipShot() {
        mctx.save();
        if (r > 0) {
          clipRoundRect(mctx, sx, sy, sw, sh, r);
        } else {
          mctx.beginPath();
          mctx.rect(sx, sy, sw, sh);
          mctx.clip();
        }
        mctx.drawImage(img, sx, sy);
        mctx.restore();
      }

      if (dev === "none") {
        applyShadow(mctx, shadowType);
        clipShot();
        clearCtxShadow(mctx);
      } else if (dev === "browser") {
        applyShadow(mctx, shadowType);
        drawMockupBrowserFrame(mctx, pad, pad, sw, sh, r);
        clearCtxShadow(mctx);
        clipShot();
      } else {
        applyShadow(mctx, shadowType);
        drawMockupBorderFrame(mctx, sx, sy, sw, sh, r);
        clearCtxShadow(mctx);
        clipShot();
      }

      const dataUrl = mc.toDataURL("image/png");
      const composed = new Image();
      let finished = false;

      function finish() {
        if (finished) return;
        if (!composed.naturalWidth) return;
        finished = true;
        canvas.width = totalW;
        canvas.height = totalH;
        baseImage = composed;
        redraw();
        updateConnectorsSVG();
        positionAllCards();
        if (typeof onDone === "function") onDone();
      }

      composed.onload = finish;
      composed.onerror = finish;
      composed.src = dataUrl;
      if (composed.complete && composed.naturalWidth) {
        finish();
      }
    }

    img.onload = run;
    img.onerror = () => {
      if (typeof onDone === "function") onDone();
    };
    img.src = originalImageData;
    if (img.complete && img.naturalWidth) {
      run();
    }
  }

  function resetMockup() {
    if (!originalImageData) return;

    applyCanvasContentOffset(-lastMockupScreenshotOrigin.x, -lastMockupScreenshotOrigin.y);
    lastMockupScreenshotOrigin = { x: 0, y: 0 };

    mockupState = {
      device: "none",
      radius: 0,
      shadow: "none",
      background: "#f5f5f5",
      padding: 48,
      borderWidth: 2,
    };

    let done = false;
    function finish() {
      if (done) return;
      done = true;
      redraw();
      updateConnectorsSVG();
      positionAllCards();
      syncMockupPanelFromState();
      commitHistory();
    }

    loadImage(originalImageData)
      .then((img) => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        baseImage = img;
        finish();
      })
      .catch(() => syncMockupPanelFromState());
  }

  const ANNOTATE_RECT_RADIUS = 6;

  function beginAnnotationRoundRectPath(c, x, y, w, h) {
    const rr = Math.min(ANNOTATE_RECT_RADIUS, w / 2, h / 2);
    c.beginPath();
    if (typeof c.roundRect === "function") {
      c.roundRect(x, y, w, h, rr);
    } else {
      c.rect(x, y, w, h);
    }
  }

  function luminanceFromHex(hex) {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const r = parseInt(full.slice(0, 2), 16) / 255;
    const g = parseInt(full.slice(2, 4), 16) / 255;
    const b = parseInt(full.slice(4, 6), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function badgeTextColor(bgHex) {
    return luminanceFromHex(bgHex) > 0.78 ? "#111111" : "#ffffff";
  }

  function categoryChevronUrl(darkText) {
    const fill = darkText ? "%23111111" : "%23ffffff";
    return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath fill='${fill}' d='M2 3l2 2 2-2'/%3E%3C/svg%3E`;
  }

  function drawArrowLineOnCtx(c, x1, y1, x2, y2, lineWidth, strokeStyle) {
    c.save();
    c.strokeStyle = strokeStyle;
    c.lineWidth = lineWidth;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();

    const headLen = Math.max(12, lineWidth * 5);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    c.fillStyle = strokeStyle;
    c.beginPath();
    c.moveTo(x2, y2);
    c.lineTo(
      x2 - headLen * Math.cos(angle - Math.PI / 6),
      y2 - headLen * Math.sin(angle - Math.PI / 6)
    );
    c.lineTo(
      x2 - headLen * Math.cos(angle + Math.PI / 6),
      y2 - headLen * Math.sin(angle + Math.PI / 6)
    );
    c.closePath();
    c.fill();
    c.restore();
  }

  function drawCommittedShape(shape, c = ctx) {
    const sw = Number(shape.strokeWidth) || strokeWidth;
    if (shape.type === "rect") {
      const { x, y, width, height } = shape;
      c.save();
      c.strokeStyle = shape.color;
      c.lineWidth = sw;
      c.fillStyle = hexToRgba(shape.color, 0.1);
      c.fillRect(x, y, width, height);
      c.strokeRect(x, y, width, height);
      c.restore();
    } else if (shape.type === "arrow") {
      drawArrowLineOnCtx(c, shape.x1, shape.y1, shape.x2, shape.y2, sw, shape.color);
    } else if (shape.type === "text") {
      c.save();
      c.font = `500 18px Inter, system-ui, sans-serif`;
      c.fillStyle = shape.color;
      c.textBaseline = "top";
      c.fillText(shape.text || "", shape.x, shape.y);
      c.restore();
    }
  }

  function drawSelectionChrome(shape) {
    if (!shape) return;
    let bx = 0;
    let by = 0;
    let bw = 0;
    let bh = 0;
    if (shape.type === "rect") {
      bx = shape.x;
      by = shape.y;
      bw = shape.width;
      bh = shape.height;
    } else if (shape.type === "text") {
      ctx.save();
      ctx.font = `500 18px Inter, system-ui, sans-serif`;
      const m = ctx.measureText(shape.text || "");
      bx = shape.x - 2;
      by = shape.y - 2;
      bw = m.width + 4;
      bh = 22;
      ctx.restore();
    } else if (shape.type === "arrow") {
      bx = Math.min(shape.x1, shape.x2) - 6;
      by = Math.min(shape.y1, shape.y2) - 6;
      bw = Math.abs(shape.x2 - shape.x1) + 12;
      bh = Math.abs(shape.y2 - shape.y1) + 12;
    }
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.restore();
  }

  function drawCommittedAnnotationRect(c, ann) {
    if (!ann.hasRect) return;
    c.save();
    c.lineJoin = "round";
    c.lineCap = "round";
    beginAnnotationRoundRectPath(c, ann.rectX, ann.rectY, ann.rectW, ann.rectH);
    c.fillStyle = hexWithAlphaByte(ann.color, "1f");
    c.fill();
    c.strokeStyle = ann.color;
    c.lineWidth = 2;
    c.setLineDash([6, 4]);
    c.stroke();
    c.setLineDash([]);
    c.restore();
  }

  function drawLiveAnnotateRectPreview(x0, y0, x1, y1) {
    const n = normalizeRect(x0, y0, x1, y1);
    const previewColor = categoryColor("UI");
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    beginAnnotationRoundRectPath(ctx, n.x, n.y, n.width, n.height);
    ctx.fillStyle = hexWithAlphaByte(previewColor, "1f");
    ctx.fill();
    ctx.strokeStyle = previewColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawAnnotationPinOnCtx(c, ann) {
    c.save();
    c.shadowBlur = 10;
    c.shadowColor = "rgba(0,0,0,0.4)";
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 0;
    c.beginPath();
    c.arc(ann.pinX, ann.pinY, PIN_RING_R, 0, Math.PI * 2);
    c.fillStyle = "#ffffff";
    c.fill();
    c.beginPath();
    c.arc(ann.pinX, ann.pinY, PIN_R, 0, Math.PI * 2);
    c.fillStyle = ann.color;
    c.fill();
    c.shadowColor = "transparent";
    c.shadowBlur = 0;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 0;
    c.font = '700 11px "Figtree", system-ui, sans-serif';
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = "#ffffff";
    c.fillText(String(ann.id), ann.pinX, ann.pinY);
    c.textAlign = "start";
    c.textBaseline = "alphabetic";
    c.restore();
  }

  function nearestPointOnRectBorder(px, py, rx, ry, rw, rh) {
    if (rw <= 0 || rh <= 0) return { x: px, y: py };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const cx = clamp(px, rx, rx + rw);
    const cy = clamp(py, ry, ry + rh);
    if (Math.abs(cx - px) > 1e-4 || Math.abs(cy - py) > 1e-4) {
      return { x: cx, y: cy };
    }
    const dL = px - rx;
    const dR = rx + rw - px;
    const dT = py - ry;
    const dB = ry + rh - py;
    const m = Math.min(dL, dR, dT, dB);
    if (m === dL) return { x: rx, y: cy };
    if (m === dR) return { x: rx + rw, y: cy };
    if (m === dT) return { x: cx, y: ry };
    return { x: cx, y: ry + rh };
  }

  /**
   * Connector end on card border for 4-direction placement.
   * @param {object} ann
   * @param {{ left: number; top: number; width: number; height: number }} cr
   */
  function connectorEndOnCard(ann, cr) {
    const side = ann.cardSide || "right";
    const yMid = cr.top + cr.height / 2;
    const xMid = cr.left + cr.width / 2;
    if (side === "right") return { x: cr.left, y: Math.max(cr.top, Math.min(cr.top + cr.height, ann.pinY)) };
    if (side === "left") return { x: cr.left + cr.width, y: Math.max(cr.top, Math.min(cr.top + cr.height, ann.pinY)) };
    if (side === "bottom") return { x: Math.max(cr.left, Math.min(cr.left + cr.width, ann.pinX)), y: cr.top };
    return { x: Math.max(cr.left, Math.min(cr.left + cr.width, ann.pinX)), y: cr.top + cr.height };
  }

  function stackPxToCanvasX(px, sw) {
    return (px / sw) * canvas.width;
  }

  function stackPxToCanvasY(py, sh) {
    return (py / sh) * canvas.height;
  }

  /** Bitmap/CSS scale: board canvas backing store vs on-screen width (export + layout). */
  function getCanvasCssToBitmapScaleX() {
    const r = canvas.getBoundingClientRect();
    const dw = r.width || canvas.width;
    return canvas.width / dw;
  }

  /** @param {object} ann */
  function getAnnotationCardElement(ann) {
    if (ann._el) return /** @type {HTMLElement} */ (ann._el);
    return /** @type {HTMLElement | null} */ (
      annotationCardsRoot?.querySelector(`[data-annotation-id="${ann.id}"]`) || null
    );
  }

  function countWrappedTextLines(c, text, maxWidth) {
    const words = text.split(" ");
    let line = "";
    let lines = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line + words[i] + " ";
      if (c.measureText(test).width > maxWidth && line) {
        lines++;
        line = words[i] + " ";
      } else {
        line = test;
      }
    }
    if (line.trim().length > 0) lines++;
    return Math.max(1, lines);
  }

  /**
   * Vertical space needed for simplified export card (padding + badge + body), bitmap px.
   * @param {CanvasRenderingContext2D} c
   * @param {object} ann
   * @param {number} cardW
   * @param {number} layoutScale
   */
  function measureExportCardContentHeight(c, ann, cardW, layoutScale) {
    const pad = 16 * layoutScale;
    const badgeFont = Math.max(13, 10) * layoutScale;
    const bh = Math.round(badgeFont * 1.25 + 8 * layoutScale);
    const gap = 8 * layoutScale;
    const bodyFont = Math.max(14, 12) * layoutScale;
    const lineH = bodyFont * 1.45;
    const maxW = Math.max(0, cardW - pad * 2);
    const bodyText = (ann.text || "").replace(/\s+/g, " ").trim() || "(empty)";
    c.save();
    c.font = `400 ${bodyFont}px Inter, system-ui, sans-serif`;
    const nLines = maxW > 0 ? countWrappedTextLines(c, bodyText, maxW) : 1;
    c.restore();
    return Math.ceil(pad + bh + gap + nLines * lineH + pad);
  }

  /**
   * Card bounds for export: DOM size from getBoundingClientRect, scaled to canvas space,
   * with height at least that required for full annotation text (confirmed cards are short in DOM).
   * @param {object} ann
   * @param {CanvasRenderingContext2D} c
   * @param {number} layoutScale
   */
  function getCardRectCanvasForExport(ann, c, layoutScale) {
    if (!canvasStack) {
      return getCardRectCanvas(ann);
    }
    const stack = canvasStack.getBoundingClientRect();
    const sw = stack.width || 1;
    const sh = stack.height || 1;
    const el = getAnnotationCardElement(ann);
    if (!el) {
      const w = (CARD_WIDTH_EDIT_PX / sw) * canvas.width;
      const h = measureExportCardContentHeight(c, ann, w, layoutScale);
      return {
        left: ann.pinX + ann.cardOffsetX,
        top: ann.pinY + ann.cardOffsetY,
        width: w,
        height: h,
      };
    }
    const br = el.getBoundingClientRect();
    const left = ((br.left - stack.left) / sw) * canvas.width;
    const top = ((br.top - stack.top) / sh) * canvas.height;
    const width = (br.width / sw) * canvas.width;
    const domH = (br.height / sh) * canvas.height;
    const contentH = measureExportCardContentHeight(c, ann, width, layoutScale);
    return {
      left,
      top,
      width,
      height: Math.max(domH, contentH),
    };
  }

  function cardRectsOverlap(a, b, pad) {
    return !(
      a.left + a.width + pad <= b.left ||
      b.left + b.width + pad <= a.left ||
      a.top + a.height + pad <= b.top ||
      b.top + b.height + pad <= a.top
    );
  }

  function getOtherCardRectsCanvas(excludeId) {
    const rects = [];
    for (const other of annotations) {
      if (other.id === excludeId) continue;
      const el = getAnnotationCardElement(other);
      if (!el || !canvasStack) continue;
      const stack = canvasStack.getBoundingClientRect();
      const sw = stack.width || 1;
      const sh = stack.height || 1;
      const br = el.getBoundingClientRect();
      rects.push({
        left: ((br.left - stack.left) / sw) * canvas.width,
        top: ((br.top - stack.top) / sh) * canvas.height,
        width: (br.width / sw) * canvas.width,
        height: (br.height / sh) * canvas.height,
      });
    }
    return rects;
  }

  function computeSmartCardPlacement(ann) {
    if (!canvasStack) return;
    const stack = canvasStack.getBoundingClientRect();
    const sw = stack.width || 1;
    const sh = stack.height || 1;
    const gap = stackPxToCanvasX(CARD_GAP_PX, sw);
    const gapY = stackPxToCanvasY(CARD_GAP_PX, sh);
    const el = getAnnotationCardElement(ann);
    const cardW = el ? el.offsetWidth : CARD_WIDTH_EDIT_PX;
    const cardH = el ? el.offsetHeight : 100;
    const cardWCanvas = (cardW / sw) * canvas.width;
    const cardHCanvas = (cardH / sh) * canvas.height;
    const margin = stackPxToCanvasX(8, sw);
    const overlapPad = stackPxToCanvasX(8, sw);
    const otherRects = getOtherCardRectsCanvas(ann.id);
    const sides = ["right", "left", "bottom", "top"];
    const placements = {
      right: { ox: gap, oy: -cardHCanvas / 2, side: "right" },
      left: { ox: -(cardWCanvas + gap), oy: -cardHCanvas / 2, side: "left" },
      bottom: { ox: -cardWCanvas / 2, oy: gapY, side: "bottom" },
      top: { ox: -cardWCanvas / 2, oy: -(cardHCanvas + gapY), side: "top" },
    };

    function fitsWithoutOverlap(left, top) {
      if (
        left < margin ||
        top < margin ||
        left + cardWCanvas > canvas.width - margin ||
        top + cardHCanvas > canvas.height - margin
      ) {
        return false;
      }
      const mine = { left, top, width: cardWCanvas, height: cardHCanvas };
      for (const other of otherRects) {
        if (cardRectsOverlap(mine, other, overlapPad)) return false;
      }
      return true;
    }

    for (const side of sides) {
      const p = placements[side];
      const left = ann.pinX + p.ox;
      const top = ann.pinY + p.oy;
      if (fitsWithoutOverlap(left, top)) {
        ann.cardSide = p.side;
        ann.cardOffsetX = left - ann.pinX;
        ann.cardOffsetY = top - ann.pinY;
        return;
      }
    }

    const p = placements.right;
    ann.cardSide = p.side;
    let left = Math.max(margin, Math.min(ann.pinX + p.ox, canvas.width - cardWCanvas - margin));
    let top = Math.max(margin, Math.min(ann.pinY + p.oy, canvas.height - cardHCanvas - margin));
    for (let nudge = 0; nudge < 12; nudge++) {
      const mine = { left, top, width: cardWCanvas, height: cardHCanvas };
      let hit = false;
      for (const other of otherRects) {
        if (cardRectsOverlap(mine, other, overlapPad)) {
          top = Math.min(top + overlapPad, canvas.height - cardHCanvas - margin);
          hit = true;
          break;
        }
      }
      if (!hit) break;
    }
    ann.cardOffsetX = left - ann.pinX;
    ann.cardOffsetY = top - ann.pinY;
  }

  /**
   * @param {object} ann
   * @param {{ animate?: boolean } | undefined} [opts]
   */
  function repositionCard(ann, opts) {
    computeSmartCardPlacement(ann);
    const animate = !!(opts && opts.animate);
    if (animate && ann._el) {
      const el = /** @type {HTMLElement & { _pinAnimTimer?: number }} */ (ann._el);
      el.classList.add("annotation-card--pin-move");
      el.offsetHeight;
      positionCard(ann);
      if (el._pinAnimTimer) window.clearTimeout(el._pinAnimTimer);
      el._pinAnimTimer = window.setTimeout(() => {
        el.classList.remove("annotation-card--pin-move");
        el._pinAnimTimer = undefined;
      }, 220);
    } else {
      if (ann._el) {
        const el = /** @type {HTMLElement & { _pinAnimTimer?: number }} */ (ann._el);
        if (el._pinAnimTimer) window.clearTimeout(el._pinAnimTimer);
        el._pinAnimTimer = undefined;
        el.classList.remove("annotation-card--pin-move");
      }
      positionCard(ann);
    }
    scheduleConnectorUpdate();
  }

  function getCardRectCanvas(ann) {
    const el = getAnnotationCardElement(ann);
    if (!el || !canvasStack) {
      const w = (CARD_WIDTH_EDIT_PX / (canvasStack?.clientWidth || 1)) * canvas.width;
      const h = (140 / (canvasStack?.clientHeight || 1)) * canvas.height;
      return {
        left: ann.pinX + ann.cardOffsetX,
        top: ann.pinY + ann.cardOffsetY,
        width: w,
        height: h,
      };
    }
    const stack = canvasStack.getBoundingClientRect();
    const br = el.getBoundingClientRect();
    const sw = stack.width || 1;
    const sh = stack.height || 1;
    return {
      left: ((br.left - stack.left) / sw) * canvas.width,
      top: ((br.top - stack.top) / sh) * canvas.height,
      width: (br.width / sw) * canvas.width,
      height: (br.height / sh) * canvas.height,
    };
  }

  function drawDottedLineOnCtx(c, x1, y1, x2, y2, strokeColor) {
    c.save();
    c.strokeStyle = strokeColor;
    c.lineWidth = 1.5;
    c.setLineDash([4, 4]);
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
    c.restore();
  }

  function drawSimplifiedCardOnCtx(c, ann, cr, layoutScale) {
    const pad = 16 * layoutScale;
    const cornerR = 16 * layoutScale;
    const x = cr.left;
    const y = cr.top;
    const w = cr.width;
    const h = cr.height;
    c.save();
    const rr = Math.min(cornerR, w / 2, h / 2);
    c.shadowColor = "rgba(0,0,0,0.12)";
    c.shadowBlur = 20 * layoutScale;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 4 * layoutScale;
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
    c.fill();
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    c.strokeStyle = "#f0f0f0";
    c.lineWidth = Math.max(1, layoutScale);
    c.stroke();

    const badgeFont = Math.max(13, 10) * layoutScale;
    const badgePad = 6 * layoutScale;
    c.font = `500 ${badgeFont}px "Geist Mono", ui-monospace, monospace`;
    const badgeText = categoryLabel(ann.category) || "UI";
    const minBadgeW = (60 / CARD_WIDTH_EDIT_PX) * w;
    const maxBadgeW = (140 / CARD_WIDTH_EDIT_PX) * w;
    const textW = c.measureText(badgeText).width + badgePad * 2;
    const bw = Math.min(
      maxBadgeW,
      Math.max(minBadgeW, Math.min(textW, w - pad * 2))
    );
    const bh = Math.round(badgeFont * 1.25 + 8 * layoutScale);
    const badgePillRadius = bh / 2;
    const pillW = Math.max(bw, badgePillRadius * 2);
    const bx = x + pad;
    const by = y + pad;
    c.fillStyle = ann.color;
    c.beginPath();
    c.moveTo(bx + badgePillRadius, by);
    c.lineTo(bx + pillW - badgePillRadius, by);
    c.arc(bx + pillW - badgePillRadius, by + badgePillRadius, badgePillRadius, -Math.PI / 2, Math.PI / 2);
    c.lineTo(bx + badgePillRadius, by + bh);
    c.arc(bx + badgePillRadius, by + badgePillRadius, badgePillRadius, Math.PI / 2, -Math.PI / 2);
    c.closePath();
    c.fill();
    c.fillStyle = "#ffffff";
    c.textBaseline = "middle";
    c.textAlign = "left";
    c.fillText(badgeText, x + pad + badgePad, y + pad + bh / 2);

    const bodyFont = Math.max(14, 12) * layoutScale;
    const lineH = bodyFont * 1.45;
    const gap = 8 * layoutScale;
    c.fillStyle = "#1a1a1a";
    c.font = `400 ${bodyFont}px Inter, system-ui, sans-serif`;
    c.textAlign = "left";
    c.textBaseline = "top";
    const bodyText = (ann.text || "").replace(/\s+/g, " ").trim() || "(empty)";
    const maxW = w - pad * 2;
    wrapTextLines(c, bodyText, x + pad, y + pad + bh + gap, maxW, lineH, 999);
    c.restore();
  }

  function wrapTextLines(c, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = text.split(" ");
    let line = "";
    let ly = y;
    let n = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line + words[i] + " ";
      if (c.measureText(test).width > maxWidth && line) {
        c.fillText(line, x, ly);
        line = words[i] + " ";
        ly += lineHeight;
        n++;
        if (n >= maxLines - 1) break;
      } else {
        line = test;
      }
    }
    if (n < maxLines) c.fillText(line.trim(), x, ly);
  }

  function buildExportCanvas() {
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const c = out.getContext("2d");
    const layoutScale = getCanvasCssToBitmapScaleX();
    drawBaseLayersBeforeBlur(c);
    applyAllBlurRegionsToCtx(c, out);
    for (const ann of annotations) {
      drawAnnotationPinOnCtx(c, ann);
      const cr = getCardRectCanvasForExport(ann, c, layoutScale);
      const end = connectorEndOnCard(ann, cr);
      drawDottedLineOnCtx(c, ann.pinX, ann.pinY, end.x, end.y, ann.color);
      drawSimplifiedCardOnCtx(c, ann, cr, layoutScale);
    }
    return out;
  }

  function redraw() {
    drawBaseLayersBeforeBlur(ctx);
    applyAllBlurRegionsToCtx(ctx, canvas);
    if (annotatePlaceActive && annotatePlaceDragging && currentTool === "annotate") {
      drawLiveAnnotateRectPreview(annotateStartX, annotateStartY, annotateCurX, annotateCurY);
    }
    if (blurDragActive && currentTool === "blur") {
      const n = normalizeBlurRect(blurDragStartX, blurDragStartY, blurDragCurX, blurDragCurY);
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#6d28d9";
      ctx.strokeRect(n.x, n.y, n.w, n.h);
      ctx.restore();
    }
    for (const region of blurRegions) {
      const hovered = region.id === hoveredBlurRegionId || region.id === selectedBlurRegionId;
      drawBlurChrome(ctx, region, hovered);
    }
    for (const ann of annotations) {
      drawAnnotationPinOnCtx(ctx, ann);
    }
    if (currentTool === "select" && selectedIndex !== null && shapes[selectedIndex]) {
      drawSelectionChrome(shapes[selectedIndex]);
    }
    updateConnectorsSVG();
    renderMeasureOverlay();
  }

  function updateConnectorsSVG() {
    if (!svgConnectors || !canvas.width) return;
    while (svgConnectors.firstChild) {
      svgConnectors.removeChild(svgConnectors.firstChild);
    }
    svgConnectors.setAttribute("viewBox", `0 0 ${canvas.width} ${canvas.height}`);
    svgConnectors.setAttribute("preserveAspectRatio", "none");
    for (const ann of annotations) {
      const cr = getCardRectCanvas(ann);
      const end = connectorEndOnCard(ann, cr);
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(ann.pinX));
      line.setAttribute("y1", String(ann.pinY));
      line.setAttribute("x2", String(end.x));
      line.setAttribute("y2", String(end.y));
      line.setAttribute("stroke", ann.color);
      line.setAttribute("stroke-width", "1.5");
      line.setAttribute("stroke-dasharray", "4 4");
      line.setAttribute("stroke-linecap", "round");
      svgConnectors.appendChild(line);
    }
  }

  function positionCard(ann) {
    if (!ann._el || !annotationCardsRoot || !canvasStack) return;
    computeSmartCardPlacement(ann);
    const stack = canvasStack.getBoundingClientRect();
    const cardsRect = annotationCardsRoot.getBoundingClientRect();
    const sw = stack.width / canvas.width;
    const sh = stack.height / canvas.height;
    const left = ann.pinX * sw + ann.cardOffsetX * sw;
    const top = ann.pinY * sh + ann.cardOffsetY * sh;
    ann._el.style.left = `${Math.round(left)}px`;
    ann._el.style.top = `${Math.round(top)}px`;
  }

  function positionAllCards() {
    for (const ann of annotations) {
      positionCard(ann);
    }
  }

  function removeAnnotation(ann) {
    const i = annotations.indexOf(ann);
    if (i >= 0) annotations.splice(i, 1);
    if (editingAnnotationId === ann.id) editingAnnotationId = null;
    if (ann._el) ann._el.remove();
    redraw();
    commitHistory();
  }

  function pickAnnotationAt(px, py) {
    for (let i = annotations.length - 1; i >= 0; i--) {
      const ann = annotations[i];
      if (Math.hypot(px - ann.pinX, py - ann.pinY) <= PIN_HIT_DIST) return ann;
    }
    return null;
  }

  function startEditingAnnotation(ann) {
    editingAnnotationId = ann.id;
    if (ann._el) {
      ann._el.classList.remove("is-saved");
      ann._el.classList.add("annotation-card--editing");
      const ta = ann._el.querySelector(".annotation-card__body-input");
      if (ta instanceof HTMLTextAreaElement) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
    scheduleConnectorUpdate();
  }

  function saveEditingAnnotation() {
    const ann = annotations.find((a) => a.id === editingAnnotationId);
    if (!ann) {
      editingAnnotationId = null;
      return;
    }
    const ta = ann._el?.querySelector(".annotation-card__body-input");
    const text = ta instanceof HTMLTextAreaElement ? ta.value.trim() : (ann.text || "").trim();
    if (!text) {
      removeAnnotation(ann);
      editingAnnotationId = null;
      return;
    }
    ann.text = text;
    ann.saved = true;
    editingAnnotationId = null;
    const maxId = annotations.reduce((m, a) => Math.max(m, a.id), 0);
    nextAnnotationId = maxId + 1;
    if (ann._el) {
      ann._el.classList.remove("annotation-card--editing");
      ann._el.classList.add("is-saved");
      const saved = ann._el.querySelector(".annotation-card__saved-text");
      if (saved) saved.textContent = ann.text;
    }
    repositionCard(ann);
    redraw();
    commitHistory();
  }

  function cancelEditingAnnotation() {
    const ann = annotations.find((a) => a.id === editingAnnotationId);
    if (!ann) {
      editingAnnotationId = null;
      return;
    }
    if (!ann.saved) {
      removeAnnotation(ann);
    } else {
      editingAnnotationId = null;
      if (ann._el) {
        ann._el.classList.remove("annotation-card--editing");
        ann._el.classList.add("is-saved");
      }
    }
    redraw();
  }

  function updateCategoryPillUI(ann) {
    const pill = ann._el?.querySelector(".annotation-card__category-pill");
    if (!pill) return;
    pill.style.backgroundColor = ann.color;
    pill.style.color = "#ffffff";
    const label = pill.querySelector(".annotation-card__category-label");
    if (label) label.textContent = categoryLabel(ann.category);
  }

  let connectorRaf = 0;
  function scheduleConnectorUpdate() {
    cancelAnimationFrame(connectorRaf);
    connectorRaf = requestAnimationFrame(() => {
      updateConnectorsSVG();
    });
  }

  function buildCardElement(ann) {
    const card = document.createElement("div");
    card.className = "annotation-card";
    card.dataset.annotationId = String(ann.id);
    if (ann.saved) card.classList.add("is-saved");
    else card.classList.add("annotation-card--editing");

    const header = document.createElement("div");
    header.className = "annotation-card__header";

    const catWrap = document.createElement("div");
    catWrap.className = "annotation-card__category-wrap";

    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "annotation-card__category-pill";
    pill.style.backgroundColor = ann.color;
    const labelSpan = document.createElement("span");
    labelSpan.className = "annotation-card__category-label";
    labelSpan.textContent = categoryLabel(ann.category);
    pill.appendChild(labelSpan);
    if (typeof lucideIcon === "function") {
      const chev = document.createElement("span");
      chev.innerHTML = lucideIcon("chevron-down", 12, "#ffffff");
      pill.appendChild(chev);
    }

    const menu = document.createElement("div");
    menu.className = "annotation-card__category-menu";

    CATEGORY_OPTIONS.forEach((opt, idx) => {
      if (idx === 1) {
        const div = document.createElement("div");
        div.className = "annotation-card__category-divider";
        menu.appendChild(div);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "annotation-card__category-option";
      if (ann.category === opt.value) btn.classList.add("is-selected");
      const check = document.createElement("span");
      check.className = "check-slot";
      if (ann.category === opt.value && typeof lucideIcon === "function") {
        check.innerHTML = lucideIcon("check", 14, "#6d28d9");
      }
      btn.appendChild(check);
      btn.appendChild(document.createTextNode(opt.label));
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        ann.category = opt.value;
        ann.color = opt.color;
        menu.classList.remove("is-open");
        menu.querySelectorAll(".annotation-card__category-option").forEach((el) => {
          el.classList.toggle("is-selected", el === btn);
          const cs = el.querySelector(".check-slot");
          if (cs) cs.innerHTML = el === btn && typeof lucideIcon === "function" ? lucideIcon("check", 14, "#6d28d9") : "";
        });
        updateCategoryPillUI(ann);
        redraw();
        commitHistory();
      });
      menu.appendChild(btn);
    });

    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".annotation-card__category-menu.is-open").forEach((m) => {
        if (m !== menu) m.classList.remove("is-open");
      });
      menu.classList.toggle("is-open");
    });

    catWrap.appendChild(pill);
    catWrap.appendChild(menu);

    const actions = document.createElement("div");
    actions.className = "annotation-card__actions";
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "annotation-card__icon-btn";
    moreBtn.setAttribute("aria-label", "More");
    if (typeof lucideIcon === "function") moreBtn.innerHTML = lucideIcon("ellipsis", 16);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "annotation-card__icon-btn";
    closeBtn.setAttribute("aria-label", "Remove");
    if (typeof lucideIcon === "function") closeBtn.innerHTML = lucideIcon("x", 16);
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeAnnotation(ann);
    });
    actions.appendChild(moreBtn);
    actions.appendChild(closeBtn);

    header.appendChild(catWrap);
    header.appendChild(actions);

    const editor = document.createElement("div");
    editor.className = "annotation-card__editor";
    const textarea = document.createElement("textarea");
    textarea.className = "annotation-card__body-input";
    textarea.placeholder = "Add a note…";
    textarea.value = ann.text || "";
    textarea.addEventListener("input", () => {
      ann.text = textarea.value;
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        editingAnnotationId = ann.id;
        saveEditingAnnotation();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEditingAnnotation();
      }
    });
    editor.appendChild(textarea);

    const savedView = document.createElement("div");
    savedView.className = "annotation-card__saved-view";
    const savedText = document.createElement("div");
    savedText.className = "annotation-card__saved-text";
    savedText.textContent = ann.text || "";
    savedView.appendChild(savedText);

    card.appendChild(header);
    card.appendChild(editor);
    card.appendChild(savedView);

    card.addEventListener("click", (e) => {
      e.stopPropagation();
      if (ann.saved) startEditingAnnotation(ann);
    });

    if (!ann.saved) {
      editingAnnotationId = ann.id;
      requestAnimationFrame(() => textarea.focus());
    }

    const ro = new ResizeObserver(() => {
      positionCard(ann);
      scheduleConnectorUpdate();
    });
    ro.observe(card);

    return card;
  }

  /**
   * @param {{ x: number; y: number } | null} p Pin position for click-only; ignored when rect is set.
   * @param {{ x: number; y: number; width: number; height: number } | null} [rect]
   */
  function addAnnotationAt(p, rect) {
    let pinX;
    let pinY;
    if (rect) {
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const mid = canvas.width / 2;
      if (cx < mid) {
        pinX = rect.x + rect.width;
        pinY = cy;
      } else {
        pinX = rect.x;
        pinY = cy;
      }
    } else {
      if (!p) return;
      pinX = p.x;
      pinY = p.y;
    }
    const ann = {
      id: nextAnnotationId++,
      pinX,
      pinY,
      color: categoryColor("UI"),
      category: "UI",
      text: "",
      saved: false,
      cardSide: "right",
      cardOffsetX: 0,
      cardOffsetY: 0,
    };
    if (rect) {
      ann.hasRect = true;
      ann.rectX = rect.x;
      ann.rectY = rect.y;
      ann.rectW = rect.width;
      ann.rectH = rect.height;
    }
    annotations.push(ann);
    const el = buildCardElement(ann);
    ann._el = el;
    annotationCardsRoot.appendChild(el);
    startEditingAnnotation(ann);
    repositionCard(ann);
    redraw();
  }

  document.addEventListener("click", () => {
    document.querySelectorAll(".annotation-card__category-menu.is-open").forEach((d) => {
      d.classList.remove("is-open");
    });
  });

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    const qx = x1 + t * dx;
    const qy = y1 + t * dy;
    return Math.hypot(px - qx, py - qy);
  }

  function textBounds(shape) {
    ctx.save();
    ctx.font = `500 18px Inter, system-ui, sans-serif`;
    const w = ctx.measureText(shape.text || "").width;
    ctx.restore();
    return { x: shape.x, y: shape.y, w, h: 20 };
  }

  function shapeDistance(px, py, shape) {
    if (shape.type === "rect") {
      const { x, y, width, height } = shape;
      const inside = px >= x && px <= x + width && py >= y && py <= y + height;
      if (inside) return 0;
      const dx = Math.max(x - px, 0, px - (x + width));
      const dy = Math.max(y - py, 0, py - (y + height));
      return Math.hypot(dx, dy);
    }
    if (shape.type === "arrow") {
      return distToSegment(px, py, shape.x1, shape.y1, shape.x2, shape.y2);
    }
    if (shape.type === "text") {
      const b = textBounds(shape);
      const inside = px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
      if (inside) return 0;
      const dx = Math.max(b.x - px, 0, px - (b.x + b.w));
      const dy = Math.max(b.y - py, 0, py - (b.y + b.h));
      return Math.hypot(dx, dy);
    }
    return Infinity;
  }

  function pickNearest(px, py) {
    let best = -1;
    let bestD = 14;
    for (let i = shapes.length - 1; i >= 0; i--) {
      const d = shapeDistance(px, py, shapes[i]);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    }
    return best;
  }

  function setTool(next) {
    if (currentTool === "annotate" && next !== "annotate") {
      annotatePlaceActive = false;
      annotatePlaceDragging = false;
      isDraggingPin = false;
      draggedAnnotationId = null;
    }
    currentTool = next;
    document.querySelectorAll(".sidebar-tool[data-tool]").forEach((btn) => {
      const is = btn.dataset.tool === next;
      btn.classList.toggle("is-active", is);
      btn.setAttribute("aria-pressed", String(is));
    });
    if (next === "blur") {
      hideBlurTrash();
    } else {
      hoveredBlurRegionId = null;
      hideBlurTrash();
    }
    if (next !== "measure") resetMeasureState();
    if (next !== "annotate" && editingAnnotationId != null) {
      const ann = annotations.find((a) => a.id === editingAnnotationId);
      if (ann && !ann.saved) cancelEditingAnnotation();
      else if (ann && ann.saved) {
        editingAnnotationId = null;
        if (ann._el) {
          ann._el.classList.remove("annotation-card--editing");
          ann._el.classList.add("is-saved");
        }
      }
    }
    if (currentTool !== "select") selectedIndex = null;
    showFlyout(next);
    redraw();
    applyCanvasCursorLast();
    if (next === "mockup") previewMockup();
    if (next === "annotate") canvas.style.cursor = "crosshair";
  }

  function syncMockupPanelFromState() {
    document.querySelectorAll(".mockup-device-btn[data-device]").forEach((btn) => {
      const is = btn.getAttribute("data-device") === mockupState.device;
      btn.classList.toggle("is-active", is);
      btn.setAttribute("aria-pressed", String(is));
    });
    if (mockupAdvancedSections) {
      mockupAdvancedSections.hidden = mockupState.device === "none";
    }
    document.querySelectorAll(".mockup-pill-btn[data-radius]").forEach((btn) => {
      const is = Number(btn.getAttribute("data-radius")) === mockupState.radius;
      btn.classList.toggle("is-active", is);
    });
    document.querySelectorAll(".mockup-pill-btn[data-shadow]").forEach((btn) => {
      const is = btn.getAttribute("data-shadow") === mockupState.shadow;
      btn.classList.toggle("is-active", is);
    });
    document.querySelectorAll(".mockup-bg-swatch[data-bg]").forEach((sw) => {
      const is = sw.getAttribute("data-bg") === mockupState.background;
      sw.classList.toggle("is-active", is);
    });
    const padStr = String(mockupState.padding);
    document.querySelectorAll(".mockup-pill-btn[data-padding]").forEach((btn) => {
      const is = btn.getAttribute("data-padding") === padStr;
      btn.classList.toggle("is-active", is);
    });
    if (mockupBorderWidthSection) {
      mockupBorderWidthSection.hidden = mockupState.device !== "border";
    }
    const bw = Math.max(0, Math.min(20, Number(mockupState.borderWidth) || 2));
    mockupState.borderWidth = bw;
    if (mockupBorderWidthInput) mockupBorderWidthInput.value = String(bw);
    if (mockupBorderWidthNum) mockupBorderWidthNum.value = String(bw);
  }

  function onCanvasMouseDown(ev) {
    if (!baseImage || ev.button !== 0) return;
    const p = getCanvasCoords(ev);

    if (editingAnnotationId != null && currentTool === "annotate") {
      const hitAnn = pickAnnotationAt(p.x, p.y);
      if (hitAnn && hitAnn.id === editingAnnotationId) return;
      return;
    }

    if (currentTool === "blur") {
      const id = pickBlurRegion(p.x, p.y);
      if (id != null) {
        const r = blurRegions.find((b) => b.id === id);
        if (r) {
          const mode = blurHandleAt(p.x, p.y, r);
          if (mode) {
            selectedBlurRegionId = id;
            blurHandleMode = mode;
            blurEditState = {
              id,
              startX: p.x,
              startY: p.y,
              startRect: { x: r.x, y: r.y, w: r.w, h: r.h },
            };
            redraw();
            return;
          }
        }
      }
      blurDragActive = true;
      blurDragStartX = p.x;
      blurDragStartY = p.y;
      blurDragCurX = p.x;
      blurDragCurY = p.y;
      selectedBlurRegionId = null;
      hideBlurTrash();
      return;
    }

    if (currentTool === "measure") {
      const bounds = floodFillBounds(p.x, p.y);
      if (!bounds) return;
      if (!measurePinA) {
        measurePinA = bounds;
        measurePinB = null;
        measureHoverB = null;
      } else if (!measurePinB) {
        measurePinB = bounds;
        measureHoverB = null;
        commitHistory();
      }
      renderMeasureOverlay();
      return;
    }

    if (currentTool === "select") {
      selectDragMoved = false;
      const idx = pickNearest(p.x, p.y);
      selectedIndex = idx >= 0 ? idx : null;
      if (selectedIndex !== null) {
        const s = shapes[selectedIndex];
        if (s.type === "rect") {
          selectOffset = { dx: p.x - s.x, dy: p.y - s.y };
        } else if (s.type === "text") {
          selectOffset = { dx: p.x - s.x, dy: p.y - s.y };
        } else if (s.type === "arrow") {
          const mx = (s.x1 + s.x2) / 2;
          const my = (s.y1 + s.y2) / 2;
          selectOffset = { dx: p.x - mx, dy: p.y - my };
        }
        isSelectDragging = true;
      }
      redraw();
      return;
    }

    if (currentTool === "annotate") {
      const hitAnn = pickAnnotationAt(p.x, p.y);
      if (hitAnn) {
        if (hitAnn.saved) startEditingAnnotation(hitAnn);
        else editingAnnotationId = hitAnn.id;
        isDraggingPin = true;
        draggedAnnotationId = hitAnn.id;
        canvas.style.cursor = "grabbing";
        return;
      }
      if (editingAnnotationId != null) return;
      annotatePlaceActive = true;
      annotatePlaceDragging = false;
      annotateStartX = p.x;
      annotateStartY = p.y;
      annotateCurX = p.x;
      annotateCurY = p.y;
      return;
    }
  }

  function onCanvasMouseMove(ev) {
    if (!baseImage) return;
    const p = getCanvasCoords(ev);

    if (currentTool === "blur") {
      if (blurEditState) {
        const r = blurRegions.find((b) => b.id === blurEditState.id);
        if (r) {
          const dx = p.x - blurEditState.startX;
          const dy = p.y - blurEditState.startY;
          const sr = blurEditState.startRect;
          if (blurHandleMode === "move") {
            r.x = sr.x + dx;
            r.y = sr.y + dy;
          } else {
            let { x, y, w, h } = sr;
            if (blurHandleMode.includes("e")) w = sr.w + dx;
            if (blurHandleMode.includes("w")) {
              x = sr.x + dx;
              w = sr.w - dx;
            }
            if (blurHandleMode.includes("s")) h = sr.h + dy;
            if (blurHandleMode.includes("n")) {
              y = sr.y + dy;
              h = sr.h - dy;
            }
            if (w > 4 && h > 4) {
              r.x = x;
              r.y = y;
              r.w = w;
              r.h = h;
            }
          }
          redraw();
        }
        applyCanvasCursorFromCoords(p.x, p.y);
        return;
      }
      if (blurDragActive) {
        blurDragCurX = p.x;
        blurDragCurY = p.y;
        redraw();
        return;
      }
      const id = pickBlurRegion(p.x, p.y);
      if (id !== hoveredBlurRegionId) {
        hoveredBlurRegionId = id;
        const r = blurRegions.find((b) => b.id === id);
        if (r) showBlurTrash(r);
        else hideBlurTrash();
        redraw();
      }
      applyCanvasCursorFromCoords(p.x, p.y);
      return;
    }

    if (currentTool === "measure") {
      if (!measurePinA || measurePinB) {
        measureHoverBounds = floodFillBounds(p.x, p.y);
      } else {
        measureHoverBounds = null;
        measureHoverB = floodFillBounds(p.x, p.y);
      }
      renderMeasureOverlay();
      applyCanvasCursorFromCoords(p.x, p.y);
      return;
    }

    if (currentTool === "annotate") {
      if (isDraggingPin && draggedAnnotationId !== null) {
        const ann = annotations.find((a) => a.id === draggedAnnotationId);
        if (ann) {
          ann.pinX = p.x;
          ann.pinY = p.y;
          positionCard(ann);
          redraw();
        }
        applyCanvasCursorFromCoords(p.x, p.y);
        return;
      }
      if (annotatePlaceActive) {
        const dx = p.x - annotateStartX;
        const dy = p.y - annotateStartY;
        if (!annotatePlaceDragging && Math.hypot(dx, dy) > 4) {
          annotatePlaceDragging = true;
        }
        annotateCurX = p.x;
        annotateCurY = p.y;
        redraw();
        applyCanvasCursorFromCoords(p.x, p.y);
        return;
      }
      applyCanvasCursorFromCoords(p.x, p.y);
      return;
    }

    if (currentTool === "select" && isSelectDragging && selectedIndex !== null && selectOffset) {
      selectDragMoved = true;
      const s = shapes[selectedIndex];
      if (s.type === "rect" || s.type === "text") {
        s.x = p.x - selectOffset.dx;
        s.y = p.y - selectOffset.dy;
      } else if (s.type === "arrow") {
        const mx = (s.x1 + s.x2) / 2;
        const my = (s.y1 + s.y2) / 2;
        const nx = p.x - selectOffset.dx;
        const ny = p.y - selectOffset.dy;
        const dx = nx - mx;
        const dy = ny - my;
        s.x1 += dx;
        s.y1 += dy;
        s.x2 += dx;
        s.y2 += dy;
      }
      redraw();
      applyCanvasCursorFromCoords(p.x, p.y);
      return;
    }
    applyCanvasCursorFromCoords(p.x, p.y);
  }

  function onCanvasMouseUp(ev) {
    if (!baseImage) return;
    if (ev.type === "mouseup" && ev.button !== 0) return;

    if (blurEditState) {
      blurEditState = null;
      blurHandleMode = null;
      commitHistory();
      redraw();
      return;
    }

    if (blurDragActive && currentTool === "blur") {
      const n = normalizeBlurRect(blurDragStartX, blurDragStartY, blurDragCurX, blurDragCurY);
      blurDragActive = false;
      if (n.w >= 4 && n.h >= 4) {
        blurRegions.push({ id: nextBlurRegionId++, ...n });
        commitHistory();
      }
      redraw();
      return;
    }

    if (isDraggingPin) {
      const id = draggedAnnotationId;
      isDraggingPin = false;
      draggedAnnotationId = null;
      const ann = id != null ? annotations.find((a) => a.id === id) : null;
      redraw();
      if (ann) repositionCard(ann, { animate: true });
      commitHistory();
      if (typeof ev.clientX === "number" && typeof ev.clientY === "number") {
        const pc = getCanvasCoords(ev);
        applyCanvasCursorFromCoords(pc.x, pc.y);
      } else {
        canvas.style.cursor = "";
      }
      return;
    }

    if (annotatePlaceActive) {
      if (annotatePlaceDragging) {
        const n = normalizeRect(annotateStartX, annotateStartY, annotateCurX, annotateCurY);
        addAnnotationAt(null, n);
      } else {
        addAnnotationAt({ x: annotateStartX, y: annotateStartY });
      }
      annotatePlaceActive = false;
      annotatePlaceDragging = false;
      redraw();
      return;
    }

    if (currentTool === "select") {
      if (selectDragMoved) commitHistory();
      selectDragMoved = false;
      isSelectDragging = false;
      selectOffset = null;
    }
  }

  function onCanvasMouseLeave() {
    lastCanvasPointer.valid = false;
    if (currentTool === "select" && isSelectDragging) {
      isSelectDragging = false;
      selectOffset = null;
    }
    if (currentTool === "blur" && (blurDragActive || blurEditState)) {
      onCanvasMouseUp({ type: "mouseup", button: 0 });
    }
    if (currentTool === "annotate" && (annotatePlaceActive || isDraggingPin)) {
      onCanvasMouseUp({ type: "mouseup", button: 0 });
    }
    if (currentTool === "blur") {
      hoveredBlurRegionId = null;
      hideBlurTrash();
      redraw();
    }
    if (currentTool === "measure") {
      measureHoverBounds = null;
      if (!measurePinB) measureHoverB = null;
      renderMeasureOverlay();
    }
    applyCanvasCursorLast();
  }

  function attachCanvasListeners() {
    if (canvasListenersAttached) return;
    canvasListenersAttached = true;
    canvas.addEventListener("mousedown", onCanvasMouseDown);
    canvas.addEventListener("mousemove", onCanvasMouseMove);
    canvas.addEventListener("mouseup", onCanvasMouseUp);
    canvas.addEventListener("mouseleave", onCanvasMouseLeave);
  }

  btnUndo.addEventListener("click", () => performUndo());
  if (btnRedo) btnRedo.addEventListener("click", () => performRedo());

  btnDownload.addEventListener("click", () => {
    const out = buildExportCanvas();
    const url = out.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(filenameInput?.value)}.png`;
    a.click();
  });

  let copyToastDismissTimer = 0;
  let copyToastHideTimer = 0;

  function showCopyToastMessage(ok) {
    if (!copyToast) return;
    window.clearTimeout(copyToastDismissTimer);
    window.clearTimeout(copyToastHideTimer);
    copyToast.textContent = ok ? "✓ Copied to clipboard" : "Copy failed";
    copyToast.classList.toggle("copy-toast--error", !ok);
    copyToast.hidden = false;
    copyToast.offsetHeight;
    copyToast.classList.add("is-visible");
    copyToastDismissTimer = window.setTimeout(() => {
      copyToast.classList.remove("is-visible");
      copyToastHideTimer = window.setTimeout(() => {
        copyToast.hidden = true;
        copyToast.classList.remove("copy-toast--error");
      }, 200);
    }, 2000);
  }

  btnCopy.addEventListener("click", async () => {
    try {
      const out = buildExportCanvas();
      const blob = await new Promise((resolve, reject) => {
        out.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
      });
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": blob,
        }),
      ]);
      showCopyToastMessage(true);
    } catch (err) {
      console.error(err);
      showCopyToastMessage(false);
    }
  });

  if (btnHelp) {
    btnHelp.addEventListener("click", () => {
      window.open(FEEDBACK_FORM_URL, "_blank");
    });
  }

  document.querySelectorAll(".sidebar-tool[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => setTool(/** @type {HTMLElement} */ (btn).dataset.tool || "annotate"));
  });

  if (toolFlyouts) {
    toolFlyouts.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const devEl = t.closest(".mockup-device-btn[data-device]");
      if (devEl) {
        const d = devEl.getAttribute("data-device");
        if (d === "none" || d === "browser" || d === "border") {
          mockupState.device = d;
          syncMockupPanelFromState();
          previewMockup(() => commitHistory());
        }
        return;
      }
      const radEl = t.closest(".mockup-pill-btn[data-radius]");
      if (radEl) {
        const n = Number(radEl.getAttribute("data-radius"));
        if (n === 0 || n === 8 || n === 16 || n === 24) {
          mockupState.radius = n;
          syncMockupPanelFromState();
          previewMockup(() => commitHistory());
        }
        return;
      }
      const shEl = t.closest(".mockup-pill-btn[data-shadow]");
      if (shEl) {
        const s = shEl.getAttribute("data-shadow");
        if (s === "none" || s === "soft" || s === "medium" || s === "hard") {
          mockupState.shadow = s;
          syncMockupPanelFromState();
          previewMockup(() => commitHistory());
        }
        return;
      }
      const swEl = t.closest(".mockup-bg-swatch[data-bg]");
      if (swEl) {
        mockupState.background = swEl.getAttribute("data-bg") || "#f5f5f5";
        syncMockupPanelFromState();
        previewMockup(() => commitHistory());
        return;
      }
      const padEl = t.closest(".mockup-pill-btn[data-padding]");
      if (padEl) {
        const n = Number(padEl.getAttribute("data-padding"));
        if (n === 24 || n === 48 || n === 80) {
          mockupState.padding = n;
          syncMockupPanelFromState();
          previewMockup(() => commitHistory());
        }
      }
    });
  }

  if (mockupResetBtn) {
    mockupResetBtn.addEventListener("click", () => resetMockup());
  }

  function syncMockupBorderFromInput(raw) {
    const n = Math.max(0, Math.min(20, Number.isFinite(Number(raw)) ? Number(raw) : 2));
    mockupState.borderWidth = n;
    if (mockupBorderWidthInput) mockupBorderWidthInput.value = String(n);
    if (mockupBorderWidthNum) mockupBorderWidthNum.value = String(n);
    previewMockup(() => commitHistory());
  }

  if (mockupBorderWidthInput) {
    mockupBorderWidthInput.addEventListener("input", () => syncMockupBorderFromInput(mockupBorderWidthInput.value));
  }
  if (mockupBorderWidthNum) {
    mockupBorderWidthNum.addEventListener("input", () => syncMockupBorderFromInput(mockupBorderWidthNum.value));
  }

  if (blurIntensityInput) {
    blurIntensityInput.addEventListener("input", () => {
      syncBlurIntensityControls(blurIntensityInput.value);
      redraw();
      commitHistory();
    });
  }
  if (blurIntensityNum) {
    blurIntensityNum.addEventListener("input", () => {
      syncBlurIntensityControls(blurIntensityNum.value);
      redraw();
      commitHistory();
    });
  }

  function isTypingInAnnotationEditor() {
    const a = document.activeElement;
    return (
      a instanceof HTMLTextAreaElement &&
      a.classList.contains("annotation-card__body-input")
    );
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if ((e.key === "v" || e.key === "V") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTypingInAnnotationEditor()) return;
        e.preventDefault();
        setTool("select");
        return;
      }
      if ((e.key === "a" || e.key === "A") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTypingInAnnotationEditor()) return;
        e.preventDefault();
        setTool("annotate");
        return;
      }
      if ((e.key === "b" || e.key === "B") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTypingInAnnotationEditor()) return;
        e.preventDefault();
        setTool("blur");
        return;
      }
      if ((e.key === "m" || e.key === "M") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTypingInAnnotationEditor()) return;
        e.preventDefault();
        setTool("mockup");
        return;
      }
      if ((e.key === "d" || e.key === "D") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTypingInAnnotationEditor()) return;
        e.preventDefault();
        setTool("measure");
        return;
      }
      if (e.key === "Escape") {
        if (currentTool === "annotate") {
          e.preventDefault();
          cancelEditingAnnotation();
          return;
        }
        if (currentTool === "blur") {
          e.preventDefault();
          selectedBlurRegionId = null;
          hideBlurTrash();
          redraw();
          return;
        }
        if (currentTool === "measure") {
          e.preventDefault();
          resetMeasureState();
          return;
        }
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && currentTool === "blur") {
        if (isTypingInAnnotationEditor()) return;
        if (selectedBlurRegionId != null) {
          e.preventDefault();
          removeBlurRegion(selectedBlurRegionId);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        if (isTypingInAnnotationEditor()) return;
        e.preventDefault();
        if (e.shiftKey) performRedo();
        else performUndo();
        return;
      }
    },
    true
  );

  async function init() {
    let row = await loadScreenshotFromIdb();
    if (!row?.dataUrl) {
      const legacy = await chrome.storage.local.get([STORAGE_SCREENSHOT, STORAGE_TYPE]);
      const leg = legacy[STORAGE_SCREENSHOT];
      if (leg && typeof leg === "string") {
        row = { dataUrl: leg, type: legacy[STORAGE_TYPE] || "visible" };
        try {
          await chrome.storage.local.remove([STORAGE_SCREENSHOT, STORAGE_TYPE]);
        } catch (_) {}
        try {
          await saveScreenshotToIdb(row.dataUrl, row.type);
        } catch (_) {
          /* legacy blob may exceed local quota; still try to display */
        }
      }
    }
    const raw = row?.dataUrl;
    if (!raw || typeof raw !== "string") {
      ctx.fillStyle = "#333";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#888";
      ctx.font = "14px Inter, system-ui, sans-serif";
      ctx.fillText("No screenshot found. Capture from the Snappd popup.", 24, 40);
      return;
    }

    try {
      await clearScreenshotFromIdb();
    } catch (_) {}

    const img = await loadImage(raw);
    originalCaptureW = img.naturalWidth;
    originalCaptureH = img.naturalHeight;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    originalImageData = canvas.toDataURL("image/png");
    baseImage = img;
    lastMockupScreenshotOrigin = { x: 0, y: 0 };

    await new Promise((resolve) => {
      const tmp = document.createElement("canvas");
      tmp.width = originalCaptureW;
      tmp.height = originalCaptureH;
      const tctx = tmp.getContext("2d");
      if (!tctx) {
        resolve();
        return;
      }
      const m = new Image();
      m.onload = () => {
        tctx.drawImage(m, 0, 0);
        const data = tctx.getImageData(0, 0, originalCaptureW, originalCaptureH);
        measurePixelData = data.data;
        measurePixelW = originalCaptureW;
        measurePixelH = originalCaptureH;
        resolve();
      };
      m.onerror = () => resolve();
      m.src = originalImageData;
    });

    injectLucideIcons();
    setupFlyoutHover();
    attachCanvasListeners();

    if (filenameInput) filenameInput.value = defaultExportFilename();
    syncBlurIntensityControls(BLUR_INTENSITY_DEFAULT);

    const ro = new ResizeObserver(() => {
      positionAllCards();
      updateConnectorsSVG();
    });
    ro.observe(canvasStack);

    setTool("annotate");
    canvas.style.cursor = "crosshair";

    redraw();
    requestAnimationFrame(() => {
      positionAllCards();
      updateConnectorsSVG();
    });

    history = [captureState()];
    historyIndex = 0;
    updateUndoRedoButtons();
    syncMockupPanelFromState();
  }

  init().catch((err) => {
    console.error(err);
    ctx.fillStyle = "#333";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ff6666";
    ctx.font = "14px Inter, system-ui, sans-serif";
    ctx.fillText("Could not load screenshot.", 24, 40);
  });
})();
