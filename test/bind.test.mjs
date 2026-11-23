// 骨骼 → Live2D 参数 的连通性测试。
//
// 这个测试不需要浏览器，但它比“看一眼”更硬：它用 Live2D 官方 Core 解析真实的
// haru_greeter_t03.moc3，拿到 42 个参数的合法区间，然后跑 30 秒人生，
// 逐帧检查 binder 吐出来的每个值：
//   1. 参数名在这个模型里真的存在（否则模型会静默忽略，等于白接）；
//   2. 值有限、且落在模型允许的 min..max 里（越界会把她拧变形）；
//   3. 头、手臂、手、嘴、呼吸这些映射真的在变（不是接了个常数）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildRig } from '../src/body/skeleton.js';
import { createServos } from '../src/body/servo.js';
import { createMotors } from '../src/body/motors/index.js';
import { createDrives } from '../src/brain/drives.js';
import { createMemory } from '../src/memory/memory.js';
import { createWorld } from '../src/world/world.js';
import { createSpinal } from '../src/brain/spinal.js';
import { createCortex } from '../src/brain/cortex.js';
import { createBrain } from '../src/brain/brain.js';
import { createLog } from '../src/core/util.js';
import { createBinder } from '../src/render/bind.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// —— 1. 用官方 Core 读出这个模型真正接受哪些参数、区间是多少 ——
const doc = {
  currentScript: { src: 'file:///core.js' },
  createElement: () => ({ getContext: () => null }),
  documentElement: {},
  addEventListener() {},
};
const sandbox = { console, WebAssembly, Math, Date, TextDecoder, TextEncoder, document: doc, location: { href: 'file:///' }, setTimeout, clearTimeout };
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/live2dcubismcore.min.js'), 'utf8'), sandbox);

const Core = sandbox.Live2DCubismCore;
const mocBuf = fs.readFileSync(path.join(ROOT, 'vendor/model/haru/haru_greeter_t03.moc3'));
const moc = Core.Moc.fromArrayBuffer(mocBuf.buffer.slice(mocBuf.byteOffset, mocBuf.byteOffset + mocBuf.byteLength));
const model = Core.Model.fromMoc(moc);
const P = model.parameters;

const spec = new Map();
for (let i = 0; i < P.count; i++) {
  spec.set(P.ids[i], { min: P.minimumValues[i], max: P.maximumValues[i], def: P.defaultValues[i] });
}
console.log(`模型参数 ${spec.size} 个（Cubism Core ${Core.Version.csmGetVersion ? '' : ''}${sandbox.Live2DCubismCore.Moc ? '' : ''}已加载）`);

// —— 2. 搭一具会思考的身体 ——
const log = createLog(40);
const rig = buildRig();
const servos = createServos(rig);
const motors = createMotors({ rig, servos, log });
const drives = createDrives();
const memory = createMemory();
const world = createWorld();
const spinal = createSpinal();
const cortex = createCortex({ log });
const brain = createBrain({ rig, servos, motors, drives, memory, world, spinal, cortex, log });
const face = motors.parts.face;
const binder = createBinder();

const DT = 1 / 60;
const pointer = { x: 0, y: -30, active: true };
const stats = new Map();
const seen = new Set();
let frames = 0;

function record(params) {
  frames++;
  for (const k in params) {
    const v = params[k];
    seen.add(k);
    if (!Number.isFinite(v)) throw new Error(`参数 ${k} 不是有限数：${v}`);
    const s = spec.get(k);
    if (!s) throw new Error(`模型里没有参数 ${k} —— 这条映射是死的`);
    const eps = 1e-3;
    if (v < s.min - eps || v > s.max + eps) {
      throw new Error(`参数 ${k}=${v.toFixed(3)} 超出模型区间 ${s.min}..${s.max}`);
    }
    const rec = stats.get(k) || { min: Infinity, max: -Infinity };
    rec.min = Math.min(rec.min, v);
    rec.max = Math.max(rec.max, v);
    stats.set(k, rec);
  }
}

// 30 秒：前 10 秒安静待着，中间走动/被戳，最后说话
for (let i = 0; i < 60 * 30; i++) {
  const t = i / 60;
  pointer.x = Math.sin(t * 0.9) * 70;
  pointer.y = -30 + Math.cos(t * 1.3) * 26;
  pointer.active = t % 20 < 15;
  if (i === 600) brain.onTouch('head', 'pet', { x: 0, y: -80 });
  if (i === 900) brain.onTouch('handR', 'poke', { x: 8, y: -20 });
  if (i === 400) brain.say('唔。你回来啦。');
  if (i === 1400) brain.respond?.('你今天怎么这么安静呀');
  brain.tick(DT, { pointer, petting: i > 700 && i < 800 });
  record(binder.compute(brain.state.pose, face, brain, DT));
}

// —— 3. 断言 ——
const must = [
  'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
  'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'ParamBodyUpper',
  'ParamArmLA', 'ParamArmRA', 'ParamArmLB', 'ParamArmRB',
  'ParamHandAngleL', 'ParamHandAngleR',
  'ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeBallX', 'ParamEyeBallY',
  'ParamMouthOpenY', 'ParamMouthForm', 'ParamBreath',
];
for (const id of must) assert.ok(seen.has(id), `没有输出必接参数 ${id}`);

// 必须真的在动（不是常数）
const moving = ['ParamAngleX', 'ParamAngleZ', 'ParamArmLA', 'ParamArmLB', 'ParamMouthOpenY', 'ParamBreath'];
for (const id of moving) {
  const r = stats.get(id);
  assert.ok(r.max - r.min > 0.01, `${id} 几乎没变化（${r.min.toFixed(3)}..${r.max.toFixed(3)}），说明没接上`);
}

// 不能长期顶在夹紧边界上：那是“接错了增益”的典型症状（她会一直歪着脖子）
for (const id of ['ParamAngleZ', 'ParamBodyAngleZ']) {
  const r = stats.get(id);
  const s0 = spec.get(id);
  assert.ok(r.max < s0.max - 0.01 && r.min > s0.min + 0.01, `${id} 顶到了模型边界 ${s0.min}..${s0.max}，增益过大`);
}

console.log(`跑了 ${frames} 帧，映射到 ${seen.size} 个模型参数，全部在模型区间内。`);
const show = ['ParamAngleZ', 'ParamAngleX', 'ParamArmLA', 'ParamArmLB', 'ParamHandAngleL', 'ParamBodyAngleZ', 'ParamMouthOpenY', 'ParamBreath'];
for (const id of show) {
  const r = stats.get(id);
  console.log(`  ${id.padEnd(18)} ${r.min.toFixed(2).padStart(7)} … ${r.max.toFixed(2).padStart(6)}`);
}
console.log('OK');
process.exit(0);
