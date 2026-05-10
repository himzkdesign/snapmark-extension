/**
 * @param {chrome.runtime.MessageSender} sender
 * @param {(response: { ok: boolean; dataUrl?: string; error?: string }) => void} sendResponse
 */
function captureChunkFromSender(sender, sendResponse) {
  (async () => {
    try {
      const windowId = sender.tab?.windowId;
      if (windowId == null) {
        sendResponse({ ok: false, error: "No sender tab for captureChunk" });
        return;
      }
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
        format: "png",
      });
      sendResponse({ ok: true, dataUrl });
    } catch (err) {
      console.error("captureChunk failed", err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.action === "captureChunk") {
    captureChunkFromSender(sender, sendResponse);
    return true;
  }
  return false;
});
