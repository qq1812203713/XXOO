// 脸：没有骨头，只有参数。但这些参数决定了“她是不是在那儿”。
import { clamp, damp, lerp, rand } from '../../core/util.js';

const MOODS = {
  calm: { mouth: 0.14, brow: 0, open: 0.88, blush: 0.12 },
  happy: { mouth: 0.72, brow: 0.12, open: 0.95, blush: 0.45 },
  shy: { mouth: 0.3, brow: 0.2, open: 0.75, blush: 1 },
  curious: { mouth: 0.22, brow: 0.4, open: 1.1, blush: 0.15 },
  sleepy: { mouth: -0.05, brow: -0.05, open: 0.42, blush: 0.2 },
  sad: { mouth: -0.5, brow: 0.24, open: 0.78, blush: 0.1 },
  startled: { mouth: 0.1, brow: 0.55, open: 1.25, blush: 0.3 },
};

export function createFace({ log }) {
  const state = {
    mood: 'calm',
    mouth: 0.12,
    eyeOpen: 1,
    brow: 0,
    blush: 0.1,
    pupil: 1,
    gazeX: 0,
    gazeY: 0,
    blink: 0,
    surprise: 0,
    twitch: 0,
  };

  function setMood(m) {
    if (!MOODS[m] || m === state.mood) return;
    state.mood = m;
    log.push({ layer: 'face', motor: 'face', text: `表情 → ${m}` });
  }

  function tick(dt, ctx) {
    const m = MOODS[state.mood] || MOODS.calm;
    state.surprise = Math.max(0, state.surprise - dt * 1.1);

    // 眼睛跟随：把注视点换算成瞳孔偏移比例（渲染层再做投影）
    const intent = ctx.intent || {};
    let gx = 0;
    let gy = 0;
    if (intent.lookAt && ctx.pose.get('head')) {
      const head = ctx.pose.get('head');
      const dx = intent.lookAt.x - head.x;
      const dy = intent.lookAt.y - head.y;
      const d = Math.hypot(dx, dy) || 1;
      gx = clamp(dx / d * 1.4, -1, 1);
      gy = clamp(dy / d * 1.4, -1, 1);
    }
    state.gazeX = damp(state.gazeX, gx, 8, dt);
    state.gazeY = damp(state.gazeY, gy, 8, dt);

    state.mouth = damp(state.mouth, m.mouth + state.surprise * 0.3, 6, dt);
    state.eyeOpen = damp(state.eyeOpen, m.open + state.surprise * 0.35, 8, dt);
    state.brow = damp(state.brow, m.brow + state.surprise * 0.5, 7, dt);
    state.blush = damp(state.blush, m.blush, 1.6, dt);
    state.pupil = damp(state.pupil, 1 + state.surprise * 0.35, 9, dt);
    state.blink = ctx.posture ? ctx.posture.blink : 0;
    state.twitch = 0.6 * Math.max(0, Math.sin(ctx.time * 0.4)) * Math.sin(ctx.time * 11) * (state.mood === 'curious' ? 1 : 0.2);
  }

  function startle() {
    state.surprise = 1;
    state.mood = 'startled';
    log.push({ layer: 'reflex', motor: 'face', text: '惊讶' });
  }

  return { state, setMood, tick, startle, MOODS };
}
