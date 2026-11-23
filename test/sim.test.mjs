// 无浏览器的“体外循环”：跑 10 分钟人生，检查身体不会崩、驱力不越界、世界会生长。
import assert from 'node:assert/strict';
import { buildRig, solvePose } from '../src/body/skeleton.js';
import { createServos } from '../src/body/servo.js';
import { createMotors } from '../src/body/motors/index.js';
import { createDrives } from '../src/brain/drives.js';
import { createMemory } from '../src/memory/memory.js';
import { createWorld } from '../src/world/world.js';
import { createSpinal } from '../src/brain/spinal.js';
import { createCortex } from '../src/brain/cortex.js';
import { createBrain } from '../src/brain/brain.js';
import { createLog } from '../src/core/util.js';

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

const DT = 1 / 60;
const pointer = { x: 0, y: 0, active: false };

let goals = new Set();
for (let i = 0; i < 60 * 600; i++) {
  const t = i / 60;
  // 模拟用户偶尔靠近、偶尔戳她
  pointer.active = t % 90 < 12;
  pointer.x = Math.sin(t * 0.4) * 60;
  pointer.y = -40 + Math.cos(t * 0.3) * 20;
  if (i % 900 === 300) brain.onTouch('handR', 'poke', { x: 5, y: -20 });
  if (i % 1500 === 700) brain.onTouch('footL','tickle', { x: 0, y: 80 });
  if (i % 2100 === 1000) brain.onTouch('head', 'pet', { x: 0, y: -80 });

  brain.tick(DT, { pointer, petting: false });
  goals.add(brain.state.goal.type);

  if (i % 600 === 0) {
    const pose = solvePose(rig);
    for (const [id, p] of pose) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `关节 ${id} 位置失效`);
      assert.ok(Math.abs(p.x) < 5000 && Math.abs(p.y) < 5000, `关节 ${id} 飞了`);
    }
    for (const [k, v] of Object.entries(drives.v)) {
      assert.ok(v >= 0 && v <= 1, `驱力 ${k} 越界: ${v}`);
    }
  }
}

const pose = solvePose(rig);
const head = pose.get('head');
console.log('10 分钟后：');
console.log('  目标类型：', [...goals].join(', '));
console.log('  驱力：', Object.entries(drives.v).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' '));
console.log('  世界：', world.summary());
console.log('  记忆条目：', memory.state.episodes.length);
console.log('  头顶位置：', head.x.toFixed(1), head.y.toFixed(1));
console.log('  日志样例：', log.items.slice(0, 6).map((l) => `[${l.layer}] ${l.text}`).join(' | '));

assert.ok(head.y < 0, '头顶应该在地面之上');
assert.ok(memory.state.episodes.length > 0, '她应该记住了至少一件事');
assert.ok(goals.size >= 3, '她应该会自主切换目标');
assert.ok(world.state.objects.length > 0, '她应该自己创造过东西');

// 离线生活
drives.applyOffline(3600 * 1000 * 9);
for (const [k, v] of Object.entries(drives.v)) assert.ok(v >= 0 && v <= 1, `离线后驱力 ${k} 越界`);
memory.offlineEpisodes(9 * 3600 * 1000, { plants: world.state.objects.length });
console.log('离线 9 小时后驱力：', Object.entries(drives.v).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' '));
console.log('OK');
