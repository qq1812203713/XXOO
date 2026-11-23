// 脚部运动程序：一只脚 = 脚踝 + 10 节趾骨。
// 每个趾头都有独立的相位和抽动计时器，所以就算她站着不动，脚趾也一直在“活着”。
import { clamp, damp, rand, chance, TAU } from '../../core/util.js';
import { TOES } from '../skeleton.js';

const LABEL = { idle: '放松', curl: '蜷起', spread: '张开', tap: '点地', point: '踮起' };

export function createFoot(side, { rig, servos, log }) {
  const s = side === 'L' ? -1 : 1;
  const toes = TOES.map((t) => ({
    name: t.name,
    ids: t.segs.map((_, i) => `${side}_toe_${t.name}_${i}`),
    phase: rand(0, TAU),
    twitch: 0,
    twitchTarget: 0,
  }));

  let gesture = 'idle';
  let reflex = 0;
  let ankle = 0;

  function announce(g) {
    if (g === gesture) return;
    gesture = g;
    log.push({ layer: 'motor', motor: `foot.${side}`, text: `脚 → ${LABEL[g] || g}` });
  }

  function tick(dt, ctx) {
    const intent = ctx.intent || {};
    const g = intent[`foot${side}`] || 'idle';
    const p = ctx.posture;
    announce(g);
    reflex = Math.max(0, reflex - dt * 1.3);

    // 脚踝：走路时随步伐屈伸，坐着时放松
    let ankleTarget = 0.06 * Math.sin(ctx.time * 0.8 + (side === 'L' ? 0 : 1.7));
    if (p.walking) ankleTarget += 0.22 * Math.sin(p.walkPhase + (side === 'L' ? 0 : Math.PI));
    if (p.sit > 0.2) ankleTarget += p.sit * 0.25;
    if (g === 'point') ankleTarget = s * 0.5;
    ankle = damp(ankle, ankleTarget + reflex * 0.5, 10, dt);
    const footJoint = rig.joints[`foot_${side}`];
    servos.set(`foot_${side}`, footJoint.rest + s * ankle, `foot.${side}`);

    for (let ti = 0; ti < toes.length; ti++) {
      const t = toes[ti];
      const j0 = rig.joints[t.ids[0]];
      let curl = 0.14 + 0.06 * Math.sin(ctx.time * 1.2 + t.phase);

      if (g === 'curl') curl = 0.8;
      else if (g === 'spread') curl = 0.0;
      else if (g === 'tap') curl = 0.3 + 0.35 * Math.sin(ctx.time * 6 + ti * 0.7);
      else if (g === 'point') curl = 0.55;

      if (p.walking) {
        const step = Math.max(0, Math.sin(p.walkPhase + (side === 'L' ? 0 : Math.PI) + 0.6));
        curl = 0.12 + 0.4 * step;
      }

      // 每个趾头独立的抽动
      if (chance(dt * 0.5)) t.twitchTarget = rand(0.15, 0.5);
      t.twitchTarget *= Math.exp(-dt * 1.4);
      t.twitch = damp(t.twitch, t.twitchTarget, 8, dt);

      const amount = clamp(curl + t.twitch * 0.6 + reflex, 0, 0.95);
      // 大脚趾更稳，小脚趾更爱动
      const gain = 0.7 + ti * 0.09;
      servos.set(t.ids[0], j0.rest - s * amount * gain * 0.55, `foot.${side}`);
      if (t.ids[1]) {
        const j1 = rig.joints[t.ids[1]];
        const d2 = damp(amount, t.twitch, 6, dt);
        servos.set(t.ids[1], j1.rest - s * d2 * 0.45, `foot.${side}`);
      }
    }
  }

  function tickle() {
    reflex = 0.8;
    for (const t of toes) t.twitchTarget = rand(0.4, 0.8);
    log.push({ layer: 'reflex', motor: `foot.${side}`, text: '痒 → 脚趾蜷起' });
  }

  return {
    side,
    toes,
    tick,
    tickle,
    get gesture() {
      return gesture;
    },
    get reflex() {
      return reflex;
    },
  };
}
