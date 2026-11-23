// 基础数学工具：整个生命体只依赖这些函数，保持无副作用、可测试。
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

// 与帧率无关的指数趋近（lambda 越大越快）
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const smooth = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const chance = (p) => Math.random() < p;
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 按权重挑选
export const weighted = (items, weightOf) => {
  let total = 0;
  for (const it of items) total += Math.max(0, weightOf(it));
  let r = Math.random() * total;
  for (const it of items) {
    r -= Math.max(0, weightOf(it));
    if (r <= 0) return it;
  }
  return items[items.length - 1];
};

export const wrap = (v, m) => ((v % m) + m) % m;
export const wrapAngle = (a) => wrap(a + Math.PI, TAU) - Math.PI;

export const uid = () => Math.random().toString(36).slice(2, 9);

export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

// 平滑的一维值噪声，用于呼吸、摆动、发丝等“活着的抖动”
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n) => {
    const s = Math.sin(n * 127.1 + seed * 311.7 + 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  return lerp(h(i), h(i + 1), smooth(f)) * 2 - 1;
}

export function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? `${h} 小时 ${mm} 分钟` : `${h} 小时`;
  const d = Math.floor(h / 24);
  return `${d} 天 ${h % 24} 小时`;
}

export const timeOfDay = (d = new Date()) => {
  const h = d.getHours();
  if (h < 5) return 'night';
  if (h < 9) return 'dawn';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
};

// 一次性事件记录器（给 UI 的滚动日志用）
export function createLog(limit = 40) {
  const items = [];
  return {
    items,
    push(entry) {
      items.unshift({ t: Date.now(), ...entry });
      if (items.length > limit) items.length = limit;
    },
  };
}
