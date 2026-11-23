// 脑干 / 脊髓：不需要“想”就会发生的事 —— 呼吸、眨眼、重心、发抖。
// 这一层让一个静止的角色看起来仍然“在”。
import { clamp, damp, noise1, rand, chance } from '../core/util.js';

export function createSpinal() {
  const posture = {
    breath: 0,
    breathRate: 0.26,
    sway: 0,
    lean: 0,
    weight: 0,
    sit: 0,
    walking: false,
    walkPhase: 0,
    shiver: 0,
    blink: 0,
    drowsy: 0,
  };

  let t = 0;
  let nextBlink = rand(2, 6);
  let blinkLeft = 0;
  let doubleBlink = 0;

  function tick(dt, ctx = {}) {
    t += dt;
    const drive = ctx.drives || {};
    const mood = ctx.mood || 'calm';

    // 呼吸频率：激动/累/睡着都不同
    const targetRate = 0.18 + (drive.arousal || 0) * 0.5 + (mood === 'sleepy' ? -0.08 : 0) + (mood === 'happy' ? 0.08 : 0);
    posture.breathRate = damp(posture.breathRate, clamp(targetRate, 0.1, 0.7), 0.8, dt);
    posture.breath = Math.sin(t * posture.breathRate * Math.PI * 2);

    // 摆动：两个不同频率的噪声叠加，永远不完全重复
    posture.sway = noise1(t * 0.09, 3) * 0.6 + noise1(t * 0.31, 11) * 0.4;
    posture.lean = noise1(t * 0.05, 7);
    posture.weight = noise1(t * 0.13, 19);

    posture.shiver = Math.max(0, posture.shiver - dt * 0.9);

    // 眨眼：随机的、偶尔连眨两下
    nextBlink -= dt;
    if (blinkLeft > 0) {
      blinkLeft -= dt;
      const p = 1 - Math.abs(blinkLeft / 0.13 - 0.5) * 2;
      posture.blink = clamp(p, 0, 1);
      if (blinkLeft <= 0) {
        posture.blink = 0;
        if (doubleBlink > 0) {
          doubleBlink -= 1;
          nextBlink = 0.09;
        }
      }
    } else if (nextBlink <= 0) {
      blinkLeft = 0.13;
      if (chance(0.22)) doubleBlink = 1;
      nextBlink = rand(2.2, 7.5) * (mood === 'sleepy' ? 0.6 : 1);
    }

    // 困的时候眼皮半垂
    posture.drowsy = damp(posture.drowsy, mood === 'sleepy' ? 1 : 0, 1.2, dt);
  }

  function flinch(amount = 1) {
    posture.shiver = Math.max(posture.shiver, amount);
  }

  return { posture, tick, flinch };
}
