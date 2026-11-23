// 腿：站立 / 走路 / 坐下 / 重心转移。
// 走路在正视图里是“假”的——所以用抬脚、屈膝、身体起伏来暗示重量感。
import { damp, clamp } from '../../core/util.js';

export function createLeg(side, { rig, servos }) {
  const s = side === 'L' ? -1 : 1;
  let sit = 0;

  function tick(dt, ctx) {
    const p = ctx.posture;
    const J = rig.joints;
    const thigh = J[`leg_${side}_thigh`];
    const shin = J[`leg_${side}_shin`];
    const foot = J[`foot_${side}`];

    sit = damp(sit, p.sit, 4, dt);

    const phase = p.walkPhase + (side === 'L' ? 0 : Math.PI);
    const walking = p.walking ? 1 : 0;
    const amp = ctx.speed ? clamp(ctx.speed / 40, 0, 1.6) : 0.6;

    // 走路
    const swing = Math.sin(phase);
    const lift = Math.max(0, Math.sin(phase + 0.7));

    // 走路：两条腿必须反相，否则会像螃蟹一样整体平移
    let thighD = walking * 0.15 * swing * amp + p.weight * s * 0.03;
    let shinD = walking * (-0.05 - 0.45 * lift * amp);
    let footD = walking * 0.14 * swing * amp;

    // 坐下：膝盖向外张开、小腿收回（盘腿）
    thighD += sit * -s * 1.15;
    shinD += sit * s * 1.55;
    footD += sit * -s * 0.4;

    servos.set(thigh.id, thigh.rest + thighD, `leg.${side}`);
    servos.set(shin.id, shin.rest + shinD, `leg.${side}`);
    servos.set(foot.id, foot.rest + footD, `leg.${side}`);
  }

  return { tick, get sit() { return sit; } };
}
