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
const activeProjectSelect = document.querySelector("#activeProjectSelect");
const categoryInput = document.querySelector("#categoryInput");
const addCategoryButton = document.querySelector("#addCategoryButton");
const categoryList = document.querySelector("#categoryList");
const projectInput = document.querySelector("#projectInput");
const projectColorInput = document.querySelector("#projectColorInput");
const addProjectButton = document.querySelector("#addProjectButton");
const projectList = document.querySelector("#projectList");
const timerTab = document.querySelector("#timerTab");
const statsTab = document.querySelector("#statsTab");
const historyTab = document.querySelector("#historyTab");
const themeButton = document.querySelector("#themeButton");
const timerPage = document.querySelector("#timerPage");
const statsPage = document.querySelector("#statsPage");
const historyPage = document.querySelector("#historyPage");
const movementTab = document.querySelector("#movementTab");
const movementPage = document.querySelector("#movementPage");
const movementCards = document.querySelector("#movementCards");
const movementInsights = document.querySelector("#movementInsights");
const movementTimeline = document.querySelector("#movementTimeline");
const movementStartDate = document.querySelector("#movementStartDate");
const movementEndDate = document.querySelector("#movementEndDate");
const movementStartTime = document.querySelector("#movementStartTime");
const movementEndTime = document.querySelector("#movementEndTime");
const movementProjectFilter = document.querySelector("#movementProjectFilter");
const dailyStats = document.querySelector("#dailyStats");
const weeklyStats = document.querySelector("#weeklyStats");
const monthlyStats = document.querySelector("#monthlyStats");
const dayTimelineChart = document.querySelector("#dayTimelineChart");
const statsTimezoneLabel = document.querySelector("#statsTimezoneLabel");
const statsStartDate = document.querySelector("#statsStartDate");
const statsEndDate = document.querySelector("#statsEndDate");
const statsStartTime = document.querySelector("#statsStartTime");
const statsEndTime = document.querySelector("#statsEndTime");
const statsProjectFilter = document.querySelector("#statsProjectFilter");
const timezoneSelect = document.querySelector("#timezoneSelect");
const saveSettingsButton = document.querySelector("#saveSettingsButton");
const autoAwayEnabled = document.querySelector("#autoAwayEnabled");
const autoAwaySeconds = document.querySelector("#autoAwaySeconds");
const autoAwayPresentSeconds = document.querySelector("#autoAwayPresentSeconds");
const autoAwaySensitivity = document.querySelector("#autoAwaySensitivity");
const cameraMovementEnabled = document.querySelector("#cameraMovementEnabled");
const visionStatus = document.querySelector("#visionStatus");
const visionStatusLabel = document.querySelector("#visionStatusLabel");
const visionStatusMetric = document.querySelector("#visionStatusMetric");
const cameraToggle = document.querySelector("#cameraToggle");
const historyDaySelect = document.querySelector("#historyDaySelect");
const historyDateLabel = document.querySelector("#historyDateLabel");
const historyEvents = document.querySelector("#historyEvents");
const historySegments = document.querySelector("#historySegments");
const deleteDayButton = document.querySelector("#deleteDayButton");

let state;
let stats;
let history;
let movement;
let settingsSnapshot = null;
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
const movementRangeStorageKey = "workday-movement-range";
const statsProjectFilterStorageKey = "workday-stats-project-filter";
const movementProjectFilterStorageKey = "workday-movement-project-filter";
const AUTO_AWAY_REASON = "Auto-away";
const autoAwaySampleMs = 1000;
const autoAwayProfiles = {
  relaxed: { minConfidence: 0.4, minWidthRatio: 0.16, minAreaRatio: 0.025, minSuppressionThreshold: 0.3 },
  normal: { minConfidence: 0.5, minWidthRatio: 0.16, minAreaRatio: 0.025, minSuppressionThreshold: 0.3 },
  strict: { minConfidence: 0.6, minWidthRatio: 0.2, minAreaRatio: 0.04, minSuppressionThreshold: 0.3 }
};
const autoAwayState = {
  landmarker: null,
  detector: null,
  detectorSensitivity: null,
  initializing: false,
  lastFaceAt: 0,
  lastFaceConfidence: 0,
  lastFaceWidthRatio: 0,
  lastPresenceMetric: null,
  lastPresenceTitle: "",
  missingSince: null,
  presentSince: null,
  isPaused: false,
  cameraSuspended: false,
  module: null,
  scanTimer: null,
  stream: null,
  video: null
};

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

function formatHourTick(minute) {
  const clamped = Math.max(0, Math.min(1440, Number(minute) || 0));
  const hour = Math.floor((clamped % 1440) / 60);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour} ${suffix}`;
}

function timelineHourTicks(range) {
  const startMinute = range.startMinute;
  const endMinute = range.endMinute;
  const totalWindow = Math.max(1, endMinute - startMinute);
  const step = totalWindow <= 6 * 60
    ? 60
    : totalWindow <= 12 * 60
      ? 120
      : totalWindow <= 18 * 60
        ? 180
        : 240;
  const ticks = [startMinute];
  let next = Math.ceil(startMinute / step) * step;
  if (next === startMinute) next += step;
  while (next < endMinute) {
    ticks.push(next);
    next += step;
  }
  ticks.push(endMinute);
  return [...new Set(ticks)].map((minute) => ({
    minute,
    label: formatHourTick(minute),
    percent: ((minute - startMinute) / totalWindow) * 100
  }));
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
  syncStatsProjectFilter();
}

function activeProjects() {
  const selectedId = state?.activeProjectId;
  return (state?.projects || []).filter((project) => !project.isArchived || project.id === selectedId);
}

function projectOptions(selectedId, includeAll = false, includeArchived = false) {
  const available = includeArchived ? (state?.projects || []) : activeProjects();
  const options = includeAll ? [`<option value="all">All Projects</option>`] : [];
  options.push(...available.map((project) => `
    <option value="${project.id}"${Number(selectedId) === project.id ? " selected" : ""}>
      ${escapeHtml(project.name)}${project.isArchived ? " (Archived)" : ""}
    </option>
  `));
  return options.join("");
}

function syncStatsProjectFilter() {
  if (!statsProjectFilter) return;
  const saved = localStorage.getItem(statsProjectFilterStorageKey) || "all";
  const selected = stats?.selectedProjectId ? String(stats.selectedProjectId) : saved;
  statsProjectFilter.innerHTML = projectOptions(selected === "all" ? null : Number(selected), true, true);
  statsProjectFilter.value = selected !== "all" && (state?.projects || []).some((project) => String(project.id) === selected)
    ? selected
    : "all";
}

function rangeFromStatsControls() {
  const defaults = defaultStatsRange();
  const projectId = statsProjectFilter?.value && statsProjectFilter.value !== "all"
    ? Number(statsProjectFilter.value)
    : null;
  const range = {
    startDay: statsStartDate.value || defaults.startDay,
    endDay: statsEndDate.value || defaults.endDay,
    startMinute: minutesFromTimeInput(statsStartTime.value, defaults.startMinute),
    endMinute: minutesFromTimeInput(statsEndTime.value, defaults.endMinute),
    projectId: Number.isInteger(projectId) ? projectId : null
  };
  if (range.endDay < range.startDay) {
    [range.startDay, range.endDay] = [range.endDay, range.startDay];
  }
  if (range.endMinute <= range.startMinute) {
    range.endMinute = Math.min(1440, range.startMinute + 60);
  }
  writeStatsRange(range);
  localStorage.setItem(statsProjectFilterStorageKey, range.projectId ? String(range.projectId) : "all");
  return range;
}

async function refreshStats() {
  stats = await trackerApi.getStats(rangeFromStatsControls());
  renderStats();
}

function defaultMovementRange() {
  const today = formatInputDate(new Date());
  return {
    startDay: today,
    endDay: today,
    startMinute: 6 * 60,
    endMinute: 20 * 60
  };
}

function readMovementRange() {
  const defaults = defaultMovementRange();
  try {
    const saved = JSON.parse(localStorage.getItem(movementRangeStorageKey) || "{}");
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

function writeMovementRange(range) {
  localStorage.setItem(movementRangeStorageKey, JSON.stringify(range));
}

function syncMovementRangeControls(range = readMovementRange()) {
  movementStartDate.value = range.startDay;
  movementEndDate.value = range.endDay;
  movementStartTime.value = timeInputFromMinutes(range.startMinute);
  movementEndTime.value = timeInputFromMinutes(range.endMinute);
  syncMovementProjectFilter();
}

function syncMovementProjectFilter() {
  if (!movementProjectFilter) return;
  const saved = localStorage.getItem(movementProjectFilterStorageKey) || "all";
  const selected = movement?.selectedProjectId ? String(movement.selectedProjectId) : saved;
  movementProjectFilter.innerHTML = projectOptions(selected === "all" ? null : Number(selected), true, true);
  movementProjectFilter.value = selected !== "all" && (state?.projects || []).some((project) => String(project.id) === selected)
    ? selected
    : "all";
}

function rangeFromMovementControls() {
  const defaults = defaultMovementRange();
  const projectId = movementProjectFilter?.value && movementProjectFilter.value !== "all"
    ? Number(movementProjectFilter.value)
    : null;
  const range = {
    startDay: movementStartDate.value || defaults.startDay,
    endDay: movementEndDate.value || defaults.endDay,
    startMinute: minutesFromTimeInput(movementStartTime.value, defaults.startMinute),
    endMinute: minutesFromTimeInput(movementEndTime.value, defaults.endMinute),
    projectId: Number.isInteger(projectId) ? projectId : null
  };
  if (range.endDay < range.startDay) {
    [range.startDay, range.endDay] = [range.endDay, range.startDay];
  }
  if (range.endMinute <= range.startMinute) {
    range.endMinute = Math.min(1440, range.startMinute + 60);
  }
  writeMovementRange(range);
  localStorage.setItem(movementProjectFilterStorageKey, range.projectId ? String(range.projectId) : "all");
  return range;
}

async function refreshMovement() {
  try {
    movement = await trackerApi.getMovement(rangeFromMovementControls());
  } catch (err) {
    console.error("Failed to load movement data", err);
    movement = { error: err?.message || "Movement data failed to load", minutes: [], events: [], workSegments: [] };
  }
  renderMovement();
}

async function loadMovementForCurrentRange() {
  try {
    return await trackerApi.getMovement(rangeFromMovementControls());
  } catch (err) {
    console.error("Failed to load movement data", err);
    return { error: err?.message || "Movement data failed to load", minutes: [], events: [], workSegments: [] };
  }
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
  activeProjectSelect.innerHTML = projectOptions(state.activeProjectId, false, false);
  if (state.activeProjectId) activeProjectSelect.value = String(state.activeProjectId);

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
  projectList.innerHTML = (state.projects || [])
    .map((project) => `
      <div class="project-row ${project.isArchived ? "is-archived" : ""}" data-project-row="${project.id}">
        <span class="project-swatch" style="background:${escapeHtml(project.color)}"></span>
        <input class="project-name-input" type="text" value="${escapeHtml(project.name)}" data-project-name="${project.id}" aria-label="Project name">
        <input class="project-color-input" type="color" value="${escapeHtml(project.color)}" data-project-color="${project.id}" aria-label="Project color">
        <button class="compact-button" type="button" data-project-save="${project.id}">Save</button>
        <button class="compact-button" type="button" data-project-archive="${project.id}" data-project-archived="${project.isArchived ? "1" : "0"}">${project.isArchived ? "Restore" : "Archive"}</button>
      </div>
    `)
    .join("");

  eventList.innerHTML = state.events.length
    ? state.events.slice().reverse().map((event) => {
      const reason = event.reason ? ` · ${event.reason}` : "";
      const project = event.projectName ? ` · ${event.projectName}` : "";
      const note = event.note ? `<small>${escapeHtml(event.note)}</small>` : "";
      return `
        <article class="event-row">
          <div>
            <strong>${escapeHtml(event.type)}</strong>
            <span>${formatTime(event.occurredAt)}${escapeHtml(project)}${escapeHtml(reason)}</span>
          </div>
          ${note}
        </article>
      `;
    }).join("")
    : `<p class="empty-state">No time recorded today.</p>`;

  refreshComputedTime();
  renderSettings();
  renderThemeButton();
  syncAutoAwayMonitor();
}

async function loadState() {
  state = await trackerApi.getState();
  syncStatsRangeControls();
  syncMovementRangeControls();
  stats = await trackerApi.getStats(rangeFromStatsControls());
  movement = null;
  history = await trackerApi.getHistory();
  render();
  renderStats();
  renderHistory();
}

async function addEvent(type, reason = "") {
  const payload = {
    type,
    reason: type === "pause" || type === "stop" ? reason : "",
    note: noteInput.value.trim(),
    projectId: type === "start" || type === "resume" ? Number(activeProjectSelect.value) : null
  };
  state = await trackerApi.addEvent(payload);
  stats = await trackerApi.getStats(rangeFromStatsControls());
  history = await trackerApi.getHistory();
  noteInput.value = "";
  render();
  renderStats();
  renderHistory();
}

async function refreshAfterProjectChange(selectedDay = history?.selectedDay) {
  stats = await trackerApi.getStats(rangeFromStatsControls());
  history = await trackerApi.getHistory(selectedDay);
  render();
  renderStats();
  renderHistory();
}

async function addAutoAwayPause() {
  const latest = await trackerApi.getState();
  if (latest.status !== "working") {
    state = latest;
    render();
    return;
  }
  state = await trackerApi.addEvent({
    type: "pause",
    reason: AUTO_AWAY_REASON,
    note: ""
  });
  stats = await trackerApi.getStats(rangeFromStatsControls());
  history = await trackerApi.getHistory(history?.selectedDay);
  render();
  renderStats();
  renderHistory();
}

async function resumeFromAutoAway() {
  const latest = await trackerApi.getState();
  if (latest.status !== "paused") {
    state = latest;
    render();
    return;
  }
  state = await trackerApi.addEvent({
    type: "resume",
    reason: "",
    note: ""
  });
  stats = await trackerApi.getStats(rangeFromStatsControls());
  history = await trackerApi.getHistory(history?.selectedDay);
  render();
  renderStats();
  renderHistory();
}

startButton.addEventListener("click", () => addEvent("start"));
pauseButton.addEventListener("click", () => addEvent("pause", "Other"));
resumeButton.addEventListener("click", () => addEvent("resume"));
stopButton.addEventListener("click", () => addEvent("stop"));

cameraToggle.addEventListener("click", () => {
  autoAwayState.cameraSuspended = !autoAwayState.cameraSuspended;
  syncAutoAwayMonitor();
});

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

activeProjectSelect.addEventListener("change", async () => {
  const projectId = Number(activeProjectSelect.value);
  if (!Number.isInteger(projectId)) return;
  state = state.status === "working"
    ? await trackerApi.switchProject(projectId)
    : await trackerApi.setActiveProject(projectId);
  await refreshAfterProjectChange();
});

addProjectButton.addEventListener("click", async () => {
  await addProjectFromSettings();
});

async function addProjectFromSettings() {
  const name = projectInput.value.trim();
  if (!name) return;
  state = await trackerApi.addProject({ name, color: projectColorInput.value });
  projectInput.value = "";
  await refreshAfterProjectChange();
}

projectInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  await addProjectFromSettings();
});

projectList.addEventListener("click", async (event) => {
  const saveButton = event.target.closest("[data-project-save]");
  const archiveButton = event.target.closest("[data-project-archive]");
  const id = Number(saveButton?.dataset.projectSave || archiveButton?.dataset.projectArchive);
  if (!Number.isInteger(id)) return;
  const project = (state.projects || []).find((item) => item.id === id);
  if (!project) return;
  const row = event.target.closest("[data-project-row]");
  if (saveButton) {
    const name = row.querySelector("[data-project-name]")?.value?.trim() || project.name;
    const color = row.querySelector("[data-project-color]")?.value || project.color;
    state = await trackerApi.updateProject({ id, name, color, isArchived: project.isArchived });
  }
  if (archiveButton) {
    state = await trackerApi.updateProject({
      id,
      name: project.name,
      color: project.color,
      isArchived: !project.isArchived
    });
  }
  await refreshAfterProjectChange();
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
movementTab.addEventListener("click", async () => {
  if (!state?.settings?.cameraMovementEnabled) {
    showPage("timer");
    return;
  }
  movement = null;
  showPage("movement");
  await refreshMovement();
});
themeButton.addEventListener("click", cycleTheme);
saveSettingsButton.addEventListener("click", async () => {
  if (!settingsAreDirty()) return;
  state = await trackerApi.updateSettings({
    timeZone: timezoneSelect.value,
    autoAwayEnabled: autoAwayEnabled.checked,
    autoAwaySeconds: Number(autoAwaySeconds.value),
    autoAwayPresentSeconds: Number(autoAwayPresentSeconds.value),
    autoAwaySensitivity: autoAwaySensitivity.value,
    cameraMovementEnabled: cameraMovementEnabled.checked
  });
  stats = await trackerApi.getStats(rangeFromStatsControls());
  history = await trackerApi.getHistory();
  render();
  renderStats();
  renderHistory();
  if (!state?.settings?.cameraMovementEnabled) showPage("timer");
});

for (const input of [
  timezoneSelect,
  autoAwayEnabled,
  autoAwaySeconds,
  autoAwayPresentSeconds,
  autoAwaySensitivity,
  cameraMovementEnabled
]) {
  input.addEventListener("input", updateSettingsSaveState);
  input.addEventListener("change", updateSettingsSaveState);
}

for (const input of [statsStartDate, statsEndDate, statsStartTime, statsEndTime]) {
  input.addEventListener("change", refreshStats);
}

statsProjectFilter.addEventListener("change", refreshStats);

for (const input of [movementStartDate, movementEndDate, movementStartTime, movementEndTime]) {
  input.addEventListener("change", refreshMovement);
}

movementProjectFilter.addEventListener("change", refreshMovement);

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

historySegments.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-reassign-segment]");
  if (!select) return;
  if (!select.value) return;
  const sourceEventId = Number(select.dataset.reassignSegment);
  const projectId = Number(select.value);
  if (!Number.isInteger(sourceEventId) || !Number.isInteger(projectId)) return;
  state = await trackerApi.reassignSegmentProject({ sourceEventId, projectId });
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
  const selectedPage = page === "movement" && !state?.settings?.cameraMovementEnabled ? "timer" : page;
  const showingStats = selectedPage === "stats";
  const showingHistory = selectedPage === "history";
  const showingMovement = selectedPage === "movement";
  timerPage.classList.toggle("hidden", showingStats || showingHistory || showingMovement);
  statsPage.classList.toggle("hidden", !showingStats);
  historyPage.classList.toggle("hidden", !showingHistory);
  movementPage.classList.toggle("hidden", !showingMovement);
  timerTab.classList.toggle("active", !showingStats && !showingHistory && !showingMovement);
  statsTab.classList.toggle("active", showingStats);
  historyTab.classList.toggle("active", showingHistory);
  movementTab.classList.toggle("active", showingMovement);
  if (showingMovement) renderMovement();
}

function renderStats() {
  if (!stats) return;
  syncStatsProjectFilter();
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
  const totalWindow = Math.max(1, chart.range.endMinute - chart.range.startMinute);
  const ticks = timelineHourTicks(chart.range);
  const gridLines = ticks
    .filter((tick) => tick.percent > 0 && tick.percent < 100)
    .map((tick) => `<span class="timeline-grid-line" style="left: ${tick.percent}%"></span>`)
    .join("");
  const axis = `
    <div class="timeline-axis timeline-row" aria-hidden="true">
      <div class="timeline-axis-spacer"></div>
      <div class="timeline-axis-track">
        ${ticks.map((tick, index) => `
          <span class="timeline-axis-tick ${index === 0 ? "is-start" : ""} ${index === ticks.length - 1 ? "is-end" : ""}"
            style="left: ${tick.percent}%">
            <span>${escapeHtml(tick.label)}</span>
          </span>
        `).join("")}
      </div>
    </div>
  `;
  dayTimelineChart.innerHTML = axis + chart.days.map((day) => {
    const segments = day.segments.map((segment) => {
      const left = ((segment.startMinute - chart.range.startMinute) / totalWindow) * 100;
      const width = Math.max(0.8, ((segment.endMinute - segment.startMinute) / totalWindow) * 100);
      const label = `${segment.type}${segment.projectName ? ` · ${segment.projectName}` : ""}${segment.reason ? ` · ${segment.reason}` : ""} · ${formatShortDuration(segment.durationMs)}`;
      const projectStyle = segment.type === "work" && segment.projectColor
        ? `; background:${escapeHtml(segment.projectColor)}`
        : "";
      return `
        <div class="timeline-segment ${segment.type === "pause" ? "pause-segment" : "work-segment"}"
          style="left: ${left}%; width: ${width}%${projectStyle}"
          ${projectStyle ? `data-project-color="1"` : ""}
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
          <div class="timeline-grid" aria-hidden="true">${gridLines}</div>
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
  const maxProjectMs = Math.max(...Object.values(item.projects || {}), 1);
  const projectRows = Object.entries(item.projects || {})
    .sort((a, b) => b[1] - a[1])
    .map(([name, ms]) => `
      <div class="category-row">
        <div class="category-row-head">
          <span>${escapeHtml(name)}</span>
          <strong>${formatShortDuration(ms)}</strong>
        </div>
        <div class="bar-track" aria-hidden="true">
          <div class="bar-fill work-fill" style="width: ${Math.max(3, Math.round((ms / maxProjectMs) * 100))}%"></div>
        </div>
      </div>
    `)
    .join("") || `<p class="empty-state">No project time yet.</p>`;
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
      <h4 class="stats-subhead">Projects</h4>
      <div class="category-breakdown">${projectRows}</div>
      <h4 class="stats-subhead">Pause Categories</h4>
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
  const settings = normalizedAutoAwaySettings();
  autoAwayEnabled.checked = settings.enabled;
  autoAwaySeconds.value = String(settings.seconds);
  autoAwayPresentSeconds.value = String(settings.presentSeconds);
  autoAwaySensitivity.value = settings.sensitivity;
  cameraMovementEnabled.checked = state?.settings?.cameraMovementEnabled || false;
  settingsSnapshot = readSettingsForm();
  updateSettingsSaveState();
}

function readSettingsForm() {
  return {
    timeZone: timezoneSelect.value,
    autoAwayEnabled: autoAwayEnabled.checked,
    autoAwaySeconds: Number(autoAwaySeconds.value),
    autoAwayPresentSeconds: Number(autoAwayPresentSeconds.value),
    autoAwaySensitivity: autoAwaySensitivity.value,
    cameraMovementEnabled: cameraMovementEnabled.checked
  };
}

function settingsAreDirty() {
  if (!settingsSnapshot) return false;
  const current = readSettingsForm();
  return Object.keys(settingsSnapshot).some((key) => current[key] !== settingsSnapshot[key]);
}

function updateSettingsSaveState() {
  const isDirty = settingsAreDirty();
  saveSettingsButton.disabled = !isDirty;
  saveSettingsButton.textContent = isDirty ? "Save" : "Saved";
}

function normalizedAutoAwaySettings() {
  const settings = state?.settings || {};
  const seconds = [10, 15, 30, 60].includes(Number(settings.autoAwaySeconds))
    ? Number(settings.autoAwaySeconds)
    : 10;
  const presentSeconds = [5, 10, 15, 30].includes(Number(settings.autoAwayPresentSeconds))
    ? Number(settings.autoAwayPresentSeconds)
    : 10;
  const sensitivity = Object.hasOwn(autoAwayProfiles, settings.autoAwaySensitivity)
    ? settings.autoAwaySensitivity
    : "normal";
  return {
    enabled: Boolean(settings.autoAwayEnabled),
    seconds,
    presentSeconds,
    sensitivity
  };
}

function setVisionStatus(label, metric = "", tone = "") {
  if (!visionStatus || !visionStatusLabel || !visionStatusMetric) return;
  if (!label) {
    visionStatus.className = "vision-status hidden";
    visionStatus.removeAttribute("title");
    visionStatus.removeAttribute("aria-label");
    visionStatus.removeAttribute("data-tooltip");
    visionStatusLabel.textContent = "Auto-away";
    setVisionMetric("Off");
    return;
  }
  visionStatus.className = `vision-status ${tone}`.trim();
  visionStatusLabel.textContent = label;
  setVisionMetric(metric);
  const details = visionMetricDescription(metric);
  const title = details ? `${label}: ${details}` : label;
  visionStatus.title = title;
  visionStatus.dataset.tooltip = title;
  visionStatus.setAttribute("aria-label", title);
}

const visionIcons = {
  tracked: `
    <svg class="vision-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 3.5h8a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 14V6A2.5 2.5 0 0 1 6 3.5Z"/>
      <path d="M7.2 8.4h.01M12.8 8.4h.01M7.4 12.1c1.3 1.2 3.9 1.2 5.2 0"/>
      <path d="M2.5 6V3.5H5M15 3.5h2.5V6M17.5 14v2.5H15M5 16.5H2.5V14"/>
    </svg>
  `,
  detected: `
    <svg class="vision-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4.5 7V4.5H7M13 4.5h2.5V7M15.5 13v2.5H13M7 15.5H4.5V13"/>
      <circle cx="10" cy="10" r="2.4"/>
    </svg>
  `,
  none: `
    <svg class="vision-icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="5.2"/>
      <path d="M6.4 6.4 13.6 13.6"/>
      <path d="M8.2 9h.01M11.8 9h.01"/>
    </svg>
  `
};

function setVisionMetric(metric) {
  if (typeof metric === "object" && metric?.icon && metric?.label) {
    const icon = visionIcons[metric.icon] || "";
    visionStatusMetric.classList.remove("hidden");
    visionStatusMetric.innerHTML = `<span class="vision-metric" title="${escapeHtml(metric.title || metric.label)}">${icon}<span>${escapeHtml(metric.label)}</span></span>`;
    return;
  }
  const text = String(metric || "");
  visionStatusMetric.textContent = text;
  visionStatusMetric.classList.toggle("hidden", !text);
}

function visionMetricDescription(metric) {
  if (typeof metric === "object" && metric?.title) return metric.title;
  if (typeof metric === "object" && metric?.label) return metric.label;
  return String(metric || "");
}

function syncAutoAwayMonitor() {
  const settings = normalizedAutoAwaySettings();
  const cameraVisible = settings.enabled;
  cameraToggle.classList.toggle("hidden", !cameraVisible);
  cameraToggle.setAttribute("aria-pressed", autoAwayState.cameraSuspended ? "false" : "true");
  const cameraTooltip = autoAwayState.cameraSuspended
    ? "Camera monitoring is off. Click to resume auto-away detection."
    : "Camera monitoring is on for auto-away. Click to turn it off.";
  cameraToggle.title = cameraTooltip;
  cameraToggle.dataset.tooltip = cameraTooltip;
  cameraToggle.setAttribute("aria-label", cameraTooltip);

  const moveEnabled = state?.settings?.cameraMovementEnabled;
  movementTab.classList.toggle("hidden", !moveEnabled);
  if (!moveEnabled) resetMovementAccumulator();

  if (autoAwayState.cameraSuspended) {
    stopAutoAwayMonitor();
    setVisionStatus("Camera suspended", "Toggle to resume", "hidden");
    return;
  }

  const shouldRun = settings.enabled && (state?.status === "working" || state?.status === "paused");
  if (shouldRun) {
    startAutoAwayMonitor();
    return;
  }
  stopAutoAwayMonitor();
  if (settings.enabled) {
    setVisionStatus("Auto-away ready", "Camera off");
  } else {
    setVisionStatus("");
  }
}

async function loadCameraModel() {
  if (autoAwayState.landmarker) return autoAwayState.landmarker;
  const { FaceLandmarker, FilesetResolver } = await loadVisionModule();
  const wasmBase = new URL("../node_modules/@mediapipe/tasks-vision/wasm/", window.location.href).toString();
  const modelPath = new URL("../assets/models/face_landmarker.task", window.location.href).toString();
  const vision = await FilesetResolver.forVisionTasks(wasmBase);
  autoAwayState.landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelPath,
      delegate: "CPU"
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true
  });
  return autoAwayState.landmarker;
}

async function loadFallbackFaceDetector(settings) {
  const profile = autoAwayProfiles[settings.sensitivity] || autoAwayProfiles.normal;
  if (autoAwayState.detector && autoAwayState.detectorSensitivity === settings.sensitivity) {
    return autoAwayState.detector;
  }
  const { FaceDetector, FilesetResolver } = await loadVisionModule();
  const wasmBase = new URL("../node_modules/@mediapipe/tasks-vision/wasm/", window.location.href).toString();
  const modelPath = new URL("../assets/models/blaze_face_short_range.tflite", window.location.href).toString();
  const vision = await FilesetResolver.forVisionTasks(wasmBase);
  autoAwayState.detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelPath,
      delegate: "CPU"
    },
    runningMode: "VIDEO",
    minDetectionConfidence: profile.minConfidence,
    minSuppressionThreshold: profile.minSuppressionThreshold
  });
  autoAwayState.detectorSensitivity = settings.sensitivity;
  return autoAwayState.detector;
}

async function loadVisionModule() {
  if (!autoAwayState.module) {
    autoAwayState.module = await import("../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs");
  }
  return autoAwayState.module;
}

async function startAutoAwayMonitor() {
  if (autoAwayState.scanTimer || autoAwayState.initializing) return;
  autoAwayState.initializing = true;
  setVisionStatus("Starting camera", "Permission may be needed", "pending");
  try {
    const settings = normalizedAutoAwaySettings();
    await loadCameraModel();
    try {
      await loadFallbackFaceDetector(settings);
    } catch (error) {
      console.error("Fallback face detector setup failed", error);
    }
    await startAutoAwayVideo();
    autoAwayState.lastFaceAt = Date.now();
    autoAwayState.missingSince = null;
    resetMovementAccumulator();
    autoAwayState.scanTimer = setInterval(scanAutoAwayFrame, autoAwaySampleMs);
    await scanAutoAwayFrame();
  } catch (error) {
    console.error("Auto-away camera setup failed", error);
    setVisionStatus("Camera unavailable", "Check permission", "warning");
    stopAutoAwayMonitor();
  } finally {
    autoAwayState.initializing = false;
  }
}

async function startAutoAwayVideo() {
  if (autoAwayState.video && autoAwayState.stream) return;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.width = 640;
  video.height = 480;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 5, max: 10 }
    }
  });
  video.srcObject = stream;
  await video.play();
  autoAwayState.video = video;
  autoAwayState.stream = stream;
}

function stopAutoAwayMonitor() {
  if (autoAwayState.scanTimer) {
    clearInterval(autoAwayState.scanTimer);
    autoAwayState.scanTimer = null;
  }
  if (autoAwayState.stream) {
    for (const track of autoAwayState.stream.getTracks()) {
      track.stop();
    }
  }
  autoAwayState.stream = null;
  autoAwayState.video = null;
  autoAwayState.lastFaceConfidence = 0;
  autoAwayState.lastFaceWidthRatio = 0;
  autoAwayState.missingSince = null;
  resetMovementAccumulator();
}

async function scanAutoAwayFrame() {
  if (!autoAwayState.video || !autoAwayState.landmarker) return;
  if (state?.status !== "working" && state?.status !== "paused") return;
  const video = autoAwayState.video;
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

  const settings = normalizedAutoAwaySettings();
  if (autoAwayState.detectorSensitivity !== settings.sensitivity) {
    try {
      await loadFallbackFaceDetector(settings);
    } catch (err) {
      console.error("Fallback face detector reload error", err);
    }
  }
  let result;
  try {
    result = autoAwayState.landmarker.detectForVideo(video, performance.now());
  } catch (err) {
    console.error("detectForVideo error", err);
    result = null;
  }

  const landmarks = result?.faceLandmarks?.[0];
  const landmarkFace = facePresenceFromLandmarks(landmarks);
  const fallbackFace = landmarkFace ? null : fallbackFacePresenceFromDetector(video, settings);
  const hasFace = landmarkFace || Boolean(fallbackFace);
  const now = Date.now();

  sampleMovement(result, now, settings);

  if (hasFace) {
    autoAwayState.lastFaceAt = now;
    autoAwayState.missingSince = null;
    if (autoAwayState.isPaused) {
      if (!autoAwayState.presentSince) autoAwayState.presentSince = now;
      const presentMs = now - autoAwayState.presentSince;
      const remaining = Math.max(0, Math.ceil((settings.presentSeconds * 1000 - presentMs) / 1000));
      setVisionStatus("Face back", remaining ? `Resumes in ${remaining}s` : "Resuming", "pending");
      if (presentMs >= settings.presentSeconds * 1000) {
        autoAwayState.isPaused = false;
        autoAwayState.presentSince = null;
        await resumeFromAutoAway();
      }
    } else {
      const metric = facePresenceMetric(fallbackFace);
      setVisionStatus("Camera active", metric, "ok");
      if (!state?.settings?.cameraMovementEnabled) {
        const title = fallbackFace
          ? "Camera active: face detected for auto-away; movement tracking is off"
          : "Camera active: face present for auto-away; movement tracking is off";
        visionStatus.title = title;
        visionStatus.dataset.tooltip = title;
        visionStatus.setAttribute("aria-label", title);
      }
    }
    return;
  }

  if (autoAwayState.isPaused) {
    setVisionStatus("No face", { icon: "none", label: "Auto-paused", title: "No face detected" }, "warning");
    return;
  }

  if (!autoAwayState.missingSince) {
    autoAwayState.missingSince = now;
  }
  const missingMs = now - autoAwayState.missingSince;
  const remainingSeconds = Math.max(0, Math.ceil((settings.seconds * 1000 - missingMs) / 1000));
  const noFaceMetric = remainingSeconds
    ? { icon: "none", label: `${remainingSeconds}s`, title: `No face detected. Pauses in ${remainingSeconds}s` }
    : { icon: "none", label: "Pausing", title: "No face detected" };
  setVisionStatus("No face detected", noFaceMetric, "warning");
  if (missingMs >= settings.seconds * 1000) {
    autoAwayState.isPaused = true;
    autoAwayState.missingSince = null;
    await addAutoAwayPause();
  }
}

function facePresenceMetric(fallbackFace) {
  const moveEnabled = state?.settings?.cameraMovementEnabled;
  if (!moveEnabled) {
    return {
      icon: "detected",
      label: "Detected",
      title: fallbackFace
        ? "Face detected by fallback detector; movement tracking is off"
        : "Face detected for auto-away; movement tracking is off"
    };
  }
  if (fallbackFace) {
    return {
      icon: "detected",
      label: "Detected",
      title: "Face detected by fallback detector; movement landmarks are unavailable"
    };
  }
  return {
    icon: "tracked",
    label: "Tracking",
    title: "Face tracked with landmarks; movement metrics are enabled"
  };
}

const MOVEMENT_INTERVAL_MS = 60000;
let movementAccumulator = null;
let movementFlushTimer = null;

function resetMovementAccumulator() {
  movementAccumulator = null;
  if (movementFlushTimer) clearInterval(movementFlushTimer);
  movementFlushTimer = null;
}

function ensureMovementAccumulator() {
  if (state?.status !== "working") {
    if (movementAccumulator && !movementFlushTimer) {
      flushMovementMinute();
    }
    resetMovementAccumulator();
    return;
  }
  const moveEnabled = state?.settings?.cameraMovementEnabled;
  if (!moveEnabled) {
    resetMovementAccumulator();
    return;
  }
  if (!movementAccumulator) {
    movementAccumulator = {
      sessionStart: new Date().toISOString(),
      minuteStart: new Date().toISOString(),
      samples: [],
      baseline: null
    };
    movementFlushTimer = setInterval(flushMovementMinute, MOVEMENT_INTERVAL_MS);
  }
}

function sampleMovement(result, now, settings) {
  ensureMovementAccumulator();
  if (!movementAccumulator) return;

  const landmarks = result?.faceLandmarks?.[0];
  const hasFace = !!(landmarks && landmarks.length >= 100);
  const blendshapes = result?.faceBlendshapes?.[0]?.categories || [];
  const matrixData = result?.facialTransformationMatrixes?.[0]?.data;

  const pose = extractPose(matrixData);
  const nose = landmarks?.[1] || null;
  const faceScale = faceScaleFromLandmarks(landmarks);
  let jawOpen = 0, blinkL = 0, blinkR = 0;
  let lookInL = 0, lookInR = 0, lookOutL = 0, lookOutR = 0;
  let lookUpL = 0, lookUpR = 0, lookDownL = 0, lookDownR = 0;
  for (const bs of blendshapes) {
    if (bs.categoryName === "jawOpen") jawOpen = bs.score;
    if (bs.categoryName === "eyeBlinkLeft") blinkL = bs.score;
    if (bs.categoryName === "eyeBlinkRight") blinkR = bs.score;
    if (bs.categoryName === "eyeLookInLeft") lookInL = bs.score;
    if (bs.categoryName === "eyeLookInRight") lookInR = bs.score;
    if (bs.categoryName === "eyeLookOutLeft") lookOutL = bs.score;
    if (bs.categoryName === "eyeLookOutRight") lookOutR = bs.score;
    if (bs.categoryName === "eyeLookUpLeft") lookUpL = bs.score;
    if (bs.categoryName === "eyeLookUpRight") lookUpR = bs.score;
    if (bs.categoryName === "eyeLookDownLeft") lookDownL = bs.score;
    if (bs.categoryName === "eyeLookDownRight") lookDownR = bs.score;
  }

  const prev = movementAccumulator.samples.at(-1);
  let movementPx = 0, rotationDeg = 0, gazeShiftPx = 0;
  if (nose && prev?.noseX != null) {
    const dx = Math.abs(nose.x - prev.noseX) * 640;
    const dy = Math.abs(nose.y - prev.noseY) * 480;
    movementPx = Math.sqrt(dx * dx + dy * dy) * (1000 / autoAwaySampleMs);
  }
  if (pose && prev?.yaw != null) {
    const dYaw = Math.abs(pose.yaw - prev.yaw);
    const dPitch = Math.abs(pose.pitch - prev.pitch);
    const dRoll = Math.abs(pose.roll - prev.roll);
    rotationDeg = Math.sqrt(dYaw * dYaw + dPitch * dPitch + dRoll * dRoll) * (1000 / autoAwaySampleMs);
  }
  const lIris = landmarks?.[468], rIris = landmarks?.[473];
  if (lIris && rIris && prev?.leftIrisX != null) {
    const ldx = Math.abs(lIris.x - prev.leftIrisX) * 640;
    const ldy = Math.abs(lIris.y - prev.leftIrisY) * 480;
    const rdx = Math.abs(rIris.x - prev.rightIrisX) * 640;
    const rdy = Math.abs(rIris.y - prev.rightIrisY) * 480;
    gazeShiftPx = ((Math.sqrt(ldx * ldx + ldy * ldy) + Math.sqrt(rdx * rdx + rdy * rdy)) / 2) * (1000 / autoAwaySampleMs);
  }

  const eyeLookX = Math.max(lookInL, lookInR, lookOutL, lookOutR);
  const eyeLookY = Math.max(lookUpL, lookUpR, lookDownL, lookDownR);
  const blink = blinkL > 0.5 || blinkR > 0.5;
  const talking = jawOpen > 0.15;

  const sample = {
    faceDetected: hasFace,
    movementPx, rotationDeg, gazeShiftPx,
    yaw: pose?.yaw ?? null, pitch: pose?.pitch ?? null, roll: pose?.roll ?? null,
    noseX: nose?.x ?? null, noseY: nose?.y ?? null,
    faceScale,
    blink, talking, jawOpen,
    eyeLookX, eyeLookY
  };

  if (!movementAccumulator.baseline && hasFace && pose && nose && prev) {
    movementAccumulator.baseline = {
      yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll,
      faceScale,
      noseX: nose.x, noseY: nose.y
    };
  }

  if (prev?.leftIrisX != null) {
    sample.leftIrisX = lIris?.x ?? null;
    sample.rightIrisX = rIris?.x ?? null;
    sample.leftIrisY = lIris?.y ?? null;
    sample.rightIrisY = rIris?.y ?? null;
  }
  movementAccumulator.samples.push(sample);
  if (movementAccumulator.samples.length > 120) movementAccumulator.samples.shift();
}

async function flushMovementMinute() {
  if (!movementAccumulator || !movementAccumulator.samples.length) return;
  const samples = movementAccumulator.samples;
  const baseline = movementAccumulator.baseline;
  movementAccumulator.samples = [];
  movementAccumulator.minuteStart = new Date().toISOString();

  const detectedSamples = samples.filter((s) => s.faceDetected);
  const faceDetectedSeconds = detectedSamples.length;
  const movementVals = detectedSamples.map((s) => s.movementPx).sort((a, b) => a - b);
  const movementAvg = movementVals.length ? movementVals.reduce((a, b) => a + b, 0) / movementVals.length : 0;
  const movementP95 = movementVals.length ? movementVals[Math.floor(movementVals.length * 0.95)] : 0;
  const rotVals = detectedSamples.filter((s) => s.rotationDeg !== null).map((s) => s.rotationDeg);
  const rotationAvg = rotVals.length ? rotVals.reduce((a, b) => a + b, 0) / rotVals.length : 0;
  const gazeVals = detectedSamples.map((s) => s.gazeShiftPx);
  const gazeShiftAvg = gazeVals.length ? gazeVals.reduce((a, b) => a + b, 0) / gazeVals.length : 0;
  const stillnessThreshold = 2;
  const stillnessSeconds = detectedSamples.filter((s) => s.movementPx < stillnessThreshold).length;
  const fidgetThreshold = 5;
  const fidgetSamples = detectedSamples.filter((s) => s.movementPx > fidgetThreshold).length;
  const fidgetScore = detectedSamples.length ? fidgetSamples / detectedSamples.length : 0;

  const yawVals = detectedSamples.filter((s) => s.yaw != null).map((s) => s.yaw);
  const pitchVals = detectedSamples.filter((s) => s.pitch != null).map((s) => s.pitch);
  const rollVals = detectedSamples.filter((s) => s.roll != null).map((s) => s.roll);
  const avgYaw = yawVals.length ? yawVals.reduce((a, b) => a + b, 0) / yawVals.length : null;
  const avgPitch = pitchVals.length ? pitchVals.reduce((a, b) => a + b, 0) / pitchVals.length : null;
  const avgRoll = rollVals.length ? rollVals.reduce((a, b) => a + b, 0) / rollVals.length : null;

  let pitchDrift = null, yawDrift = null, rollDrift = null, forwardLeanScore = null;
  if (baseline && avgPitch != null) {
    pitchDrift = avgPitch - baseline.pitch;
    yawDrift = avgYaw != null ? avgYaw - baseline.yaw : null;
    rollDrift = avgRoll != null ? avgRoll - baseline.roll : null;
    const currentScale = detectedSamples.filter((s) => s.faceScale > 0);
    if (currentScale.length && baseline.faceScale > 0) {
      const avgScale = currentScale.reduce((a, b) => a + b.faceScale, 0) / currentScale.length;
      forwardLeanScore = Math.max(0, (avgScale / baseline.faceScale - 1) * 100);
    }
  }

  const postureRiskScore = computePostureRisk(pitchDrift, rollDrift, forwardLeanScore, stillnessSeconds, samples.length);
  const blinkCount = detectedSamples.filter((s) => s.blink).length;
  const talkingSeconds = detectedSamples.filter((s) => s.talking).length;
  const jawVals = detectedSamples.map((s) => s.jawOpen);
  const jawMean = jawVals.length ? jawVals.reduce((a, b) => a + b, 0) / jawVals.length : 0;
  const expressionActivity = jawVals.length > 1
    ? Math.sqrt(jawVals.reduce((a, b) => a + (b - jawMean) * (b - jawMean), 0) / jawVals.length) * 100
    : 0;

  const minuteData = {
    sessionStart: movementAccumulator.sessionStart,
    minuteStart: movementAccumulator.minuteStart,
    faceDetectedSeconds,
    movementAvg, movementP95, rotationAvg, gazeShiftAvg,
    avgYaw, avgPitch, avgRoll,
    pitchDrift, yawDrift, rollDrift, forwardLeanScore,
    stillnessSeconds, fidgetScore, postureRiskScore,
    blinkCount, talkingSeconds, expressionActivity
  };

  try {
    await trackerApi.storeMovementMinute(minuteData);
  } catch (err) {
    console.error("Failed to store movement minute", err);
  }
}

function computePostureRisk(pitchDrift, rollDrift, forwardLeanScore, stillnessSeconds, totalSeconds) {
  let score = 0;
  if (pitchDrift != null && Math.abs(pitchDrift) > 8) score += 25;
  if (rollDrift != null && Math.abs(rollDrift) > 8) score += 25;
  if (forwardLeanScore != null && forwardLeanScore > 15) score += 20;
  if (totalSeconds > 0 && stillnessSeconds / totalSeconds > 0.7) score += 30;
  return Math.min(100, score);
}

function facePresenceFromLandmarks(landmarks) {
  if (!landmarks || landmarks.length < 100) return false;
  const nose = landmarks[1];
  if (!nose || nose.x < 0 || nose.x > 1 || nose.y < 0 || nose.y > 1) return false;
  autoAwayState.lastFaceConfidence = 1;
  return true;
}

function fallbackFacePresenceFromDetector(video, settings) {
  if (!autoAwayState.detector) return null;
  const profile = autoAwayProfiles[settings.sensitivity] || autoAwayProfiles.normal;
  let result;
  try {
    result = autoAwayState.detector.detectForVideo(video, performance.now());
  } catch (err) {
    console.error("Fallback face detector error", err);
    return null;
  }
  const vw = video.videoWidth || video.width || 640;
  const vh = video.videoHeight || video.height || 480;
  let best = null;
  for (const detection of result?.detections || []) {
    const confidence = detection.categories?.[0]?.score ?? detection.score?.[0] ?? 0;
    const box = detection.boundingBox;
    if (!box || confidence < profile.minConfidence) continue;
    const width = Number(box.width) || 0;
    const height = Number(box.height) || 0;
    const widthRatio = width / vw;
    const areaRatio = (width * height) / (vw * vh);
    if (widthRatio < profile.minWidthRatio || areaRatio < profile.minAreaRatio) continue;
    if (!best || confidence > best.confidence) {
      best = { confidence, widthRatio, areaRatio };
    }
  }
  if (best) {
    autoAwayState.lastFaceConfidence = best.confidence;
    autoAwayState.lastFaceWidthRatio = best.widthRatio;
  }
  return best;
}

function extractPose(matrixData) {
  if (!matrixData || matrixData.length < 12) return null;
  const m = matrixData;
  const r02 = m[8], r12 = m[9], r22 = m[10];
  const r10 = m[1], r11 = m[5];
  const pitch = Math.atan2(-r12, Math.sqrt(r02 * r02 + r22 * r22));
  const yaw = Math.atan2(r02, r22);
  const roll = Math.atan2(r10, r11);
  return {
    yaw: yaw * 180 / Math.PI,
    pitch: pitch * 180 / Math.PI,
    roll: roll * 180 / Math.PI
  };
}

function faceScaleFromLandmarks(landmarks) {
  if (!landmarks) return 0;
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  if (!leftCheek || !rightCheek) return 0;
  return Math.sqrt(
    (leftCheek.x - rightCheek.x) ** 2 +
    (leftCheek.y - rightCheek.y) ** 2
  );
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
    const projectBadge = renderProjectBadge(event.projectName, event.projectColor);
    return `
      <article class="event-row history-row">
        <div>
          <strong>${escapeHtml(event.type)}</strong>
          <span>${formatTime(event.occurredAt)}${escapeHtml(reason)}</span>
          ${projectBadge}
        </div>
        ${note}
        <button class="danger-button compact-button" type="button" data-delete-event-id="${event.id}">Delete</button>
      </article>
    `;
  }).join("") : `<p class="empty-state">No entries for this day.</p>`;

  historySegments.innerHTML = history.segments.length ? history.segments.slice().reverse().map((segment) => {
    const reason = segment.reason ? ` · ${segment.reason}` : "";
    const projectBadge = renderProjectBadge(segment.projectName, segment.projectColor);
    const projectEditor = segment.type === "work" && segment.sourceEventId
      ? `
        <label class="history-project-edit">
          <span>Project</span>
          <select data-reassign-segment="${segment.sourceEventId}">
            ${segment.projectId ? "" : `<option value="" selected>Unassigned</option>`}
            ${projectOptions(segment.projectId, false, true)}
          </select>
        </label>
      `
      : "";
    return `
      <article class="event-row history-row">
        <div>
          <strong>${escapeHtml(segment.type)}</strong>
          <span>${formatTime(segment.start)} - ${formatTime(segment.end)} · ${formatShortDuration(segment.durationMinutes * 60000)}${escapeHtml(reason)}</span>
          ${projectBadge}
        </div>
        ${segment.note ? `<small>${escapeHtml(segment.note)}</small>` : ""}
        ${projectEditor}
        <button class="danger-button compact-button" type="button" data-delete-period-start="${escapeHtml(segment.start)}" data-delete-period-end="${escapeHtml(segment.end)}">Delete Period</button>
      </article>
    `;
  }).join("") : `<p class="empty-state">No time periods for this day.</p>`;
}

function renderProjectBadge(name, color) {
  if (!name) return "";
  return `
    <span class="project-badge" title="Assigned project: ${escapeHtml(name)}">
      <i class="project-dot" style="background:${escapeHtml(color || "#647084")}"></i>${escapeHtml(name)}
    </span>
  `;
}

function renderMovement() {
  if (!movement) {
    movementCards.innerHTML = `<p class="empty-state">Loading movement data...</p>`;
    movementInsights.innerHTML = "";
    movementTimeline.innerHTML = "";
    return;
  }

  if (movement.range) syncMovementRangeControls(movement.range);
  syncMovementProjectFilter();
  if (movement.error) {
    movementCards.innerHTML = `<p class="empty-state">Movement data could not load: ${escapeHtml(movement.error)}</p>`;
    movementInsights.innerHTML = "";
    movementTimeline.innerHTML = "";
    return;
  }
  const minutes = movement.minutes || [];
  if (!minutes.length) {
    movementCards.innerHTML = `<p class="empty-state">No movement data yet. Start a work session with movement tracking enabled.</p>`;
    movementInsights.innerHTML = "";
    movementTimeline.innerHTML = "";
    return;
  }

  const movementVals = minutes.map((m) => m.movement_avg || 0).filter((v) => v > 0);
  const avgMovement = movementVals.length ? movementVals.reduce((a, b) => a + b, 0) / movementVals.length : 0;
  const totalStillness = minutes.reduce((s, m) => s + (m.stillness_seconds || 0), 0);
  const maxRisk = Math.max(...minutes.map((m) => m.posture_risk_score || 0), 0);

  const movementScore = Math.min(100, Math.round(avgMovement * 4 + (100 - Math.min(100, (totalStillness / Math.max(1, minutes.length * 60)) * 100)) * 0.5));
  const movementLabel = movementScore >= 70 ? "Active" : movementScore >= 40 ? "Moderate" : "Low";
  const postureLabel = maxRisk >= 60 ? "High risk" : maxRisk >= 30 ? "Moderate" : "Good";

  movementCards.innerHTML = `
    <div class="mv-card">
      <span class="mv-card-label">Movement Score</span>
      <span class="mv-card-value">${movementScore} <small>/ 100</small></span>
      <span class="mv-card-sub">${movementLabel}</span>
    </div>
    <div class="mv-card">
      <span class="mv-card-label">Stillness</span>
      <span class="mv-card-value">${formatMovementDuration(totalStillness)}</span>
      <span class="mv-card-sub">of ${formatMovementDuration(minutes.length * 60)} tracked</span>
    </div>
    <div class="mv-card">
      <span class="mv-card-label">Posture Risk</span>
      <span class="mv-card-value">${Math.round(maxRisk)} <small>/ 100</small></span>
      <span class="mv-card-sub">${postureLabel}</span>
    </div>
  `;

  const insights = buildMovementInsights(minutes);
  const projectSummary = renderMovementProjectSummary(movement.projectTotals || []);
  movementInsights.innerHTML = insights.length
    ? `${projectSummary}<h3>Insights</h3><ul class="mv-insight-list">${insights.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
    : projectSummary;

  movementTimeline.innerHTML = buildMovementTimeline(minutes, movement.workSegments || []);
}

function renderMovementProjectSummary(projectTotals) {
  if (!projectTotals.length) return "";
  const maxMs = Math.max(...projectTotals.map((project) => project.workMs), 1);
  return `
    <h3>Projects</h3>
    <div class="movement-project-list">
      ${projectTotals.map((project) => `
        <div class="category-row">
          <div class="category-row-head">
            <span><i class="project-dot" style="background:${escapeHtml(project.projectColor)}"></i>${escapeHtml(project.projectName)}</span>
            <strong>${formatShortDuration(project.workMs)}</strong>
          </div>
          <div class="bar-track" aria-hidden="true">
            <div class="bar-fill work-fill" style="width:${Math.max(3, Math.round((project.workMs / maxMs) * 100))}%"></div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function formatMovementDuration(s) {
  const seconds = Math.round(Number(s) || 0);
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)}h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${seconds}s`;
}

function buildMovementInsights(minutes) {
  const insights = [];

  const consecStill = longestConsecutive(minutes, (m) => (m.stillness_seconds || 0) > 50);
  if (consecStill >= 10) {
    insights.push(`Longest still period: ${consecStill} minutes`);
  }

  const avgPitch = minutes.reduce((s, m) => s + (m.pitch_drift || 0), 0) / minutes.length;
  if (avgPitch < -4) {
    insights.push("Head tended downward (possible slouching)");
  }

  const avgRoll = minutes.reduce((s, m) => s + (m.roll_drift || 0), 0) / minutes.length;
  if (Math.abs(avgRoll) > 5) {
    insights.push(`Head tilted ${avgRoll > 0 ? "right" : "left"} on average`);
  }

  const highLean = minutes.filter((m) => (m.forward_lean_score || 0) > 15).length;
  if (highLean > 3) {
    insights.push(`Forward lean detected in ${highLean} minute${highLean === 1 ? "" : "s"}`);
  }

  const totalBlinks = minutes.reduce((s, m) => s + (m.blink_count || 0), 0);
  if (totalBlinks > 0 && minutes.length > 0) {
    const blinkRate = totalBlinks / minutes.length;
    if (blinkRate < 8) insights.push(`Low blink rate (~${blinkRate.toFixed(0)}/min) may indicate eye strain`);
  }

  const highFidget = minutes.filter((m) => (m.fidget_score || 0) > 0.3).length;
  if (highFidget > 5) {
    insights.push(`${highFidget} minutes of above-average fidgeting`);
  }

  const faceMissing = minutes.filter((m) => (m.face_detected_seconds || 0) < 30).length;
  if (faceMissing > 0) {
    insights.push(`${faceMissing} minute${faceMissing === 1 ? "" : "s"} with little or no face detected`);
  }

  return insights;
}

function longestConsecutive(minutes, predicate) {
  let max = 0, cur = 0;
  for (const m of minutes) {
    if (predicate(m)) { cur += 1; max = Math.max(max, cur); }
    else { cur = 0; }
  }
  return max;
}

function buildMovementTimeline(minutes, workSegments = []) {
  if (!minutes.length) return "";

  const windows = movement?.windows?.length
    ? movement.windows
    : [{ start: minutes[0].minute_start, end: minutes[minutes.length - 1].minute_start }];
  const startMs = Math.min(...windows.map((w) => new Date(w.start).getTime()).filter(Number.isFinite));
  const endMs = Math.max(...windows.map((w) => new Date(w.end).getTime()).filter(Number.isFinite));
  const chartStart = Number.isFinite(startMs) ? startMs : new Date(minutes[0].minute_start).getTime();
  const chartEnd = Number.isFinite(endMs) && endMs > chartStart
    ? endMs
    : new Date(minutes[minutes.length - 1].minute_start).getTime() + 60000;
  const totalMs = Math.max(1, chartEnd - chartStart);
  const rawMax = Math.max(0.1, ...minutes.map((m) => m.movement_avg || 0));
  const yMax = Math.max(5, Math.ceil(rawMax / 5) * 5);
  const allLow = minutes.every((m) => (m.movement_avg || 0) < 1);
  const width = 840;
  const height = 220;
  const pad = { top: 18, right: 18, bottom: 38, left: 46 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const BLUE = "#4f9cf9";
  const YELLOW = "#fbbf24";
  const RED = "#f87171";

  const points = minutes.map((m) => {
    const date = new Date(m.minute_start);
    const t = date.getTime();
    const mov = m.movement_avg || 0;
    return {
      source: m,
      x: pad.left + (((t - chartStart) / totalMs) * plotW),
      y: pad.top + ((1 - Math.min(1, mov / yMax)) * plotH),
      value: mov,
      risk: m.posture_risk_score || 0,
      date
    };
  }).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const xTicks = movementTimeTicks(chartStart, chartEnd);
  const yTicks = [0, yMax / 2, yMax].map((value) => ({
    value,
    y: pad.top + ((1 - value / yMax) * plotH)
  }));
  const grid = [
    ...xTicks.map((tick) => `<line class="mv-chart-grid" x1="${tick.x}" y1="${pad.top}" x2="${tick.x}" y2="${pad.top + plotH}"></line>`),
    ...yTicks.map((tick) => `<line class="mv-chart-grid" x1="${pad.left}" y1="${tick.y}" x2="${pad.left + plotW}" y2="${tick.y}"></line>`)
  ].join("");
  const projectBands = workSegments.map((segment) => {
    const start = new Date(segment.start).getTime();
    const end = new Date(segment.end).getTime();
    const clippedStart = Math.max(chartStart, start);
    const clippedEnd = Math.min(chartEnd, end);
    if (!Number.isFinite(clippedStart) || !Number.isFinite(clippedEnd) || clippedEnd <= clippedStart) return "";
    const x = pad.left + (((clippedStart - chartStart) / totalMs) * plotW);
    const width = Math.max(2, ((clippedEnd - clippedStart) / totalMs) * plotW);
    const title = `${segment.projectName || "Unassigned"}\n${formatMovementTooltipTime(new Date(clippedStart))} - ${formatMovementTooltipTime(new Date(clippedEnd))}`;
    return `<rect class="mv-project-band" x="${x.toFixed(1)}" y="${pad.top}" width="${width.toFixed(1)}" height="${plotH}" fill="${escapeHtml(segment.projectColor || "#647084")}"><title>${escapeHtml(title)}</title></rect>`;
  }).join("");
  const pointNodes = points.map((point) => {
    const color = point.risk > 50 ? RED : point.risk > 25 ? YELLOW : BLUE;
    const title = `${formatMovementTooltipTime(point.date)}\nMovement ${point.value.toFixed(1)} px/s\nStill ${point.source.stillness_seconds || 0}s\nPosture risk ${Math.round(point.risk)}/100\nFace detected ${point.source.face_detected_seconds || 0}s`;
    return `
      <g class="mv-chart-point">
        <circle class="mv-chart-hit" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="9">
          <title>${escapeHtml(title)}</title>
        </circle>
        <circle class="mv-chart-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.5" fill="${color}">
          <title>${escapeHtml(title)}</title>
        </circle>
      </g>
    `;
  }).join("");

  return `
    <h3>Movement timeline</h3>
    <div class="mv-timeline-wrap">
      ${allLow ? `<p class="setting-note" style="margin:0 0 10px">Movement is very low; you're sitting still.</p>` : ""}
      <div class="mv-timeline-legend">
        <span><i class="mv-legend-line" style="background:${BLUE}"></i>movement</span>
        <span><i class="mv-legend-dot" style="background:${YELLOW}"></i>elevated risk point</span>
        <span><i class="mv-legend-dot" style="background:${RED}"></i>high risk point</span>
      </div>
      <svg class="mv-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Movement over selected time range">
        ${projectBands}
        ${grid}
        <line class="mv-chart-axis" x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}"></line>
        <line class="mv-chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}"></line>
        ${linePath ? `<path class="mv-chart-line" d="${linePath}"></path>` : ""}
        ${pointNodes}
        ${yTicks.map((tick) => `<text class="mv-chart-label mv-chart-y-label" x="${pad.left - 8}" y="${tick.y + 4}" text-anchor="end">${tick.value.toFixed(tick.value % 1 ? 1 : 0)}</text>`).join("")}
        ${xTicks.map((tick) => `<text class="mv-chart-label" x="${tick.x}" y="${height - 12}" text-anchor="${tick.anchor}">${escapeHtml(tick.label)}</text>`).join("")}
      </svg>
    </div>
  `;
}

function movementTimeTicks(startMs, endMs) {
  const span = Math.max(1, endMs - startMs);
  const count = span <= 12 * 60 * 60 * 1000 ? 5 : 6;
  return Array.from({ length: count }, (_, index) => {
    const ratio = count === 1 ? 0 : index / (count - 1);
    const date = new Date(startMs + (span * ratio));
    return {
      x: (46 + (ratio * (840 - 46 - 18))).toFixed(1),
      label: formatMovementAxisTime(date, span),
      anchor: index === 0 ? "start" : index === count - 1 ? "end" : "middle"
    };
  });
}

function formatMovementAxisTime(date, spanMs) {
  const options = spanMs > 24 * 60 * 60 * 1000
    ? { month: "short", day: "numeric", hour: "numeric" }
    : { hour: "numeric", minute: "2-digit" };
  return new Intl.DateTimeFormat(undefined, {
    timeZone: state?.settings?.timeZone,
    ...options
  }).format(date);
}

function formatMovementTooltipTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: state?.settings?.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
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
  if (page === "movement") {
    movement = await loadMovementForCurrentRange();
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
    setActiveProject: () => invoke("get_state"),
    switchProject: () => invoke("get_state"),
    addProject: () => invoke("get_state"),
    updateProject: () => invoke("get_state"),
    reassignSegmentProject: () => invoke("get_state"),
    addCategory: (name) => invoke("add_category", { name }),
    deleteCategory: (id) => invoke("delete_category", { id }),
    updateSettings: (payload) => invoke("update_settings", { timeZone: payload.timeZone }),
    exportToday: async () => {
      const filePath = await invoke("export_today");
      if (filePath) alert(`Exported workbook:\n${filePath}`);
      return filePath;
    },
    getMovement: () => Promise.resolve({ minutes: [], events: [], workSegments: [] }),
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
