const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const zlib = require("node:zlib");
const Database = require("better-sqlite3");

let mainWindow;
let tray;
let db;
let statusTimer;

const DEFAULT_CATEGORIES = ["Bathroom", "Family", "Break", "Admin", "Meal", "Other"];
const APP_ID = "local.workday-time-tracker";
const AUTO_AWAY_DEFAULTS = {
  enabled: false,
  seconds: 30,
  sensitivity: "normal"
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
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
  db.prepare(`
    INSERT OR IGNORE INTO settings (key, value)
    VALUES ('timeZone', ?)
  `).run(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  setDefaultSetting("autoAwayEnabled", AUTO_AWAY_DEFAULTS.enabled ? "1" : "0");
  setDefaultSetting("autoAwaySeconds", String(AUTO_AWAY_DEFAULTS.seconds));
  setDefaultSetting("autoAwaySensitivity", AUTO_AWAY_DEFAULTS.sensitivity);
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
  return {
    timeZone: getSetting("timeZone", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
    autoAwayEnabled: getSetting("autoAwayEnabled", "0") === "1",
    autoAwaySeconds: validateAutoAwaySeconds(getSetting("autoAwaySeconds", String(AUTO_AWAY_DEFAULTS.seconds))),
    autoAwaySensitivity: validateAutoAwaySensitivity(getSetting("autoAwaySensitivity", AUTO_AWAY_DEFAULTS.sensitivity))
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
  return [15, 30, 60].includes(seconds) ? seconds : AUTO_AWAY_DEFAULTS.seconds;
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

function currentState() {
  const appSettings = settings();
  const events = todayEvents(appSettings.timeZone);
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
    settings: appSettings,
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

function statsSummary(range = {}) {
  const timeZone = settings().timeZone;
  const segments = calculateTotals(allEvents()).segments;
  const days = new Map();
  const weeks = new Map();
  const months = new Map();

  for (const segment of segments) {
    const start = new Date(segment.start);
    addSegmentStats(days, todayKey(start, timeZone), segment);
    addSegmentStats(weeks, weekKey(start, timeZone), segment);
    addSegmentStats(months, monthKey(start, timeZone), segment);
  }

  return {
    days: Array.from(days.values()).sort((a, b) => b.key.localeCompare(a.key)),
    weeks: Array.from(weeks.values()).sort((a, b) => b.key.localeCompare(a.key)),
    months: Array.from(months.values()).sort((a, b) => b.key.localeCompare(a.key)),
    chart: chartSummary(segments, range)
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

function trayTitle(state = currentState()) {
  if (process.platform !== "darwin") return "";
  if (state.status === "working") return "Work";
  if (state.status === "paused") return "Paused";
  if (state.status === "stopped") return "Done";
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
      "pause_reason",
      "note",
      "duration_minutes"
    ],
    ...segments.map((segment) => [
      todayKey(new Date(segment.start), timeZone),
      segment.start,
      segment.end,
      segment.type,
      segment.reason,
      segment.note,
      segment.durationMinutes
    ])
  ];

  return createXlsx([
    { name: "Segments", rows: segmentRows },
    { name: "Summary", rows: [...summaryRows("day", stats.days), ...summaryRows("week", stats.weeks), ...summaryRows("month", stats.months)] },
    { name: "Category Summary", rows: [...categoryRows("day", stats.days), ...categoryRows("week", stats.weeks), ...categoryRows("month", stats.months)] }
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
  return {
    selectedDay: dayKeyValue,
    days: eventDayKeys(timeZone),
    events,
    segments: calculateTotals(events, new Date(range.end)).segments,
    settings: settings()
  };
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
ipcMain.handle("event:add", (_event, payload) => addEvent(payload.type, payload.reason, payload.note));
ipcMain.handle("event:delete", (_event, id) => deleteEvent(id));
ipcMain.handle("events:deleteDay", (_event, dayKeyValue) => deleteEventsForDay(dayKeyValue));
ipcMain.handle("events:deletePeriod", (_event, payload) => deleteEventsForPeriod(payload.start, payload.end));
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
  setSetting("autoAwaySensitivity", validateAutoAwaySensitivity(payload?.autoAwaySensitivity));
  updateTray();
  updateAppMenu();
  return currentState();
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
