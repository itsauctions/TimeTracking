const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, systemPreferences, Tray } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const zlib = require("node:zlib");
const Database = require("better-sqlite3");

let mainWindow;
let tray;
let db;
let statusTimer;

const DEFAULT_CATEGORIES = ["Bathroom", "Family", "Break", "Admin", "Meal", "Other"];
const DEFAULT_PROJECTS = [
  { name: "General", color: "#647084" }
];
const APP_ID = "local.workday-time-tracker";
const AUTO_AWAY_DEFAULTS = {
  enabled: false,
  seconds: 10,
  presentSeconds: 10,
  sensitivity: "normal",
  cameraMovementEnabled: false
};

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
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL CHECK(event_type IN ('start', 'pause', 'resume', 'stop', 'project_switch')),
      reason TEXT,
      note TEXT,
      project_id INTEGER REFERENCES projects(id),
      occurred_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS movement_minute_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_start TEXT NOT NULL,
      minute_start TEXT NOT NULL,
      face_detected_seconds INTEGER DEFAULT 0,
      movement_avg REAL,
      movement_p95 REAL,
      rotation_avg REAL,
      gaze_shift_avg REAL,
      avg_yaw REAL,
      avg_pitch REAL,
      avg_roll REAL,
      pitch_drift REAL,
      yaw_drift REAL,
      roll_drift REAL,
      forward_lean_score REAL,
      stillness_seconds INTEGER DEFAULT 0,
      fidget_score REAL,
      posture_risk_score REAL,
      blink_count INTEGER DEFAULT 0,
      talking_seconds INTEGER DEFAULT 0,
      expression_activity REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS movement_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_start TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      event_type TEXT NOT NULL,
      severity TEXT,
      message TEXT
    );
  `);
  migrateEventsForProjects();

  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO categories (name, is_default, created_at)
    VALUES (?, ?, ?)
  `);
  const now = new Date().toISOString();
  for (const category of DEFAULT_CATEGORIES) {
    insertCategory.run(category, 1, now);
  }
  const insertProject = db.prepare(`
    INSERT OR IGNORE INTO projects (name, color, is_archived, created_at)
    VALUES (?, ?, 0, ?)
  `);
  for (const project of DEFAULT_PROJECTS) {
    insertProject.run(project.name, project.color, now);
  }
  const generalProject = projectByName("General") || projects(true)[0];
  db.prepare(`
    INSERT OR IGNORE INTO settings (key, value)
    VALUES ('timeZone', ?)
  `).run(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  if (generalProject) {
    setDefaultSetting("activeProjectId", String(generalProject.id));
  }
  setDefaultSetting("autoAwayEnabled", AUTO_AWAY_DEFAULTS.enabled ? "1" : "0");
  setDefaultSetting("autoAwaySeconds", String(AUTO_AWAY_DEFAULTS.seconds));
  setDefaultSetting("autoAwayPresentSeconds", String(AUTO_AWAY_DEFAULTS.presentSeconds));
  setDefaultSetting("autoAwaySensitivity", AUTO_AWAY_DEFAULTS.sensitivity);
  setDefaultSetting("cameraMovementEnabled", AUTO_AWAY_DEFAULTS.cameraMovementEnabled ? "1" : "0");
}

function migrateEventsForProjects() {
  const columns = db.prepare("PRAGMA table_info(events)").all();
  const hasProjectId = columns.some((column) => column.name === "project_id");
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'").get()?.sql || "";
  const allowsProjectSwitch = schema.includes("project_switch");
  if (hasProjectId && allowsProjectSwitch) return;

  db.exec(`
    BEGIN;
    CREATE TABLE events_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL CHECK(event_type IN ('start', 'pause', 'resume', 'stop', 'project_switch')),
      reason TEXT,
      note TEXT,
      project_id INTEGER REFERENCES projects(id),
      occurred_at TEXT NOT NULL
    );
    INSERT INTO events_new (id, event_type, reason, note, project_id, occurred_at)
    SELECT id, event_type, reason, note, ${hasProjectId ? "project_id" : "NULL"}, occurred_at FROM events;
    DROP TABLE events;
    ALTER TABLE events_new RENAME TO events;
    COMMIT;
  `);
}

function getSetting(key, fallback) {
  return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value || fallback;
}

function setDefaultSetting(key, value) {
  db.prepare(`
    INSERT OR IGNORE INTO settings (key, value)
    VALUES (?, ?)
  `).run(key, value);
}

function settings() {
  const activeProjectId = normalizeProjectId(getSetting("activeProjectId", ""));
  return {
    timeZone: getSetting("timeZone", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
    activeProjectId,
    autoAwayEnabled: getSetting("autoAwayEnabled", "0") === "1",
    autoAwaySeconds: validateAutoAwaySeconds(getSetting("autoAwaySeconds", String(AUTO_AWAY_DEFAULTS.seconds))),
    autoAwayPresentSeconds: validateAutoAwayPresentSeconds(getSetting("autoAwayPresentSeconds", String(AUTO_AWAY_DEFAULTS.presentSeconds))),
    autoAwaySensitivity: validateAutoAwaySensitivity(getSetting("autoAwaySensitivity", AUTO_AWAY_DEFAULTS.sensitivity)),
    cameraMovementEnabled: getSetting("cameraMovementEnabled", "0") === "1"
  };
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function validateTimeZone(timeZone) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

function validateAutoAwaySeconds(value) {
  const seconds = Number(value);
  return [10, 15, 30, 60].includes(seconds) ? seconds : AUTO_AWAY_DEFAULTS.seconds;
}

function validateAutoAwayPresentSeconds(value) {
  const seconds = Number(value);
  return [5, 10, 15, 30].includes(seconds) ? seconds : AUTO_AWAY_DEFAULTS.presentSeconds;
}

function validateAutoAwaySensitivity(value) {
  const sensitivity = String(value || "");
  return ["relaxed", "normal", "strict"].includes(sensitivity) ? sensitivity : AUTO_AWAY_DEFAULTS.sensitivity;
}

function datePartsInZone(date = new Date(), timeZone = settings().timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function todayKey(date = new Date(), timeZone = settings().timeZone) {
  const parts = datePartsInZone(date, timeZone);
  const year = parts.year;
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function zonedTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstParts = datePartsInZone(new Date(guess), timeZone);
  const firstAsUtc = Date.UTC(firstParts.year, firstParts.month - 1, firstParts.day, firstParts.hour, firstParts.minute, firstParts.second);
  const adjusted = guess - (firstAsUtc - guess);
  const secondParts = datePartsInZone(new Date(adjusted), timeZone);
  const secondAsUtc = Date.UTC(secondParts.year, secondParts.month - 1, secondParts.day, secondParts.hour, secondParts.minute, secondParts.second);
  return new Date(adjusted - (secondAsUtc - guess));
}

function dayRangeForKey(dayKeyValue = todayKey(), timeZone = settings().timeZone) {
  const [year, month, day] = String(dayKeyValue).split("-").map(Number);
  const start = zonedTimeToUtc(year, month, day, 0, 0, 0, timeZone);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const end = zonedTimeToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), 0, 0, 0, timeZone);
  return { start: start.toISOString(), end: end.toISOString() };
}

function todayEvents(timeZone = settings().timeZone) {
  const range = dayRangeForKey(todayKey(new Date(), timeZone), timeZone);
  return eventsBetween(range.start, range.end);
}

function eventsBetween(start, end) {
  return db.prepare(`
    SELECT
      events.id,
      events.event_type AS type,
      events.reason,
      events.note,
      events.project_id AS projectId,
      projects.name AS projectName,
      projects.color AS projectColor,
      projects.is_archived AS projectArchived,
      events.occurred_at AS occurredAt
    FROM events
    LEFT JOIN projects ON projects.id = events.project_id
    WHERE occurred_at >= ? AND occurred_at < ?
    ORDER BY events.occurred_at ASC, events.id ASC
  `).all(start, end);
}

function allEvents() {
  return db.prepare(`
    SELECT
      events.id,
      events.event_type AS type,
      events.reason,
      events.note,
      events.project_id AS projectId,
      projects.name AS projectName,
      projects.color AS projectColor,
      projects.is_archived AS projectArchived,
      events.occurred_at AS occurredAt
    FROM events
    LEFT JOIN projects ON projects.id = events.project_id
    ORDER BY events.occurred_at ASC, events.id ASC
  `).all();
}

function eventDayKeys(timeZone = settings().timeZone) {
  return db.prepare(`
    SELECT occurred_at AS occurredAt
    FROM events
    ORDER BY occurred_at DESC, id DESC
  `).all()
    .map((event) => todayKey(new Date(event.occurredAt), timeZone))
    .filter((key, index, keys) => keys.indexOf(key) === index);
}

function categories() {
  return db.prepare(`
    SELECT id, name, is_default AS isDefault
    FROM categories
    ORDER BY is_default DESC, lower(name) ASC
  `).all();
}

function projects(includeArchived = false) {
  return db.prepare(`
    SELECT id, name, color, is_archived AS isArchived
    FROM projects
    ${includeArchived ? "" : "WHERE is_archived = 0"}
    ORDER BY is_archived ASC, lower(name) ASC
  `).all();
}

function projectByName(name) {
  return db.prepare(`
    SELECT id, name, color, is_archived AS isArchived
    FROM projects
    WHERE lower(name) = lower(?)
  `).get(name);
}

function projectById(id) {
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) return null;
  return db.prepare(`
    SELECT id, name, color, is_archived AS isArchived
    FROM projects
    WHERE id = ?
  `).get(projectId);
}

function normalizeProjectId(value, allowArchived = false) {
  const projectId = Number(value);
  const project = Number.isInteger(projectId) ? projectById(projectId) : null;
  if (project && (allowArchived || !project.isArchived)) return project.id;
  return null;
}

function fallbackProject() {
  const general = projectByName("General");
  if (general && !general.isArchived) return general;
  return projects(false)[0] || projects(true)[0] || null;
}

function activeProjectId() {
  const appSettings = settings();
  return appSettings.activeProjectId || fallbackProject()?.id || null;
}

function projectShape(project) {
  if (!project) return null;
  return {
    id: project.id,
    name: project.name,
    color: project.color,
    isArchived: Boolean(project.isArchived)
  };
}

function currentState() {
  const appSettings = settings();
  const events = todayEvents(appSettings.timeZone);
  const latest = events.at(-1);
  let status = "idle";
  if (latest) {
    if (latest.type === "start" || latest.type === "resume" || latest.type === "project_switch") status = "working";
    if (latest.type === "pause") status = "paused";
    if (latest.type === "stop") status = "stopped";
  }
  const totals = calculateTotals(events);
  const openWorkSegment = totals.segments.filter((segment) => segment.type === "work").at(-1);
  const selectedProject = status === "working" && openWorkSegment?.projectId
    ? projectById(openWorkSegment.projectId)
    : projectById(appSettings.activeProjectId) || fallbackProject();

  return {
    status,
    activeSince: status === "working" || status === "paused" ? latest.occurredAt : null,
    events,
    categories: categories(),
    projects: projects(true),
    activeProjectId: selectedProject?.id || null,
    activeProject: projectShape(selectedProject),
    settings: appSettings,
    totals
  };
}

function calculateTotals(events, now = new Date()) {
  let workMs = 0;
  let pauseMs = 0;
  let openType = null;
  let openAt = null;
  let openReason = "";
  let openNote = "";
  let openProject = null;
  let openEventId = null;
  const segments = [];

  for (const event of events) {
    const occurredAt = new Date(event.occurredAt);
    if (event.type === "start" || event.type === "resume" || event.type === "project_switch") {
      if (event.type === "project_switch" && openType === "work" && openAt) {
        const durationMs = occurredAt - openAt;
        workMs += durationMs;
        segments.push(segmentRow("work", openAt, occurredAt, durationMs, "", "", openProject, openEventId));
      }
      if (openType === "pause" && openAt) {
        const durationMs = occurredAt - openAt;
        pauseMs += durationMs;
        segments.push(segmentRow("pause", openAt, occurredAt, durationMs, openReason, openNote, null, openEventId));
      }
      openType = "work";
      openAt = occurredAt;
      openReason = "";
      openNote = "";
      openProject = projectFromEvent(event);
      openEventId = event.id;
    }

    if (event.type === "pause") {
      if (openType === "work" && openAt) {
        const durationMs = occurredAt - openAt;
        workMs += durationMs;
        segments.push(segmentRow("work", openAt, occurredAt, durationMs, "", "", openProject, openEventId));
      }
      openType = "pause";
      openAt = occurredAt;
      openReason = event.reason || "";
      openNote = event.note || "";
      openProject = null;
      openEventId = event.id;
    }

    if (event.type === "stop") {
      if (openType && openAt) {
        const durationMs = occurredAt - openAt;
        if (openType === "work") workMs += durationMs;
        if (openType === "pause") pauseMs += durationMs;
        segments.push(segmentRow(openType, openAt, occurredAt, durationMs, openReason, openNote, openType === "work" ? openProject : null, openEventId));
      }
      openType = null;
      openAt = null;
      openReason = "";
      openNote = "";
      openProject = null;
      openEventId = null;
    }
  }

  if (openType && openAt) {
    const durationMs = now - openAt;
    if (openType === "work") workMs += durationMs;
    if (openType === "pause") pauseMs += durationMs;
    segments.push(segmentRow(openType, openAt, now, durationMs, openReason, openNote, openType === "work" ? openProject : null, openEventId));
  }

  return { workMs, pauseMs, segments };
}

function statsSummary(range = {}) {
  const timeZone = settings().timeZone;
  const segments = calculateTotals(allEvents()).segments;
  const projectId = normalizeProjectId(range.projectId, true);
  const filteredSegments = projectId
    ? segments.filter((segment) => segment.type === "work" && segment.projectId === projectId)
    : segments;
  const days = new Map();
  const weeks = new Map();
  const months = new Map();

  for (const segment of filteredSegments) {
    const start = new Date(segment.start);
    addSegmentStats(days, todayKey(start, timeZone), segment);
    addSegmentStats(weeks, weekKey(start, timeZone), segment);
    addSegmentStats(months, monthKey(start, timeZone), segment);
  }

  return {
    days: Array.from(days.values()).sort((a, b) => b.key.localeCompare(a.key)),
    weeks: Array.from(weeks.values()).sort((a, b) => b.key.localeCompare(a.key)),
    months: Array.from(months.values()).sort((a, b) => b.key.localeCompare(a.key)),
    projects: projects(true),
    selectedProjectId: projectId,
    projectTotals: projectTotals(segments),
    chart: chartSummary(filteredSegments, range)
  };
}

function weekKey(date, timeZone = settings().timeZone) {
  const key = todayKey(date, timeZone);
  const [year, month, day] = key.split("-").map(Number);
  const dateOnly = new Date(Date.UTC(year, month - 1, day));
  dateOnly.setUTCDate(dateOnly.getUTCDate() - dateOnly.getUTCDay());
  return `${dateOnly.getUTCFullYear()}-${String(dateOnly.getUTCMonth() + 1).padStart(2, "0")}-${String(dateOnly.getUTCDate()).padStart(2, "0")}`;
}

function monthKey(date, timeZone = settings().timeZone) {
  const parts = datePartsInZone(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function dayKeyToDate(dayKeyValue) {
  const [year, month, day] = String(dayKeyValue || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysToKey(dayKeyValue, days) {
  const date = dayKeyToDate(dayKeyValue);
  if (!date) return todayKey();
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function parseStatsRange(range = {}, timeZone = settings().timeZone) {
  const defaultEnd = todayKey(new Date(), timeZone);
  const defaultStart = addDaysToKey(defaultEnd, -6);
  let startDay = /^\d{4}-\d{2}-\d{2}$/.test(range.startDay) ? range.startDay : defaultStart;
  let endDay = /^\d{4}-\d{2}-\d{2}$/.test(range.endDay) ? range.endDay : defaultEnd;
  if (endDay < startDay) {
    [startDay, endDay] = [endDay, startDay];
  }
  const startMinute = Number.isFinite(range.startMinute)
    ? Math.max(0, Math.min(1439, Math.floor(range.startMinute)))
    : 6 * 60;
  let endMinute = Number.isFinite(range.endMinute)
    ? Math.max(1, Math.min(1440, Math.floor(range.endMinute)))
    : 20 * 60;
  if (endMinute <= startMinute) {
    endMinute = Math.min(1440, startMinute + 60);
  }
  return { startDay, endDay, startMinute, endMinute };
}

function minuteOfDayInZone(date, timeZone) {
  const parts = datePartsInZone(date, timeZone);
  return (parts.hour * 60) + parts.minute + (parts.second / 60);
}

function localMinuteBoundary(dayKeyValue, minute, timeZone) {
  const [year, month, day] = dayKeyValue.split("-").map(Number);
  const hour = Math.floor(minute / 60);
  const localMinute = minute % 60;
  if (minute >= 1440) {
    const nextDay = addDaysToKey(dayKeyValue, 1);
    const [nextYear, nextMonth, nextDate] = nextDay.split("-").map(Number);
    return zonedTimeToUtc(nextYear, nextMonth, nextDate, 0, 0, 0, timeZone);
  }
  return zonedTimeToUtc(year, month, day, hour, localMinute, 0, timeZone);
}

function chartSummary(segments, rangeInput = {}) {
  const timeZone = settings().timeZone;
  const range = parseStatsRange(rangeInput, timeZone);
  const days = new Map();
  for (let dayKeyValue = range.startDay; dayKeyValue <= range.endDay; dayKeyValue = addDaysToKey(dayKeyValue, 1)) {
    days.set(dayKeyValue, {
      key: dayKeyValue,
      workMs: 0,
      pauseMs: 0,
      segments: []
    });
  }

  for (const segment of segments) {
    const segmentStart = new Date(segment.start);
    const segmentEnd = new Date(segment.end);
    if (Number.isNaN(segmentStart.getTime()) || Number.isNaN(segmentEnd.getTime())) continue;

    for (const [dayKeyValue, day] of days) {
      const windowStart = localMinuteBoundary(dayKeyValue, range.startMinute, timeZone);
      const windowEnd = localMinuteBoundary(dayKeyValue, range.endMinute, timeZone);

      const clippedStart = new Date(Math.max(segmentStart.getTime(), windowStart.getTime()));
      const clippedEnd = new Date(Math.min(segmentEnd.getTime(), windowEnd.getTime()));
      if (clippedEnd <= clippedStart) continue;

      const durationMs = clippedEnd - clippedStart;
      if (segment.type === "work") day.workMs += durationMs;
      if (segment.type === "pause") day.pauseMs += durationMs;
      day.segments.push({
        type: segment.type,
        reason: segment.reason || "",
        projectId: segment.projectId || null,
        projectName: segment.projectName || "",
        projectColor: segment.projectColor || "",
        start: clippedStart.toISOString(),
        end: clippedEnd.toISOString(),
        startMinute: Math.max(range.startMinute, minuteOfDayInZone(clippedStart, timeZone)),
        endMinute: Math.min(range.endMinute, minuteOfDayInZone(clippedEnd, timeZone)),
        durationMs
      });
    }
  }

  return {
    timeZone,
    range,
    days: Array.from(days.values()).sort((a, b) => b.key.localeCompare(a.key))
  };
}

function addSegmentStats(map, key, segment) {
  if (!map.has(key)) {
    map.set(key, {
      key,
      workMs: 0,
      pauseMs: 0,
      totalMs: 0,
      categories: {},
      projects: {}
    });
  }

  const bucket = map.get(key);
  const durationMs = Math.round(segment.durationMinutes * 60000);
  bucket.totalMs += durationMs;
  if (segment.type === "work") {
    bucket.workMs += durationMs;
    const projectName = segment.projectName || "Unassigned";
    bucket.projects[projectName] = (bucket.projects[projectName] || 0) + durationMs;
  }
  if (segment.type === "pause") {
    bucket.pauseMs += durationMs;
    const category = segment.reason || "Uncategorized";
    bucket.categories[category] = (bucket.categories[category] || 0) + durationMs;
  }
}

function projectFromEvent(event) {
  if (!event?.projectId) return null;
  return {
    id: event.projectId,
    name: event.projectName || "Unassigned",
    color: event.projectColor || "#647084",
    isArchived: Boolean(event.projectArchived)
  };
}

function segmentRow(type, start, end, durationMs, reason, note, project, sourceEventId) {
  return {
    type,
    start: start.toISOString(),
    end: end.toISOString(),
    durationMinutes: Math.round((durationMs / 60000) * 100) / 100,
    reason: reason || "",
    note: note || "",
    sourceEventId: sourceEventId || null,
    projectId: type === "work" ? project?.id || null : null,
    projectName: type === "work" ? project?.name || "Unassigned" : "",
    projectColor: type === "work" ? project?.color || "#647084" : "",
    projectArchived: type === "work" ? Boolean(project?.isArchived) : false
  };
}

function projectTotals(segments) {
  const totals = new Map();
  for (const segment of segments) {
    if (segment.type !== "work") continue;
    const key = segment.projectId || "unassigned";
    if (!totals.has(key)) {
      totals.set(key, {
        projectId: segment.projectId,
        projectName: segment.projectName || "Unassigned",
        projectColor: segment.projectColor || "#647084",
        workMs: 0
      });
    }
    totals.get(key).workMs += Math.round(segment.durationMinutes * 60000);
  }
  return Array.from(totals.values()).sort((a, b) => b.workMs - a.workMs);
}

function addEvent(type, reason = "", note = "", projectId = null) {
  const cleanType = ["start", "pause", "resume", "stop", "project_switch"].includes(type) ? type : "start";
  const eventProjectId = cleanType === "start" || cleanType === "resume" || cleanType === "project_switch"
    ? normalizeProjectId(projectId, true) || activeProjectId()
    : null;
  db.prepare(`
    INSERT INTO events (event_type, reason, note, project_id, occurred_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(cleanType, reason || null, note || null, eventProjectId, new Date().toISOString());
  if (eventProjectId) setSetting("activeProjectId", String(eventProjectId));
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

function compactElapsed(ms) {
  const elapsed = formatElapsed(ms);
  return elapsed === "less than 1m" ? "<1m" : elapsed;
}

function compactProjectName(name) {
  const value = String(name || "").trim();
  if (value.length <= 18) return value;
  return `${value.slice(0, 17)}...`;
}

function statusText(state = currentState()) {
  const label = statusLabel(state.status);
  if (!state.activeSince) return label;
  const project = state.status === "working" && state.activeProject?.name ? ` on ${state.activeProject.name}` : "";
  return `${label}${project} for ${formatElapsed(Date.now() - new Date(state.activeSince).getTime())}`;
}

function trayTitle(state = currentState()) {
  if (process.platform !== "darwin") return "";
  const elapsed = state.activeSince ? ` ${compactElapsed(Date.now() - new Date(state.activeSince).getTime())}` : "";
  const projectName = compactProjectName(state.activeProject?.name);
  const project = projectName ? ` - ${projectName}` : "";
  if (state.status === "working") return `Work${elapsed}${project}`;
  if (state.status === "paused") return `Paused${elapsed}${project}`;
  if (state.status === "stopped") return `Done${project}`;
  return "Timer";
}

function minutes(ms) {
  return Math.round((ms / 60000) * 100) / 100;
}

function exportWorkbook() {
  const timeZone = settings().timeZone;
  const segments = calculateTotals(allEvents()).segments;
  const stats = statsSummary();
  const segmentRows = [
    [
      "date",
      "segment_start",
      "segment_end",
      "segment_type",
      "project_id",
      "project",
      "pause_reason",
      "note",
      "duration_minutes"
    ],
    ...segments.map((segment) => [
      todayKey(new Date(segment.start), timeZone),
      segment.start,
      segment.end,
      segment.type,
      segment.projectId || "",
      segment.projectName || "",
      segment.reason,
      segment.note,
      segment.durationMinutes
    ])
  ];

  return createXlsx([
    { name: "Segments", rows: segmentRows },
    { name: "Summary", rows: [...summaryRows("day", stats.days), ...summaryRows("week", stats.weeks), ...summaryRows("month", stats.months)] },
    { name: "Category Summary", rows: [...categoryRows("day", stats.days), ...categoryRows("week", stats.weeks), ...categoryRows("month", stats.months)] },
    { name: "Project Summary", rows: [...projectRows("day", stats.days), ...projectRows("week", stats.weeks), ...projectRows("month", stats.months)] }
  ]);
}

function summaryRows(periodType, periods) {
  const rows = [["period_type", "period_key", "work_minutes", "pause_minutes", "total_minutes"]];
  for (const period of periods) {
    rows.push([
      periodType,
      period.key,
      minutes(period.workMs),
      minutes(period.pauseMs),
      minutes(period.totalMs)
    ]);
  }
  return rows;
}

function categoryRows(periodType, periods) {
  const rows = [["period_type", "period_key", "category", "category_minutes"]];
  for (const period of periods) {
    for (const [category, categoryMs] of Object.entries(period.categories)) {
      rows.push([
        periodType,
        period.key,
        category,
        minutes(categoryMs)
      ]);
    }
  }
  return rows;
}

function projectRows(periodType, periods) {
  const rows = [["period_type", "period_key", "project", "project_minutes"]];
  for (const period of periods) {
    for (const [project, projectMs] of Object.entries(period.projects || {})) {
      rows.push([
        periodType,
        period.key,
        project,
        minutes(projectMs)
      ]);
    }
  }
  return rows;
}

function createXlsx(sheets) {
  const workbookSheets = sheets.map((sheet, index) => `
    <sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const workbookRels = sheets.map((sheet, index) => `
    <Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const contentSheetOverrides = sheets.map((sheet, index) => `
    <Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const files = [
    {
      path: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Default Extension="xml" ContentType="application/xml"/>
          <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
          <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
          ${contentSheetOverrides}
        </Types>`
    },
    {
      path: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
        </Relationships>`
    },
    {
      path: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <sheets>${workbookSheets}</sheets>
        </workbook>`
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          ${workbookRels}
          <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
        </Relationships>`
    },
    {
      path: "xl/styles.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
          <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
          <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
          <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
          <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
          <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
        </styleSheet>`
    },
    ...sheets.map((sheet, index) => ({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      content: sheetXml(sheet.rows)
    }))
  ];
  return zipFiles(files);
}

function sheetXml(rows) {
  const xmlRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => cellXml(columnName(columnIndex + 1), rowIndex + 1, value)).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>${xmlRows}</sheetData>
    </worksheet>`;
}

function cellXml(column, row, value) {
  const reference = `${column}${row}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function columnName(index) {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function zipFiles(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const content = Buffer.from(file.content.replace(/\n\s+/g, ""), "utf8");
    const compressed = zlib.deflateRawSync(content);
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function exportWorkbookWithDialog() {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export time workbook",
    defaultPath: `workday-time-export-${todayKey(new Date(), settings().timeZone)}.xlsx`,
    filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, exportWorkbook());
  return { canceled: false, filePath: result.filePath };
}

function historyForDay(dayKeyValue = todayKey()) {
  const timeZone = settings().timeZone;
  const range = dayRangeForKey(dayKeyValue, timeZone);
  const events = eventsBetween(range.start, range.end);
  const segments = calculateTotals(events, new Date(range.end)).segments;
  return {
    selectedDay: dayKeyValue,
    days: eventDayKeys(timeZone),
    events: eventsWithProjectContext(events, segments),
    segments,
    projects: projects(true),
    settings: settings()
  };
}

function eventsWithProjectContext(events, segments) {
  return events.map((event) => {
    if (event.projectName) return event;
    const eventTime = new Date(event.occurredAt).getTime();
    const relatedWorkSegment = segments.find((segment) => {
      if (segment.type !== "work" || !segment.projectId) return false;
      const start = new Date(segment.start).getTime();
      const end = new Date(segment.end).getTime();
      return Math.abs(end - eventTime) < 1000 || Math.abs(start - eventTime) < 1000;
    });
    if (!relatedWorkSegment) return event;
    return {
      ...event,
      projectId: relatedWorkSegment.projectId,
      projectName: relatedWorkSegment.projectName,
      projectColor: relatedWorkSegment.projectColor,
      projectArchived: relatedWorkSegment.projectArchived
    };
  });
}

function deleteEvent(id) {
  const eventId = Number(id);
  if (Number.isInteger(eventId)) {
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
  }
  updateTray();
  updateAppMenu();
  return currentState();
}

function deleteEventsForDay(dayKeyValue) {
  const range = dayRangeForKey(dayKeyValue, settings().timeZone);
  db.prepare("DELETE FROM events WHERE occurred_at >= ? AND occurred_at < ?").run(range.start, range.end);
  updateTray();
  updateAppMenu();
  return currentState();
}

function deleteEventsForPeriod(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return currentState();
  db.prepare("DELETE FROM events WHERE occurred_at >= ? AND occurred_at <= ?").run(startDate.toISOString(), endDate.toISOString());
  updateTray();
  updateAppMenu();
  return currentState();
}

function setActiveProject(projectId) {
  const cleanProjectId = normalizeProjectId(projectId, false) || fallbackProject()?.id || null;
  if (cleanProjectId) setSetting("activeProjectId", String(cleanProjectId));
  updateTray();
  updateAppMenu();
  return currentState();
}

function switchProject(projectId) {
  const cleanProjectId = normalizeProjectId(projectId, false) || fallbackProject()?.id || null;
  if (!cleanProjectId) return currentState();
  const state = currentState();
  setSetting("activeProjectId", String(cleanProjectId));
  if (state.status === "working" && state.activeProjectId !== cleanProjectId) {
    return addEvent("project_switch", "", "", cleanProjectId);
  }
  updateTray();
  updateAppMenu();
  return currentState();
}

function addProject(name, color = "#647084") {
  const cleanName = String(name || "").trim();
  if (!cleanName) return currentState();
  const existing = projectByName(cleanName);
  if (existing) {
    db.prepare(`
      UPDATE projects
      SET color = ?, is_archived = 0
      WHERE id = ?
    `).run(validateProjectColor(color), existing.id);
    setSetting("activeProjectId", String(existing.id));
    updateTray();
    updateAppMenu();
    return currentState();
  }
  db.prepare(`
    INSERT OR IGNORE INTO projects (name, color, is_archived, created_at)
    VALUES (?, ?, 0, ?)
  `).run(cleanName, validateProjectColor(color), new Date().toISOString());
  const project = projectByName(cleanName);
  if (project) setSetting("activeProjectId", String(project.id));
  updateTray();
  updateAppMenu();
  return currentState();
}

function updateProject(payload = {}) {
  const projectId = Number(payload.id);
  const existing = Number.isInteger(projectId) ? projectById(projectId) : null;
  if (!existing) return currentState();
  const cleanName = String(payload.name || existing.name).trim() || existing.name;
  const cleanColor = validateProjectColor(payload.color || existing.color);
  const isArchived = payload.isArchived ? 1 : 0;
  try {
    db.prepare(`
      UPDATE projects
      SET name = ?, color = ?, is_archived = ?
      WHERE id = ?
    `).run(cleanName, cleanColor, isArchived, projectId);
  } catch {
    db.prepare(`
      UPDATE projects
      SET color = ?, is_archived = ?
      WHERE id = ?
    `).run(cleanColor, isArchived, projectId);
  }
  if (isArchived && getSetting("activeProjectId", "") === String(projectId)) {
    const replacement = fallbackProject();
    if (replacement) setSetting("activeProjectId", String(replacement.id));
  }
  updateTray();
  updateAppMenu();
  return currentState();
}

function validateProjectColor(color) {
  const value = String(color || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#647084";
}

function reassignSegmentProject(sourceEventId, projectId) {
  const eventId = Number(sourceEventId);
  const cleanProjectId = normalizeProjectId(projectId, true);
  if (!Number.isInteger(eventId) || !cleanProjectId) return currentState();
  db.prepare(`
    UPDATE events
    SET project_id = ?
    WHERE id = ? AND event_type IN ('start', 'resume', 'project_switch')
  `).run(cleanProjectId, eventId);
  updateTray();
  updateAppMenu();
  return currentState();
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
  const traySize = process.platform === "darwin" ? 18 : 16;
  const icon = nativeImage.createFromPath(assetPath("app-icon-rgba.png")).resize({ width: traySize, height: traySize });
  if (process.platform === "darwin") {
    icon.setTemplateImage(true);
  }
  tray = new Tray(icon);
  tray.setToolTip("Workday Time Tracker");
  tray.on("click", () => {
    if (process.platform === "darwin") return;
    showMainWindow();
  });
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
  if (process.platform === "darwin") {
    tray.setTitle(trayTitle(state));
  }
  if (mainWindow) {
    mainWindow.setTitle(`${text} - Workday Time Tracker`);
  }
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(state, text)));
  updateAppMenu();
}

function trayMenuTemplate(state, text) {
  return [
    { label: text, enabled: false },
    { label: "Show", click: showMainWindow },
    { type: "separator" },
    { label: "Start Work", enabled: state.status === "idle" || state.status === "stopped", click: () => addEvent("start") },
    { label: "Resume", enabled: state.status === "paused", click: () => addEvent("resume") },
    {
      label: "Pause For",
      enabled: state.status === "working",
      submenu: categories().map((category) => ({
        label: category.name,
        click: () => addEvent("pause", category.name)
      }))
    },
    { label: "End Day", enabled: state.status !== "idle" && state.status !== "stopped", click: () => addEvent("stop") },
    { type: "separator" },
    { label: "Stats", click: () => sendNavigation("stats") },
    { label: "History", click: () => sendNavigation("history") },
    { label: "Export XLSX", click: exportWorkbookWithDialog },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ];
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
    ...(process.platform === "darwin" ? [{
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    }] : []),
    {
      label: statusText(state),
      submenu: [
        { label: "Show Timer", click: () => sendNavigation("timer") },
        { label: "Show Stats", click: () => sendNavigation("stats") },
        { label: "Show History", click: () => sendNavigation("history") }
      ]
    },
    {
      label: "File",
      submenu: [
        { label: "Export XLSX", click: exportWorkbookWithDialog },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : {
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
        { label: "History", click: () => sendNavigation("history") },
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
            detail: "Use Start Work to begin tracking. Use the pause category buttons or Timer menu to pause with a reason. Stats show daily, weekly, and monthly totals. Export XLSX creates separate workbook sheets for raw segments and summary stats."
          })
        },
        {
          label: "About",
          click: () => dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "About Workday Time Tracker",
            message: "Workday Time Tracker",
            detail: "A local SQLite-based workday timer with tray status, XLSX export, and stats.\nVersion: 0.0.1\nAuthor: Noah Vandal, ITS Solutions"
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
ipcMain.handle("stats:get", (_event, range) => statsSummary(range));
ipcMain.handle("history:get", (_event, dayKeyValue) => historyForDay(dayKeyValue || todayKey()));
ipcMain.handle("event:add", (_event, payload) => addEvent(payload.type, payload.reason, payload.note, payload.projectId));
ipcMain.handle("event:delete", (_event, id) => deleteEvent(id));
ipcMain.handle("events:deleteDay", (_event, dayKeyValue) => deleteEventsForDay(dayKeyValue));
ipcMain.handle("events:deletePeriod", (_event, payload) => deleteEventsForPeriod(payload.start, payload.end));
ipcMain.handle("project:setActive", (_event, projectId) => setActiveProject(projectId));
ipcMain.handle("project:switch", (_event, projectId) => switchProject(projectId));
ipcMain.handle("project:add", (_event, payload) => addProject(payload?.name, payload?.color));
ipcMain.handle("project:update", (_event, payload) => updateProject(payload));
ipcMain.handle("segment:reassignProject", (_event, payload) => reassignSegmentProject(payload?.sourceEventId, payload?.projectId));
ipcMain.handle("category:add", (_event, name) => {
  const cleanName = String(name || "").trim();
  if (!cleanName) return currentState();
  db.prepare(`
    INSERT OR IGNORE INTO categories (name, is_default, created_at)
    VALUES (?, 0, ?)
  `).run(cleanName, new Date().toISOString());
  updateTray();
  updateAppMenu();
  return currentState();
});
ipcMain.handle("category:delete", (_event, id) => {
  const categoryId = Number(id);
  if (!Number.isInteger(categoryId)) return currentState();
  db.prepare("DELETE FROM categories WHERE id = ?").run(categoryId);
  updateTray();
  updateAppMenu();
  return currentState();
});
ipcMain.handle("csv:exportToday", async () => {
  return exportWorkbookWithDialog();
});
ipcMain.handle("settings:update", (_event, payload) => {
  const timeZone = validateTimeZone(String(payload?.timeZone || ""));
  setSetting("timeZone", timeZone);
  setSetting("autoAwayEnabled", payload?.autoAwayEnabled ? "1" : "0");
  setSetting("autoAwaySeconds", String(validateAutoAwaySeconds(payload?.autoAwaySeconds)));
  setSetting("autoAwayPresentSeconds", String(validateAutoAwayPresentSeconds(payload?.autoAwayPresentSeconds)));
  setSetting("autoAwaySensitivity", validateAutoAwaySensitivity(payload?.autoAwaySensitivity));
  setSetting("cameraMovementEnabled", payload?.cameraMovementEnabled ? "1" : "0");
  updateTray();
  updateAppMenu();
  return currentState();
});

function storeMovementMinute(minuteData) {
  db.prepare(`
    INSERT INTO movement_minute_metrics (
      session_start, minute_start, face_detected_seconds,
      movement_avg, movement_p95, rotation_avg, gaze_shift_avg,
      avg_yaw, avg_pitch, avg_roll,
      pitch_drift, yaw_drift, roll_drift, forward_lean_score,
      stillness_seconds, fidget_score, posture_risk_score,
      blink_count, talking_seconds, expression_activity, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    minuteData.sessionStart, minuteData.minuteStart, minuteData.faceDetectedSeconds,
    minuteData.movementAvg ?? null, minuteData.movementP95 ?? null,
    minuteData.rotationAvg ?? null, minuteData.gazeShiftAvg ?? null,
    minuteData.avgYaw ?? null, minuteData.avgPitch ?? null, minuteData.avgRoll ?? null,
    minuteData.pitchDrift ?? null, minuteData.yawDrift ?? null,
    minuteData.rollDrift ?? null, minuteData.forwardLeanScore ?? null,
    minuteData.stillnessSeconds ?? 0, minuteData.fidgetScore ?? null,
    minuteData.postureRiskScore ?? null,
    minuteData.blinkCount ?? 0, minuteData.talkingSeconds ?? 0,
    minuteData.expressionActivity ?? null, new Date().toISOString()
  );
}

function getMovement(rangeInput = {}) {
  const timeZone = settings().timeZone;
  const range = parseStatsRange(rangeInput, timeZone);
  const selectedProjectId = normalizeProjectId(rangeInput?.projectId, true);
  const days = [];
  let queryStart = null;
  let queryEnd = null;
  for (let dayKeyValue = range.startDay; dayKeyValue <= range.endDay; dayKeyValue = addDaysToKey(dayKeyValue, 1)) {
    const start = localMinuteBoundary(dayKeyValue, range.startMinute, timeZone);
    const end = localMinuteBoundary(dayKeyValue, range.endMinute, timeZone);
    days.push({ key: dayKeyValue, start: start.toISOString(), end: end.toISOString() });
    if (!queryStart || start < queryStart) queryStart = start;
    if (!queryEnd || end > queryEnd) queryEnd = end;
  }

  let rows = db.prepare(`
    SELECT * FROM movement_minute_metrics
    WHERE minute_start >= ? AND minute_start < ?
    ORDER BY minute_start ASC
  `).all(queryStart.toISOString(), queryEnd.toISOString()).filter((row) => {
    const minuteStart = row.minute_start;
    return days.some((day) => minuteStart >= day.start && minuteStart < day.end);
  });

  let events = db.prepare(`
    SELECT * FROM movement_events
    WHERE start_time >= ? AND start_time < ?
    ORDER BY start_time ASC
  `).all(queryStart.toISOString(), queryEnd.toISOString()).filter((event) => {
    const start = event.start_time;
    return days.some((day) => start >= day.start && start < day.end);
  });

  const segments = calculateTotals(allEvents()).segments;
  const workSegments = [];
  for (const segment of segments.filter((s) => s.type === "work" && (!selectedProjectId || s.projectId === selectedProjectId))) {
    const segmentStart = new Date(segment.start);
    const segmentEnd = new Date(segment.end);
    for (const day of days) {
      const windowStart = new Date(day.start);
      const windowEnd = new Date(day.end);
      const clippedStart = new Date(Math.max(segmentStart.getTime(), windowStart.getTime()));
      const clippedEnd = new Date(Math.min(segmentEnd.getTime(), windowEnd.getTime()));
      if (clippedEnd <= clippedStart) continue;
      workSegments.push({
        ...segment,
        start: clippedStart.toISOString(),
        end: clippedEnd.toISOString(),
        durationMinutes: Math.round(((clippedEnd - clippedStart) / 60000) * 100) / 100
      });
    }
  }
  if (selectedProjectId) {
    rows = rows.filter((row) => workSegments.some((segment) => intervalOverlaps(
      row.minute_start,
      new Date(new Date(row.minute_start).getTime() + 60000).toISOString(),
      segment.start,
      segment.end
    )));
    events = events.filter((event) => workSegments.some((segment) => intervalOverlaps(
      event.start_time,
      event.end_time || event.start_time,
      segment.start,
      segment.end
    )));
  }

  return {
    timeZone,
    range,
    selectedProjectId,
    windows: days,
    minutes: rows,
    events,
    workSegments,
    projectTotals: projectTotals(workSegments)
  };
}

function intervalOverlaps(startA, endA, startB, endB) {
  const aStart = new Date(startA).getTime();
  let aEnd = new Date(endA).getTime();
  const bStart = new Date(startB).getTime();
  let bEnd = new Date(endB).getTime();
  if (![aStart, aEnd, bStart, bEnd].every(Number.isFinite)) return false;
  if (aEnd <= aStart) aEnd = aStart + 1;
  if (bEnd <= bStart) bEnd = bStart + 1;
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

ipcMain.handle("movement:storeMinute", (_event, minuteData) => {
  storeMovementMinute(minuteData);
});

ipcMain.handle("movement:get", (_event, range) => getMovement(range));
ipcMain.handle("movement:getToday", () => getMovement());

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });

  if (process.platform === "darwin") {
    const status = systemPreferences.getMediaAccessStatus("camera");
    if (status === "not-determined") {
      try {
        await systemPreferences.askForMediaAccess("camera");
      } catch (error) {
        console.error("Camera permission request failed", error);
      }
    }
  }

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
