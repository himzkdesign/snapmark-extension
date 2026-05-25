(function () {
  if (window.__snapmarkCaptureInstalled) return;
  window.__snapmarkCaptureInstalled = true;

  const MAX_CANVAS_HEIGHT = 15000;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Softens common fixed headers/nav so they scroll with the page during stitched capture.
   * Complements snapshotFixedAndStickyStyles (computed fixed/sticky on all elements).
   */
  function injectSnapmarkFixStyle() {
    const id = "snapmark-fix";
    if (document.getElementById(id)) return () => {};
    const style = document.createElement("style");
    style.id = id;
    style.textContent =
      '*[style*="position:fixed"],*[style*="position: fixed"],header,nav,.header,.navbar{position:absolute!important;}';
    document.documentElement.appendChild(style);
    return () => {
      const el = document.getElementById(id);
      if (el) el.remove();
    };
  }

  function snapshotFixedAndStickyStyles() {
    const entries = [];
    const all = document.querySelectorAll("*");
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const pos = window.getComputedStyle(el).position;
      if (pos === "fixed" || pos === "sticky") {
        entries.push({
          el,
          position: el.style.position,
          top: el.style.top,
          left: el.style.left,
          right: el.style.right,
          bottom: el.style.bottom,
          width: el.style.width,
          height: el.style.height,
        });
        el.style.position = "absolute";
      }
    }
    return () => {
      for (const e of entries) {
        e.el.style.position = e.position;
        e.el.style.top = e.top;
        e.el.style.left = e.left;
        e.el.style.right = e.right;
        e.el.style.bottom = e.bottom;
        e.el.style.width = e.width;
        e.el.style.height = e.height;
      }
    };
  }

  async function requestChunk() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "captureChunk" }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve({ ok: false, error: err.message });
          return;
        }
        resolve(response || { ok: false, error: "No response" });
      });
    });
  }

  async function stitchFullPageImage() {
    const originalScrollX = window.scrollX;
    const originalScrollY = window.scrollY;
    const docScrollHeight = Math.max(
      1,
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0
    );
    const viewportHeight = window.innerHeight;
    const vh = viewportHeight;
    const totalWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0
    );
    if (totalWidth > window.innerWidth + 1) {
      console.warn(
        "[Snappd] Page scroll width exceeds viewport width;",
        totalWidth,
        "px — vertical stitch only; ensure page is fully visible horizontally."
      );
    }
    const clampedCaptureHeight = Math.max(1, Math.min(docScrollHeight, MAX_CANVAS_HEIGHT));
    if (docScrollHeight > MAX_CANVAS_HEIGHT) {
      console.warn(
        "[Snappd] Page height exceeds max canvas height; clamping to",
        MAX_CANVAS_HEIGHT,
        "px"
      );
    }

    const removeFixStyle = injectSnapmarkFixStyle();
    const restorePositioning = snapshotFixedAndStickyStyles();

    try {
      const maxScroll = Math.max(0, clampedCaptureHeight - vh);
      const scrollPositions = [];
      for (let y = 0; y < clampedCaptureHeight; y += vh) {
        scrollPositions.push(Math.min(y, maxScroll));
      }
      const uniqueScrolls = [];
      for (const y of scrollPositions) {
        if (
          uniqueScrolls.length === 0 ||
          uniqueScrolls[uniqueScrolls.length - 1] !== y
        ) {
          uniqueScrolls.push(y);
        }
      }

      const chunks = [];
      for (const y of uniqueScrolls) {
        window.scrollTo(0, y);
        await sleep(150);
        const res = await requestChunk();
        if (!res.ok || !res.dataUrl) {
          throw new Error(res.error || "Chunk capture failed");
        }
        chunks.push({ scrollY: y, dataUrl: res.dataUrl });
      }

      const firstImg = await loadImage(chunks[0].dataUrl);
      const pxRatio = firstImg.height / vh;
      const canvas = document.createElement("canvas");
      canvas.width = firstImg.width;
      canvas.height = Math.round(clampedCaptureHeight * pxRatio);
      const ctx = canvas.getContext("2d");

      for (const { scrollY, dataUrl } of chunks) {
        const img = await loadImage(dataUrl);
        const sliceCss = Math.min(vh, clampedCaptureHeight - scrollY);
        const srcH = (img.height * sliceCss) / vh;
        const destY = scrollY * pxRatio;
        const destH = srcH;
        ctx.drawImage(img, 0, 0, img.width, srcH, 0, destY, img.width, destH);
      }

      return canvas.toDataURL("image/png");
    } finally {
      restorePositioning();
      removeFixStyle();
      window.scrollTo(originalScrollX, originalScrollY);
    }
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = dataUrl;
    });
  }

  /**
   * @param {(response: { ok: boolean; dataUrl?: string; error?: string }) => void} sendResponse
   */
  function captureFullPage(sendResponse) {
    stitchFullPageImage()
      .then((dataUrl) => {
        sendResponse({ ok: true, dataUrl });
      })
      .catch((err) => {
        console.error("[Snappd] captureFullPage", err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.action === "captureFullPage") {
      captureFullPage(sendResponse);
      return true;
    }
    return false;
  });
})();
