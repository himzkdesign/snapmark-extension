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

  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  const btnCopy = document.getElementById("btn-copy");
  const btnDownload = document.getElementById("btn-download");
  const copyToast = document.getElementById("copy-toast");
  const btnFeedback = document.getElementById("btn-feedback");
  const sidebarTools = document.getElementById("sidebar-tools");
  const annotateContextPanel = document.getElementById("annotate-context-panel");
  const mockupContextPanel = document.getElementById("mockup-context-panel");
  const mockupApplyBtn = document.getElementById("mockup-apply-btn");
  const mockupResetRow = document.getElementById("mockup-reset-row");
  const mockupResetLink = document.getElementById("mockup-reset-link");
  const mockupBorderWidthSection = document.getElementById("mockup-border-width-section");
  const mockupBorderWidthInput = document.getElementById("mockup-border-width");
  const mockupBorderWidthValue = document.getElementById("mockup-border-width-value");

  const CATEGORIES = ["UI", "Copy", "Bug", "Idea", "Question"];
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PIN_R = 16;
  /** Outer radius of white ring behind the colored pin disk. */
  const PIN_RING_R = 19;
  /** Distance from pin center for grab hit-test and hover (px). */
  const PIN_HIT_DIST = 22;
  /** Card width in stack/CSS pixels — must match `.annotation-card { width }`. */
  const CARD_WIDTH_STACK_PX = 220;

  /** @type {HTMLImageElement | null} */
  let baseImage = null;
  /** @type {Array<Record<string, unknown>>} */
  let shapes = [];
  /** @type {Array<object>} */
  let annotations = [];
  let nextAnnotationId = 1;

  /** @type {'select'|'annotate'|'mockup'} */
  let currentTool = "select";

  let mockupState = {
    device: /** @type {'none'|'browser'|'border'} */ ("none"),
    radius: 0,
    shadow: /** @type {'none'|'soft'|'medium'|'hard'} */ ("none"),
    background: "#f5f5f5",
    padding: 48,
    borderWidth: 2,
    applied: false,
  };

  /** Canonical original screenshot PNG (from canvas after first paint) — mockup preview/reset source. */
  let originalImageData = "";
  let originalCaptureW = 0;
  let originalCaptureH = 0;
  /** Top-left of screenshot content in canvas space for current mockup preview (offset for annotations). */
  let lastMockupScreenshotOrigin = { x: 0, y: 0 };
  let color = "#FF4444";
  let strokeWidth = 1;
  /** @type {number | null} */
  let selectedIndex = null;

  let isSelectDragging = false;
  /** @type {{dx:number,dy:number} | null} */
  let selectOffset = null;

  /** @type {{ann: object, startClientX: number, startClientY: number, startOx: number, startOy: number} | null} */
  let cardDragState = null;

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

  /** @param {object} ann */
  function serializeAnnotation(ann) {
    return {
      id: ann.id,
      pinX: ann.pinX,
      pinY: ann.pinY,
      color: ann.color,
      category: ann.category,
      text: ann.text || "",
      confirmed: !!ann.confirmed,
      hasRect: !!ann.hasRect,
      rectX: ann.rectX,
      rectY: ann.rectY,
      rectW: ann.rectW,
      rectH: ann.rectH,
      cardOffsetX: ann.cardOffsetX,
      cardOffsetY: ann.cardOffsetY,
    };
  }

  function captureState() {
    return {
      shapes: JSON.parse(JSON.stringify(shapes)),
      annData: annotations.map(serializeAnnotation),
      nextId: nextAnnotationId,
      baseDataUrl: baseImage && baseImage.src ? baseImage.src : "",
      canvasW: canvas.width,
      canvasH: canvas.height,
      mockupApplied: mockupState.applied,
      mockupOriginX: lastMockupScreenshotOrigin.x,
      mockupOriginY: lastMockupScreenshotOrigin.y,
    };
  }

  function rebuildAnnotationsFromData(annData) {
    annotationCardsRoot.replaceChildren();
    annotations = annData.map((d) => {
      const ann = { ...d };
      const el = buildCardElement(ann);
      ann._el = el;
      annotationCardsRoot.appendChild(el);
      positionCard(ann);
      return ann;
    });
  }

  function restoreState(snap) {
    mockupState.applied = snap.mockupApplied === true;
    lastMockupScreenshotOrigin = {
      x: typeof snap.mockupOriginX === "number" ? snap.mockupOriginX : 0,
      y: typeof snap.mockupOriginY === "number" ? snap.mockupOriginY : 0,
    };

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
    annotatePlaceActive = false;
    annotatePlaceDragging = false;
    isDraggingPin = false;
    draggedAnnotationId = null;

    let restored = false;
    function finishRestore() {
      if (restored) return;
      restored = true;
      redraw();
      updateConnectorsSVG();
      positionAllCards();
      updateUndoRedoButtons();
      applyCanvasCursorLast();
      updateMockupResetRow();
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

  let lastCanvasPointer = { x: 0, y: 0, valid: false };

  function applyCanvasCursorFromCoords(px, py) {
    if (!baseImage) return;
    lastCanvasPointer = { x: px, y: py, valid: true };
    if (currentTool === "mockup") {
      canvas.style.cursor = "default";
      return;
    }
    if (currentTool === "select") {
      canvas.style.cursor = "default";
      return;
    }
    if (currentTool === "annotate") {
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
    ctx.fillText("snapmark.design", x + totalW / 2, y + barH / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function drawMockupBorderFrame(ctx, x, y, sw, sh, r) {
    const bw = Math.max(1, Math.min(20, Number(mockupState.borderWidth) || 2));
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

  function updateMockupResetRow() {
    if (mockupResetRow) {
      mockupResetRow.hidden = !mockupState.applied;
    }
  }

  function computeMockupLayout(device, screenshotW, screenshotH, padding) {
    const bw =
      device === "border"
        ? Math.max(1, Math.min(20, Number(mockupState.borderWidth) || 2))
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

  function applyMockup() {
    previewMockup(() => {
      mockupState.applied = true;
      commitHistory();
      updateMockupResetRow();
      setTimeout(() => {
        setTool("select");
      }, 300);
    });
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
      applied: false,
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
      updateMockupResetRow();
    }

    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      baseImage = img;
      finish();
    };
    img.onerror = () => {
      syncMockupPanelFromState();
      updateMockupResetRow();
    };
    img.src = originalImageData;
    if (img.complete && img.naturalWidth) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      baseImage = img;
      finish();
    }
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
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    beginAnnotationRoundRectPath(ctx, n.x, n.y, n.width, n.height);
    ctx.fillStyle = hexWithAlphaByte(color, "1f");
    ctx.fill();
    ctx.strokeStyle = color;
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
    c.font = '800 14px "Geist Mono", ui-monospace, monospace';
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

  /** When true, card anchors to the right of the pin; when false, to the left (Figma-style). */
  function annotationCardBranchLeft(ann) {
    const cw = canvas.width;
    if (ann.hasRect) {
      return ann.rectX + ann.rectW / 2 < cw / 2;
    }
    return ann.pinX < cw / 2;
  }

  /**
   * Drag-to-area: horizontal dashed line from pin to nearest vertical side of the card.
   * Click-only: nearest point on card border (may be diagonal).
   * @param {object} ann
   * @param {{ left: number; top: number; width: number; height: number }} cr
   */
  function connectorEndOnCard(ann, cr) {
    if (!ann.hasRect) {
      return nearestPointOnRectBorder(ann.pinX, ann.pinY, cr.left, cr.top, cr.width, cr.height);
    }
    const yClamped = Math.max(cr.top, Math.min(cr.top + cr.height, ann.pinY));
    const px = ann.pinX;
    if (px <= cr.left) {
      return { x: cr.left, y: yClamped };
    }
    if (px >= cr.left + cr.width) {
      return { x: cr.left + cr.width, y: yClamped };
    }
    const dL = Math.abs(px - cr.left);
    const dR = Math.abs(px - (cr.left + cr.width));
    return dL <= dR ? { x: cr.left, y: yClamped } : { x: cr.left + cr.width, y: yClamped };
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
      const w = (CARD_WIDTH_STACK_PX / sw) * canvas.width;
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

  function computeSmartCardOffsets(ann) {
    if (!canvasStack) return;
    const stack = canvasStack.getBoundingClientRect();
    const sw = stack.width || 1;
    const sh = stack.height || 1;
    const cw = canvas.width;
    const ch = canvas.height;

    const cardWCanvas = stackPxToCanvasX(CARD_WIDTH_STACK_PX, sw);
    const gapStackPx = ann.hasRect ? 16 : 20;
    const gapXCanvas = stackPxToCanvasX(gapStackPx, sw);
    const gapYCanvas = stackPxToCanvasY(20, sh);

    let cardHCanvas;
    const cardEl = getAnnotationCardElement(ann);
    if (cardEl) {
      const br = cardEl.getBoundingClientRect();
      cardHCanvas = (br.height / sh) * ch;
    } else {
      cardHCanvas = stackPxToCanvasY(120, sh);
    }

    const branchLeft = annotationCardBranchLeft(ann);
    let ox = branchLeft ? gapXCanvas : -(cardWCanvas + gapXCanvas);
    const oy = -gapYCanvas;

    let cardLeft = ann.pinX + ox;
    let cardTop = ann.pinY + oy;
    const maxLeft = Math.max(0, cw - cardWCanvas);
    const maxTop = Math.max(0, ch - cardHCanvas);
    cardLeft = Math.max(0, Math.min(cardLeft, maxLeft));
    cardTop = Math.max(0, Math.min(cardTop, maxTop));
    ann.cardOffsetX = cardLeft - ann.pinX;
    ann.cardOffsetY = cardTop - ann.pinY;
  }

  /**
   * @param {object} ann
   * @param {{ animate?: boolean } | undefined} [opts]
   */
  function repositionCard(ann, opts) {
    computeSmartCardOffsets(ann);
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
      const w = (CARD_WIDTH_STACK_PX / (canvasStack?.clientWidth || 1)) * canvas.width;
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
    const badgeText = ann.category || "UI";
    const minBadgeW = (60 / CARD_WIDTH_STACK_PX) * w;
    const maxBadgeW = (140 / CARD_WIDTH_STACK_PX) * w;
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
    if (baseImage) {
      c.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
    }
    for (const s of shapes) {
      drawCommittedShape(s, c);
    }
    for (const ann of annotations) {
      drawCommittedAnnotationRect(c, ann);
    }
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (baseImage) {
      ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
    }
    for (const s of shapes) {
      drawCommittedShape(s, ctx);
    }
    for (const ann of annotations) {
      drawCommittedAnnotationRect(ctx, ann);
    }
    if (annotatePlaceActive && annotatePlaceDragging && currentTool === "annotate") {
      drawLiveAnnotateRectPreview(annotateStartX, annotateStartY, annotateCurX, annotateCurY);
    }
    for (const ann of annotations) {
      drawAnnotationPinOnCtx(ctx, ann);
    }
    if (currentTool === "select" && selectedIndex !== null && shapes[selectedIndex]) {
      drawSelectionChrome(shapes[selectedIndex]);
    }
    updateConnectorsSVG();
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
    if (!ann._el || !annotationCardsRoot) return;
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / canvas.width;
    const scaleY = canvasRect.height / canvas.height;
    const pinScreenX = canvasRect.left + ann.pinX * scaleX;
    const pinScreenY = canvasRect.top + ann.pinY * scaleY;
    const cardsRect = annotationCardsRoot.getBoundingClientRect();

    const stack = canvasStack && canvasStack.getBoundingClientRect();
    const sw = (stack && stack.width) || canvasRect.width || 1;
    const sh = (stack && stack.height) || canvasRect.height || 1;
    const gapStackPx = ann.hasRect ? 16 : 20;
    const gapXCanvas = stackPxToCanvasX(gapStackPx, sw);
    const cardWCanvas = stackPxToCanvasX(CARD_WIDTH_STACK_PX, sw);
    const branchLeft = annotationCardBranchLeft(ann);
    const anchorOx = branchLeft ? gapXCanvas : -(cardWCanvas + gapXCanvas);
    const anchorOy = -stackPxToCanvasY(20, sh);

    const cardW = ann._el.offsetWidth || CARD_WIDTH_STACK_PX;
    const cardH = ann._el.offsetHeight || 1;
    const gapScreenX = ann.hasRect ? 16 : 20;
    const cardViewportLeft = branchLeft
      ? pinScreenX + gapScreenX
      : pinScreenX - cardW - gapScreenX;
    const cardViewportTop = pinScreenY - 20;

    const rawViewportLeft = cardViewportLeft + (ann.cardOffsetX - anchorOx) * scaleX;
    const rawViewportTop = cardViewportTop + (ann.cardOffsetY - anchorOy) * scaleY;
    const minVL = canvasRect.left + 8;
    const maxVL = canvasRect.right - cardW - 8;
    const minVT = canvasRect.top + 8;
    const maxVT = canvasRect.bottom - cardH - 8;
    const clampedVL =
      maxVL >= minVL ? Math.max(minVL, Math.min(rawViewportLeft, maxVL)) : rawViewportLeft;
    const clampedVT =
      maxVT >= minVT ? Math.max(minVT, Math.min(rawViewportTop, maxVT)) : rawViewportTop;
    ann.cardOffsetX += (clampedVL - rawViewportLeft) / scaleX;
    ann.cardOffsetY += (clampedVT - rawViewportTop) / scaleY;

    const left = clampedVL - cardsRect.left;
    const top = clampedVT - cardsRect.top;
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
    if (ann._el) ann._el.remove();
    redraw();
    commitHistory();
  }

  function syncCategoryStyle(selectEl, ann) {
    const tc = badgeTextColor(ann.color);
    selectEl.style.backgroundColor = ann.color;
    selectEl.style.color = tc;
    selectEl.style.backgroundImage = `url("${categoryChevronUrl(tc === "#111111")}")`;
  }

  function truncatePreviewLabel(text, maxLen) {
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (!t) return "";
    if (t.length <= maxLen) return t;
    return `${t.slice(0, maxLen)}…`;
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

    const statusDot = document.createElement("span");
    statusDot.className = "annotation-card__status-dot";
    statusDot.setAttribute("aria-hidden", "true");

    const header = document.createElement("div");
    header.className = "annotation-card__header";

    const dragZone = document.createElement("div");
    dragZone.className = "annotation-card__drag";
    const grip = document.createElement("div");
    grip.className = "annotation-card__drag-handle";
    grip.title = "Drag";
    const gripSvg = document.createElementNS(SVG_NS, "svg");
    gripSvg.setAttribute("width", "12");
    gripSvg.setAttribute("height", "16");
    gripSvg.setAttribute("viewBox", "0 0 12 16");
    gripSvg.setAttribute("aria-hidden", "true");
    const gripDots = [
      [3.5, 3],
      [8.5, 3],
      [3.5, 8],
      [8.5, 8],
      [3.5, 13],
      [8.5, 13],
    ];
    for (const [cx, cy] of gripDots) {
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(cx));
      dot.setAttribute("cy", String(cy));
      dot.setAttribute("r", "1");
      dot.setAttribute("fill", "#ccc");
      gripSvg.appendChild(dot);
    }
    grip.appendChild(gripSvg);
    const select = document.createElement("select");
    select.className = "annotation-card__category";
    CATEGORIES.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      if (cat === ann.category) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      ann.category = select.value;
      scheduleConnectorUpdate();
      commitHistory();
    });
    dragZone.appendChild(grip);
    dragZone.appendChild(select);

    const actions = document.createElement("div");
    actions.className = "annotation-card__header-actions";

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "annotation-card__menu";
    menuBtn.textContent = "⋯";
    menuBtn.setAttribute("aria-label", "Menu");

    const dropdown = document.createElement("div");
    dropdown.className = "annotation-card__menu-dropdown";

    const body = document.createElement("div");
    body.className = "annotation-card__body";
    body.contentEditable = "true";
    body.setAttribute("data-placeholder", "Add an annotation...");
    body.textContent = ann.text || "";
    let textHistTimer = 0;
    body.addEventListener("input", () => {
      ann.text = body.innerText || "";
      scheduleConnectorUpdate();
      window.clearTimeout(textHistTimer);
      textHistTimer = window.setTimeout(() => commitHistory(), 400);
    });

    const preview = document.createElement("div");
    preview.className = "annotation-card__preview";
    preview.setAttribute("aria-hidden", "true");

    const editorWrap = document.createElement("div");
    editorWrap.className = "annotation-card__editor-wrap";
    editorWrap.appendChild(body);

    function expandCard() {
      card.classList.remove("is-confirmed");
      preview.textContent = "";
      preview.setAttribute("aria-hidden", "true");
      editorWrap.removeAttribute("aria-hidden");
      ann.confirmed = false;
      scheduleConnectorUpdate();
      requestAnimationFrame(() => {
        body.focus();
        const range = document.createRange();
        range.selectNodeContents(body);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
    }

    function confirmCard() {
      ann.text = body.innerText || "";
      preview.textContent = truncatePreviewLabel(ann.text, 40) || "—";
      preview.setAttribute("aria-hidden", "false");
      editorWrap.setAttribute("aria-hidden", "true");
      body.blur();
      card.classList.add("is-confirmed");
      ann.confirmed = true;
      scheduleConnectorUpdate();
      commitHistory();
    }

    body.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        confirmCard();
      }
    });

    card.addEventListener("click", (e) => {
      if (!card.classList.contains("is-confirmed")) return;
      const t = /** @type {HTMLElement} */ (e.target);
      if (t.closest(".annotation-card__header-actions")) return;
      if (t.closest(".annotation-card__drag-handle")) return;
      if (t.closest("select")) return;
      expandCard();
    });

    const miFocus = document.createElement("button");
    miFocus.type = "button";
    miFocus.className = "annotation-card__menu-item";
    miFocus.textContent = "Edit";
    miFocus.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.remove("is-open");
      if (card.classList.contains("is-confirmed")) {
        expandCard();
      } else {
        body.focus();
      }
    });

    const miDel = document.createElement("button");
    miDel.type = "button";
    miDel.className = "annotation-card__menu-item annotation-card__menu-item--danger";
    miDel.textContent = "Delete";
    miDel.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.remove("is-open");
      removeAnnotation(ann);
    });

    dropdown.appendChild(miFocus);
    dropdown.appendChild(miDel);

    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".annotation-card__menu-dropdown.is-open").forEach((d) => {
        if (d !== dropdown) d.classList.remove("is-open");
      });
      dropdown.classList.toggle("is-open");
    });

    dropdown.addEventListener("mousedown", (e) => e.stopPropagation());
    dropdown.addEventListener("click", (e) => e.stopPropagation());

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "annotation-card__close";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeAnnotation(ann);
    });

    actions.appendChild(menuBtn);
    actions.appendChild(closeBtn);
    actions.appendChild(dropdown);

    header.appendChild(dragZone);
    header.appendChild(actions);

    card.appendChild(statusDot);
    card.appendChild(header);
    card.appendChild(editorWrap);
    card.appendChild(preview);

    syncCategoryStyle(select, ann);

    if (ann.confirmed) {
      card.classList.add("is-confirmed");
      preview.textContent = truncatePreviewLabel(ann.text, 40) || "—";
      preview.setAttribute("aria-hidden", "false");
      editorWrap.setAttribute("aria-hidden", "true");
    }

    function onGripDown(ev) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      document.body.style.cursor = "grabbing";
      cardDragState = {
        ann,
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startOx: ann.cardOffsetX,
        startOy: ann.cardOffsetY,
      };
      document.addEventListener("mousemove", onDocMove);
      document.addEventListener("mouseup", onDocUp);
    }

    function onDocMove(ev) {
      if (!cardDragState || cardDragState.ann !== ann) return;
      const stack = canvasStack.getBoundingClientRect();
      const sw = stack.width || 1;
      const sh = stack.height || 1;
      const dxPx = ev.clientX - cardDragState.startClientX;
      const dyPx = ev.clientY - cardDragState.startClientY;
      const dCanvasX = (dxPx / sw) * canvas.width;
      const dCanvasY = (dyPx / sh) * canvas.height;
      ann.cardOffsetX = cardDragState.startOx + dCanvasX;
      ann.cardOffsetY = cardDragState.startOy + dCanvasY;
      positionCard(ann);
      updateConnectorsSVG();
    }

    function onDocUp() {
      document.removeEventListener("mousemove", onDocMove);
      document.removeEventListener("mouseup", onDocUp);
      document.body.style.cursor = "";
      cardDragState = null;
      commitHistory();
    }

    grip.addEventListener("mousedown", onGripDown);

    const ro = new ResizeObserver(() => scheduleConnectorUpdate());
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
      color,
      category: "UI",
      text: "",
      confirmed: false,
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
    repositionCard(ann);
    redraw();
    requestAnimationFrame(() => {
      repositionCard(ann);
      redraw();
      commitHistory();
    });
  }

  document.addEventListener("click", () => {
    document.querySelectorAll(".annotation-card__menu-dropdown.is-open").forEach((d) => {
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
    if (sidebarTools) {
      sidebarTools.classList.toggle("sidebar-tools--select-active", next === "select");
    }
    if (annotateContextPanel) {
      const annOpen = next === "annotate";
      annotateContextPanel.classList.toggle("annotate-context-panel--open", annOpen);
      if (!annOpen) {
        annotateContextPanel.setAttribute("inert", "");
        annotateContextPanel.setAttribute("aria-hidden", "true");
      } else {
        annotateContextPanel.removeAttribute("inert");
        annotateContextPanel.setAttribute("aria-hidden", "false");
      }
    }
    if (mockupContextPanel) {
      const muOpen = next === "mockup";
      mockupContextPanel.classList.toggle("mockup-context-panel--open", muOpen);
      if (!muOpen) {
        mockupContextPanel.setAttribute("inert", "");
        mockupContextPanel.setAttribute("aria-hidden", "true");
      } else {
        mockupContextPanel.removeAttribute("inert");
        mockupContextPanel.setAttribute("aria-hidden", "false");
      }
    }
    if (next !== "annotate" && next !== "mockup") {
      canvas.style.cursor = "";
      lastCanvasPointer.valid = false;
    }
    if (currentTool !== "select") {
      selectedIndex = null;
    }
    redraw();
    applyCanvasCursorLast();
    if (next === "mockup") {
      previewMockup();
    }
  }

  function updateMockupBorderWidthSliderFill() {
    if (!mockupBorderWidthInput) return;
    const min = 1;
    const max = 20;
    const raw = Number(mockupBorderWidthInput.value);
    const v = Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : 2));
    const pct = ((v - min) / (max - min)) * 100;
    mockupBorderWidthInput.style.background = `linear-gradient(to right, #ffffff 0%, #ffffff ${pct}%, #2a2a2a ${pct}%, #2a2a2a 100%)`;
  }

  function syncMockupPanelFromState() {
    document.querySelectorAll(".mockup-context-panel__device-btn[data-device]").forEach((btn) => {
      const el = /** @type {HTMLElement} */ (btn);
      const is = el.dataset.device === mockupState.device;
      btn.classList.toggle("is-active", is);
      btn.setAttribute("aria-pressed", String(is));
    });
    document.querySelectorAll(".mockup-context-panel__pill-btn[data-radius]").forEach((btn) => {
      const el = /** @type {HTMLElement} */ (btn);
      const is = Number(el.dataset.radius) === mockupState.radius;
      btn.classList.toggle("is-active", is);
    });
    document.querySelectorAll(".mockup-context-panel__pill-btn[data-shadow]").forEach((btn) => {
      const el = /** @type {HTMLElement} */ (btn);
      const is = el.dataset.shadow === mockupState.shadow;
      btn.classList.toggle("is-active", is);
    });
    document.querySelectorAll(".mockup-context-panel__bg-swatch[data-bg]").forEach((sw) => {
      const el = /** @type {HTMLElement} */ (sw);
      const is = el.dataset.bg === mockupState.background;
      sw.classList.toggle("is-active", is);
    });
    const padStr = String(mockupState.padding);
    document.querySelectorAll(".mockup-context-panel__pill-btn[data-padding]").forEach((btn) => {
      const el = /** @type {HTMLElement} */ (btn);
      const is = el.dataset.padding === padStr;
      btn.classList.toggle("is-active", is);
    });
    if (mockupBorderWidthSection) {
      mockupBorderWidthSection.hidden = mockupState.device !== "border";
    }
    if (mockupBorderWidthInput && mockupBorderWidthValue) {
      const bw = Math.max(1, Math.min(20, Number(mockupState.borderWidth) || 2));
      mockupState.borderWidth = bw;
      mockupBorderWidthInput.value = String(bw);
      mockupBorderWidthValue.textContent = `${bw}px`;
      updateMockupBorderWidthSliderFill();
    }
  }

  function setColor(next) {
    color = next;
    document.querySelectorAll(".annotate-context-panel__swatch[data-color]").forEach((sw) => {
      const is = sw.dataset.color === next;
      sw.classList.toggle("is-active", is);
      sw.setAttribute("aria-selected", String(is));
    });
  }

  function onCanvasMouseDown(ev) {
    if (!baseImage || ev.button !== 0) return;
    const p = getCanvasCoords(ev);

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
      for (let i = annotations.length - 1; i >= 0; i--) {
        const ann = annotations[i];
        if (Math.hypot(p.x - ann.pinX, p.y - ann.pinY) <= PIN_HIT_DIST) {
          isDraggingPin = true;
          draggedAnnotationId = ann.id;
          canvas.style.cursor = "grabbing";
          return;
        }
      }
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
    if (currentTool === "annotate" && (annotatePlaceActive || isDraggingPin)) {
      onCanvasMouseUp({ type: "mouseup", button: 0 });
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
    a.download = "snapmark-export.png";
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

  if (btnFeedback) {
    btnFeedback.addEventListener("click", () => {
      window.open(FEEDBACK_FORM_URL, "_blank");
    });
  }

  document.querySelectorAll(".sidebar-tool[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => setTool(/** @type {HTMLElement} */ (btn).dataset.tool || "select"));
  });

  if (mockupContextPanel) {
    mockupContextPanel.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;

      if (t.closest("#mockup-apply-btn")) {
        applyMockup();
        return;
      }
      if (t.closest("#mockup-reset-link")) {
        resetMockup();
        return;
      }

      const devEl = t.closest(".mockup-context-panel__device-btn[data-device]");
      if (devEl) {
        const d = devEl.getAttribute("data-device");
        if (d === "none" || d === "browser" || d === "border") {
          mockupState.device = d;
          syncMockupPanelFromState();
          previewMockup();
        }
        return;
      }

      const radEl = t.closest(".mockup-context-panel__pill-btn[data-radius]");
      if (radEl) {
        const n = Number(radEl.getAttribute("data-radius"));
        if (n === 0 || n === 8 || n === 16 || n === 24) {
          mockupState.radius = n;
          syncMockupPanelFromState();
          previewMockup();
        }
        return;
      }

      const shEl = t.closest(".mockup-context-panel__pill-btn[data-shadow]");
      if (shEl && shEl.hasAttribute("data-shadow")) {
        const s = /** @type {string} */ (shEl.getAttribute("data-shadow"));
        if (s === "none" || s === "soft" || s === "medium" || s === "hard") {
          mockupState.shadow = /** @type {'none'|'soft'|'medium'|'hard'} */ (s);
          syncMockupPanelFromState();
          previewMockup();
        }
        return;
      }

      const swEl = t.closest(".mockup-context-panel__bg-swatch[data-bg]");
      if (swEl) {
        mockupState.background = swEl.getAttribute("data-bg") || "#f5f5f5";
        syncMockupPanelFromState();
        previewMockup();
        return;
      }

      const padEl = t.closest(".mockup-context-panel__pill-btn[data-padding]");
      if (padEl && padEl.hasAttribute("data-padding")) {
        const n = Number(padEl.getAttribute("data-padding"));
        if (n === 24 || n === 48 || n === 80) {
          mockupState.padding = n;
          syncMockupPanelFromState();
          previewMockup();
        }
      }
    });
  }

  if (mockupBorderWidthInput) {
    mockupBorderWidthInput.addEventListener("input", () => {
      const raw = Number(mockupBorderWidthInput.value);
      const n = Math.max(1, Math.min(20, Number.isFinite(raw) ? raw : 2));
      mockupState.borderWidth = n;
      if (mockupBorderWidthValue) mockupBorderWidthValue.textContent = `${n}px`;
      updateMockupBorderWidthSliderFill();
      previewMockup();
    });
  }

  document.querySelectorAll(".annotate-context-panel__swatch[data-color]").forEach((sw) => {
    sw.addEventListener("click", () => setColor(/** @type {HTMLElement} */ (sw).dataset.color || "#FF4444"));
  });

  function isTypingInAnnotationEditor() {
    const a = document.activeElement;
    return a instanceof HTMLElement && (a.classList.contains("annotation-card__body") || !!a.closest(".annotation-card__body"));
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
      if ((e.key === "m" || e.key === "M") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTypingInAnnotationEditor()) return;
        e.preventDefault();
        setTool("mockup");
        return;
      }
      if (e.key === "Escape") {
        if (currentTool === "annotate" || currentTool === "mockup") {
          e.preventDefault();
          setTool("select");
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
      ctx.fillText("No screenshot found. Capture from the SnapMark popup.", 24, 40);
      return;
    }

    try {
      await clearScreenshotFromIdb();
    } catch (_) {}

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = raw;
    });
    originalCaptureW = img.naturalWidth;
    originalCaptureH = img.naturalHeight;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    originalImageData = canvas.toDataURL("image/png");
    baseImage = img;
    lastMockupScreenshotOrigin = { x: 0, y: 0 };

    attachCanvasListeners();

    const ro = new ResizeObserver(() => {
      positionAllCards();
      updateConnectorsSVG();
    });
    ro.observe(canvasStack);

    redraw();
    requestAnimationFrame(() => {
      positionAllCards();
      updateConnectorsSVG();
    });

    history = [captureState()];
    historyIndex = 0;
    updateUndoRedoButtons();
    syncMockupPanelFromState();
    updateMockupResetRow();
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
