function createClipboardController(ipcMain, clipboard, getMainWindow) {
  let clipboardInterval = null;
  let lastClipboardText = "";

  function startPolling(intervalMs) {
    if (clipboardInterval) {
      clearInterval(clipboardInterval);
    }

    lastClipboardText = clipboard.readText();
    clipboardInterval = setInterval(() => {
      const text = clipboard.readText();
      if (text && text !== lastClipboardText) {
        lastClipboardText = text;
        getMainWindow()?.webContents.send("clipboard:changed", text);
      }
    }, intervalMs || 2000);
  }

  function stopPolling() {
    if (clipboardInterval) {
      clearInterval(clipboardInterval);
      clipboardInterval = null;
    }
  }

  function registerIpcHandlers() {
    ipcMain.handle("clipboard:start-polling", (_event, intervalMs) => {
      startPolling(intervalMs);
    });

    ipcMain.handle("clipboard:stop-polling", () => {
      stopPolling();
    });

    ipcMain.handle("clipboard:read", () => clipboard.readText());
  }

  return {
    registerIpcHandlers,
    stopPolling,
  };
}

module.exports = {
  createClipboardController,
};
