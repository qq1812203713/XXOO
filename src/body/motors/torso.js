// 躯干：呼吸、重心、歪头。这些不是“大脑指令”，是脑干级别的节律。
import { damp, clamp } from '../../core/util.js';

export function createTorso({ rig, servos }) {
  let slouch = 0;

  function tick(dt, ctx) {
    const p = ctx.posture;
    const J = rig.joints;
    const b = p.breath; // -1..1 呼吸正弦
    const sway = p.sway;
    const lean = p.lean;
    const shiver = p.shiver || 0;

    // 坐下的驼背程度
    slouch = damp(slouch, p.sit, 3.5, dt);

    // 朝向注视点歪头（头只做“一部分”转动，眼睛补剩下的）
    const g = ctx.gaze || { x: 0, y: 0 };
    const head = ctx.pose.get('head');
    let lookX = 0;
    let lookY = 0;
    if (head) {
      const dx = g.x - head.x;
      const dy = g.y - head.y;
      lookX = clamp(dx / 110, -0.5, 0.5);
      lookY = clamp(dy / 150, -0.25, 0.3);
    }

    const tr = 0.012 * Math.sin(ctx.time * 37) * shiver;

    servos.set('spine1', J.spine1.rest + sway * 0.035 + lean * 0.05 + slouch * 0.1 + b * 0.006 + tr, 'torso');
    servos.set('spine2', J.spine2.rest + sway * 0.045 + lean * 0.06 + slouch * 0.12 + b * 0.01, 'torso');
    servos.set('chest', J.chest.rest + sway * 0.035 + slouch * 0.06 + b * 0.014 + tr, 'torso');
    servos.set('neck', J.neck.rest + lookX * 0.2 + slouch * 0.12 - lookY * 0.16, 'torso');
    servos.set('head', J.head.rest + lookX * 0.42 - lookY * 0.4 + 0.015 * Math.sin(ctx.time * 0.55), 'torso');
  }

  return { tick };
}
