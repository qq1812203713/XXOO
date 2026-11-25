// 下丘脑：五个“内在张力”。它们不上报给用户，只决定她此刻想做什么。
// 关键点：张力会随时间自己上涨，被满足后下降 —— 这就是“自主”的发动机。
import { clamp, damp, rand } from '../core/util.js';

export const DRIVE_META = {
  energy: { label: '疲倦', color: '#3b73e8', hint: '越高越想坐下休息' },
  curiosity: { label: '好奇', color: '#d98a12', hint: '越高越想探索、创造' },
  social: { label: '想见你', color: '#e04f80', hint: '越高越想靠近你' },
  comfort: { label: '不安', color: '#12997e', hint: '越高越需要被安抚' },
  arousal: { label: '心跳', color: '#e63b64', hint: '被触碰后升高，会自己退下去' },
};

const DEFAULTS = { energy: 0.2, curiosity: 0.52, social: 0.42, comfort: 0.34, arousal: 0.08 };

export function createDrives(saved) {
  const v = { ...DEFAULTS };
  if (saved) for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === 'number') v[k] = clamp(saved[k], 0, 1);

  function tick(dt, c = {}) {
    const night = c.night ? 1 : 0;

    // 基础漂移
    v.energy = clamp(v.energy + dt * (0.000024 + night * 0.00006) * (c.resting ? -1.8 : 1), 0, 1);
    v.curiosity = clamp(v.curiosity + dt * 0.0011 * (c.creating ? -1.4 : 1), 0, 1);
    v.social = clamp(v.social + dt * 0.0007 * (c.talking ? -1.6 : 1), 0, 1);
    v.comfort = clamp(v.comfort + dt * 0.00005 * (c.petting ? -1.8 : 1), 0, 1);
    v.arousal = clamp(v.arousal - dt * 0.009, 0, 1);

    // 疲倦会放大不安，孤独会让好奇变钝
    if (v.energy > 0.55) v.comfort = clamp(v.comfort + dt * 0.0002, 0, 1);
    if (v.social > 0.65) v.curiosity = clamp(v.curiosity + dt * 0.00003, 0, 1);

    if (c.resting) v.energy = clamp(v.energy - dt * 0.022, 0, 1);
    if (c.creating) v.curiosity = clamp(v.curiosity - dt * 0.035, 0, 1);
    if (c.talking) v.social = clamp(v.social - dt * 0.05, 0, 1);
    if (c.petting) {
      v.comfort = clamp(v.comfort - dt * 0.06, 0, 1);
      v.arousal = clamp(v.arousal + dt * 0.03, 0, 1);
    }
  }

  function satisfy(key, amount) {
    if (key in v) v[key] = clamp(v[key] - amount, 0, 1);
  }

  function excite(key, amount) {
    if (key in v) v[key] = clamp(v[key] + amount, 0, 1);
  }

  // 离线：她一个人待着的时候，也在生活
  function applyOffline(ms) {
    const dt = Math.min(ms / 1000, 86400 * 3);
    v.energy = clamp(v.energy + dt * 0.000024, 0, 1);
    v.curiosity = clamp(v.curiosity + dt * 0.0011 * 0.6, 0, 1);
    v.social = clamp(v.social + dt * 0.0007, 0, 1);
    v.comfort = clamp(v.comfort + dt * 0.00005, 0, 1);
    v.arousal = clamp(v.arousal - dt * 0.009, 0, 1);

    // 太久没人陪：她学会自己找事做，好奇下降、不安上升
    if (dt > 3600) {
      v.curiosity = clamp(v.curiosity - 0.12, 0, 1);
      v.comfort = clamp(v.comfort + 0.15, 0, 1);
    }
  }

  const snapshot = () => ({ ...v });

  return { v, tick, satisfy, excite, applyOffline, snapshot };
}
