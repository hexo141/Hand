// 手部几何与朝向工具

// 归一化坐标 → 像素坐标
export function toPixel(lm, canvas) {
  return { x: lm.x * canvas.width, y: lm.y * canvas.height };
}

// 我们始终喂非镜像帧给模型 → 模型 handedness 与物理手相反 → 恒交换
export function trueHandedness(raw) {
  if (raw === "Left")  return "Right";
  if (raw === "Right") return "Left";
  return "Unknown";
}

// 手心/手背判定：腕(0)、食指MCP(5)、小指MCP(17) 的 2D 叉积
export const PALM_SIGN = 1;   // 若始终反，改为 -1
export function classifyFacing(lm, trueLabel) {
  const ax = lm[5].x  - lm[0].x, ay = lm[5].y  - lm[0].y;
  const bx = lm[17].x - lm[0].x, by = lm[17].y - lm[0].y;
  const cross = (ax * by - ay * bx) * PALM_SIGN;   // 2D 叉积(3D 法向 z 分量)
  // 原始非镜像帧：右手手心→cross<0；左手手心→cross>0
  const isPalm = (trueLabel === "Right") ? (cross < 0) : (cross > 0);
  return isPalm ? "手心" : "手背";
}
