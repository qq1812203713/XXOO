// 手臂：大部分时间只是垂着、随呼吸摆动；一旦大脑说“伸向那个点”，
// 小脑用两骨 IK 把它翻译成肩/肘角度——大脑从头到尾没算过一个角度。
import { clamp, damp, lerp } from '../../core/util.js';
import { solveTwoBone } from '../ik.js';

export function createArm(side, { rig, servos, log }) {
  const s = side === 'L' ? -1 : 1;
  const upperId = `arm_${side}_upper`;
  const foreId = `arm_${side}_fore`;
  // 骨长直接从骨架读，避免 IK 用了错的尺寸
  const L1 = rig.joints[foreId].dy;
  const L2 = rig.joints[`hand_${side}`].dy;
  let mode = 'idle';
  let waveT = 0;

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    log.push({ layer: 'cerebellum', motor: `arm.${side}`, text: `手臂 → ${m}` });
  }

  function tick(dt, ctx) {
    const p = ctx.posture;
    const intent = ctx.intent || {};
    const pose = ctx.pose;
    const chest = pose.get('chest');
    const sh = pose.get(upperId);
    if (!chest || !sh) return;

    const wantsReach = intent.reach === side || intent.reach === 'both';
    const wantsWave = intent.wave === side || (wantsReach && intent.wave === 'both');
    const gesture = intent[`hand${side}`] || 'idle';
    const target = intent.reachPoint;

    if (wantsReach && target) {
      setMode(gesture === 'wave' ? 'wave' : 'reach');
      let tx = target.x;
      let ty = target.y;
      if (gesture === 'wave') {
        waveT += dt;
        tx = chest.x + s * 34 + Math.sin(waveT * 6) * 4;
        ty = chest.y - 62 + Math.cos(waveT * 6) * 5;
      }
      const ik = solveTwoBone(sh, { x: tx, y: ty }, L1, L2, s);
      const chestA = pose.get('chest').a;
      servos.set(upperId, ik.a1 - chestA, `arm.${side}`);
      servos.set(foreId, ik.a2 - ik.a1, `arm.${side}`);
      return;
    }

    setMode(gesture === 'wave' ? 'wave' : 'idle');

    if (gesture === 'wave') {
      waveT += dt;
      const tx = chest.x + s * 30 + Math.sin(waveT * 6) * 6;
      const ty = chest.y - 60;
      const ik = solveTwoBone(sh, { x: tx, y: ty }, L1, L2, s);
      servos.set(upperId, ik.a1 - pose.get('chest').a, `arm.${side}`);
      servos.set(foreId, ik.a2 - ik.a1, `arm.${side}`);
      return;
    }

    const J = rig.joints;
    const swing = p.walking ? 0.12 * Math.sin(p.walkPhase + (side === 'L' ? Math.PI : 0)) : 0;
    const breath = p.breath * 0.02;
    servos.set(upperId, J[upperId].rest + s * swing + breath + p.sway * 0.03, `arm.${side}`);
    servos.set(foreId, J[foreId].rest + 0.05 + 0.03 * Math.sin(ctx.time * 0.9 + (side === 'L' ? 0 : 1.3)) + breath, `arm.${side}`);
  }

  return { tick, get mode() { return mode; } };
}
