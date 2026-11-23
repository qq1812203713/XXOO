// 步态的“物理检查”：不渲染，只拿模型真实的腿长，算一遍走路循环。
//
// 为什么要这个：走路是一串数字（步幅、抬脚高度、支撑比例），这些数字必须
// 和时间/腿长对得上 —— 否则脚会插进地里、或者腿被拉直成一瘸一拐。
// 在看不到画面的情况下，这是唯一能证明“她走得像人”的办法。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = path.join(ROOT, 'vendor/model/alicia/AliciaSolid.vrm');

const buf = fs.readFileSync(MODEL);
let off = 12;
let json = null;
const total = buf.readUInt32LE(8);
while (off < total) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8'));
  off += 8 + len;
  off += (4 - (off % 4)) % 4;
}
assert.ok(json, 'GLB 里没有 JSON chunk');

const vrmExt = json.extensions?.VRM || json.extensions?.VRMC_vrm;
const humanBones = vrmExt.humanoid.humanBones;
const nodeOf = new Map();
if (Array.isArray(humanBones)) {
  for (const b of humanBones) nodeOf.set(b.bone, b.node);
} else {
  for (const [name, b] of Object.entries(humanBones)) nodeOf.set(name, b.node);
}

// —— 骨架：局部平移 + 旋转，累积成世界坐标 ——
const parentOf = new Map();
(json.nodes || []).forEach((n, i) => (n.children || []).forEach((c) => parentOf.set(c, i)));

function worldPos(index, depth = 0) {
  const n = json.nodes[index];
  const t = n.translation || [0, 0, 0];
  const q = n.rotation || [0, 0, 0, 1];
  let [x, y, z] = t;
  if (depth < 64 && parentOf.has(index)) {
    const p = parentOf.get(index);
    const pq = json.nodes[p].rotation || [0, 0, 0, 1];
    // 只用旋转把子节点的平移搬到父空间
    const [qx, qy, qz, qw] = pq;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    const rx = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    const ry = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    const rz = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    const pp = worldPos(p, depth + 1);
    x = pp[0] + rx;
    y = pp[1] + ry;
    z = pp[2] + rz;
  }
  void q;
  return [x, y, z];
}

const P = (name) => {
  const i = nodeOf.get(name);
  assert.notEqual(i, undefined, `模型里没有 ${name}`);
  return worldPos(i);
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

for (const side of ['left', 'right']) {
  const hip = P(`${side}UpperLeg`);
  const knee = P(`${side}LowerLeg`);
  const ankle = P(`${side}Foot`);
  const L1 = dist(hip, knee);
  const L2 = dist(knee, ankle);
  const legLen = L1 + L2;
  assert.ok(L1 > 0.05 && L2 > 0.05, `${side} 腿骨长度不对：${L1.toFixed(3)} / ${L2.toFixed(3)}`);

  // 和 src/render/vrm.js 里的 WALK 保持一致
  const WALK = { T: 1.05, stride: 0.26, lift: 0.055, duty: 0.62, sink: 0.035 };
  const ankleY = ankle[1];
  const hipY = hip[1];

  // 身高尺度检查：腿长应该和模型对得上（她大约 1.5m）
  assert.ok(legLen > 0.4 && legLen < 1.2, `${side} 腿长 ${legLen.toFixed(2)}m 不合理`);

  let maxKnee = 0;
  let minKnee = 180;
  let lowestFoot = Infinity;
  let maxReach = 0;

  for (let i = 0; i < 200; i++) {
    const p = i / 200;
    let z;
    let y = ankleY;
    if (p < WALK.duty) {
      z = -WALK.stride / 2 + WALK.stride * (p / WALK.duty);
    } else {
      const u = (p - WALK.duty) / (1 - WALK.duty);
      const e = u * u * (3 - 2 * u);
      z = WALK.stride / 2 - WALK.stride * e;
      y = ankleY + WALK.lift * Math.sin(Math.PI * u);
    }
    const hipH = hipY - WALK.sink;
    const d = Math.hypot(hipH - y, z);
    maxReach = Math.max(maxReach, d);
    assert.ok(Number.isFinite(d), '步态里出现 NaN');

    // 余弦定理：膝盖弯了多少度
    const cosKnee = (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2);
    assert.ok(cosKnee <= 1.0000001 && cosKnee >= -1.0000001, `膝盖角度解不出来：d=${d.toFixed(3)} 腿长=${legLen.toFixed(3)}`);
    // 大腿和小腿之间的内角 → 屈膝角度
    const flex = 180 - (Math.acos(Math.min(1, Math.max(-1, cosKnee))) * 180) / Math.PI;
    minKnee = Math.min(minKnee, flex);
    maxKnee = Math.max(maxKnee, flex);
    lowestFoot = Math.min(lowestFoot, y);
  }

  // 腿不能被拉直（伸直 = 180°，那样膝盖会锁死、看起来像木偶），也不能弯过头
  assert.ok(minKnee > 2, `${side} 腿在某一刻被完全拉直了（屈膝 ${minKnee.toFixed(1)}°），膝盖会锁死`);
  assert.ok(maxKnee > 15, `${side} 膝盖几乎不弯（最多 ${maxKnee.toFixed(1)}°），走起来像在滑行`);
  assert.ok(maxKnee < 75, `${side} 膝盖弯得太狠（${maxKnee.toFixed(1)}°）`);
  // 脚不能穿到地面以下
  assert.ok(Math.abs(lowestFoot - ankleY) < 1e-6, `${side} 脚穿进地里了：${lowestFoot.toFixed(3)}`);
  // 步幅必须是腿能到的（够不到 → 脚打滑）
  assert.ok(maxReach < legLen * 0.999, `${side} 步幅超过腿长：需要 ${maxReach.toFixed(3)}，只有 ${legLen.toFixed(3)}`);

  const speed = (WALK.stride * 2) / WALK.T;
  console.log(
    `${side}: 腿 ${legLen.toFixed(2)}m（大腿 ${L1.toFixed(2)} / 小腿 ${L2.toFixed(2)}）` +
      ` 膝 ${minKnee.toFixed(0)}–${maxKnee.toFixed(0)}° 最远 ${(maxReach / legLen).toFixed(2)}×腿长 速度 ${speed.toFixed(2)}m/s`,
  );
}
console.log('OK');
