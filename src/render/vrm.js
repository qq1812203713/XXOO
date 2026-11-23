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
  scene.add(vrm.scene);

  const node = (name) => vrm.humanoid.getNormalizedBoneNode(name);

  // ————————————————— 静止姿态采集 —————————————————
  vrm.scene.updateMatrixWorld(true);
  const rest = Object.create(null); // name -> { q, dir, pos }
  const V = THREE.Vector3;
  const Q = THREE.Quaternion;

  for (const name of REQUIRED_BONES) {
    const b = node(name);
    if (!b) continue;
    const q = new Q();
    b.getWorldQuaternion(q);
    const pos = new V();
    b.getWorldPosition(pos);
    // 朝向：指向第一根子骨；没有子骨就沿用父骨的朝向
    let dir = null;
    const childBone = b.children.find((c) => c.isBone);
    if (childBone) {
      const cp = new V();
      childBone.getWorldPosition(cp);
      dir = cp.sub(pos).normalize();
    }
    rest[name] = { q, dir, pos };
  }
  // 补上终端骨（指尖、脚趾）的朝向
  for (const name of REQUIRED_BONES) {
    if (!rest[name] || rest[name].dir) continue;
    const parentName = REQUIRED_BONES.find((n) => {
      const b = node(n);
      return b && b.children.some((c) => c === node(name));
    });
    rest[name].dir = (parentName && rest[parentName]?.dir) ? rest[parentName].dir.clone() : new V(0, 1, 0);
  }

  // 所有骨（含 shoulder 这种我们不去写的）的静止世界四元数，用作父级兜底
  const restWorldQ = new Map();
  for (const name of REQUIRED_BONES) {
    const b = node(name);
    if (b) restWorldQ.set(b, rest[name].q.clone());
    let p = b?.parent;
    while (p) {
      if (p.isBone && !restWorldQ.has(p)) {
        const q = new Q();
        p.getWorldQuaternion(q);
        restWorldQ.set(p, q);
      }
      p = p.parent;
    }
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
  const wq = new Map(); // Object3D -> 这一帧的目标世界四元数
  const aq = new Map(); // Object3D -> 累积的世界增量（相对静止姿态）
  const IDENT = new Q();

  const parentBoneOf = (b) => {
    let p = b.parent;
    while (p && !p.isBone) p = p.parent;
    return p;
  };

  function writeLocal(name, targetWorldQ) {
    const b = node(name);
    if (!b) return;
    const p = parentBoneOf(b);
    const parentQ = p ? wq.get(p) || restWorldQ.get(p) || IDENT : IDENT;
    const local = parentQ.clone().invert().multiply(targetWorldQ);
    b.quaternion.copy(local);
    wq.set(b, targetWorldQ);
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
  }

  // 绕某个世界轴转一根骨（用于脊柱/头这类只需要“倾斜多少”的关节）
  const eulerTmp = new THREE.Euler();
  function turn(name, eulerWorld) {
    const r = rest[name];
    const b = node(name);
    if (!r || !b) return;
    const p = parentBoneOf(b);
    const parentAcc = p ? aq.get(p) || IDENT : IDENT;
    eulerTmp.set(eulerWorld.x, eulerWorld.y, eulerWorld.z, 'YXZ');
    const dq = new Q().setFromEuler(eulerTmp);
    const a = parentAcc.clone().multiply(dq);
    aq.set(b, a);
    writeLocal(name, a.clone().multiply(r.q));
  }

  function rotateAround(v, axis, angle) {
    return v.clone().applyAxisAngle(axis, angle);
  }

  // 手腕相对静止姿态转了多少（手指卷曲的轴要跟着它一起转）
  const handDelta = (handName) => {
    const w = wq.get(node(handName));
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

    // 呼吸：胸腔起伏
    const chestNode = node('chest');
    if (chestNode) chestNode.position.y = (0.5 + 0.5 * Math.sin(t * 1.35) - 0.5) * 0.012;

    // 她在世界里走动时，整个人跟着平移一点
    vrm.scene.position.x = clamp((brain.state.root.x || 0) * 0.006, -0.35, 0.35);
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
  renderer.render(scene, camera);

  return {
    vrm,
    scene,
    camera,
    renderer,
    rest,
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
