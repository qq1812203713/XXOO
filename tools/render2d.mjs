// 离线把 2D 那一层渲染成 PNG —— 这里没有浏览器，靠它我才能真的「看见」她。
// 用法：node tools/render2d.mjs [输出路径] [pose:rest|walk|arms]
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { buildRig, solvePose } from '../src/body/skeleton.js';

const out = process.argv[2] || 'tools/out/2d.png';
const which = process.argv[3] || 'rest';

const W = 460;
const H = 620;
globalThis.window = {
  devicePixelRatio: 1,
  innerWidth: W,
  innerHeight: H,
  addEventListener() {},
};

const canvas = createCanvas(W, H);
const { createRenderer } = await import('../src/render/renderer.js');
const renderer = createRenderer(canvas);
renderer.resize();
renderer.setSprite(await loadImage('assets/girl.png'));

const rig = buildRig();
for (const id of rig.order) rig.joints[id].local = rig.joints[id].rest;

if (which === 'walk') {
  rig.joints['leg_L_thigh'].local = 0.42;
  rig.joints['leg_L_shin'].local = -0.15;
  rig.joints['leg_R_thigh'].local = -0.34;
  rig.joints['leg_R_shin'].local = -0.55;
  rig.joints['arm_L_upper'].local = -0.3;
  rig.joints['arm_R_upper'].local = 0.3;
} else if (which === 'arms') {
  rig.joints['arm_L_upper'].local = 1.2;
  rig.joints['arm_R_upper'].local = 1.2;
  rig.joints['arm_L_fore'].local = -0.5;
  rig.joints['arm_R_fore'].local = -0.5;
}

const pose = solvePose(rig);
const face = {
  state: new Proxy(
    { mood: 'calm', mouth: 0.14, eyeOpen: 0.95, brow: 0, blush: 0.2, pupil: 1, gazeX: 0.15, gazeY: 0, blink: 0, surprise: 0, twitch: 0 },
    { get: (t, k) => (k in t ? t[k] : 0) },
  ),
};
const view = {
  rig,
  pose,
  brain: {
    state: {
      pose,
      root: { x: 0 },
      mood: { tone: 'calm', warmth: 0.5, energy: 0.5 },
      ripples: [],
      walking: false,
      walkPhase: 0,
    },
  },
  face,
  world: { state: { objects: [] }, growth: () => 0, KINDS: {} },
  drives: { v: { arousal: 0.3 } },
};

renderer.draw(view, 1 / 60);
writeFileSync(out, canvas.toBuffer('image/png'));
console.log(`wrote ${out}`);
