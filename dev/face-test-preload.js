const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("systemStats", {
  getCpuStats: () => ipcRenderer.invoke("cpu:stats")
});
