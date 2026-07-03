const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const previewEmpty = document.getElementById("previewEmpty");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const delegateSel = document.getElementById("delegate");
const resSel = document.getElementById("res");
const fpsSel = document.getElementById("fps");
const numFacesSel = document.getElementById("numFaces");

const camPill = document.getElementById("camPill");
const modelPill = document.getElementById("modelPill");
const facePill = document.getElementById("facePill");
const fpsPill = document.getElementById("fpsPill");
const resPill = document.getElementById("resPill");
const cpuPill = document.getElementById("cpuPill");
const memPill = document.getElementById("memPill");

const posValue = document.getElementById("posValue");
const posSub = document.getElementById("posSub");
const posBar = document.getElementById("posBar");
const rotValue = document.getElementById("rotValue");
const rotSub = document.getElementById("rotSub");
const rotBar = document.getElementById("rotBar");
const gazeValue = document.getElementById("gazeValue");
const gazeSub = document.getElementById("gazeSub");
const gazeBar = document.getElementById("gazeBar");
const exprValue = document.getElementById("exprValue");
const exprSub = document.getElementById("exprSub");
const exprBar = document.getElementById("exprBar");

const poseYaw = document.getElementById("poseYaw");
const posePitch = document.getElementById("posePitch");
const poseRoll = document.getElementById("poseRoll");

const keypointTable = document.getElementById("keypointTable");
const blendGrid = document.getElementById("blendGrid");
const logEl = document.getElementById("log");
const clearLog = document.getElementById("clearLog");

const MODEL_URL = new URL("../assets/models/face_landmarker.task", window.location.href).href;
const WASM_URL = new URL("../node_modules/@mediapipe/tasks-vision/wasm/", window.location.href).href;

const KEYPOINT_DEFS = [
  { idx: 1, name: "Nose tip", group: "nose" },
  { idx: 168, name: "Between eyes", group: "eye" },
  { idx: 10, name: "Forehead", group: "face" },
  { idx: 152, name: "Chin", group: "face" },
  { idx: 234, name: "L cheek", group: "face" },
  { idx: 454, name: "R cheek", group: "face" },
  { idx: 33, name: "L eye outer", group: "eye" },
  { idx: 263, name: "R eye outer", group: "eye" },
  { idx: 61, name: "Mouth L", group: "mouth" },
  { idx: 291, name: "Mouth R", group: "mouth" },
  { idx: 13, name: "Upper lip", group: "mouth" },
  { idx: 14, name: "Lower lip", group: "mouth" },
  { idx: 468, name: "L iris", group: "iris" },
  { idx: 473, name: "R iris", group: "iris" },
  { idx: 159, name: "L eye top", group: "eye" },
  { idx: 145, name: "L eye bot", group: "eye" },
  { idx: 386, name: "R eye top", group: "eye" },
  { idx: 374, name: "R eye bot", group: "eye" },
];

const BLENDSHAPE_FILTER = new Set([
  "jawOpen", "eyeBlinkLeft", "eyeBlinkRight", "mouthSmileLeft",
  "mouthSmileRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight",
  "eyeLookUpLeft", "eyeLookUpRight", "eyeLookDownLeft", "eyeLookDownRight",
  "eyeSquintLeft", "eyeSquintRight", "cheekSquintLeft", "cheekSquintRight",
  "mouthFrownLeft", "mouthFrownRight"
]);

const state = {
  stream: null,
  landmarker: null,
  module: null,
  running: false,
  rafId: null,
  frameCount: 0,
  fpsTimer: 0,
  lastPose: null,
  lastNosePos: null,
  lastIrisPositions: null,
  poseDeltas: [],
  noseDeltas: [],
  irisDeltas: [],
  jawScores: [],
  blinkEvents: [],
  blinkState: { left: false, right: false }
};

function log(message, tone = "info") {
  const line = document.createElement("div");
  line.className = `log-line ${tone}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
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
    resW: Number(resSel.value.split("x")[0]),
    resH: Number(resSel.value.split("x")[1]),
    fps: Number(fpsSel.value),
    numFaces: Number(numFacesSel.value)
  };
}

clearLog.addEventListener("click", () => { logEl.innerHTML = ""; });

async function loadModule() {
  if (state.module) return state.module;
  log("Loading MediaPipe vision module...", "info");
  state.module = await import("../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs");
  log("Module loaded.", "ok");
  return state.module;
}

async function loadLandmarker() {
  const settings = readSettings();
  const { FaceLandmarker, FilesetResolver } = await loadModule();
  log(`Creating FaceLandmarker (${settings.delegate})...`, "info");
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  state.landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: settings.delegate
    },
    runningMode: "VIDEO",
    numFaces: settings.numFaces,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true
  });
  setPill(modelPill, `Landmarker (${settings.delegate})`, "ok");
  log("FaceLandmarker ready.", "ok");
}

async function startCamera() {
  const settings = readSettings();
  log(`Requesting camera ${settings.resW}x${settings.resH} @ ${settings.fps}fps...`, "info");
  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: settings.resW },
      height: { ideal: settings.resH },
      frameRate: { ideal: settings.fps, max: settings.fps }
    }
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

function getLandmark(arr, idx) {
  return arr[idx] || null;
}

function landmarkToCss(lm, vw, vh) {
  const dpr = devicePixelRatio;
  const cssW = overlay.width / dpr;
  const cssH = overlay.height / dpr;
  return {
    x: lm.x * cssW,
    y: lm.y * cssH
  };
}

function drawPoints(points, vw, vh, radius, color) {
  for (const pt of points) {
    if (!pt) continue;
    const p = landmarkToCss(pt, vw, vh);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function drawLine(lm1, lm2, vw, vh, color, lineWidth) {
  if (!lm1 || !lm2) return;
  const p1 = landmarkToCss(lm1, vw, vh);
  const p2 = landmarkToCss(lm2, vw, vh);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawOverlay(result) {
  resizeOverlay();
  const dpr = devicePixelRatio;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  if (!result.faceLandmarks || !result.faceLandmarks.length) {
    ctx.restore();
    return;
  }

  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;

  for (const landmarks of result.faceLandmarks) {
    if (!landmarks || !landmarks.length) continue;

    drawTesselation(landmarks, vw, vh);
    drawContours(landmarks, vw, vh);
    drawKeyPoints(landmarks, vw, vh);
    drawIris(landmarks, vw, vh);
  }

  ctx.restore();
}

function drawTesselation(landmarks, vw, vh) {
  const { FaceLandmarker } = state.module;
  if (!FaceLandmarker) return;
  let tess;
  try { tess = FaceLandmarker.FACE_LANDMARKS_TESSELATION; } catch { return; }
  if (!tess || !Array.isArray(tess)) return;
  ctx.strokeStyle = "rgba(167,139,250,0.08)";
  ctx.lineWidth = 0.5;
  for (const conn of tess) {
    const a = getLandmark(landmarks, conn.start);
    const b = getLandmark(landmarks, conn.end);
    if (!a || !b) continue;
    const pa = landmarkToCss(a, vw, vh);
    const pb = landmarkToCss(b, vw, vh);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
}

function drawContours(landmarks, vw, vh) {
  const { FaceLandmarker } = state.module;
  if (!FaceLandmarker) return;

  const drawConnections = (connections, color, lineWidth) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (const conn of connections) {
      const a = getLandmark(landmarks, conn.start);
      const b = getLandmark(landmarks, conn.end);
      if (!a || !b) continue;
      const pa = landmarkToCss(a, vw, vh);
      const pb = landmarkToCss(b, vw, vh);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  };

  const tryContour = (name, color, lineWidth) => {
    try {
      let contour;
      if (name === "LIPS") contour = FaceLandmarker.FACE_LANDMARKS_LIPS;
      else if (name === "FACE_OVAL") contour = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL;
      else if (name === "LEFT_EYE") contour = FaceLandmarker.FACE_LANDMARKS_LEFT_EYE;
      else if (name === "RIGHT_EYE") contour = FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE;
      else if (name === "LEFT_EYEBROW") contour = FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW;
      else if (name === "RIGHT_EYEBROW") contour = FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW;
      else if (name === "LEFT_IRIS") contour = FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS;
      else if (name === "RIGHT_IRIS") contour = FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS;
      if (contour && Array.isArray(contour)) drawConnections(contour, color, lineWidth);
    } catch { /* skip */ }
  };

  tryContour("FACE_OVAL", "rgba(167,139,250,0.3)", 1);
  tryContour("LIPS", "rgba(251,191,36,0.5)", 1);
  tryContour("LEFT_EYE", "rgba(79,156,249,0.5)", 1);
  tryContour("RIGHT_EYE", "rgba(79,156,249,0.5)", 1);
  tryContour("LEFT_EYEBROW", "rgba(79,156,249,0.3)", 1);
  tryContour("RIGHT_EYEBROW", "rgba(79,156,249,0.3)", 1);
}

function drawKeyPoints(landmarks, vw, vh) {
  const colors = {
    nose: "#f87171",
    eye: "#4f9cf9",
    mouth: "#fbbf24",
    iris: "#34d399",
    face: "#a78bfa"
  };

  for (const def of KEYPOINT_DEFS) {
    const lm = getLandmark(landmarks, def.idx);
    if (!lm) continue;
    const p = landmarkToCss(lm, vw, vh);
    const radius = def.group === "iris" ? 5 : 4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = colors[def.group] || "#fff";
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawIris(landmarks, vw, vh) {
  for (const irisIdx of [468, 473]) {
    const lm = getLandmark(landmarks, irisIdx);
    if (!lm) continue;
    const p = landmarkToCss(lm, vw, vh);
    const radius = 6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function extractPose(matrixData) {
  if (!matrixData || matrixData.length < 12) return null;
  const m = matrixData;
  const r02 = m[8], r12 = m[9], r22 = m[10];
  const r00 = m[0], r10 = m[1];
  const r01 = m[4], r11 = m[5];
  const pitch = Math.atan2(-r12, Math.sqrt(r02 * r02 + r22 * r22));
  const yaw = Math.atan2(r02, r22);
  const roll = Math.atan2(r10, r11);
  return {
    yaw: yaw * 180 / Math.PI,
    pitch: pitch * 180 / Math.PI,
    roll: roll * 180 / Math.PI
  };
}

function computeMovement(result, now) {
  const landmarks = result.faceLandmarks?.[0];
  if (!landmarks || !landmarks.length) {
    state.lastPose = null;
    state.lastNosePos = null;
    state.lastIrisPositions = null;
    return;
  }

  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const dt = state.lastFrameTime ? Math.max(0.016, (now - state.lastFrameTime) / 1000) : 0.033;
  state.lastFrameTime = now;

  let posDelta = 0, rotDelta = 0, gazeDelta = 0, exprActivity = 0;

  const nose = getLandmark(landmarks, 1);
  if (nose && state.lastNosePos) {
    const dx = (nose.x - state.lastNosePos.x) * vw;
    const dy = (nose.y - state.lastNosePos.y) * vh;
    posDelta = Math.sqrt(dx * dx + dy * dy) / dt;
  }
  if (nose) state.lastNosePos = { x: nose.x, y: nose.y };

  state.noseDeltas.push(posDelta);
  if (state.noseDeltas.length > 60) state.noseDeltas.shift();
  const avgPos = state.noseDeltas.reduce((a, b) => a + b, 0) / state.noseDeltas.length;
  const maxPos = Math.max(...state.noseDeltas, 1);

  const pose = result.facialTransformationMatrixes?.[0]?.data;
  if (pose) {
    const current = extractPose(pose);
    if (current && state.lastPose) {
      const dYaw = Math.abs(current.yaw - state.lastPose.yaw);
      const dPitch = Math.abs(current.pitch - state.lastPose.pitch);
      const dRoll = Math.abs(current.roll - state.lastPose.roll);
      rotDelta = Math.sqrt(dYaw * dYaw + dPitch * dPitch + dRoll * dRoll) / dt;
    }
    if (current) state.lastPose = current;
  }

  state.poseDeltas.push(rotDelta);
  if (state.poseDeltas.length > 60) state.poseDeltas.shift();
  const avgRot = state.poseDeltas.reduce((a, b) => a + b, 0) / state.poseDeltas.length;
  const maxRot = Math.max(...state.poseDeltas, 1);

  const leftEyeOuter = getLandmark(landmarks, 33);
  const rightEyeOuter = getLandmark(landmarks, 263);
  const leftIris = getLandmark(landmarks, 468);
  const rightIris = getLandmark(landmarks, 473);
  if (leftIris && rightIris && state.lastIrisPositions && leftEyeOuter && rightEyeOuter) {
    const liDX = (leftIris.x - state.lastIrisPositions.left.x) * vw;
    const liDY = (leftIris.y - state.lastIrisPositions.left.y) * vh;
    const riDX = (rightIris.x - state.lastIrisPositions.right.x) * vw;
    const riDY = (rightIris.y - state.lastIrisPositions.right.y) * vh;
    gazeDelta = (Math.sqrt(liDX * liDX + liDY * liDY) + Math.sqrt(riDX * riDX + riDY * riDY)) / 2 / dt;
  }
  if (leftIris) state.lastIrisPositions = { left: { x: leftIris.x, y: leftIris.y }, right: rightIris ? { x: rightIris.x, y: rightIris.y } : { x: 0, y: 0 } };

  state.irisDeltas.push(gazeDelta);
  if (state.irisDeltas.length > 60) state.irisDeltas.shift();
  const avgGaze = state.irisDeltas.reduce((a, b) => a + b, 0) / state.irisDeltas.length;
  const maxGaze = Math.max(...state.irisDeltas, 1);

  const blendshapes = result.faceBlendshapes?.[0]?.categories || [];
  let jawOpen = 0, blinkL = 0, blinkR = 0;
  for (const bs of blendshapes) {
    if (bs.categoryName === "jawOpen") jawOpen = bs.score;
    if (bs.categoryName === "eyeBlinkLeft") blinkL = bs.score;
    if (bs.categoryName === "eyeBlinkRight") blinkR = bs.score;
  }

  state.jawScores.push(jawOpen);
  if (state.jawScores.length > 60) state.jawScores.shift();
  if (state.jawScores.length > 1) {
    const mean = state.jawScores.reduce((a, b) => a + b, 0) / state.jawScores.length;
    const varJaw = state.jawScores.reduce((a, b) => a + (b - mean) * (b - mean), 0) / state.jawScores.length;
    exprActivity = varJaw * 100;
  }

  for (const [side, score] of [["left", blinkL], ["right", blinkR]]) {
    if (score > 0.5 && !state.blinkState[side]) {
      state.blinkState[side] = true;
    } else if (score < 0.3 && state.blinkState[side]) {
      state.blinkState[side] = false;
      state.blinkEvents.push(now);
    }
  }
  while (state.blinkEvents.length > 0 && now - state.blinkEvents[0] > 30000) {
    state.blinkEvents.shift();
  }
  const blinkRate = state.blinkEvents.length / 30 * 60;
  exprActivity += blinkRate * 2;

  posValue.innerHTML = `${avgPos.toFixed(1)} <small>px/s</small>`;
  posBar.style.width = `${Math.min(100, (avgPos / maxPos) * 100)}%`;
  posSub.textContent = `instant ${posDelta.toFixed(1)} px`;

  rotValue.innerHTML = `${avgRot.toFixed(1)} <small>°/s</small>`;
  rotBar.style.width = `${Math.min(100, (avgRot / maxRot) * 100)}%`;
  rotSub.textContent = "yaw + pitch + roll delta";

  gazeValue.innerHTML = `${avgGaze.toFixed(1)} <small>px/s</small>`;
  gazeBar.style.width = `${Math.min(100, (avgGaze / maxGaze) * 100)}%`;
  gazeSub.textContent = "iris displacement";

  exprValue.innerHTML = `${exprActivity.toFixed(1)} <small>%</small>`;
  exprBar.style.width = `${Math.min(100, exprActivity * 2)}%`;
  exprSub.textContent = `jaw var + blink ~${blinkRate.toFixed(0)}/m`;

  if (pose) {
    const current = extractPose(pose);
    if (current) {
      poseYaw.textContent = current.yaw.toFixed(1);
      posePitch.textContent = current.pitch.toFixed(1);
      poseRoll.textContent = current.roll.toFixed(1);
    }
  }

  updateKeypointTable(landmarks, vw, vh);
  updateBlendGrid(blendshapes);
}

function updateKeypointTable(landmarks, vw, vh) {
  let html = "";
  for (const def of KEYPOINT_DEFS) {
    const lm = getLandmark(landmarks, def.idx);
    html += `<span class="kname">${def.name}</span>`;
    if (lm) {
      html += `<span class="kval">${(lm.x * vw).toFixed(1)},${(lm.y * vh).toFixed(1)}</span>`;
      html += `<span class="kval">z:${(lm.z ?? 0).toFixed(3)}</span>`;
    } else {
      html += `<span class="kval" style="color:var(--muted)">—</span>`;
      html += `<span class="kval" style="color:var(--muted)">—</span>`;
    }
  }
  keypointTable.innerHTML = html;
}

function updateBlendGrid(blendshapes) {
  const filtered = blendshapes.filter(bs => BLENDSHAPE_FILTER.has(bs.categoryName));
  let html = "";
  for (const bs of filtered) {
    const name = bs.categoryName.replace(/([A-Z])/g, " $1").trim();
    html += `<div class="blend-row">
      <span class="bn">${name}</span>
      <span class="bv">${(bs.score * 100).toFixed(0)}</span>
      <span class="bbar"><div style="width:${bs.score * 100}%"></div></span>
    </div>`;
  }
  blendGrid.innerHTML = html;
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

async function loop(now) {
  if (!state.running) return;
  if (!state.landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    state.rafId = requestAnimationFrame(loop);
    return;
  }

  let result;
  try {
    result = state.landmarker.detectForVideo(video, now);
  } catch (err) {
    log(`detectForVideo error: ${err.message}`, "danger");
    state.rafId = requestAnimationFrame(loop);
    return;
  }

  drawOverlay(result);

  const hasFace = result.faceLandmarks && result.faceLandmarks.length > 0;
  if (hasFace) {
    setPill(facePill, `${result.faceLandmarks.length} face${result.faceLandmarks.length > 1 ? "s" : ""}`, "ok");
    computeMovement(result, performance.now());
  } else {
    setPill(facePill, "No face", "danger");
  }

  tickFps(now);
  state.rafId = requestAnimationFrame(loop);
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  try {
    await loadLandmarker();
    await startCamera();
    state.running = true;
    state.lastFrameTime = null;
    state.lastPose = null;
    state.lastNosePos = null;
    state.lastIrisPositions = null;
    state.noseDeltas = [];
    state.poseDeltas = [];
    state.irisDeltas = [];
    state.jawScores = [];
    state.blinkEvents = [];
    state.blinkState = { left: false, right: false };
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

[delegateSel].forEach(el => el.addEventListener("change", async () => {
  if (state.landmarker) {
    log("Reloading landmarker with new delegate...", "info");
    state.landmarker = null;
    if (state.running) {
      state.running = false;
      if (state.rafId) cancelAnimationFrame(state.rafId);
      try { await loadLandmarker(); state.running = true; state.rafId = requestAnimationFrame(loop); }
      catch (err) { log(`Reload failed: ${err.message}`, "danger"); }
    }
  }
}));

[numFacesSel].forEach(el => el.addEventListener("change", async () => {
  if (state.landmarker) {
    log("Reloading for new face count...", "info");
    state.landmarker = null;
    if (state.running) {
      state.running = false;
      if (state.rafId) cancelAnimationFrame(state.rafId);
      try { await loadLandmarker(); state.running = true; state.rafId = requestAnimationFrame(loop); }
      catch (err) { log(`Reload failed: ${err.message}`, "danger"); }
    }
  }
}));

[resSel, fpsSel].forEach(el => el.addEventListener("change", async () => {
  if (state.stream) {
    log("Restarting camera...", "info");
    stopCamera();
    await startCamera();
  }
}));

window.addEventListener("resize", resizeOverlay);

async function pollCpuStats() {
  if (!window.systemStats) return;
  try {
    const stats = await window.systemStats.getCpuStats();
    const mainCpu = stats.main.cpuPercent.toFixed(1);
    const rendererCpu = stats.renderer.cpuPercent.toFixed(1);
    const totalMem = (stats.main.rssMB + stats.renderer.memMB).toFixed(0);
    cpuPill.textContent = `CPU main ${mainCpu}% · rdr ${rendererCpu}%`;
    memPill.textContent = `Mem ${totalMem}MB`;
  } catch {
    cpuPill.textContent = "CPU: error";
  }
}
setInterval(pollCpuStats, 1000);
pollCpuStats();

log("Ready. Press Start to load FaceLandmarker and begin.", "info");
