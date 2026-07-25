// 主入口：DOM、状态、面板交互、检测循环、绘制编排
import { createLandmarker } from "./landmarker.js";
import { startCamera } from "./camera.js";
import { trueHandedness, classifyFacing, toPixel }
  from "./geometry.js";
import { drawQuad, drawLabel, drawDots, drawDebug } from "./draw.js";

// ===== DOM 引用 =====
const video  = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx    = canvas.getContext("2d");
const btnToggleCam = document.getElementById("btn-toggle-cam");
const statusEl     = document.getElementById("status");
const optMirror    = document.getElementById("opt-mirror");
const optFillMode  = document.getElementById("opt-fillmode");
const optColor     = document.getElementById("opt-color");
const optColor2    = document.getElementById("opt-color2");
const optGlitch    = document.getElementById("opt-glitch");
const optLabels    = document.getElementById("opt-labels");
const optDebug     = document.getElementById("opt-debug");

// ===== 状态 =====
let handLandmarker = null;
let stream = null;
let running = false;
let rafId = 0;
let lastVideoTime = -1;

const DOT_COLOR = "#ffd400";   // 单手提示点色
const GLITCH_STROKE = "#00e5ff"; // 故障模式固定描边色（不取色，由风格类型决定观感）

function setStatus(text) { statusEl.textContent = text; }

// 故障模式不取色：描边/顶点用固定霓虹色；其余模式用用户色1
function strokeColor() {
  return optFillMode.value === "glitch" ? GLITCH_STROKE : optColor.value;
}

function applyMirror(on) {
  // video 与 overlay 同时加/去 .mirror 类 —— "统一镜像"的落点
  video.classList.toggle("mirror", on);
  canvas.classList.toggle("mirror", on);
}

// ===== 检测循环 =====
function loop() {
  if (!running) return;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const ts = performance.now();          // 单调递增，满足 detectForVideo 要求
    try {
      const result = handLandmarker.detectForVideo(video, ts);
      drawResult(result);
    } catch (err) {
      console.warn("detectForVideo error:", err);  // 单帧异常兜底
    }
  }
  rafId = requestAnimationFrame(loop);
}

// ===== 绘制编排 =====
// 左手拇指(4)+食指(8) 与 右手拇指(4)+食指(8) 共 4 点 → 取景框矩形
// 固定语义顺序连接（同手两点相邻、对边同指相连）：
//   左拇指 → 左食指 → 右食指 → 右拇指 → 闭合
// 与手心/手背朝向无关，一只正手一只背手时也不会交叉
function drawResult(result) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const hands = result?.landmarks ?? [];
  const handed = result?.handedness ?? [];

  // 按"物理真手"分左右
  let leftHand = null, rightHand = null;
  for (let i = 0; i < hands.length; i++) {
    const lm = hands[i];
    if (!lm || lm.length < 21) continue;                       // 边界：点数不足
    const modelLabel = handed[i]?.[0]?.categoryName ?? "Unknown";
    const trueLabel = trueHandedness(modelLabel);
    const info = { lm, trueLabel, facing: classifyFacing(lm, trueLabel) };
    if (trueLabel === "Left")        leftHand  = info;
    else if (trueLabel === "Right")  rightHand = info;
  }

  if (optDebug.checked) {
    if (leftHand)  drawDebug(ctx, canvas, leftHand.lm);
    if (rightHand) drawDebug(ctx, canvas, rightHand.lm);
  }

  if (leftHand && rightHand) {
    // 固定语义顺序：左拇指→左食指→右食指→右拇指→闭合
    // 同手两点相邻、对边同指配对，形成取景框矩形
    // 无论手心/手背朝向如何，连接顺序不变，永不交叉
    const pts = [
      toPixel(leftHand.lm[4], canvas),   // 左拇指
      toPixel(leftHand.lm[8], canvas),   // 左食指
      toPixel(rightHand.lm[8], canvas),  // 右食指
      toPixel(rightHand.lm[4], canvas),  // 右拇指
    ];
    drawQuad(ctx, canvas, pts, strokeColor(), optFillMode.value, {
      color2: optColor2.value, video, glitchStyle: optGlitch.value,
    });
    if (optLabels.checked) {
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = Math.min(...pts.map((p) => p.y)) - canvas.height * 0.04;
      drawLabel(ctx, canvas, cx, cy, "双手矩形", optMirror.checked);
      tagHand(leftHand,  "左手·" + leftHand.facing);
      tagHand(rightHand, "右手·" + rightHand.facing);
    }
    setStatus("检测中：双手矩形");
  } else if (leftHand || rightHand) {
    // 仅检测到一只手：画出其拇指/食指点提示
    const h = leftHand || rightHand;
    const name = leftHand ? "左手" : "右手";
    drawDots(ctx, canvas, [toPixel(h.lm[4], canvas), toPixel(h.lm[8], canvas)], DOT_COLOR);
    if (optLabels.checked) tagHand(h, `${name}·${h.facing}（需另一只手）`);
    setStatus(`仅检测到${name}，需要双手`);
  } else {
    setStatus("未检测到手");
  }
}

// 单手标签：放在手腕(0)上方
function tagHand(h, text) {
  const c = toPixel(h.lm[0], canvas);
  drawLabel(ctx, canvas, c.x, c.y - canvas.height * 0.06, text, optMirror.checked);
}

// ===== 面板交互 =====
async function toggleCam() {
  if (running) {
    running = false; cancelAnimationFrame(rafId);
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    btnToggleCam.textContent = "开启摄像头";
    setStatus("已停止");
  } else {
    btnToggleCam.disabled = true; setStatus("加载模型…");
    try {
      if (!handLandmarker) handLandmarker = await createLandmarker();
      setStatus("请求摄像头…");
      stream = await startCamera(video, canvas);
      applyMirror(optMirror.checked);
      running = true; lastVideoTime = -1; loop();
      btnToggleCam.disabled = false; btnToggleCam.textContent = "停止摄像头";
    } catch (err) {
      console.error("启动失败:", err);
      btnToggleCam.disabled = false;
      setStatus("启动失败：" + (err?.message || err));
    }
  }
}

btnToggleCam.addEventListener("click", toggleCam);
optMirror.addEventListener("change", () => applyMirror(optMirror.checked));

// 填充模式联动：按当前模式显隐 颜色1/颜色2/故障风格类型
// - 纯色：色1；渐变：色1+色2；故障：故障类型（不取色）；无：全隐
function syncFillControlsVisibility() {
  const mode = optFillMode.value;
  const useColor = mode === "solid" || mode === "gradient";
  optColor.classList.toggle("hidden", !useColor);
  optColor2.classList.toggle("hidden", mode !== "gradient");
  optGlitch.classList.toggle("hidden", mode !== "glitch");
}
optFillMode.addEventListener("change", syncFillControlsVisibility);
syncFillControlsVisibility();

// 初始化时同步一次镜像类（默认勾选）
applyMirror(optMirror.checked);
setStatus("点击开启摄像头开始");
