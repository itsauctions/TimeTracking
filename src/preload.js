const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tracker", {
  getState: () => ipcRenderer.invoke("state:get"),
  getStats: (range) => ipcRenderer.invoke("stats:get", range),
  getHistory: (dayKey) => ipcRenderer.invoke("history:get", dayKey),
  addEvent: (payload) => ipcRenderer.invoke("event:add", payload),
  deleteEvent: (id) => ipcRenderer.invoke("event:delete", id),
  deleteDay: (dayKey) => ipcRenderer.invoke("events:deleteDay", dayKey),
  deletePeriod: (payload) => ipcRenderer.invoke("events:deletePeriod", payload),
  addCategory: (name) => ipcRenderer.invoke("category:add", name),
  deleteCategory: (id) => ipcRenderer.invoke("category:delete", id),
  updateSettings: (payload) => ipcRenderer.invoke("settings:update", payload),
  exportToday: () => ipcRenderer.invoke("csv:exportToday"),
  onNavigate: (callback) => ipcRenderer.on("menu:navigate", (_event, page) => callback(page)),
  onCycleTheme: (callback) => ipcRenderer.on("menu:cycleTheme", callback)
});
