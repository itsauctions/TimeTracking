const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const previewEmpty = document.getElementById("previewEmpty");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const delegateSel = document.getElementById("delegate");
const resSel = document.getElementById("res");
const fpsSel = document.getElementById("fps");

const conf = document.getElementById("conf");
const wr = document.getElementById("wr");
const ar = document.getElementById("ar");
const nms = document.getElementById("nms");
const confVal = document.getElementById("confVal");
const wrVal = document.getElementById("wrVal");
const arVal = document.getElementById("arVal");
const nmsVal = document.getElementById("nmsVal");

const absentSec = document.getElementById("absentSec");
const presentSec = document.getElementById("presentSec");
const absentSecVal = document.getElementById("absentSecVal");
const presentSecVal = document.getElementById("presentSecVal");

const camPill = document.getElementById("camPill");
const modelPill = document.getElementById("modelPill");
const facePill = document.getElementById("facePill");
const fpsPill = document.getElementById("fpsPill");
const resPill = document.getElementById("resPill");
const cpuPill = document.getElementById("cpuPill");
const memPill = document.getElementById("memPill");

const absentValue = document.getElementById("absentValue");
const presentValue = document.getElementById("presentValue");
const absentBar = document.getElementById("absentBar");
const presentBar = document.getElementById("presentBar");
const absentTarget = document.getElementById("absentTarget");
const presentTarget = document.getElementById("presentTarget");

const logEl = document.getElementById("log");
const clearLog = document.getElementById("clearLog");

const state = {
  stream: null,
  detector: null,
  module: null,
  running: false,
  rafId: null,
  lastFrameAt: 0,
  frameCount: 0,
  fpsAccum: 0,
  fpsTimer: 0,
  lastFaceAt: 0,
  missingSince: null,
  presentSince: null,
  isPaused: false
};

const MODEL_URL = new URL("../assets/models/blaze_face_short_range.tflite", window.location.href).href;
const WASM_URL = new URL("../node_modules/@mediapipe/tasks-vision/wasm/", window.location.href).href;

function log(message, tone = "info") {
  const line = document.createElement("div");
  line.className = `log-line ${tone}`;
  const ts = new Date().toLocaleTimeString();
  line.textContent = `[${ts}] ${message}`;
  logEl.prepend(line);
  while (logEl.children.length > 200) logEl.removeChild(logEl.lastChild);
}

function setPill(el, text, tone = "") {
  el.className = `pill ${tone}`.trim();
  el.innerHTML = `<span class="dot"></span>${text}`;
}

function readSettings() {
  return {
    delegate: delegateSel.value,
    minConfidence: Number(conf.value),
    minWidthRatio: Number(wr.value),
    minAreaRatio: Number(ar.value),
    minSuppressionThreshold: Number(nms.value),
    absentSeconds: Number(absentSec.value),
    presentSeconds: Number(presentSec.value),
    fps: Number(fpsSel.value)
  };
}

function bindSlider(input, label, formatter = (v) => String(v)) {
  const update = () => { label.textContent = formatter(Number(input.value)); };
  input.addEventListener("input", update);
  update();
}
bindSlider(conf, confVal, (v) => v.toFixed(2));
bindSlider(wr, wrVal, (v) => v.toFixed(2));
bindSlider(ar, arVal, (v) => v.toFixed(3));
bindSlider(nms, nmsVal, (v) => v.toFixed(2));
bindSlider(absentSec, absentSecVal);
bindSlider(presentSec, presentSecVal);
absentSec.addEventListener("input", () => { absentTarget.textContent = absentSec.value; });
presentSec.addEventListener("input", () => { presentTarget.textContent = presentSec.value; });
absentTarget.textContent = absentSec.value;
presentTarget.textContent = presentSec.value;

clearLog.addEventListener("click", () => { logEl.innerHTML = ""; });

async function loadModule() {
  if (state.module) return state.module;
  log("Loading MediaPipe tasks-vision module...", "info");
  state.module = await import("../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs");
  log("Module loaded.", "ok");
  return state.module;
}

async function loadDetector() {
  const settings = readSettings();
  const { FaceDetector, FilesetResolver } = await loadModule();
  log(`Creating FaceDetector (delegate: ${settings.delegate})...`, "info");
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  state.detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: settings.delegate
    },
    runningMode: "VIDEO",
    minDetectionConfidence: settings.minConfidence,
    minSuppressionThreshold: settings.minSuppressionThreshold
  });
  setPill(modelPill, `Model (${settings.delegate})`, "ok");
  log("FaceDetector ready.", "ok");
}

async function startCamera() {
  const [w, h] = resSel.value.split("x").map(Number);
  const fps = Number(fpsSel.value);
  log(`Requesting camera ${w}x${h} @ ${fps}fps...`, "info");
  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: fps, max: fps } }
  });
  video.srcObject = state.stream;
  await video.play();
  previewEmpty.style.display = "none";
  resPill.textContent = `${video.videoWidth}x${video.videoHeight}`;
  setPill(camPill, "Camera on", "ok");
  log("Camera started.", "ok");
}

function stopCamera() {
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
  }
  state.stream = null;
  video.srcObject = null;
  previewEmpty.style.display = "grid";
  setPill(camPill, "Camera off", "");
  resPill.textContent = "—";
}

function resizeOverlay() {
  const wrap = video.parentElement;
  const rect = wrap.getBoundingClientRect();
  overlay.width = rect.width * devicePixelRatio;
  overlay.height = rect.height * devicePixelRatio;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
}

function bestUsableFace(detections) {
  const settings = readSettings();
  const vw = video.videoWidth || 320;
  const vh = video.videoHeight || 240;
  let best = null;
  for (const d of detections) {
    const score = d.categories?.[0]?.score ?? d.score?.[0] ?? 0;
    const box = d.boundingBox;
    if (!box || score < settings.minConfidence) continue;
    const bw = Number(box.width) || 0;
    const bh = Number(box.height) || 0;
    const widthRatio = bw / vw;
    const areaRatio = (bw * bh) / (vw * vh);
    if (widthRatio >= settings.minWidthRatio && areaRatio >= settings.minAreaRatio) {
      if (!best || score > best.confidence) {
        best = { confidence: score, widthRatio, areaRatio, box };
      }
    }
  }
  return best;
}

function drawDetections(detections, best) {
  resizeOverlay();
  const dpr = devicePixelRatio;
  const vw = video.videoWidth || 320;
  const vh = video.videoHeight || 240;
  const cssW = overlay.width / dpr;
  const cssH = overlay.height / dpr;
  const scaleX = cssW / vw;
  const scaleY = cssH / vh;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  for (const d of detections) {
    const score = d.categories?.[0]?.score ?? d.score?.[0] ?? 0;
    const box = d.boundingBox;
    if (!box) continue;
    const isBest = d === best?.source;
    const x = (Number(box.originX) || 0) * scaleX;
    const y = (Number(box.originY) || 0) * scaleY;
    const w = (Number(box.width) || 0) * scaleX;
    const h = (Number(box.height) || 0) * scaleY;
    ctx.lineWidth = isBest ? 3 : 1.5;
    ctx.strokeStyle = isBest ? "#34d399" : "rgba(79,156,249,0.6)";
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = isBest ? "#34d399" : "rgba(79,156,249,0.9)";
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(`${(score * 100).toFixed(0)}%`, x, Math.max(12, y - 4));
  }
  ctx.restore();
}

function tickFps(now) {
  state.frameCount += 1;
  if (!state.fpsTimer) state.fpsTimer = now;
  if (now - state.fpsTimer >= 1000) {
    const fps = Math.round((state.frameCount * 1000) / (now - state.fpsTimer));
    fpsPill.textContent = `${fps} fps`;
    state.frameCount = 0;
    state.fpsTimer = now;
  }
}

function updateTimers(now, face, settings) {
  if (face) {
    state.lastFaceAt = now;
    state.missingSince = null;
    if (!state.presentSince) state.presentSince = now;
    if (state.isPaused) {
      const presentMs = now - state.presentSince;
      presentValue.textContent = `${(presentMs / 1000).toFixed(1)}s`;
      presentBar.firstElementChild.style.width = `${Math.min(100, (presentMs / (settings.presentSeconds * 1000)) * 100)}%`;
      if (presentMs >= settings.presentSeconds * 1000) {
        state.isPaused = false;
        log(`Resume triggered (face present ${(presentMs / 1000).toFixed(1)}s)`, "ok");
      }
    } else {
      presentValue.textContent = `${((now - state.presentSince) / 1000).toFixed(1)}s`;
      presentBar.firstElementChild.style.width = "100%";
    }
    absentValue.textContent = "0.0s";
    absentBar.firstElementChild.style.width = "0%";
  } else {
    state.presentSince = null;
    presentValue.textContent = "0.0s";
    presentBar.firstElementChild.style.width = "0%";
    if (!state.missingSince) state.missingSince = now;
    const absentMs = now - state.missingSince;
    absentValue.textContent = `${(absentMs / 1000).toFixed(1)}s`;
    absentBar.firstElementChild.style.width = `${Math.min(100, (absentMs / (settings.absentSeconds * 1000)) * 100)}%`;
    if (!state.isPaused && absentMs >= settings.absentSeconds * 1000) {
      state.isPaused = true;
      log(`Pause triggered (face absent ${(absentMs / 1000).toFixed(1)}s)`, "warn");
    }
  }
}

async function loop() {
  if (!state.running) return;
  const now = performance.now();
  const settings = readSettings();

  if (state.detector && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    let result;
    try {
      result = state.detector.detectForVideo(video, now);
    } catch (err) {
      log(`detectForVideo error: ${err.message}`, "danger");
    }
    const detections = result?.detections || [];
    const best = bestUsableFace(detections);
    drawDetections(detections, best);

    if (best) {
      setPill(facePill, `Face ${Math.round(best.confidence * 100)}%`, "ok");
    } else if (detections.length) {
      setPill(facePill, `${detections.length} raw, none pass`, "warn");
    } else {
      setPill(facePill, "No face", "danger");
    }
    updateTimers(Date.now(), best, settings);
  }

  tickFps(now);
  state.rafId = requestAnimationFrame(loop);
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  try {
    await loadDetector();
    await startCamera();
    state.running = true;
    state.isPaused = false;
    state.presentSince = null;
    state.missingSince = null;
    log("Detection loop started.", "ok");
    state.rafId = requestAnimationFrame(loop);
  } catch (err) {
    log(`Start failed: ${err.message}`, "danger");
    console.error(err);
  } finally {
    startBtn.disabled = false;
  }
});

stopBtn.addEventListener("click", () => {
  state.running = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  stopCamera();
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  setPill(facePill, "No face", "");
  setPill(modelPill, "—", "");
  log("Stopped.", "info");
});

[delegateSel].forEach((el) => el.addEventListener("change", async () => {
  if (state.detector) {
    log("Reloading detector with new delegate...", "info");
    state.detector = null;
    if (state.running) {
      state.running = false;
      if (state.rafId) cancelAnimationFrame(state.rafId);
      try { await loadDetector(); state.running = true; state.rafId = requestAnimationFrame(loop); }
      catch (err) { log(`Reload failed: ${err.message}`, "danger"); }
    }
  }
}));

[conf, nms].forEach((el) => el.addEventListener("input", () => {
  if (!state.detector) return;
  const s = readSettings();
  try {
    state.detector.setOptions({
      minDetectionConfidence: s.minConfidence,
      minSuppressionThreshold: s.minSuppressionThreshold
    });
  } catch (err) {
    log(`setOptions failed: ${err.message}`, "danger");
  }
}));

[resSel, fpsSel].forEach((el) => el.addEventListener("change", async () => {
  if (state.stream) {
    log("Restarting camera with new settings...", "info");
    stopCamera();
    await startCamera();
  }
}));

window.addEventListener("resize", resizeOverlay);
log("Ready. Press Start to begin.", "info");

async function pollCpuStats() {
  if (!window.systemStats) return;
  try {
    const stats = await window.systemStats.getCpuStats();
    const mainCpu = stats.main.cpuPercent.toFixed(1);
    const rendererCpu = stats.renderer.cpuPercent.toFixed(1);
    const totalMem = (stats.main.rssMB + stats.renderer.memMB).toFixed(0);
    const cores = stats.renderer.cores || "?";
    cpuPill.textContent = `CPU main ${mainCpu}% · renderer ${rendererCpu}% (of ${cores})`;
    memPill.textContent = `Mem ${totalMem} MB · rss ${stats.main.rssMB.toFixed(0)} · heap ${stats.main.heapUsedMB.toFixed(0)}/${stats.main.heapTotalMB.toFixed(0)} · gpu+renderer ${stats.renderer.memMB.toFixed(0)}`;
  } catch (err) {
    cpuPill.textContent = "CPU: error";
    memPill.textContent = "Mem: error";
  }
}
setInterval(pollCpuStats, 1000);
pollCpuStats();
