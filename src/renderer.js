const statusLabel = document.querySelector("#statusLabel");
const workTime = document.querySelector("#workTime");
const pauseTime = document.querySelector("#pauseTime");
const clockTime = document.querySelector("#clockTime");
const startButton = document.querySelector("#startButton");
const pauseButton = document.querySelector("#pauseButton");
const resumeButton = document.querySelector("#resumeButton");
const stopButton = document.querySelector("#stopButton");
const quickReasons = document.querySelector("#quickReasons");
const noteInput = document.querySelector("#noteInput");
const eventList = document.querySelector("#eventList");
const exportButton = document.querySelector("#exportButton");
const settingsButton = document.querySelector("#settingsButton");
const settingsDialog = document.querySelector("#settingsDialog");
const categoryInput = document.querySelector("#categoryInput");
const addCategoryButton = document.querySelector("#addCategoryButton");
const categoryList = document.querySelector("#categoryList");
const timerTab = document.querySelector("#timerTab");
const statsTab = document.querySelector("#statsTab");
const historyTab = document.querySelector("#historyTab");
const themeButton = document.querySelector("#themeButton");
const timerPage = document.querySelector("#timerPage");
const statsPage = document.querySelector("#statsPage");
const historyPage = document.querySelector("#historyPage");
const dailyStats = document.querySelector("#dailyStats");
const weeklyStats = document.querySelector("#weeklyStats");
const monthlyStats = document.querySelector("#monthlyStats");
const dayTimelineChart = document.querySelector("#dayTimelineChart");
const statsTimezoneLabel = document.querySelector("#statsTimezoneLabel");
const statsStartDate = document.querySelector("#statsStartDate");
const statsEndDate = document.querySelector("#statsEndDate");
const statsStartTime = document.querySelector("#statsStartTime");
const statsEndTime = document.querySelector("#statsEndTime");
const timezoneSelect = document.querySelector("#timezoneSelect");
const saveSettingsButton = document.querySelector("#saveSettingsButton");
const historyDaySelect = document.querySelector("#historyDaySelect");
const historyDateLabel = document.querySelector("#historyDateLabel");
const historyEvents = document.querySelector("#historyEvents");
const historySegments = document.querySelector("#historySegments");
const deleteDayButton = document.querySelector("#deleteDayButton");

let state;
let stats;
let history;
const trackerApi = createTrackerApi();
const themes = [
  { id: "light", label: "Light" },
  { id: "night", label: "Night" },
  { id: "forest", label: "Forest" },
  { id: "sunrise", label: "Sunrise" }
];
const fallbackTimeZones = [
  "UTC",
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney"
];
const statsRangeStorageKey = "workday-stats-range";

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: state?.settings?.timeZone,
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDateLabel(dayKey, options = {}) {
  const [year, month, day] = String(dayKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    weekday: options.weekday ?? "long",
    month: options.month ?? "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatPeriodLabel(key) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return formatDateLabel(key);
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [year, month] = key.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", month: "long", year: "numeric" })
      .format(new Date(Date.UTC(year, month - 1, 1, 12)));
  }
  return key;
}

function formatShortDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function formatInputDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function minutesFromTimeInput(value, fallback) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return (hours * 60) + minutes;
}

function timeInputFromMinutes(minutes) {
  const clamped = Math.max(0, Math.min(1439, Number(minutes) || 0));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function defaultStatsRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 6);
  return {
    startDay: formatInputDate(start),
    endDay: formatInputDate(end),
    startMinute: 6 * 60,
    endMinute: 20 * 60
  };
}

function readStatsRange() {
  const defaults = defaultStatsRange();
  try {
    const saved = JSON.parse(localStorage.getItem(statsRangeStorageKey) || "{}");
    return {
      startDay: /^\d{4}-\d{2}-\d{2}$/.test(saved.startDay) ? saved.startDay : defaults.startDay,
      endDay: /^\d{4}-\d{2}-\d{2}$/.test(saved.endDay) ? saved.endDay : defaults.endDay,
      startMinute: Number.isFinite(saved.startMinute) ? saved.startMinute : defaults.startMinute,
      endMinute: Number.isFinite(saved.endMinute) ? saved.endMinute : defaults.endMinute
    };
  } catch {
    return defaults;
  }
}

function writeStatsRange(range) {
  localStorage.setItem(statsRangeStorageKey, JSON.stringify(range));
}

function syncStatsRangeControls(range = readStatsRange()) {
  statsStartDate.value = range.startDay;
  statsEndDate.value = range.endDay;
  statsStartTime.value = timeInputFromMinutes(range.startMinute);
  statsEndTime.value = timeInputFromMinutes(range.endMinute);
}

function rangeFromStatsControls() {
  const defaults = defaultStatsRange();
  const range = {
    startDay: statsStartDate.value || defaults.startDay,
    endDay: statsEndDate.value || defaults.endDay,
    startMinute: minutesFromTimeInput(statsStartTime.value, defaults.startMinute),
    endMinute: minutesFromTimeInput(statsEndTime.value, defaults.endMinute)
  };
  if (range.endDay < range.startDay) {
    [range.startDay, range.endDay] = [range.endDay, range.startDay];
  }
  if (range.endMinute <= range.startMinute) {
    range.endMinute = Math.min(1440, range.startMinute + 60);
  }
  writeStatsRange(range);
  return range;
}

async function refreshStats() {
  stats = await trackerApi.getStats(rangeFromStatsControls());
  renderStats();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function labelForStatus(status) {
  if (status === "working") return "Recording Work";
  if (status === "paused") return "Paused";
  if (status === "stopped") return "Day Ended";
  return "Ready";
}

function refreshComputedTime() {
  if (!state) return;
  const freshTotals = { ...state.totals };
  const latest = state.events.at(-1);
  if (latest && latest.type !== "stop") {
    const elapsed = Date.now() - new Date(latest.occurredAt).getTime();
    if (latest.type === "start" || latest.type === "resume") freshTotals.workMs += elapsed;
    if (latest.type === "pause") freshTotals.pauseMs += elapsed;
  }
  workTime.textContent = formatDuration(freshTotals.workMs);
  pauseTime.textContent = formatDuration(freshTotals.pauseMs);
  clockTime.textContent = new Intl.DateTimeFormat(undefined, {
    timeZone: state.settings?.timeZone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());
}

function render() {
  statusLabel.textContent = labelForStatus(state.status);
  document.body.dataset.status = state.status;

  startButton.disabled = state.status === "working" || state.status === "paused";
  pauseButton.disabled = state.status !== "working";
  resumeButton.disabled = state.status !== "paused";
  stopButton.disabled = state.status === "idle" || state.status === "stopped";

  quickReasons.innerHTML = state.categories
    .map((category) => {
      const name = escapeHtml(category.name);
      return `<button class="reason-button" type="button" data-reason="${name}">${name}</button>`;
    })
    .join("");

  categoryList.innerHTML = state.categories
    .map((category) => `
      <div class="category-pill">
        <span>${escapeHtml(category.name)}</span>
        <button class="category-delete" type="button" data-category-id="${category.id}" data-category-name="${escapeHtml(category.name)}" title="Delete ${escapeHtml(category.name)}" aria-label="Delete ${escapeHtml(category.name)}">×</button>
      </div>
    `)
    .join("");

  eventList.innerHTML = state.events.length
    ? state.events.slice().reverse().map((event) => {
      const reason = event.reason ? ` · ${event.reason}` : "";
      const note = event.note ? `<small>${escapeHtml(event.note)}</small>` : "";
      return `
        <article class="event-row">
          <div>
            <strong>${escapeHtml(event.type)}</strong>
            <span>${formatTime(event.occurredAt)}${escapeHtml(reason)}</span>
          </div>
          ${note}
        </article>
      `;
    }).join("")
    : `<p class="empty-state">No time recorded today.</p>`;

  refreshComputedTime();
  renderSettings();
  renderThemeButton();
}

async function loadState() {
  state = await trackerApi.getState();
  syncStatsRangeControls();
  stats = await trackerApi.getStats(rangeFromStatsControls());
  history = await trackerApi.getHistory();
  render();
  renderStats();
  renderHistory();
}

async function addEvent(type, reason = "") {
  const payload = {
    type,
    reason: type === "pause" || type === "stop" ? reason : "",
    note: noteInput.value.trim()
  };
  state = await trackerApi.addEvent(payload);
  stats = await trackerApi.getStats(rangeFromStatsControls());
  history = await trackerApi.getHistory();
  noteInput.value = "";
  render();
  renderStats();
  renderHistory();
}

startButton.addEventListener("click", () => addEvent("start"));
pauseButton.addEventListener("click", () => addEvent("pause", "Other"));
resumeButton.addEventListener("click", () => addEvent("resume"));
stopButton.addEventListener("click", () => addEvent("stop"));

quickReasons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-reason]");
  if (!button || state.status !== "working") return;
  addEvent("pause", button.dataset.reason);
});

exportButton.addEventListener("click", async () => {
  await trackerApi.exportToday();
});

settingsButton.addEventListener("click", () => {
  renderSettings();
  settingsDialog.showModal();
});

addCategoryButton.addEventListener("click", async () => {
  const name = categoryInput.value.trim();
  if (!name) return;
  state = await trackerApi.addCategory(name);
  stats = await trackerApi.getStats(rangeFromStatsControls());
  history = await trackerApi.getHistory(history?.selectedDay);
  categoryInput.value = "";
  render();
  renderStats();
  renderHistory();
});

categoryList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-category-id]");
  if (!button) return;
  const name = button.dataset.categoryName || "this category";
  if (!confirm(`Delete "${name}" from pause categories?`)) return;
  state = await trackerApi.deleteCategory(Number(button.dataset.categoryId));
  stats = await trackerApi.getStats(rangeFromStatsControls());
  history = await trackerApi.getHistory(history?.selectedDay);
  render();
  renderStats();
  renderHistory();
});

timerTab.addEventListener("click", () => showPage("timer"));
statsTab.addEventListener("click", async () => {
  await refreshStats();
  showPage("stats");
});
historyTab.addEventListener("click", async () => {
  history = await trackerApi.getHistory(history?.selectedDay);
  renderHistory();
  showPage("history");
});
themeButton.addEventListener("click", cycleTheme);
saveSettingsButton.addEventListener("click", async () => {
  state = await trackerApi.updateSettings({ timeZone: timezoneSelect.value });
  stats = await trackerApi.getStats(rangeFromStatsControls());
  history = await trackerApi.getHistory();
  render();
  renderStats();
  renderHistory();
});

for (const input of [statsStartDate, statsEndDate, statsStartTime, statsEndTime]) {
  input.addEventListener("change", refreshStats);
}

historyDaySelect.addEventListener("change", async () => {
  history = await trackerApi.getHistory(historyDaySelect.value);
  renderHistory();
});

historyEvents.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-event-id]");
  if (!button) return;
  if (!confirm("Delete this entry? This recalculates the affected periods.")) return;
  state = await trackerApi.deleteEvent(Number(button.dataset.deleteEventId));
  stats = await trackerApi.getStats(rangeFromStatsControls());
  history = await trackerApi.getHistory(history?.selectedDay);
  render();
  renderStats();
  renderHistory();
});

historySegments.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-period-start]");
  if (!button) return;
  if (!confirm("Delete this time period and its boundary entries?")) return;
  state = await trackerApi.deletePeriod({
    start: button.dataset.deletePeriodStart,
    end: button.dataset.deletePeriodEnd
  });
  stats = await trackerApi.getStats(rangeFromStatsControls());
  history = await trackerApi.getHistory(history?.selectedDay);
  render();
  renderStats();
  renderHistory();
});

deleteDayButton.addEventListener("click", async () => {
  const dayKey = history?.selectedDay;
  if (!dayKey) return;
  if (!confirm(`Delete all entries for ${formatDateLabel(dayKey)}?`)) return;
  state = await trackerApi.deleteDay(dayKey);
  stats = await trackerApi.getStats(rangeFromStatsControls());
  history = await trackerApi.getHistory();
  render();
  renderStats();
  renderHistory();
});

function showPage(page) {
  const showingStats = page === "stats";
  const showingHistory = page === "history";
  timerPage.classList.toggle("hidden", showingStats || showingHistory);
  statsPage.classList.toggle("hidden", !showingStats);
  historyPage.classList.toggle("hidden", !showingHistory);
  timerTab.classList.toggle("active", !showingStats && !showingHistory);
  statsTab.classList.toggle("active", showingStats);
  historyTab.classList.toggle("active", showingHistory);
}

function renderStats() {
  if (!stats) return;
  renderDayTimeline();
  dailyStats.innerHTML = stats.days.length ? stats.days.map(renderStatsCard).join("") : emptyStats();
  weeklyStats.innerHTML = stats.weeks.length ? stats.weeks.map(renderStatsCard).join("") : emptyStats();
  monthlyStats.innerHTML = stats.months.length ? stats.months.map(renderStatsCard).join("") : emptyStats();
}

function renderDayTimeline() {
  const chart = stats.chart;
  if (!chart || !chart.days?.length) {
    statsTimezoneLabel.textContent = state?.settings?.timeZone ? `Timezone: ${state.settings.timeZone}` : "";
    dayTimelineChart.innerHTML = emptyStats();
    return;
  }

  statsTimezoneLabel.textContent = `Timezone: ${chart.timeZone}`;
  syncStatsRangeControls(chart.range);
  dayTimelineChart.innerHTML = chart.days.map((day) => {
    const totalWindow = Math.max(1, chart.range.endMinute - chart.range.startMinute);
    const segments = day.segments.map((segment) => {
      const left = ((segment.startMinute - chart.range.startMinute) / totalWindow) * 100;
      const width = Math.max(0.8, ((segment.endMinute - segment.startMinute) / totalWindow) * 100);
      const label = `${segment.type}${segment.reason ? ` · ${segment.reason}` : ""} · ${formatShortDuration(segment.durationMs)}`;
      return `
        <div class="timeline-segment ${segment.type === "pause" ? "pause-segment" : "work-segment"}"
          style="left: ${left}%; width: ${width}%"
          title="${escapeHtml(label)}"
          aria-label="${escapeHtml(label)}"></div>
      `;
    }).join("");

    return `
      <article class="timeline-row">
        <div class="timeline-label">
          <strong>${escapeHtml(formatDateLabel(day.key, { weekday: "short", month: "short" }))}</strong>
          <span>${formatShortDuration(day.workMs)} work · ${formatShortDuration(day.pauseMs)} paused</span>
        </div>
        <div class="timeline-track" role="img" aria-label="${escapeHtml(formatDateLabel(day.key))} timeline">
          ${segments || `<span class="timeline-empty">No tracked time</span>`}
        </div>
      </article>
    `;
  }).join("");
}

function renderStatsCard(item) {
  const totalMs = Math.max(item.totalMs, 1);
  const workPercent = Math.round((item.workMs / totalMs) * 100);
  const pausePercent = Math.max(0, 100 - workPercent);
  const maxCategoryMs = Math.max(...Object.values(item.categories), 1);
  const categoryRows = Object.entries(item.categories)
    .sort((a, b) => b[1] - a[1])
    .map(([name, ms]) => `
      <div class="category-row">
        <div class="category-row-head">
          <span>${escapeHtml(name)}</span>
          <strong>${formatShortDuration(ms)}</strong>
        </div>
        <div class="bar-track" aria-hidden="true">
          <div class="bar-fill category-fill" style="width: ${Math.max(3, Math.round((ms / maxCategoryMs) * 100))}%"></div>
        </div>
      </div>
    `)
    .join("") || `<p class="empty-state">No pause categories yet.</p>`;

  return `
    <article class="stats-card">
      <div class="stats-card-head">
        <h3>${escapeHtml(formatPeriodLabel(item.key))}</h3>
        <span>${formatShortDuration(item.totalMs)} total</span>
      </div>
      <div class="stats-totals">
        <span>Work <strong>${formatShortDuration(item.workMs)}</strong></span>
        <span>Paused <strong>${formatShortDuration(item.pauseMs)}</strong></span>
      </div>
      <div class="stacked-bar" aria-label="Work and pause split">
        <div class="bar-fill work-fill" style="width: ${workPercent}%"></div>
        <div class="bar-fill pause-fill" style="width: ${pausePercent}%"></div>
      </div>
      <div class="category-breakdown">${categoryRows}</div>
    </article>
  `;
}

function emptyStats() {
  return `<p class="empty-state">No tracked time yet.</p>`;
}

function renderSettings() {
  const selected = state?.settings?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const supportedTimeZones = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : fallbackTimeZones;
  const options = Array.from(new Set([selected, ...supportedTimeZones])).map((timeZone) => `
    <option value="${escapeHtml(timeZone)}"${timeZone === selected ? " selected" : ""}>${escapeHtml(timeZone)}</option>
  `).join("");
  timezoneSelect.innerHTML = options;
}

function renderHistory() {
  if (!history) return;
  const days = history.days.length ? history.days : [history.selectedDay];
  historyDaySelect.innerHTML = days.map((dayKey) => `
    <option value="${escapeHtml(dayKey)}"${dayKey === history.selectedDay ? " selected" : ""}>${escapeHtml(formatDateLabel(dayKey))}</option>
  `).join("");
  historyDateLabel.textContent = history.selectedDay ? formatDateLabel(history.selectedDay) : "";
  deleteDayButton.disabled = !history.events.length;

  historyEvents.innerHTML = history.events.length ? history.events.slice().reverse().map((event) => {
    const reason = event.reason ? ` · ${event.reason}` : "";
    const note = event.note ? `<small>${escapeHtml(event.note)}</small>` : "";
    return `
      <article class="event-row history-row">
        <div>
          <strong>${escapeHtml(event.type)}</strong>
          <span>${formatTime(event.occurredAt)}${escapeHtml(reason)}</span>
        </div>
        ${note}
        <button class="danger-button compact-button" type="button" data-delete-event-id="${event.id}">Delete</button>
      </article>
    `;
  }).join("") : `<p class="empty-state">No entries for this day.</p>`;

  historySegments.innerHTML = history.segments.length ? history.segments.slice().reverse().map((segment) => {
    const reason = segment.reason ? ` · ${segment.reason}` : "";
    return `
      <article class="event-row history-row">
        <div>
          <strong>${escapeHtml(segment.type)}</strong>
          <span>${formatTime(segment.start)} - ${formatTime(segment.end)} · ${formatShortDuration(segment.durationMinutes * 60000)}${escapeHtml(reason)}</span>
        </div>
        ${segment.note ? `<small>${escapeHtml(segment.note)}</small>` : ""}
        <button class="danger-button compact-button" type="button" data-delete-period-start="${escapeHtml(segment.start)}" data-delete-period-end="${escapeHtml(segment.end)}">Delete Period</button>
      </article>
    `;
  }).join("") : `<p class="empty-state">No time periods for this day.</p>`;
}

function currentTheme() {
  return localStorage.getItem("workday-theme") || "light";
}

function applyTheme(theme) {
  const selected = themes.some((item) => item.id === theme) ? theme : "light";
  document.documentElement.dataset.theme = selected;
  localStorage.setItem("workday-theme", selected);
  renderThemeButton();
}

function cycleTheme() {
  const currentIndex = themes.findIndex((theme) => theme.id === currentTheme());
  const next = themes[(currentIndex + 1) % themes.length];
  applyTheme(next.id);
}

function renderThemeButton() {
  const theme = themes.find((item) => item.id === currentTheme()) || themes[0];
  themeButton.textContent = theme.label;
}

trackerApi.onNavigate(async (page) => {
  if (page === "stats") {
    await refreshStats();
  }
  if (page === "history") {
    history = await trackerApi.getHistory(history?.selectedDay);
    renderHistory();
  }
  showPage(page);
});
trackerApi.onCycleTheme(cycleTheme);

function createTrackerApi() {
  if (window.tracker) return window.tracker;
  const invoke = window.__TAURI__?.core?.invoke;
  const listen = window.__TAURI__?.event?.listen;
  if (!invoke) {
    throw new Error("No desktop runtime API is available");
  }
  return {
    getState: () => invoke("get_state"),
    getStats: () => invoke("get_stats"),
    getHistory: (dayKey) => invoke("get_history", { dayKey }),
    addEvent: (payload) => invoke("add_event", {
      eventType: payload.type,
      reason: payload.reason || null,
      note: payload.note || null
    }),
    deleteEvent: (id) => invoke("delete_event", { id }),
    deleteDay: (dayKey) => invoke("delete_day", { dayKey }),
    deletePeriod: (payload) => invoke("delete_period", { start: payload.start, end: payload.end }),
    addCategory: (name) => invoke("add_category", { name }),
    deleteCategory: (id) => invoke("delete_category", { id }),
    updateSettings: (payload) => invoke("update_settings", { timeZone: payload.timeZone }),
    exportToday: async () => {
      const filePath = await invoke("export_today");
      if (filePath) alert(`Exported workbook:\n${filePath}`);
      return filePath;
    },
    onNavigate: (callback) => {
      if (listen) listen("menu:navigate", (event) => callback(event.payload));
    },
    onCycleTheme: (callback) => {
      if (listen) listen("menu:cycle-theme", callback);
      if (listen) listen("menu:help", () => {
        alert("Use Start Work to begin tracking. Use pause category buttons or the Timer menu to pause with a reason. Stats show daily, weekly, and monthly totals. Export XLSX creates separate workbook sheets for raw segments and summary stats.");
      });
    }
  };
}

applyTheme(currentTheme());
setInterval(refreshComputedTime, 1000);
loadState();
