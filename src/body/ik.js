import { clamp } from '../core/util.js';

// 两骨解析 IK（小脑负责的事）：给肩点和目标点，算出大臂/小臂的绝对角度。
// 角度约定：a = 0 朝上，增大顺时针，方向 = (sin a, -cos a)
export function solveTwoBone(origin, target, l1, l2, bend = 1) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const raw = Math.hypot(dx, dy);
  const d = clamp(raw, Math.abs(l1 - l2) + 0.5, l1 + l2 - 0.5);

  const base = Math.atan2(dx, -dy);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const A = Math.acos(cosA);
  const a1 = base + bend * A;

  const cosB = clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1);
  const B = Math.acos(cosB);
  const a2 = a1 - bend * (Math.PI - B);

  return { a1, a2, reach: raw };
}
