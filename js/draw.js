// Canvas 绘制工具（纯函数，接收 ctx/canvas 与数据）

// #rrggbb -> rgba(r,g,b,a)
export function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
  ctx.closePath();
}

// 四边形：顺序连线 + 闭合
// fillMode: "none" | "solid" | "gradient" | "glitch"
// opts.color2: 渐变第二色；opts.video: 故障模式降色用的视频源
export function drawQuad(ctx, canvas, pts, color, fillMode, opts = {}) {
  if (pts.length < 3) return;
  const W = canvas.width;

  // —— 填充 ——
  if (fillMode !== "none") {
    if (fillMode === "solid") {
      tracePath(ctx, pts);
      ctx.fillStyle = hexA(color, 0.22);
      ctx.fill();
    } else if (fillMode === "gradient") {
      // 双色渐变：颜色1 → 颜色2（用户指定两色）
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const g = ctx.createLinearGradient(
        Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)
      );
      g.addColorStop(0, hexA(color, 0.5));
      g.addColorStop(1, hexA(opts.color2 || color, 0.5));
      tracePath(ctx, pts);
      ctx.fillStyle = g;
      ctx.fill();
    } else if (fillMode === "glitch") {
      drawGlitchFill(ctx, canvas, pts, opts.video, opts.glitchStyle || "pixelate");
    }
  }

  // —— 描边 ——
  ctx.lineWidth = Math.max(2, W * 0.004);
  ctx.strokeStyle = color;
  tracePath(ctx, pts);
  ctx.stroke();

  // —— 顶点高亮 ——
  pts.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3, W * 0.006), 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  });
}

// 故障填充：取矩形区域内视频像素，按"风格类型"做不同故障化处理
// style: "pixelate" 像素化 | "tear" 撕裂 | "posterize" 色块
let glitchBuf = null;   // 复用的离屏 canvas
function bboxOf(canvas, pts) {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(canvas.width,  Math.ceil(Math.max(...xs)));
  const y1 = Math.min(canvas.height, Math.ceil(Math.max(...ys)));
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// 极淡扫描线（各风格共用，背景仍可见）
function drawScanlines(ctx, x0, y0, x1, y1) {
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  for (let y = y0; y < y1; y += 4) ctx.fillRect(x0, y, x1 - x0, 1);
}

function drawGlitchFill(ctx, canvas, pts, video, style) {
  if (!video || video.readyState < 2) return;
  const { x0, y0, x1, y1, w, h } = bboxOf(canvas, pts);
  if (w <= 0 || h <= 0) return;

  if (style === "pixelate") {
    drawGlitchPixelate(ctx, canvas, pts, video, x0, y0, x1, y1, w, h);
  } else if (style === "tear") {
    drawGlitchTear(ctx, canvas, pts, video, x0, y0, x1, y1, w, h);
  } else {
    drawGlitchPosterize(ctx, canvas, pts, video, x0, y0, x1, y1, w, h);
  }
}

// 像素化：把区域缩到极小再以最近邻放回 → 马赛克色块
// 叠加随机像素行水平错位 + 极淡扫描线，强化"像素故障"感
function drawGlitchPixelate(ctx, canvas, pts, video, x0, y0, x1, y1, w, h) {
  if (!glitchBuf) glitchBuf = document.createElement("canvas");
  // 像素块大小随区域自适应、有下限，保证明显的方块感
  const block = Math.max(6, Math.round(Math.min(w, h) / 22));
  const cw = Math.max(1, Math.floor(w / block));
  const ch = Math.max(1, Math.floor(h / block));
  if (glitchBuf.width !== cw || glitchBuf.height !== ch) {
    glitchBuf.width = cw; glitchBuf.height = ch;
  }
  const gctx = glitchBuf.getContext("2d");
  gctx.imageSmoothingEnabled = false;
  gctx.clearRect(0, 0, cw, ch);
  // 源坐标 = 视频内在坐标 = canvas 坐标（两者位图同尺寸，见 camera.js）
  gctx.drawImage(video, x0, y0, w, h, 0, 0, cw, ch);

  ctx.save();
  tracePath(ctx, pts);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  // 放大回原尺寸 → 方块马赛克
  ctx.drawImage(glitchBuf, 0, 0, cw, ch, x0, y0, w, h);
  // 随机像素行错位：取小图某行，偏移后重绘一条带，产生像素撕裂
  for (let by = 0; by < ch; by++) {
    if (Math.random() < 0.12) {
      const dx = (Math.random() - 0.5) * w * 0.20;
      ctx.drawImage(glitchBuf, 0, by, cw, 1, x0 + dx, y0 + by * block, w, block + 1);
    }
  }
  drawScanlines(ctx, x0, y0, x1, y1);
  ctx.restore();
}

// 撕裂：posterize 降色 + 随机水平切片位移 + 扫描线
function drawGlitchTear(ctx, canvas, pts, video, x0, y0, x1, y1, w, h) {
  if (!glitchBuf) glitchBuf = document.createElement("canvas");
  if (glitchBuf.width !== w || glitchBuf.height !== h) {
    glitchBuf.width = w; glitchBuf.height = h;
  }
  const gctx = glitchBuf.getContext("2d", { willReadFrequently: true });
  gctx.drawImage(video, x0, y0, w, h, 0, 0, w, h);

  // 颜色退化：posterize —— 每通道量化到少量色阶
  const img = gctx.getImageData(0, 0, w, h);
  const d = img.data;
  const levels = 4;
  const step = 255 / (levels - 1);
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.round(d[i]     / step) * step;
    d[i + 1] = Math.round(d[i + 1] / step) * step;
    d[i + 2] = Math.round(d[i + 2] / step) * step;
  }
  gctx.putImageData(img, 0, 0);

  ctx.save();
  tracePath(ctx, pts);
  ctx.clip();
  const sliceH = Math.max(6, h / 20);
  for (let y = 0; y < h; y += sliceH) {
    const sh = Math.min(sliceH, h - y);
    const dx = (Math.random() < 0.3) ? (Math.random() - 0.5) * w * 0.12 : 0;
    ctx.drawImage(glitchBuf, 0, y, w, sh, x0 + dx, y0 + y, w, sh);
  }
  drawScanlines(ctx, x0, y0, x1, y1);
  ctx.restore();
}

// 色块：仅 posterize 降色 + 扫描线（无位移），色彩阶跃、静止退化
function drawGlitchPosterize(ctx, canvas, pts, video, x0, y0, x1, y1, w, h) {
  if (!glitchBuf) glitchBuf = document.createElement("canvas");
  if (glitchBuf.width !== w || glitchBuf.height !== h) {
    glitchBuf.width = w; glitchBuf.height = h;
  }
  const gctx = glitchBuf.getContext("2d", { willReadFrequently: true });
  gctx.drawImage(video, x0, y0, w, h, 0, 0, w, h);

  const img = gctx.getImageData(0, 0, w, h);
  const d = img.data;
  const levels = 4;
  const step = 255 / (levels - 1);
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.round(d[i]     / step) * step;
    d[i + 1] = Math.round(d[i + 1] / step) * step;
    d[i + 2] = Math.round(d[i + 2] / step) * step;
  }
  gctx.putImageData(img, 0, 0);

  ctx.save();
  tracePath(ctx, pts);
  ctx.clip();
  ctx.drawImage(glitchBuf, 0, 0, w, h, x0, y0, w, h);
  drawScanlines(ctx, x0, y0, x1, y1);
  ctx.restore();
}

// 文字标签：开启镜像时预先 scale(-1,1) 抵消 CSS 翻转，避免反字
export function drawLabel(ctx, canvas, cx, cy, text, mirror) {
  ctx.save();
  ctx.font = `${Math.max(16, canvas.width * 0.022)}px system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  if (mirror) { ctx.translate(cx, cy); ctx.scale(-1, 1); ctx.translate(-cx, -cy); }
  ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.strokeText(text, cx, cy);
  ctx.fillStyle = "#fff"; ctx.fillText(text, cx, cy);
  ctx.restore();
}

// 散点（单手时提示已检测到的指尖点）
export function drawDots(ctx, canvas, pts, color) {
  const r = Math.max(3, canvas.width * 0.006);
  pts.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  });
}

// 21 点调试：画出全部关键点及序号
export function drawDebug(ctx, canvas, lm) {
  ctx.save();
  lm.forEach((p, idx) => {
    const c = { x: p.x * canvas.width, y: p.y * canvas.height };
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(2, canvas.width * 0.004), 0, Math.PI * 2);
    ctx.fillStyle = "#00ff66"; ctx.fill();
    ctx.font = `${Math.max(10, canvas.width * 0.014)}px monospace`;
    ctx.fillStyle = "#fffe7a";
    ctx.fillText(String(idx), c.x + 4, c.y - 4);
  });
  ctx.restore();
}
