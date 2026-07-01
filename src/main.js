const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");

let mainWindow;
let tray;
let db;
let statusTimer;

const DEFAULT_CATEGORIES = ["Bathroom", "Family", "Break", "Admin", "Meal", "Other"];
const APP_ID = "local.workday-time-tracker";

app.setAppUserModelId(APP_ID);

function dataPath(fileName) {
  return path.join(app.getPath("userData"), fileName);
}

function assetPath(fileName) {
  return path.join(__dirname, "..", "assets", fileName);
}

function openDatabase() {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  db = new Database(dataPath("workday-time.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL CHECK(event_type IN ('start', 'pause', 'resume', 'stop')),
      reason TEXT,
      note TEXT,
      occurred_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO categories (name, is_default, created_at)
    VALUES (?, ?, ?)
  `);
  const now = new Date().toISOString();
  for (const category of DEFAULT_CATEGORIES) {
    insertCategory.run(category, 1, now);
  }
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDayRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function todayEvents() {
  const range = localDayRange();
  return eventsBetween(range.start, range.end);
}

function eventsBetween(start, end) {
  return db.prepare(`
    SELECT id, event_type AS type, reason, note, occurred_at AS occurredAt
    FROM events
    WHERE occurred_at >= ? AND occurred_at < ?
    ORDER BY occurred_at ASC, id ASC
  `).all(start, end);
}

function allEvents() {
  return db.prepare(`
    SELECT id, event_type AS type, reason, note, occurred_at AS occurredAt
    FROM events
    ORDER BY occurred_at ASC, id ASC
  `).all();
}

function categories() {
  return db.prepare(`
    SELECT id, name, is_default AS isDefault
    FROM categories
    ORDER BY is_default DESC, lower(name) ASC
  `).all();
}

function currentState() {
  const events = todayEvents();
  const latest = events.at(-1);
  let status = "idle";
  if (latest) {
    if (latest.type === "start" || latest.type === "resume") status = "working";
    if (latest.type === "pause") status = "paused";
    if (latest.type === "stop") status = "stopped";
  }

  return {
    status,
    activeSince: status === "working" || status === "paused" ? latest.occurredAt : null,
    events,
    categories: categories(),
    totals: calculateTotals(events)
  };
}

function calculateTotals(events, now = new Date()) {
  let workMs = 0;
  let pauseMs = 0;
  let openType = null;
  let openAt = null;
  let openReason = "";
  let openNote = "";
  const segments = [];

  for (const event of events) {
    const occurredAt = new Date(event.occurredAt);
    if (event.type === "start" || event.type === "resume") {
      if (openType === "pause" && openAt) {
        const durationMs = occurredAt - openAt;
        pauseMs += durationMs;
        segments.push(segmentRow("pause", openAt, occurredAt, durationMs, openReason, openNote));
      }
      openType = "work";
      openAt = occurredAt;
      openReason = "";
      openNote = "";
    }

    if (event.type === "pause") {
      if (openType === "work" && openAt) {
        const durationMs = occurredAt - openAt;
        workMs += durationMs;
        segments.push(segmentRow("work", openAt, occurredAt, durationMs, "", ""));
      }
      openType = "pause";
      openAt = occurredAt;
      openReason = event.reason || "";
      openNote = event.note || "";
    }

    if (event.type === "stop") {
      if (openType && openAt) {
        const durationMs = occurredAt - openAt;
        if (openType === "work") workMs += durationMs;
        if (openType === "pause") pauseMs += durationMs;
        segments.push(segmentRow(openType, openAt, occurredAt, durationMs, openReason, openNote));
      }
      openType = null;
      openAt = null;
      openReason = "";
      openNote = "";
    }
  }

  if (openType && openAt) {
    const durationMs = now - openAt;
    if (openType === "work") workMs += durationMs;
    if (openType === "pause") pauseMs += durationMs;
    segments.push(segmentRow(openType, openAt, now, durationMs, openReason, openNote));
  }

  return { workMs, pauseMs, segments };
}

function statsSummary() {
  const segments = calculateTotals(allEvents()).segments;
  const days = new Map();
  const weeks = new Map();
  const months = new Map();

  for (const segment of segments) {
    const start = new Date(segment.start);
    addSegmentStats(days, todayKey(start), segment);
    addSegmentStats(weeks, weekKey(start), segment);
    addSegmentStats(months, monthKey(start), segment);
  }

  return {
    days: Array.from(days.values()).sort((a, b) => b.key.localeCompare(a.key)),
    weeks: Array.from(weeks.values()).sort((a, b) => b.key.localeCompare(a.key)),
    months: Array.from(months.values()).sort((a, b) => b.key.localeCompare(a.key))
  };
}

function weekKey(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - start.getDay());
  return todayKey(start);
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addSegmentStats(map, key, segment) {
  if (!map.has(key)) {
    map.set(key, {
      key,
      workMs: 0,
      pauseMs: 0,
      totalMs: 0,
      categories: {}
    });
  }

  const bucket = map.get(key);
  const durationMs = Math.round(segment.durationMinutes * 60000);
  bucket.totalMs += durationMs;
  if (segment.type === "work") bucket.workMs += durationMs;
  if (segment.type === "pause") {
    bucket.pauseMs += durationMs;
    const category = segment.reason || "Uncategorized";
    bucket.categories[category] = (bucket.categories[category] || 0) + durationMs;
  }
}

function segmentRow(type, start, end, durationMs, reason, note) {
  return {
    type,
    start: start.toISOString(),
    end: end.toISOString(),
    durationMinutes: Math.round((durationMs / 60000) * 100) / 100,
    reason: reason || "",
    note: note || ""
  };
}

function addEvent(type, reason = "", note = "") {
  db.prepare(`
    INSERT INTO events (event_type, reason, note, occurred_at)
    VALUES (?, ?, ?, ?)
  `).run(type, reason || null, note || null, new Date().toISOString());
  updateTray();
  updateAppMenu();
  return currentState();
}

function statusLabel(status) {
  if (status === "working") return "Working";
  if (status === "paused") return "Paused";
  if (status === "stopped") return "Day ended";
  return "Ready";
}

function formatElapsed(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  if (minutes) return `${minutes}m`;
  return "less than 1m";
}

function statusText(state = currentState()) {
  const label = statusLabel(state.status);
  if (!state.activeSince) return label;
  return `${label} for ${formatElapsed(Date.now() - new Date(state.activeSince).getTime())}`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function minutes(ms) {
  return Math.round((ms / 60000) * 100) / 100;
}

function exportCsv() {
  const segments = calculateTotals(allEvents()).segments;
  const stats = statsSummary();
  const rows = [
    [
      "section",
      "period_type",
      "period_key",
      "date",
      "segment_start",
      "segment_end",
      "segment_type",
      "pause_reason",
      "note",
      "duration_minutes",
      "work_minutes",
      "pause_minutes",
      "total_minutes",
      "category",
      "category_minutes"
    ],
    ...segments.map((segment) => [
      "segment",
      "",
      "",
      todayKey(new Date(segment.start)),
      segment.start,
      segment.end,
      segment.type,
      segment.reason,
      segment.note,
      segment.durationMinutes,
      "",
      "",
      "",
      "",
      ""
    ]),
    ...statsRows("day", stats.days),
    ...statsRows("week", stats.weeks),
    ...statsRows("month", stats.months)
  ];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function statsRows(periodType, periods) {
  const rows = [];
  for (const period of periods) {
    rows.push([
      "summary",
      periodType,
      period.key,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      minutes(period.workMs),
      minutes(period.pauseMs),
      minutes(period.totalMs),
      "",
      ""
    ]);

    for (const [category, categoryMs] of Object.entries(period.categories)) {
      rows.push([
        "category_summary",
        periodType,
        period.key,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        category,
        minutes(categoryMs)
      ]);
    }
  }
  return rows;
}

async function exportCsvWithDialog() {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export time and stats",
    defaultPath: `workday-time-export-${todayKey()}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, exportCsv(), "utf8");
  return { canceled: false, filePath: result.filePath };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    title: "Workday Time Tracker",
    icon: assetPath("app-icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(assetPath("app-icon.png")).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("Workday Time Tracker");
  tray.on("click", showMainWindow);
  updateTray();
}

function showMainWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

function updateTray() {
  if (!tray || !db) return;
  const state = currentState();
  const text = statusText(state);
  tray.setToolTip(`Workday Time Tracker\n${text}`);
  if (mainWindow) {
    mainWindow.setTitle(`${text} - Workday Time Tracker`);
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: text, enabled: false },
    { label: "Show", click: showMainWindow },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ]));
  updateAppMenu();
}

function updateAppMenu() {
  if (!db) return;
  const state = currentState();
  const pauseItems = categories().map((category) => ({
    label: category.name,
    enabled: state.status === "working",
    click: () => addEvent("pause", category.name)
  }));

  const template = [
    {
      label: statusText(state),
      submenu: [
        { label: "Show Timer", click: () => sendNavigation("timer") },
        { label: "Show Stats", click: () => sendNavigation("stats") }
      ]
    },
    {
      label: "File",
      submenu: [
        { label: "Export CSV", click: exportCsvWithDialog },
        { type: "separator" },
        {
          label: "Quit",
          click: () => {
            app.isQuiting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: "Timer",
      submenu: [
        { label: "Start Work", enabled: state.status === "idle" || state.status === "stopped", click: () => addEvent("start") },
        { label: "Resume", enabled: state.status === "paused", click: () => addEvent("resume") },
        { label: "Pause For", submenu: pauseItems },
        { label: "End Day", enabled: state.status !== "idle" && state.status !== "stopped", click: () => addEvent("stop") }
      ]
    },
    {
      label: "View",
      submenu: [
        { label: "Timer", click: () => sendNavigation("timer") },
        { label: "Stats", click: () => sendNavigation("stats") },
        { label: "Next Theme", click: () => mainWindow?.webContents.send("menu:cycleTheme") },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { label: "Hide To Tray", click: () => mainWindow?.hide() },
        { role: "minimize" },
        { role: "close" }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "How This Works",
          click: () => dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "Workday Time Tracker Help",
            message: "Workday Time Tracker",
            detail: "Use Start Work to begin tracking. Use the pause category buttons or Timer menu to pause with a reason. Stats show daily, weekly, and monthly totals. Export CSV includes both raw segments and summary stats."
          })
        },
        {
          label: "About",
          click: () => dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "About Workday Time Tracker",
            message: "Workday Time Tracker",
            detail: "A local SQLite-based workday timer with tray status, CSV export, and stats."
          })
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function sendNavigation(page) {
  showMainWindow();
  mainWindow?.webContents.send("menu:navigate", page);
}

ipcMain.handle("state:get", () => currentState());
ipcMain.handle("stats:get", () => statsSummary());
ipcMain.handle("event:add", (_event, payload) => addEvent(payload.type, payload.reason, payload.note));
ipcMain.handle("category:add", (_event, name) => {
  const cleanName = String(name || "").trim();
  if (!cleanName) return currentState();
  db.prepare(`
    INSERT OR IGNORE INTO categories (name, is_default, created_at)
    VALUES (?, 0, ?)
  `).run(cleanName, new Date().toISOString());
  return currentState();
});
ipcMain.handle("csv:exportToday", async () => {
  return exportCsvWithDialog();
});

app.whenReady().then(() => {
  openDatabase();
  createWindow();
  createTray();
  updateAppMenu();
  statusTimer = setInterval(updateTray, 30000);
  app.on("activate", showMainWindow);
});

app.on("before-quit", () => {
  if (statusTimer) clearInterval(statusTimer);
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
