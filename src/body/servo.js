// 伺服层：每根骨头一个“马达”，它只认识角度和速度，不认识情绪。
// 真正的智能在它上面；而它决定了整体动作的质感（惯性、迟滞、极限）。
import { clamp } from '../core/util.js';

export function createServos(rig) {
  const ids = Object.keys(rig.joints);

  function set(id, localTarget, source) {
    const j = rig.joints[id];
    if (!j) return;
    j.target = clamp(localTarget, j.min, j.max);
    if (source) j.lastSource = source;
    j.lastSetAt = performance.now ? performance.now() : Date.now();
  }

  function snap(id) {
    const j = rig.joints[id];
    j.local = j.target = j.rest;
    j.vel = 0;
  }

  function snapAll() {
    for (const id of ids) snap(id);
  }

  // 临界阻尼弹簧 + 目标角速度限幅：动作“有重量”而不是插值
  function tick(dt) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;

    for (const id of ids) {
      const j = rig.joints[id];
      if (j.locked) continue;

      // 临界阻尼弹簧：动作“有重量”，而不是线性插值
      const k = j.stiff;
      const c = 2 * Math.sqrt(k) * 0.94;
      for (let s = 0; s < steps; s++) {
        const acc = k * (j.target - j.local) - c * j.vel;
        j.vel += acc * h;
        j.local += j.vel * h;
      }

      if (j.local < j.min) {
        j.local = j.min;
        j.vel = 0;
      } else if (j.local > j.max) {
        j.local = j.max;
        j.vel = 0;
      }
    }
  }

  return { set, snap, snapAll, tick, ids };
}
