const { app, BrowserWindow, ipcMain, session } = require("electron");
const path = require("node:path");

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });

  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    title: "Face Detection Test",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "face-test-preload.js"),
      sandbox: false
    }
  });

  let lastCpu = process.cpuUsage();
  let lastHr = process.hrtime.bigint();
  ipcMain.handle("cpu:stats", () => {
    const now = process.cpuUsage(lastCpu);
    const hrNow = process.hrtime.bigint();
    const elapsedNs = Number(hrNow - lastHr);
    lastCpu = process.cpuUsage();
    lastHr = hrNow;
    const cpuPercent = elapsedNs > 0 ? (now.user + now.system) * 1000 / elapsedNs : 0;
    const mem = process.getProcessMemoryInfo();
    const appMetrics = app.getAppMetrics();
    let rendererCpu = 0;
    let rendererMem = 0;
    for (const metric of appMetrics) {
      if (metric.type === "renderer" || metric.type === "GPU") {
        rendererCpu += metric.cpu.percentCPUUsage || 0;
        rendererMem += metric.memory.workingSetSize || 0;
      }
    }
    return {
      main: {
        cpuPercent,
        userMs: now.user / 1000,
        systemMs: now.system / 1000,
        rssMB: mem.rss / 1024,
        heapUsedMB: mem.heapUsed / 1024,
        heapTotalMB: mem.heapTotal / 1024,
        externalMB: mem.external / 1024
      },
      renderer: {
        cpuPercent: rendererCpu,
        memMB: rendererMem / 1024,
        cores: navigatorHardwareCores()
      }
    };
  });

  win.loadFile(path.join(__dirname, "face-test.html"));
  win.webContents.openDevTools({ mode: "detach" });
});

function navigatorHardwareCores() {
  try {
    return require("node:os").cpus().length;
  } catch {
    return 0;
  }
}
