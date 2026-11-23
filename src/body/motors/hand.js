// 手部运动程序：大脑只会说“张开 / 握紧 / 挥手 / 指一下 / 按下去”，
// 剩下的活——20 节指骨各自的相位、延迟、抽搐——由这个脚本自己完成。
import { clamp, damp, rand, chance, TAU } from '../../core/util.js';
import { FINGERS } from '../skeleton.js';

const LABEL = {
  idle: '放松',
  open: '张开',
  fist: '握紧',
  point: '指',
  wave: '挥手',
  press: '按下去',
  reach: '伸出去',
  hold: '托住',
};

export function createHand(side, { rig, servos, log }) {
  const s = side === 'L' ? -1 : 1;
  const fingers = FINGERS.map((f) => ({
    name: f.name,
    ids: f.segs.map((_, i) => `${side}_${f.name}_${i}`),
    bend: f.bend,
    phase: rand(0, TAU),
    twitch: 0,
    twitchTarget: 0,
    curl: 0.16,
    speed: rand(0.85, 1.2),
  }));

  let gesture = 'idle';
  let reflex = 0;

  function announce(g) {
    if (g === gesture) return;
    gesture = g;
    log.push({ layer: 'motor', motor: `hand.${side}`, text: `手势 → ${LABEL[g] || g}` });
  }

  function tick(dt, ctx) {
    const intent = ctx.intent || {};
    const g = intent[`hand${side}`] || 'idle';
    announce(g);
    reflex = Math.max(0, reflex - dt * 1.6);

    // 每个指头都跑自己的时钟
    for (let fi = 0; fi < fingers.length; fi++) {
      const f = fingers[fi];
      let target = 0.55 + 0.06 * Math.sin(ctx.time * 0.7 + f.phase);
      let spread = 0;

      switch (g) {
        case 'open':
          target = 0.05;
          spread = 0.6;
          break;
        case 'fist':
          target = 1;
          break;
        case 'point':
          target = f.name === 'index' ? 0.03 : 0.88;
          spread = 0.25;
          break;
        case 'wave':
          target = 0.1 + 0.16 * Math.sin(ctx.time * 8 + fi * 0.8);
          spread = 0.45;
          break;
        case 'press':
          target = 0.42 + 0.1 * Math.sin(ctx.time * 2.1);
          break;
        case 'hold':
          target = 0.28;
          spread = 0.3;
          break;
        case 'reach':
          target = 0.2;
          spread = 0.2;
          break;
        default:
          target = 0.55;
      }

      // 独立的随机小动作：这是“脚本化生命感”的来源之一
      if (chance(dt * 0.45)) f.twitchTarget = rand(0.2, 0.55);
      f.twitchTarget *= Math.exp(-dt * 1.5);
      f.twitch = damp(f.twitch, f.twitchTarget, 9, dt);

      target = clamp(target + f.twitch * 0.5 + reflex * 0.8, 0, 1);

      // 逐节指骨有自己的延迟，手指才不会像一根塑料棍
      let delay = 0;
      for (let i = 0; i < f.ids.length; i++) {
        const j = rig.joints[f.ids[i]];
        delay = damp(delay, target, 20 / (1 + i * 0.5), dt);
        const bend = (f.bend[i] ?? 0.5) * delay + spread * 0.09;
        servos.set(f.ids[i], j.rest + s * bend, `hand.${side}`);
      }
      f.curl = damp(f.curl, target, 10, dt);
    }

    // 手腕
    let wrist = 0.05 * Math.sin(ctx.time * 0.5 + (side === 'L' ? 0 : 2.1));
    if (g === 'wave') wrist = Math.sin(ctx.time * 8) * 0.38;
    if (g === 'point') wrist = -s * 0.12;
    servos.set(`hand_${side}`, rig.joints[`hand_${side}`].rest + wrist, `hand.${side}`);
  }

  function poke() {
    reflex = 0.7;
    log.push({ layer: 'reflex', motor: `hand.${side}`, text: '被碰到 → 手指收缩' });
  }

  return {
    side,
    fingers,
    tick,
    poke,
    get gesture() {
      return gesture;
    },
    get reflex() {
      return reflex;
    },
  };
}
