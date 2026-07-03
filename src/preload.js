const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tracker", {
  getState: () => ipcRenderer.invoke("state:get"),
  getStats: (range) => ipcRenderer.invoke("stats:get", range),
  getHistory: (dayKey) => ipcRenderer.invoke("history:get", dayKey),
  addEvent: (payload) => ipcRenderer.invoke("event:add", payload),
  deleteEvent: (id) => ipcRenderer.invoke("event:delete", id),
  deleteDay: (dayKey) => ipcRenderer.invoke("events:deleteDay", dayKey),
  deletePeriod: (payload) => ipcRenderer.invoke("events:deletePeriod", payload),
  setActiveProject: (projectId) => ipcRenderer.invoke("project:setActive", projectId),
  switchProject: (projectId) => ipcRenderer.invoke("project:switch", projectId),
  addProject: (payload) => ipcRenderer.invoke("project:add", payload),
  updateProject: (payload) => ipcRenderer.invoke("project:update", payload),
  reassignSegmentProject: (payload) => ipcRenderer.invoke("segment:reassignProject", payload),
  addCategory: (name) => ipcRenderer.invoke("category:add", name),
  deleteCategory: (id) => ipcRenderer.invoke("category:delete", id),
  updateSettings: (payload) => ipcRenderer.invoke("settings:update", payload),
  exportToday: () => ipcRenderer.invoke("csv:exportToday"),
  storeMovementMinute: (data) => ipcRenderer.invoke("movement:storeMinute", data),
  getMovement: (range) => ipcRenderer.invoke("movement:get", range),
  getMovementToday: () => ipcRenderer.invoke("movement:get"),
  onNavigate: (callback) => ipcRenderer.on("menu:navigate", (_event, page) => callback(page)),
  onCycleTheme: (callback) => ipcRenderer.on("menu:cycleTheme", callback)
});
