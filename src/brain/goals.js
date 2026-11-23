// 目标选择：把五条“内在张力”翻译成一件此刻想做的事。
// 这不是脚本化的行为树，而是每几秒重新竞标一次 —— 所以她看起来会有主意。
import { weighted, rand, clamp } from '../core/util.js';

export const GOAL_META = {
  idle: { label: '发呆', mood: 'calm' },
  wander: { label: '到处走走', mood: 'curious' },
  create: { label: '种点东西', mood: 'happy' },
  rest: { label: '坐下休息', mood: 'sleepy' },
  approach: { label: '靠近你', mood: 'happy' },
  observe: { label: '看着你', mood: 'curious' },
  arrange: { label: '整理世界', mood: 'calm' },
};

export function createGoals({ log } = {}) {
  let lastType = 'idle';
  let recent = [];

  function candidateWeights(d, ctx) {
    const pointer = ctx.pointer ? 1 : 0;
    const hasWorld = ctx.hasWorld ? 1 : 0;
    const canCreate = ctx.canCreate ? 1 : 0;

    return [
      { type: 'idle', w: 0.55 + (1 - d.curiosity) * 0.9 },
      { type: 'wander', w: 0.35 + d.curiosity * 1.5 },
      { type: 'create', w: d.curiosity * 2.4 * canCreate },
      { type: 'rest', w: Math.pow(d.energy, 1.4) * 3.1 },
      { type: 'approach', w: d.social * 2.2 * (0.5 + pointer * 0.7) },
      { type: 'observe', w: 0.3 + d.social * 1.15 + d.comfort * 0.6 },
      { type: 'arrange', w: d.curiosity * 0.7 * hasWorld },
    ];
  }

  function choose(drives, ctx = {}) {
    const weights = candidateWeights(drives, ctx).map((o) => {
      let w = o.w;
      if (o.type === lastType) w *= 0.35; // 避免一直重复同一件事
      if (recent.includes(o.type)) w *= 0.6;
      return { ...o, w: Math.max(0.01, w) };
    });

    const picked = weighted(weights, (o) => o.w);
    lastType = picked.type;
    recent.push(picked.type);
    if (recent.length > 3) recent.shift();
    return picked.type;
  }

  function durationFor(type) {
    switch (type) {
      case 'idle':
        return rand(9, 22);
      case 'wander':
        return rand(10, 20);
      case 'create':
        return rand(7, 10);
      case 'rest':
        return rand(24, 70);
      case 'approach':
        return rand(7, 12);
      case 'observe':
        return rand(9, 18);
      case 'arrange':
        return rand(8, 14);
      default:
        return 10;
    }
  }

  return { choose, durationFor, GOAL_META };
}
