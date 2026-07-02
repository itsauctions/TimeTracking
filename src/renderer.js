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
const themeButton = document.querySelector("#themeButton");
const timerPage = document.querySelector("#timerPage");
const statsPage = document.querySelector("#statsPage");
const dailyStats = document.querySelector("#dailyStats");
const weeklyStats = document.querySelector("#weeklyStats");
const monthlyStats = document.querySelector("#monthlyStats");

let state;
let stats;
const trackerApi = createTrackerApi();
const themes = [
  { id: "light", label: "Light" },
  { id: "night", label: "Night" },
  { id: "forest", label: "Forest" },
  { id: "sunrise", label: "Sunrise" }
];

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatShortDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
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
    .map((category) => `<span>${escapeHtml(category.name)}</span>`)
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
  renderThemeButton();
}

async function loadState() {
  state = await trackerApi.getState();
  stats = await trackerApi.getStats();
  render();
  renderStats();
}

async function addEvent(type, reason = "") {
  const payload = {
    type,
    reason: type === "pause" || type === "stop" ? reason : "",
    note: noteInput.value.trim()
  };
  state = await trackerApi.addEvent(payload);
  stats = await trackerApi.getStats();
  noteInput.value = "";
  render();
  renderStats();
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
  settingsDialog.showModal();
});

addCategoryButton.addEventListener("click", async () => {
  const name = categoryInput.value.trim();
  if (!name) return;
  state = await trackerApi.addCategory(name);
  stats = await trackerApi.getStats();
  categoryInput.value = "";
  render();
  renderStats();
});

timerTab.addEventListener("click", () => showPage("timer"));
statsTab.addEventListener("click", async () => {
  stats = await trackerApi.getStats();
  renderStats();
  showPage("stats");
});
themeButton.addEventListener("click", cycleTheme);

function showPage(page) {
  const showingStats = page === "stats";
  timerPage.classList.toggle("hidden", showingStats);
  statsPage.classList.toggle("hidden", !showingStats);
  timerTab.classList.toggle("active", !showingStats);
  statsTab.classList.toggle("active", showingStats);
}

function renderStats() {
  if (!stats) return;
  dailyStats.innerHTML = stats.days.length ? stats.days.map(renderStatsCard).join("") : emptyStats();
  weeklyStats.innerHTML = stats.weeks.length ? stats.weeks.map(renderStatsCard).join("") : emptyStats();
  monthlyStats.innerHTML = stats.months.length ? stats.months.map(renderStatsCard).join("") : emptyStats();
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
        <h3>${escapeHtml(item.key)}</h3>
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
    stats = await trackerApi.getStats();
    renderStats();
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
    addEvent: (payload) => invoke("add_event", {
      eventType: payload.type,
      reason: payload.reason || null,
      note: payload.note || null
    }),
    addCategory: (name) => invoke("add_category", { name }),
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
