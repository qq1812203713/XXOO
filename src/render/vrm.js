// 3D 身体：VRM 模型 + three.js。
//
// 这里做的不是“把 2D 角度硬塞进 rotation.z”，而是真正的姿态重定向：
//
//   1. 载入时把每根骨在静止姿态（T-pose）下的**世界朝向**和**世界四元数**记下来；
//   2. 每帧从骨架解算出每根骨想要的**世界方向**（手臂朝哪、前臂朝哪、指尖朝哪）；
//   3. 用「把静止方向旋到目标方向」的最小旋转求出该骨的目标世界四元数；
//   4. 再换算成相对父骨的局部四元数写进去。
//
// 这样做的好处：不依赖模型骨的局部轴朝哪（每家绑骨都不一样），
// 而且关节转动发生在解剖学上正确的平面上——
// 肘是往**前**弯的（绕“手臂×前方向”的轴），膝是往**后**弯的（绕相反轴），
// 手指是朝**掌心**卷的（轴随手腕一起转）。
//
// 分工没有变：大脑只下达「想要」，运动程序把想要分解到每根指骨，这里只负责把这具
// 骨架的姿态搬到一个有 55 根骨头、30 根手指的 3D 人形上。

import { hasWebGL } from './gl.js';

const DEG = 180 / Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// three 有 1.4MB，只在真的要上 3D 时才加载
let THREE = null;
let GLTFLoader = null;

async function loadThree() {
  if (THREE) return;
  THREE = await import('../../vendor/three.module.js');
  const mod = await import('../../vendor/gltf/GLTFLoader.js');
  GLTFLoader = mod.GLTFLoader;
}

// 显式的骨链定义。
// 关键教训：three-vrm 的 normalized humanoid bone 是普通 Object3D，**不是** Bone，
// 所以 `child.isBone` 永远是 false —— 之前靠它找子骨/找父骨，全部失效，
// 导致每根骨的“静止朝向”都退化成 (0,1,0)，于是整具身体被转到莫名其妙的方向。
const CHAINS = [
  ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'],
  ['upperChest', 'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'],
  ['upperChest', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'],
  ['hips', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'],
  ['hips', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'],
];
for (const s0 of ['left', 'right']) {
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
    CHAINS.push([
      `${s0}Hand`,
      `${s0}${f}Proximal`,
      `${s0}${f}Intermediate`,
      `${s0}${f}Distal`,
    ]);
  }
}

const PARENT = new Map();
const CHILD = new Map();
for (const chain of CHAINS) {
  for (let i = 1; i < chain.length; i++) {
    if (!PARENT.has(chain[i])) PARENT.set(chain[i], chain[i - 1]);
    if (!CHILD.has(chain[i - 1])) CHILD.set(chain[i - 1], chain[i]);
  }
}

// 我们的骨架：拇指 2 节，其余 4 指 3 节；模型是 5 指 × 3 节，所以拇指末端借用第二节
const FINGERS = [
  { bone: 'Thumb', rig: 'thumb', seg: 2 },
  { bone: 'Index', rig: 'index', seg: 3 },
  { bone: 'Middle', rig: 'middle', seg: 3 },
  { bone: 'Ring', rig: 'ring', seg: 3 },
  { bone: 'Little', rig: 'pinky', seg: 3 },
];
const SEGS = ['Proximal', 'Intermediate', 'Distal'];

const EXPRESSIONS = {
  happy: 'joy',
  sad: 'sorrow',
  shy: 'fun',
  startled: 'angry',
  curious: 'fun',
  sleepy: 'sorrow',
  calm: null,
};

// 我们一定会去写这些骨骼。测试拿它跟 .vrm 里的 humanoid 列表逐条核对。
export const REQUIRED_BONES = (() => {
  const out = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftEye', 'rightEye'];
  for (const s of ['left', 'right']) {
    out.push(`${s}UpperArm`, `${s}LowerArm`, `${s}Hand`);
    out.push(`${s}UpperLeg`, `${s}LowerLeg`, `${s}Foot`, `${s}Toes`);
    for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
      for (const seg of SEGS) out.push(`${s}${f}${seg}`);
    }
  }
  return out;
})();

const ALL_BONE_NAMES = [...new Set([...REQUIRED_BONES, ...PARENT.keys(), ...PARENT.values()])];

export const USED_EXPRESSIONS = [...new Set(Object.values(EXPRESSIONS).filter(Boolean)), 'blink', 'a'];

export async function create3DBody({ canvas, modelUrl, onStatus }) {
  if (!hasWebGL()) return null;
  onStatus?.('正在加载 3D 身体…');
  await loadThree();
  const { VRMLoaderPlugin, VRMUtils } = await import('../../vendor/three-vrm.module.js');

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearAlpha(0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);

  const key = new THREE.DirectionalLight(0xfff2f6, 2.6);
  key.position.set(1.2, 2.4, 2.2);
  const fill = new THREE.DirectionalLight(0x9fb8ff, 1.1);
  fill.position.set(-2, 1.2, 1.4);
  const rim = new THREE.DirectionalLight(0xff9fbe, 2.0);
  rim.position.set(0.4, 1.6, -2.4);
  const amb = new THREE.HemisphereLight(0xbfd4ff, 0x281a30, 1.2);
  scene.add(key, fill, rim, amb);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(modelUrl);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('这个文件不是 VRM（没有 humanoid）');

  try {
    VRMUtils.rotateVRM0(vrm);
  } catch {
    if (vrm.meta?.metaVersion === '0') vrm.scene.rotation.y = Math.PI;
  }
  // 模型挂在一个外壳上：转动外壳，永远不怕别处改写 vrm.scene.rotation
  const holder = new THREE.Group();
  holder.add(vrm.scene);
  scene.add(holder);

  const node = (name) => vrm.humanoid.getNormalizedBoneNode(name);
  const V = THREE.Vector3;
  let faceYaw = 0; // 朝向校正了多少度，写进 ?debug=1 面板
  let faceProbe = '没量到';
  const Q = THREE.Quaternion;

  // —— 朝向 ——
  // 已经拆开模型文件量过：她的左脚趾指向 -Z、眼睛在 -Z 一侧 ⇒ 原件面朝 -Z，
  // 而相机在 +Z。所以这里**无条件**先转 180°，再用实测结果自我验证并打日志。
  holder.rotation.y = Math.PI;

  const boneOf = (n) => {
    try {
      return vrm.humanoid.getRawBoneNode?.(n) || node(n) || null;
    } catch {
      return node(n) || null;
    }
  };

  const measureFacing = () => {
    vrm.scene.updateMatrixWorld(true);
    const f = new V();
    const tt = new V();
    const fb = boneOf('leftFoot');
    const tb = boneOf('leftToes');
    if (fb && tb) {
      fb.getWorldPosition(f);
      tb.getWorldPosition(tt);
      const d = tt.clone().sub(f).setY(0);
      if (d.lengthSq() > 1e-9) return d.normalize();
    }
    const L = new V();
    const R = new V();
    boneOf('leftUpperArm')?.getWorldPosition(L);
    boneOf('rightUpperArm')?.getWorldPosition(R);
    const leftAxis = L.clone().sub(R).setY(0);
    if (leftAxis.lengthSq() > 1e-9) {
      leftAxis.normalize();
      return new V().crossVectors(leftAxis, new V(0, 1, 0)).normalize();
    }
    return null;
  };

  vrm.update(0);
  {
    let facing = measureFacing();
    if (facing) {
      faceProbe = `${((Math.atan2(facing.x, facing.z) * 180) / Math.PI).toFixed(1)}°`;
      // 转完还是背对（z<0）就再转半圈；两次仍未面向 +Z 说明测量本身有问题
      if (facing.z < 0) {
        holder.rotation.y += Math.PI;
        vrm.scene.updateMatrixWorld(true);
        const again = measureFacing();
        if (again) faceProbe = `修正后 ${((Math.atan2(again.x, again.z) * 180) / Math.PI).toFixed(1)}°`;
      }
    } else {
      faceProbe = '没量到（已硬转 180°）';
    }
    const forced = Number(new URLSearchParams(globalThis.location?.search || '').get('face'));
    if (Number.isFinite(forced) && forced !== 0) {
      holder.rotation.y += (forced * Math.PI) / 180;
      faceProbe += ` + 手动 ${forced}°`;
    }
    vrm.scene.updateMatrixWorld(true);
    vrm.update(0);
    onStatus?.(`已醒来 · 3D 身体（VRM）· 朝向 ${faceProbe}`);
  }

  // ————————————————— 静止姿态采集 —————————————————
  const rest = Object.create(null); // name -> { q, dir, pos }

  for (const name of ALL_BONE_NAMES) {
    const b = node(name);
    if (!b) continue;
    const q = new Q();
    b.getWorldQuaternion(q);
    const pos = new V();
    b.getWorldPosition(pos);
    rest[name] = { q, dir: null, pos };
  }

  // 静止朝向：指向显式链里的下一根骨
  for (const name of ALL_BONE_NAMES) {
    if (!rest[name]) continue;
    const childName = CHILD.get(name);
    const b = node(name);
    const c = childName ? node(childName) : null;
    if (b && c) {
      const cp = new V();
      c.getWorldPosition(cp);
      const d = cp.sub(rest[name].pos).normalize();
      if (d.lengthSq() > 1e-6) rest[name].dir = d;
    }
  }
  // 终端骨（指尖、脚趾、头）沿用上一节的朝向
  for (const name of ALL_BONE_NAMES) {
    if (!rest[name] || rest[name].dir) continue;
    const pName = PARENT.get(name);
    if (pName && rest[pName]?.dir) rest[name].dir = rest[pName].dir.clone();
  }
  for (const name of ALL_BONE_NAMES) {
    if (rest[name] && !rest[name].dir) rest[name].dir = new V(0, 1, 0);
  }

  // name -> 静止世界四元数（父级兜底用）
  const restWorldQ = new Map();
  for (const name of ALL_BONE_NAMES) {
    if (rest[name]) restWorldQ.set(name, rest[name].q.clone());
  }

  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = box.getSize(new V());
  const height = size.y || 1.55;

  let t = 0;
  let ready = false;

  function layout() {
    const w = canvas.clientWidth || window.innerWidth || 1;
    const h = canvas.clientHeight || window.innerHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const dist = (height * 0.62) / Math.tan(camera.fov / 2 / DEG);
    camera.position.set(0, height * 0.72, dist * 1.06);
    camera.lookAt(0, height * 0.58, 0);
    camera.updateProjectionMatrix();
  }
  layout();

  // ————————————————— 每帧：世界四元数累积 —————————————————
  const wq = new Map(); // name -> 这一帧的目标世界四元数
  const aq = new Map(); // name -> 累积的世界增量（相对静止姿态）
  const IDENT = new Q();

  function writeLocal(name, targetWorldQ) {
    const b = node(name);
    if (!b) return;
    const pName = PARENT.get(name);
    const parentQ = pName ? (wq.get(pName) || restWorldQ.get(pName) || IDENT) : IDENT;
    const local = parentQ.clone().invert().multiply(targetWorldQ);
    b.quaternion.copy(local);
    wq.set(name, targetWorldQ);
  }

  // 把某根骨「转到」指定世界方向：解出最小的旋转
  function aim(name, dirWorld) {
    const r = rest[name];
    if (!r) return;
    if (!r.dir || dirWorld.lengthSq() < 1e-8) return;
    const d1 = dirWorld.clone().normalize();
    const qd = new Q().setFromUnitVectors(r.dir, d1);
    const target = qd.multiply(r.q);
    writeLocal(name, target);
    lastTarget.set(name, d1);
  }

  // 绕某个世界轴转一根骨（用于脊柱/头这类只需要“倾斜多少”的关节）
  const lastTarget = new Map(); // 本帧给每根骨设定的目标方向（诊断用）

  const eulerTmp = new THREE.Euler();
  function turn(name, eulerWorld) {
    const r = rest[name];
    const b = node(name);
    if (!r || !b) return;
    const pName = PARENT.get(name);
    const parentAcc = pName ? aq.get(pName) || IDENT : IDENT;
    eulerTmp.set(eulerWorld.x, eulerWorld.y, eulerWorld.z, 'YXZ');
    const dq = new Q().setFromEuler(eulerTmp);
    const a = parentAcc.clone().multiply(dq);
    aq.set(name, a);
    writeLocal(name, a.clone().multiply(r.q));
  }

  function rotateAround(v, axis, angle) {
    return v.clone().applyAxisAngle(axis, angle);
  }

  // 手腕相对静止姿态转了多少（手指卷曲的轴要跟着它一起转）
  const handDelta = (handName) => {
    const w = wq.get(handName);
    if (!w || !rest[handName]) return new Q();
    return w.clone().multiply(rest[handName].q.clone().invert());
  };

  const FORWARD = new V(0, 0, 1);
  const BACK = new V(0, 0, -1);
  const DOWN = new V(0, -1, 0);

  function poseFromRig(brain, face, dt) {
    t += dt;
    const p = brain.state.pose;
    if (!p) return;
    const j = (id) => p.get?.(id) || null;
    const f = face?.state || {};
    const mood = brain.state.mood || 'calm';
    const gazeX = clamp((f.gazeX ?? 0) / 3, -1, 1);
    const gazeY = clamp((f.gazeY ?? 0) / 3, -1, 1);

    wq.clear();
    aq.clear();
    lastTarget.clear();

    // —— 躯干：绕世界 Z 轴侧倾，逐段累积 ——
    const pelvis = j('pelvis');
    const spine1 = j('spine1');
    const chest = j('chest');
    const neck = j('neck');
    const head = j('head');

    turn('hips', { x: 0, y: gazeX * 0.1, z: -(pelvis?.a || 0) * 0.5 });
    turn('spine', { x: 0, y: 0, z: -(spine1?.a || 0) * 0.8 });
    turn('chest', { x: gazeY * 0.04, y: 0, z: -(chest?.a || 0) * 0.9 });
    turn('upperChest', { x: 0, y: 0, z: -(chest?.a || 0) * 0.35 });
    turn('neck', { x: -gazeY * 0.16, y: gazeX * 0.3, z: -(neck?.a || 0) * 0.8 });
    turn('head', { x: -gazeY * 0.24, y: gazeX * 0.5, z: -(head?.a || 0) * 1.0 });

    // —— 手臂：先定上臂的世界方向，再依次“指向”前臂、手、每一节指骨 ——
    for (const side of ['L', 'R']) {
      // 我们骨架里的 L/R 是**画面**左右（L 在屏幕左边）；VRM 的 left/right 是**她本人**的左右。
      // 她面朝镜头，所以画面左边是她的右手 —— 这里必须反过来。
      const s = side === 'L' ? 'right' : 'left';
      const up = j(`arm_${side}_upper`);
      const fore = j(`arm_${side}_fore`);
      const hand = j(`hand_${side}`);
      if (!up) continue;

      const aUp = up.a ?? Math.PI;
      // 我们的 a：0 朝上、π 朝下、顺时针为正；换成 3D 就是“在额状面里张开多少”
      // 再补一点向前的分量，避免像稻草人一样贴着身体
      const dirUp = new V(Math.sin(aUp), Math.cos(aUp), 0);
      dirUp.z = 0.18 * (side === 'L' ? 1 : 1);
      dirUp.normalize();
      aim(`${s}UpperArm`, dirUp);

      // 屈肘：绕「上臂 × 前方向」的轴转，肘永远是往**前**弯的
      const flex = Math.abs(wrap((fore?.a ?? aUp) - aUp));
      let axis = new V().crossVectors(dirUp, FORWARD);
      if (axis.lengthSq() < 1e-6) axis = new V(1, 0, 0);
      axis.normalize();
      const dirFore = rotateAround(dirUp, axis, flex);
      aim(`${s}LowerArm`, dirFore);

      // 手腕：在手的前臂坐标系里再弯一点，然后指向更细的弯曲
      const wrist = wrap((hand?.a ?? fore?.a ?? 0) - (fore?.a ?? 0));
      const dirHand = rotateAround(dirFore, axis, wrist * 0.8);
      aim(`${s}Hand`, dirHand);

      // —— 手指：轴 = 指骨静止方向 × 掌心朝下，再跟着手腕一起转 ——
      const hd = handDelta(`${s}Hand`);
      const palmRest = DOWN;
      for (const fdef of FINGERS) {
        const firstBoneName = `${s}${fdef.bone}Proximal`;
        const restDir = rest[firstBoneName]?.dir;
        if (!restDir) continue;
        const axisRest = new V().crossVectors(restDir, palmRest);
        if (axisRest.lengthSq() < 1e-6) axisRest.set(0, 0, side === 'L' ? -1 : 1);
        axisRest.normalize();
        const axisWorld = axisRest.clone().applyQuaternion(hd).normalize();

        let prevDir = dirHand.clone();
        for (let i = 0; i < 3; i++) {
          const boneName = `${s}${fdef.bone}${SEGS[i]}`;
          const rigIdx = i < fdef.seg ? i : fdef.seg - 1;
          const jn = j(`${side}_${fdef.rig}_${rigIdx}`);
          const factor = i < fdef.seg ? 1 : 0.7;
          const curl = clamp((jn?.local ?? 0) * factor, -0.2, 1.6);
          const dir = rotateAround(prevDir, axisWorld, curl);
          aim(boneName, dir);
          prevDir = dir;
        }
      }
    }

    // —— 腿：走路的摆动发生在矢状面（绕 X），膝只往后弯 ——
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? 'right' : 'left';
      const thigh = j(`leg_${side}_thigh`);
      const shin = j(`leg_${side}_shin`);
      const foot = j(`foot_${side}`);
      if (!thigh) continue;

      // 大腿相对正下方的摆角：正 = 往前
      const swing = wrap(Math.PI - (thigh.a ?? Math.PI)) * (side === 'L' ? 1 : 1);
      const dirThigh = new V(0, -Math.cos(clamp(swing, -1.2, 1.2)), Math.sin(clamp(swing, -1.2, 1.2))).normalize();
      aim(`${s}UpperLeg`, dirThigh);

      // 膝盖：只允许往后弯（真人膝盖不会反着折）
      const knee = clamp(Math.abs(wrap((shin?.a ?? Math.PI) - (thigh?.a ?? Math.PI))), 0, 2.2);
      const dirShin = rotateAround(dirThigh, new V(1, 0, 0), knee);
      aim(`${s}LowerLeg`, dirShin);

      // 踝：脚掌基本朝前，随踝角抬落
      const ankle = clamp(wrap((foot?.a ?? 0) - 1.2), -0.8, 0.8);
      const dirFoot = rotateAround(FORWARD.clone(), new V(1, 0, 0), ankle);
      aim(`${s}Foot`, dirFoot);

      // 脚趾：模型只有一根骨，取五根脚趾卷曲的平均
      const toes = ['big', 'second', 'third', 'fourth', 'little'].map((n) => j(`${side}_toe_${n}_0`)).filter(Boolean);
      if (toes.length) {
        const avg = toes.reduce((sum, tt) => sum + (tt.local ?? 0), 0) / toes.length;
        aim(`${s}Toes`, rotateAround(dirFoot, new V(1, 0, 0), clamp(avg, 0, 1.2)));
      }
    }

    // —— 眼睛：在头骨局部里转，真的会看你 ——
    for (const side of ['left', 'right']) {
      const eye = node(`${side}Eye`);
      if (eye) eye.rotation.set(-gazeY * 0.28, gazeX * 0.4, 0);
    }

    // —— 表情 ——
    const em = vrm.expressionManager;
    if (em) {
      const blink = clamp((f.blink ?? 0) + (1 - clamp(f.eyeOpen ?? 1, 0, 1)) * 0.6, 0, 1);
      em.setValue('blink', blink);
      const talking = brain.state.talking > 0 ? 1 : 0;
      const syllable = 0.5 + 0.5 * Math.sin(t * 18.7) * Math.sin(t * 4.3);
      em.setValue('a', clamp(talking * syllable, 0, 1));
      for (const [k, name] of Object.entries(EXPRESSIONS)) {
        if (name) em.setValue(name, k === mood ? 0.75 : 0);
      }
    }


    // 她在世界里走动时，整个人跟着平移一点
    holder.position.x = clamp((brain.state.root.x || 0) * 0.006, -0.35, 0.35);
  }

  // 诊断：把「我要它朝哪」和「它实际朝哪」并排打出来。对不上就是重定向出了问题。
  const DEBUG_BONES = [
    'leftUpperArm', 'rightUpperArm',
    'leftLowerArm', 'rightLowerArm',
    'leftHand', 'rightHand',
    'leftUpperLeg', 'rightUpperLeg',
    'leftLowerLeg', 'rightLowerLeg',
    'leftIndexProximal', 'rightIndexProximal',
  ];
  function debugLines() {
    const out = [];
    out.push(`朝向：量到 ${faceProbe}（应为 180 或 0）`);
    vrm.scene.updateMatrixWorld(true);
    for (const name of DEBUG_BONES) {
      const b = node(name);
      const t = lastTarget.get(name);
      if (!b) {
        out.push(`${name.padEnd(18)} 骨骼不存在`);
        continue;
      }
      const childName = CHILD.get(name);
      const child = childName ? node(childName) : null;
      let actual = null;
      if (child) {
        const p0 = new V();
        const p1 = new V();
        b.getWorldPosition(p0);
        child.getWorldPosition(p1);
        actual = p1.sub(p0).normalize();
      }
      const f = (v) => (v ? `(${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)})` : '   —   ');
      out.push(`${name.padEnd(18)} 目标${f(t)} 实际${f(actual)}`);
    }
    return out;
  }

  const clock = new THREE.Clock();

  function sync(brain, face, dt) {
    poseFromRig(brain, face, dt);
    vrm.update(Math.min(dt || clock.getDelta(), 0.05));
    renderer.render(scene, camera);
    ready = true;
  }

  vrm.update(0);
  poseFromRig({ state: { pose: null } }, null, 0);
  try {
    vrm.springBoneManager?.reset?.();
  } catch {
    /* 没有就算了 */
  }
  renderer.render(scene, camera);
  // 弹簧骨在首帧容易因为“骨架刚被换过”而弹飞，半秒后再复位一次
  setTimeout(() => {
    try {
      vrm.springBoneManager?.reset?.();
    } catch {
      /* ignore */
    }
  }, 600);

  return {
    vrm,
    scene,
    camera,
    renderer,
    rest,
    debugLines,
    sync,
    resize: layout,
    get ready() {
      return ready;
    },
    destroy() {
      try {
        renderer.dispose();
        VRMUtils?.deepDispose?.(vrm.scene);
      } catch {
        /* ignore */
      }
    },
  };
}
