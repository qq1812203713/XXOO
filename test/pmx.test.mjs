// PMX 建模解析、VRM 人形适配与完整 create3DBody 管线验证：
// 用真实的 Three.js 与 src/render/vrm.js 在 Node 里跑通 `jianmo/温迪.pmx` 的解析、
// 骨骼映射、付与旋转、刚体挂件接回、全套动作烘焙、手势弯曲校准、表情与步态检查。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

import * as THREE from '../vendor/three.module.js';
import { isPMXBuffer, parsePMX, mapPMXBones, buildPMXVRM, patchPMXToonFragmentShader } from '../src/render/pmx.js';
import { create3DBody, REQUIRED_BONES, USED_EXPRESSIONS, MODELS, MODEL_ORDER } from '../src/render/vrm.js';
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = path.join(ROOT, 'jianmo/温迪.pmx');

assert.ok(fs.existsSync(MODEL), `模型不存在：${MODEL}`);
assert.deepEqual(MODEL_ORDER, ['wendi'], '仅保留温迪模型');
assert.deepEqual(Object.keys(MODELS), ['wendi'], 'MODELS 仅包含 wendi');
assert.equal(MODELS.wendi?.type, 'pmx');

const rawBuf = fs.readFileSync(MODEL);
const ab = rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength);
assert.ok(isPMXBuffer(ab), '文件头应为 PMX');

const parsed = parsePMX(ab);
assert.equal(parsed.vertexCount, 16211);
assert.equal(parsed.materials.length, 10);
assert.equal(parsed.bones.length, 355);

// 1. 验证未设父骨的胸前飘带（ys1 / M-ys1）已通过刚体关节自动接回 上半身2
const byName = new Map(parsed.bones.map((b) => [b.name, b]));
assert.equal(parsed.bones[byName.get('ys1').parent]?.name, '上半身2', 'ys1 应自动接回 上半身2');
assert.equal(parsed.bones[byName.get('M-ys1').parent]?.name, '上半身2', 'M-ys1 应自动接回 上半身2');

// 2. 验证镜像左手->右手系后 left* 在 -X、right* 在 +X、脚趾朝 -Z
const boneMap = mapPMXBones(parsed.bones);
const OPTIONAL = new Set(['upperChest']);
const missing = REQUIRED_BONES.filter((b) => !OPTIONAL.has(b) && boneMap[b] === undefined);
assert.deepEqual(missing, [], `缺少必须骨骼：${missing.join(', ')}`);

assert.ok(parsed.bones[boneMap.leftUpperArm].pos[0] < 0, 'leftUpperArm 应在 -X');
assert.ok(parsed.bones[boneMap.rightUpperArm].pos[0] > 0, 'rightUpperArm 应在 +X');
assert.ok(
  parsed.bones[boneMap.leftToes].pos[2] < parsed.bones[boneMap.leftFoot].pos[2],
  'leftToes 应在 leftFoot 前方（-Z）',
);

// 3. 构造成 Three.js VRM 兼容对象（含兜底贴图）
const vrm = buildPMXVRM(THREE, parsed, new Map(), {
  createCanvas: (w, h) => createCanvas(w, h),
});
assert.ok(vrm.isPMX);
assert.equal(vrm.mesh.material.length, 10);
assert.ok(vrm.mesh.morphTargetInfluences.length >= 15, '应生成表情变形目标');

const EMAP = {
  joy: ['happy', 'joy'],
  sorrow: ['sad', 'sorrow'],
  fun: ['relaxed', 'fun'],
  angry: ['angry'],
  neutral: ['neutral'],
  blink: ['blink'],
  a: ['aa', 'a'],
  i: ['ih', 'i'],
  u: ['ou', 'u'],
  e: ['ee', 'e'],
  o: ['oh', 'o'],
};
for (const expr of USED_EXPRESSIONS) {
  const key = (EMAP[expr] || [expr]).find((k) => k in vrm.expressionManager.expressionMap);
  assert.ok(key, `表情 ${expr} 在 PMX expressionMap 中未找到`);
}

vrm.expressionManager.setValue('blink', 1);
assert.ok(vrm.mesh.morphTargetInfluences.some((v) => v > 0.5), 'blink 未驱动 morphTargetInfluences');
vrm.expressionManager.setValue('blink', 0);

// 4. 验证 D 骨与付与旋转（右/左足 -> 右/左足D、腰 -> 腰キャンセル、右ひじ -> 右ひじ補助）
const nHip = vrm.humanoid.getNormalizedBoneNode('hips');
const nLegL = vrm.humanoid.getNormalizedBoneNode('leftUpperLeg');
const nKneeL = vrm.humanoid.getNormalizedBoneNode('leftLowerLeg');
const nElbowR = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');

nHip.quaternion.setFromEuler(new THREE.Euler(0.15, 0.35, 0));
nLegL.quaternion.setFromEuler(new THREE.Euler(-0.5, 0, 0));
nKneeL.quaternion.setFromEuler(new THREE.Euler(0.7, 0, 0));
nElbowR.quaternion.setFromEuler(new THREE.Euler(0, 0, -0.8));
vrm.update(1 / 60);

const rawLegL = vrm.mesh.skeleton.bones[boneMap.leftUpperLeg];
const rawLegLD = vrm.mesh.skeleton.bones[byName.get('左足D').index];
const rawKneeLD = vrm.mesh.skeleton.bones[byName.get('左ひざD').index];
const rawElbowRHelp = vrm.mesh.skeleton.bones[byName.get('右ひじ補助').index];

const qLegL = new THREE.Quaternion();
const qLegLD = new THREE.Quaternion();
const qNormLegL = new THREE.Quaternion();
nLegL.getWorldQuaternion(qNormLegL);
rawLegL.getWorldQuaternion(qLegL);
rawLegLD.getWorldQuaternion(qLegLD);

assert.ok(Math.abs(qLegL.dot(qNormLegL)) > 0.999, '左足未对齐 normalized leftUpperLeg 世界旋转');
assert.ok(Math.abs(qLegLD.dot(qNormLegL)) > 0.999, '左足D 未继承左足的旋转');

const qNormKneeL = new THREE.Quaternion();
const qKneeLD = new THREE.Quaternion();
nKneeL.getWorldQuaternion(qNormKneeL);
rawKneeLD.getWorldQuaternion(qKneeLD);
assert.ok(Math.abs(qKneeLD.dot(qNormKneeL)) > 0.999, '左ひざD 未继承左ひざ的旋转');
assert.ok(Math.abs(rawElbowRHelp.quaternion.z) > 0.1, '右ひじ補助未跟随右ひじ屈伸');

// 5. 完整跑通 create3DBody（含动作烘焙、手势校准、胯宽测量、表情、神经帧）
const origFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const s = String(url);
  if (s === './jianmo/温迪.pmx') {
    const b = fs.readFileSync(MODEL);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    };
  }
  return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
};

let body;
try {
  const canvasStub = { clientWidth: 430, clientHeight: 800, width: 430, height: 800 };
  const rendererStub = {
    domElement: canvasStub,
    setPixelRatio() {},
    setSize() {},
    setClearAlpha() {},
    render() {},
    dispose() {},
  };
  body = await create3DBody({
    canvas: canvasStub,
    modelUrl: MODELS.wendi.url,
    modelType: MODELS.wendi.type,
    renderer: rendererStub,
    createCanvas: (w, h) => createCanvas(w, h),
  });
} finally {
  globalThis.fetch = origFetch;
}

assert.ok(body, 'create3DBody 应返回有效身体对象');
assert.ok(body.facingCamera() > 0.99, `温迪应正对相机，实际 facing=${body.facingCamera()}`);

const dbg = body.debugState();
assert.equal(dbg.clipErr, null, `动作烘焙出现错误：${JSON.stringify(dbg.clipErr)}`);
assert.ok(dbg.curlCheck.l?.calib?.down !== undefined && dbg.curlCheck.l?.calib?.up !== undefined, '左手屈曲校准应有结果');
assert.ok(dbg.curlCheck.r?.calib?.down !== undefined && dbg.curlCheck.r?.calib?.up !== undefined, '右手屈曲校准应有结果');
// 手指弯曲必须朝手腕收拢（即对应 calib 方向距离严格小于伸直距离）
assert.ok(
  Math.min(dbg.curlCheck.l.calib.up, dbg.curlCheck.l.calib.down) < dbg.curlCheck.l.calib.straight - 0.005,
  '左手屈曲方向未向掌心收拢',
);
assert.ok(
  Math.min(dbg.curlCheck.r.calib.up, dbg.curlCheck.r.calib.down) < dbg.curlCheck.r.calib.straight - 0.005,
  '右手屈曲方向未向掌心收拢',
);
// 胯宽测量不应被披风或袖子拉大到 0.3m 以上，手垂落 X 应落在 [0.14, 0.25] 之间
assert.ok(
  Math.abs(dbg.hands.l[0]) > 0.14 && Math.abs(dbg.hands.l[0]) < 0.25,
  `左手悬垂位置异常：${JSON.stringify(dbg.hands.l)}`,
);
assert.ok(
  Math.abs(dbg.hands.r[0]) > 0.14 && Math.abs(dbg.hands.r[0]) < 0.25,
  `右手悬垂位置异常：${JSON.stringify(dbg.hands.r)}`,
);

// 驱动几秒真实动作（walk / bow / wave + 情绪）
const log = createLog(20);
const rig = buildRig();
const servos = createServos(rig);
const motors = createMotors({ rig, servos, log });
const brain = createBrain({
  rig,
  servos,
  motors,
  drives: createDrives(),
  memory: createMemory(),
  world: createWorld(),
  spinal: createSpinal(),
  cortex: createCortex({ log }),
  log,
});

for (const [actName, sec, mood] of [
  ['walk', 0.25, 'happy'],
  ['bow', 1.35, 'calm'],
  ['wave', 0.85, 'shy'],
]) {
  assert.ok(body.play(actName), `应支持播放动作 ${actName}`);
  body.freezeAt(actName, sec);
  body.setMoodOverride(mood);
  brain.tick(1 / 60, { pointer: { x: 0, y: 0, active: false }, petting: false });
  body.sync(brain, motors.parts.face, 1 / 60);
  const nf = body.nerveFrame();
  assert.ok(nf.bones.length >= 50, 'nerveFrame 骨骼数量不足');
  assert.equal(nf.fingers.length, 10, 'nerveFrame 应包含 10 根手指');
  for (const b of nf.bones) {
    assert.ok(Number.isFinite(b.x + b.y + b.z), `骨骼 ${b.n} 出现非有限坐标`);
  }
}

// 5b. 验证手指自然放松与握拳动画（不能再因局部角累加/拇指错轴而翻折成爪子）
assert.ok(body.play('idle'), '应支持切换回 idle');
for (let i = 0; i < 40; i++) body.sync(brain, motors.parts.face, 1 / 60);
const nfIdle = body.nerveFrame();
for (const fin of nfIdle.fingers) {
  assert.ok(
    fin.maxBend < 45,
    `idle 时 ${fin.side} ${fin.finger} 单节弯曲角应自然放松 (<45°)，实际 ${fin.maxBend.toFixed(1)}°`,
  );
}
assert.ok(body.play('grip'), '应支持播放 grip 握拳动作');
for (let i = 0; i < 36; i++) body.sync(brain, motors.parts.face, 1 / 60);
const dbgGrip = body.debugState();
assert.ok(
  dbgGrip.curlCheck.r.curlOK > 0.025 && dbgGrip.curlCheck.l.curlOK > 0.025,
  `grip 时双手手指应向掌心自然握拢，实际 ${JSON.stringify(dbgGrip.curlCheck)}`,
);
assert.equal(body.play('turnL'), false, '已移除 turnL 转身动作');
assert.equal(body.play('turnR'), false, '已移除 turnR 转身动作');
assert.equal(dbgGrip.yaw, 0, '移除转身后舞台偏航角 yaw 应保持为 0');

// 6. 验证颊红 照れ 与材质透明渐变、眼珠联动 目戻、多材质装扮显隐 (?hide=)
const exprMat = body.vrm.mesh.material.find((m) => m.name === '表情');
assert.ok(exprMat, '应存在 表情 贴图材质');
const tereAttrIdx = (body.vrm.mesh.geometry.morphAttributes.position || []).findIndex((a) => a.name === '照れ');
assert.ok(tereAttrIdx >= 0, '应存在 照れ 顶点变形');

body.setMoodOverride('calm');
for (let i = 0; i < 90; i++) body.sync(brain, motors.parts.face, 1 / 60);
assert.equal(exprMat.opacity, 0, 'calm 时不应强显颊红贴片');

body.setMoodOverride('love');
for (let i = 0; i < 60; i++) body.sync(brain, motors.parts.face, 1 / 60);
assert.equal(body.vrm.mesh.morphTargetInfluences[tereAttrIdx], 1, 'love 时 照れ 应完全推至脸颊表面避免穿模');
assert.ok(exprMat.opacity > 0.45, `love 时 表情 opacity 应渐显，实际 ${exprMat.opacity}`);

// 眼珠与 目戻(-0.7) 联动
const nEyeL = vrm.humanoid.getNormalizedBoneNode('leftEye');
nEyeL.quaternion.setFromEuler(new THREE.Euler(0, 0.25, 0));
vrm.update(1 / 60);
const rawEyeL = vrm.mesh.skeleton.bones[boneMap.leftEye];
const rawEyeRet = vrm.mesh.skeleton.bones[byName.get('左目戻').index];
assert.ok(Math.abs(rawEyeL.quaternion.y) > 0.05, '左目应随 normalized leftEye 转动');
assert.ok(Math.abs(rawEyeRet.quaternion.y) > 0.03, '左目戻 应跟随左目执行 -0.7 反向付与旋转');

body.destroy();

// 多材质装扮层（轻装：摘帽子 + 无披风）
const prevFlags = globalThis.__XXOO_FLAGS__;
globalThis.__XXOO_FLAGS__ = 'hide=^披风$,^帽子$';
globalThis.fetch = async (url) => {
  if (String(url) === './jianmo/温迪.pmx') {
    const b = fs.readFileSync(MODEL);
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  }
  return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
};
try {
  const c2 = { clientWidth: 430, clientHeight: 800, width: 430, height: 800 };
  const r2 = { domElement: c2, setPixelRatio() {}, setSize() {}, setClearAlpha() {}, render() {}, dispose() {} };
  const lightBody = await create3DBody({
    canvas: c2,
    modelUrl: MODELS.wendi.url,
    modelType: MODELS.wendi.type,
    renderer: r2,
    createCanvas: (w, h) => createCanvas(w, h),
  });
  const hatMat = lightBody.vrm.mesh.material.find((m) => m.name === '帽子');
  const capeMat = lightBody.vrm.mesh.material.find((m) => m.name === '披风');
  const clothMat = lightBody.vrm.mesh.material.find((m) => m.name === '衣服');
  assert.equal(hatMat.visible, false, '轻装模式应隐藏 帽子');
  assert.equal(capeMat.visible, false, '轻装模式应隐藏 披风');
  assert.equal(clothMat.visible, true, '轻装模式应保留 衣服');
  lightBody.destroy();
} finally {
  globalThis.fetch = origFetch;
  globalThis.__XXOO_FLAGS__ = prevFlags;
}

// 7. 验证真实贴图加载（jianmo/ 下与 .pmx 同目录扁平存放时，loadPMXAsVRM 自动回退并全部命中）
const origCreateImageBitmap = globalThis.createImageBitmap;
let nestedMisses = 0;
globalThis.createImageBitmap = async (blob) => loadImage(Buffer.from(await blob.arrayBuffer()));
globalThis.fetch = async (url) => {
  const s = decodeURIComponent(String(url));
  const rel = s.replace(/^\.\//, '');
  const full = path.join(ROOT, rel);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    const b = fs.readFileSync(full);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      blob: async () => new Blob([b]),
    };
  }
  if (s.includes('/Texture/')) nestedMisses++;
  return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), blob: async () => new Blob([]) };
};
try {
  const c3 = { clientWidth: 430, clientHeight: 800, width: 430, height: 800 };
  const r3 = { domElement: c3, setPixelRatio() {}, setSize() {}, setClearAlpha() {}, render() {}, dispose() {} };
  const realBody = await create3DBody({
    canvas: c3,
    modelUrl: MODELS.wendi.url,
    modelType: MODELS.wendi.type,
    renderer: r3,
    createCanvas: (w, h) => createCanvas(w, h),
  });
  assert.equal(realBody.vrm.missingTextures, 0, 'jianmo/ 下真实贴图应全部命中（missingTextures === 0）');
  assert.equal(nestedMisses, 1, `应只试探 1 次 Texture/ 子目录后切到同目录加载，实际 ${nestedMisses}`);
  const clothTex = realBody.vrm.mesh.material.find((m) => m.name === '衣服')?.map;
  assert.ok(clothTex, '衣服材质应存在贴图');
  assert.equal(clothTex.flipY, true, '贴图 flipY 应为 true 以匹配 Three.js UV');
  assert.equal(clothTex.wrapS, THREE.RepeatWrapping, 'PMX 贴图应启用 RepeatWrapping');
  assert.equal(clothTex.wrapT, THREE.RepeatWrapping, 'PMX 贴图应启用 RepeatWrapping');
  realBody.destroy();
} finally {
  globalThis.fetch = origFetch;
  globalThis.createImageBitmap = origCreateImageBitmap;
}

// 8. 回归测试：浏览器环境（存在 globalThis.Image）下应优先用 HTMLImageElement 而非 ImageBitmap，
// 避免 Three.js WebGLTextures 跳过 UNPACK_FLIP_Y_WEBGL 导致贴图整张上下颠倒
const origImage = globalThis.Image;
const origCreateObjectURL = globalThis.URL?.createObjectURL;
const origRevokeObjectURL = globalThis.URL?.revokeObjectURL;
let bitmapCalls = 0;
let htmlImgCalls = 0;
globalThis.createImageBitmap = async () => {
  bitmapCalls++;
  throw new Error('should not decode via ImageBitmap when HTMLImageElement is available');
};
globalThis.Image = class MockHTMLImage {
  constructor() { this.width = 64; this.height = 64; }
  set src(val) {
    htmlImgCalls++;
    queueMicrotask(() => this.onload && this.onload());
  }
};
globalThis.URL.createObjectURL = () => 'blob:mock-tex';
globalThis.URL.revokeObjectURL = () => {};
globalThis.fetch = async (url) => {
  const s = decodeURIComponent(String(url));
  const rel = s.replace(/^\.\//, '');
  const full = path.join(ROOT, rel);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    const b = fs.readFileSync(full);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      blob: async () => new Blob([b]),
    };
  }
  return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), blob: async () => new Blob([]) };
};
try {
  const c4 = { clientWidth: 430, clientHeight: 800, width: 430, height: 800 };
  const r4 = { domElement: c4, setPixelRatio() {}, setSize() {}, setClearAlpha() {}, render() {}, dispose() {} };
  const browserBody = await create3DBody({
    canvas: c4,
    modelUrl: MODELS.wendi.url,
    modelType: MODELS.wendi.type,
    renderer: r4,
    createCanvas: (w, h) => createCanvas(w, h),
  });
  assert.equal(bitmapCalls, 0, '浏览器环境不应调用 createImageBitmap');
  assert.ok(htmlImgCalls >= 4, `浏览器环境应通过 HTMLImageElement 解码全部贴图，实际 ${htmlImgCalls}`);
  const faceMat = browserBody.vrm.mesh.material.find((m) => m.name === '脸');
  assert.equal(faceMat.map.flipY, true, 'HTMLImageElement 贴图必须保持 flipY=true');
  assert.equal(faceMat.userData.pmxUniforms.uPmxHasSphere.value, 0, '皮肤不应叠加球面金属反光');
  const hairMat = browserBody.vrm.mesh.material.find((m) => m.name === '头发');
  const clothMat = browserBody.vrm.mesh.material.find((m) => m.name === '衣服');
  assert.equal(hairMat.userData.pmxUniforms.uPmxHasSphere.value, 1, '头发应启用 mc3 球面反光');
  assert.equal(clothMat.userData.pmxUniforms.uPmxHasSphere.value, 1, '衣服应启用 mc3 球面反光');
  assert.equal(hairMat.userData.pmxUniforms.uPmxSphereMap.value.colorSpace, THREE.NoColorSpace, '球面反光贴图应保持线性空间避免被压暗');
  assert.equal(hairMat.userData.pmxUniforms.uPmxToonMap.value.colorSpace, THREE.SRGBColorSpace, 'toon 阶梯图应使用 sRGB 解码');
  assert.ok(hairMat.userData.pmxUniforms.uPmxSpecStrength.value > 0.25, '头发应具有可见方向高光');

  // 验证 Shader 注入片段与 calm 睁眼状态
  const patchedFrag = patchPMXToonFragmentShader(THREE.ShaderLib.toon.fragmentShader);
  assert.ok(!patchedFrag.includes('#include <gradientmap_pars_fragment>'));
  assert.ok(!patchedFrag.includes('#include <lights_toon_pars_fragment>'));
  assert.ok(patchedFrag.includes('uPmxSphereMap') && patchedFrag.includes('reflectedLight.directSpecular'));

  browserBody.setMoodOverride('calm');
  for (let i = 0; i < 60; i++) browserBody.sync(brain, motors.parts.face, 1 / 60);
  const wIdx = browserBody.vrm.mesh.geometry.morphAttributes.position.findIndex((a) => a.name === 'ウィンク');
  assert.ok(browserBody.vrm.expressionManager.getValue('happy') < 0.1, 'calm 时 happy 眯眼权重应低于 0.1');
  assert.ok(wIdx >= 0 && browserBody.vrm.mesh.morphTargetInfluences[wIdx] < 0.1, 'calm 时双眼应保持睁开明亮');
  browserBody.destroy();
} finally {
  globalThis.fetch = origFetch;
  globalThis.createImageBitmap = origCreateImageBitmap;
  globalThis.Image = origImage;
  if (origCreateObjectURL) globalThis.URL.createObjectURL = origCreateObjectURL;
  if (origRevokeObjectURL) globalThis.URL.revokeObjectURL = origRevokeObjectURL;
}

console.log(
  `PMX OK · ${parsed.name} · facing=${body.facingCamera().toFixed(2)} · ` +
  `handsL=${dbg.hands.l[0]} handsR=${dbg.hands.r[0]} · ` +
  `legScale=${dbg.legScale} · morphs=${vrm.mesh.morphTargetInfluences.length}`,
);
