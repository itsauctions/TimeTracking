const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tracker", {
  getState: () => ipcRenderer.invoke("state:get"),
  getStats: () => ipcRenderer.invoke("stats:get"),
  addEvent: (payload) => ipcRenderer.invoke("event:add", payload),
  addCategory: (name) => ipcRenderer.invoke("category:add", name),
  exportToday: () => ipcRenderer.invoke("csv:exportToday"),
  onNavigate: (callback) => ipcRenderer.on("menu:navigate", (_event, page) => callback(page)),
  onCycleTheme: (callback) => ipcRenderer.on("menu:cycleTheme", callback)
});
