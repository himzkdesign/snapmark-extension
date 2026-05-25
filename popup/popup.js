const STORAGE_SCREENSHOT = "snapmark_screenshot";
const STORAGE_TYPE = "snapmark_type";
const CAPTURE_SCRIPT = "content/capture.js";
const ANNOTATOR_URL = "annotator/annotator.html";
const FULL_PAGE_CAPTURE_TIMEOUT_MS = 30000;

const statusEl = document.getElementById("status");
const btnVisible = document.getElementById("btn-visible");
const btnFull = document.getElementById("btn-full");

function setStatus(text) {
  statusEl.textContent = text;
}

function getAnnotatorUrl() {
  return chrome.runtime.getURL(ANNOTATOR_URL);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** @param {string | undefined} url */
function isInjectCapturableUrl(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  return (
    !u.startsWith("chrome://") &&
    !u.startsWith("chrome-extension://") &&
    !u.startsWith("edge://") &&
    !u.startsWith("about:") &&
    !u.startsWith("devtools://") &&
    !u.startsWith("view-source:")
  );
}

function sendMessageWithTimeout(tabId, message, timeoutMs) {
  return Promise.race([
    new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(response);
      });
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Capture timed out")), timeoutMs);
    }),
  ]);
}

async function openAnnotator() {
  await chrome.tabs.create({ url: getAnnotatorUrl() });
}

async function persistScreenshot(dataUrl, type) {
  await saveScreenshotToIdb(dataUrl, type);
  try {
    await chrome.storage.local.remove([STORAGE_SCREENSHOT, STORAGE_TYPE]);
  } catch (_) {
    /* ignore if keys absent or tiny remove fails */
  }
}

function showError() {
  setStatus("Something went wrong. Try again.");
}

btnVisible.addEventListener("click", async () => {
  setStatus("Capturing...");
  btnVisible.disabled = true;
  btnFull.disabled = true;
  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("No active tab");

    let dataUrl;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
    } catch (err) {
      console.error(err);
      throw err;
    }

    await persistScreenshot(dataUrl, "visible");
    setStatus("Opening annotator...");
    await openAnnotator();
    setStatus("Ready to capture");
  } catch {
    showError();
  } finally {
    btnVisible.disabled = false;
    btnFull.disabled = false;
  }
});

async function runFullPageCapture() {
  setStatus("Preparing…");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("No active tab");
    return;
  }

  if (!isInjectCapturableUrl(tab.url)) {
    setStatus("Cannot capture this page type");
    console.warn("[Snappd] Skipping inject; URL:", tab.url);
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [CAPTURE_SCRIPT],
    });
  } catch (err) {
    console.error("[Snappd] executeScript failed:", err);
    setStatus("Cannot inject capture script on this page");
    return;
  }

  setStatus("Capturing…");
  await new Promise((r) => setTimeout(r, 200));

  await chrome.tabs.update(tab.id, { active: true });

  let response;
  try {
    response = await sendMessageWithTimeout(
      tab.id,
      { action: "captureFullPage" },
      FULL_PAGE_CAPTURE_TIMEOUT_MS
    );
  } catch (err) {
    console.error("Full page capture error:", err);
    setStatus(err instanceof Error ? `Error: ${err.message}` : "Error: capture failed");
    return;
  }

  if (!response || !response.ok || !response.dataUrl) {
    const msg =
      response?.error ||
      (!response ? "No response from tab" : "No data received from content script");
    console.error("Full page capture:", msg, response);
    setStatus(`Error: ${msg}`);
    return;
  }

  setStatus("Opening annotator…");
  await saveScreenshotToIdb(response.dataUrl, "fullpage");
  try {
    await chrome.storage.local.remove([STORAGE_SCREENSHOT, STORAGE_TYPE]);
  } catch (_) {}
  await chrome.tabs.create({ url: chrome.runtime.getURL("annotator/annotator.html") });
  setStatus("Ready to capture");
}

btnFull.addEventListener("click", async () => {
  btnVisible.disabled = true;
  btnFull.disabled = true;
  try {
    await runFullPageCapture();
  } catch (err) {
    console.error("Full page capture error:", err);
    setStatus(err instanceof Error ? `Error: ${err.message}` : "Error: capture failed");
  } finally {
    btnVisible.disabled = false;
    btnFull.disabled = false;
  }
});
