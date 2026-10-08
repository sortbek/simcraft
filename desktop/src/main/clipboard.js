function createClipboardController(ipcMain, clipboard) {
  function registerIpcHandlers() {
    ipcMain.handle("clipboard:read", () => clipboard.readText());
  }

  return {
    registerIpcHandlers,
  };
}

module.exports = {
  createClipboardController,
};
