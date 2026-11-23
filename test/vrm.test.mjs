// 3D 身体的“接线检查”：不渲染，但把 .vrm 文件本身拆开，逐条核对我们的映射表。
//
// 这一步能抓住最尴尬的一类错误：代码写得好好的，但目标模型的骨架里根本没有那根骨头，
// 于是 setRotation 静默地什么也没发生 —— 你看到的就是“她不动”，而且没有任何报错。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRig } from '../src/body/skeleton.js';
import { REQUIRED_BONES, USED_EXPRESSIONS } from '../src/render/vrm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = path.join(ROOT, 'vendor/model/alicia/AliciaSolid.vrm');

assert.ok(fs.existsSync(MODEL), `模型不存在：${MODEL}`);
const buf = fs.readFileSync(MODEL);

// —— 拆 GLB ——
assert.equal(buf.readUInt32LE(0), 0x46546c67, '不是 GLB 文件');
const total = buf.readUInt32LE(8);
let off = 12;
let json = null;
while (off < total) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8'));
  off += 8 + len;
  off += (4 - (off % 4)) % 4;
}
assert.ok(json, 'GLB 里没有 JSON chunk');

const vrmExt = json.extensions?.VRM || json.extensions?.VRMC_vrm;
assert.ok(vrmExt, '没有 VRM 扩展，这不是 VRM 模型');

// —— 骨架 ——
const bones = new Set(
  (vrmExt.humanoid?.humanBones || vrmExt.humanoid?.humanBones || []).map((b) => b.bone || b.node),
);
const boneNames = new Set([...bones].map(String));
console.log(`模型骨架 ${boneNames.size} 根（${vrmExt.meta?.title || vrmExt.meta?.name || '未命名'}）`);

const missing = REQUIRED_BONES.filter((b) => !boneNames.has(b));
assert.deepEqual(missing, [], `模型缺少这些骨骼：${missing.join(', ')}`);

// —— 手指：模型有 30 根，我们的骨架必须也有 30 个对应关节 ——
const rig = buildRig();
const rigIds = Object.keys(rig.joints);
// 骨架：拇指 2 节 + 其余四指 3 节 → 每只手 14 个关节，共 28
const fingerJoints = rigIds.filter((id) => /^[LR]_(thumb|index|middle|ring|pinky)_\d$/.test(id));
assert.equal(fingerJoints.length, 28, `骨架里手指关节应有 28 个，实际 ${fingerJoints.length}`);
// 模型：5 指 × 3 节 × 2 手 = 30 根
assert.equal([...boneNames].filter((b) => /(Thumb|Index|Middle|Ring|Little)(Proximal|Intermediate|Distal)$/.test(b)).length, 30);

// 每一根指骨都要有对应的骨架关节（名字对得上）
const pairs = [];
for (const side of ['L', 'R']) {
  const s = side === 'L' ? 'left' : 'right';
  for (const [bone, rig_] of [['Thumb', 'thumb'], ['Index', 'index'], ['Middle', 'middle'], ['Ring', 'ring'], ['Little', 'pinky']]) {
    const segs = ['Proximal', 'Intermediate', 'Distal'];
    for (let i = 0; i < 3; i++) {
      const boneName = `${s}${bone}${segs[i]}`;
      const rigIdx = Math.min(i, rig_ === 'thumb' ? 1 : 2); // 拇指第三根骨借用第二节
      const rigId = `${side}_${rig_}_${rigIdx}`;
      assert.ok(boneNames.has(boneName), `模型缺指骨 ${boneName}`);
      assert.ok(rigIds.includes(rigId), `骨架缺关节 ${rigId}`);
      pairs.push([rigId, boneName]);
    }
  }
}
console.log(`手指映射：${pairs.length} 根指骨 → 骨架关节（拇指末端借用第二节，其余 1:1）`);

// —— 表情 ——
const groups = (vrmExt.blendShapeMaster?.blendShapeGroups || []).map((g) => g.presetName || g.name);
const exprs = new Set(groups.map((g) => String(g).toLowerCase()));
const noExpr = USED_EXPRESSIONS.filter((e) => !exprs.has(e.toLowerCase()) && !exprs.has(e === 'a' ? 'a' : e));
assert.deepEqual(noExpr, [], `模型没有这些表情：${noExpr.join(', ')}，代码里用到会在运行时静默失效`);
console.log(`表情：用到 ${USED_EXPRESSIONS.join('/')}，模型都有（共 ${exprs.size} 组）`);

// —— 身体部件数量 ——
console.log(`网格 ${json.meshes?.length} 个，材质 ${json.materials?.length} 个，节点 ${json.nodes?.length} 个`);
console.log('OK');
process.exit(0);
