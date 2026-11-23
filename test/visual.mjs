// 用 @napi-rs/canvas 在 Node 里跑真实渲染，导出截图 —— 没有浏览器也能看见她的样子。
// 运行：node test/visual.mjs
import fs from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { buildRig } from '../src/body/skeleton.js';
import { createServos } from '../src/body/servo.js';
import { createMotors } from '../src/body/motors/index.js';
import { createDrives } from '../src/brain/drives.js';
import { createMemory } from '../src/memory/memory.js';
import { createWorld } from '../src/world/world.js';
import { createSpinal } from '../src/brain/spinal.js';
import { createCortex } from '../src/brain/cortex.js';
import { createBrain } from '../src/brain/brain.js';
import { createRenderer } from '../src/render/renderer.js';
import { createLog } from '../src/core/util.js';

const W = 430;
const H = 800;
const DPR = 2;

globalThis.window = { devicePixelRatio: DPR, innerWidth: W, innerHeight: H };
globalThis.document = { body: {} };

const log = createLog(80);
const rig = buildRig();
const servos = createServos(rig);
const motors = createMotors({ rig, servos, log });
const drives = createDrives();
const memory = createMemory();
const world = createWorld();
const spinal = createSpinal();
const cortex = createCortex({ log });
const brain = createBrain({ rig, servos, motors, drives, memory, world, spinal, cortex, log });

const canvas = createCanvas(W * DPR, H * DPR);
canvas.clientWidth = W;
canvas.clientHeight = H;
const renderer = createRenderer(canvas);

fs.mkdirSync('test/shots', { recursive: true });

const shots = [
  { at: 3, name: '01-idle.png' },
  { at: 9, name: '02-create.png', prepare: () => brain.forceGoal('create') },
  { at: 15, name: '03-hand.png', prepare: () => brain.onTouch('handR', 'poke', { x: 6, y: -10 }) },
  { at: 21, name: '04-foot.png', prepare: () => brain.onTouch('footL', 'tickle', { x: 0, y: 84 }) },
  { at: 30, name: '05-walk.png', prepare: () => brain.forceGoal('wander') },
];

const DT = 1 / 60;
let frame = 0;
const totalFrames = Math.ceil(30 / DT);
let shotIndex = 0;

for (let i = 0; i < totalFrames; i++) {
  const t = i * DT;
  while (shotIndex < shots.length && t >= shots[shotIndex].at) {
    const shot = shots[shotIndex];
    shot.prepare?.();
    // 截图前让它走几帧，把姿势稳定下来
    for (let k = 0; k < 90; k++) {
      brain.tick(DT, { pointer: { x: -30, y: -60, active: true }, petting: false });
      renderer.draw({ rig, brain, face: motors.parts.face, world, drives, cortex, memory }, DT);
    }
    fs.writeFileSync(`test/shots/${shot.name}`, canvas.toBuffer('image/png'));
    console.log('saved', shot.name, 't=', t.toFixed(1), 'goal=', brain.state.goal.type);
    shotIndex++;
  }

  const pointerActive = t > 4;
  brain.tick(DT, {
    pointer: { x: Math.sin(t * 0.5) * 40, y: -50 + Math.cos(t * 0.4) * 20, active: pointerActive },
    petting: false,
  });
  renderer.draw({ rig, brain, face: motors.parts.face, world, drives, cortex, memory }, DT);
  frame++;
}

// 神经面板里的手脚特写
for (const [side, part] of [
  ['L', 'hand'],
  ['R', 'foot'],
]) {
  const c = createCanvas(300 * 2, 220 * 2);
  const g = c.getContext('2d');
  g.setTransform(2, 0, 0, 2, 0, 0);
  renderer.drawInspector(g, { rig, pose: brain.state.pose, side, part, width: 300, height: 220 });
  fs.writeFileSync(`test/shots/inspector-${side}-${part}.png`, c.toBuffer('image/png'));
  console.log('saved inspector', side, part);
}

console.log('done, frames =', frame);
