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

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true, // 让画面能被抓下来（自己看，而不是让用户代劳）
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearAlpha(0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);

  // 这套模型的脸在 -Z 一侧（拆 GLB 量过：眼睛 z≈-0.051，脚趾 z≈-0.060）。
  // 与其反复拧模型，不如把相机放到她脸的那一边 —— 这是几何事实，不会被
  // 矩阵缓存、保存的角度、版本号里的隐藏旋转任何一项抵消。
  const FRONT = -1;
  const key = new THREE.DirectionalLight(0xfff2f6, 2.6);
  key.position.set(1.2, 2.4, 2.2 * FRONT);
  const fill = new THREE.DirectionalLight(0x9fb8ff, 1.1);
  fill.position.set(-2, 1.2, 1.4 * FRONT);
  const rim = new THREE.DirectionalLight(0xff9fbe, 2.0);
  rim.position.set(0.4, 1.6, -2.4 * FRONT);
  const amb = new THREE.HemisphereLight(0xbfd4ff, 0x281a30, 1.2);
  scene.add(key, fill, rim, amb);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(modelUrl);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('这个文件不是 VRM（没有 humanoid）');

  // 不再调用 VRMUtils.rotateVRM0：它会按版本号偷偷转半圈，转没转无从得知。
  // 朝向统一由下面的实测决定，只有一个入口。
  // 头发/裙子的弹簧骨：默认关掉。
  // 我们每帧都在改写骨架，弹簧在这套“被驱动的骨架”上极容易自激振荡，
  // 屏幕上就是头发乱甩、身体抽搐。关掉后头发刚性跟随头部，稳定第一。
  // 想看弹簧：地址加 ?spring=1
  let springOn = false;
  try {
    const KEEP_SPRING = new URLSearchParams(globalThis.location?.search || '').get('spring') === '1';
    const sbm = vrm.springBoneManager;
    if (sbm && !KEEP_SPRING) {
      // 只把属性置空可能被只读属性挡掉，直接掐掉 update 才是真的关掉
      sbm.update = () => {};
      vrm.springBoneManager = null;
    }
    springOn = Boolean(vrm.springBoneManager);
  } catch {
    /* 关不掉就算了 */
  }

  // 模型挂在一个外壳上：转动外壳，永远不怕别处改写 vrm.scene.rotation
  // 注意：旧版本在这里存过“累计偏移”，那是在校正本身还错的时候按出来的，
  // 现在校正已经对了，再叠加就等于把对的结果又转回去。
  // 换个新 key，老的脏数据自然失效。
  const FACE_KEY = 'xxoo.faceYaw.v2';
  const holder = new THREE.Group();
  holder.add(vrm.scene);
  scene.add(holder);

  // ————————————————— 世界：地面 + 远处的景物 —————————————————
  // 她站在原点不动，舞台绕着她转 —— 这样镜头永远在她正面，
  // 而地面、石头、树会随着她走动真实地往后掠过去。
  const stage = new THREE.Group();
  scene.add(stage);

  // 模型的原点不一定在脚底 —— 先用包围盒量出她真正站在哪
  const bbox = new THREE.Box3().setFromObject(vrm.scene);
  const floorY = bbox.min.y;
  console.log('[world] bbox', bbox.min.y.toFixed(3), bbox.max.y.toFixed(3));

  function groundTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#131a2b');
    grad.addColorStop(0.5, '#1a2236');
    grad.addColorStop(1, '#121826');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(120,170,255,0.20)';
    g.lineWidth = 1.5;
    for (let i = 0; i <= 256; i += 64) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 256);
      g.moveTo(0, i);
      g.lineTo(256, i);
      g.stroke();
    }
    g.fillStyle = 'rgba(150,200,255,0.05)';
    g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(24, 24);
    tex.anisotropy = 4;
    return tex;
  }

  // 地面用一张会滚动的网格贴图表示“她在往前走”；景物排成格子，
  // 走到哪儿就从另一边绕回来 —— 这样永远不会有东西突然穿过她的身体。
  const world = { tex: null, props: [], tile: 4.5, span: 27 };
  {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    stage.add(ground);
    world.tex = ground.material.map;
    stage.position.y = floorY;
    scene.fog = new THREE.Fog(0x0b0d14, 5.5, 19);

    let seed = 20261122;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0x8fd2ff, emissive: 0x2a6fa8, emissiveIntensity: 0.5, roughness: 0.3 });
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x2b4a63, roughness: 0.9 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe3b0, emissive: 0xffb35c, emissiveIntensity: 1.4 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a2333, roughness: 1 });

    const n = 6;
    for (let ix = 0; ix < n; ix++) {
      for (let iz = 0; iz < n; iz++) {
        const bx = (ix - (n - 1) / 2) * world.tile + (rnd() - 0.5) * 1.6;
        const bz = (iz - (n - 1) / 2) * world.tile + (rnd() - 0.5) * 1.6;
        const kind = rnd();
        let m;
        if (kind < 0.55) {
          const h = 0.35 + rnd() * 1.2;
          m = new THREE.Mesh(new THREE.ConeGeometry(0.15 + rnd() * 0.2, h, 6), treeMat);
          m.position.y = h / 2;
          const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.28, 5), trunkMat);
          tr.position.y = 0.14;
          m.add(tr);
        } else if (kind < 0.85) {
          const s0 = 0.1 + rnd() * 0.26;
          m = new THREE.Mesh(new THREE.OctahedronGeometry(s0, 0), crystalMat);
          m.position.y = s0 * 0.9;
          m.rotation.y = rnd() * 3;
        } else {
          m = new THREE.Mesh(new THREE.SphereGeometry(0.05 + rnd() * 0.05, 8, 8), lampMat);
          m.position.y = 0.5 + rnd() * 0.9;
        }
        m.position.x = bx;
        m.position.z = bz;
        m.userData.base = new THREE.Vector2(bx, bz);
        stage.add(m);
        world.props.push(m);
      }
    }
  }

  const node = (name) => vrm.humanoid.getNormalizedBoneNode(name);
  const V = THREE.Vector3;
  let faceYaw = 0; // 朝向校正了多少度，写进 ?debug=1 面板
  let faceProbe = '没量到';
  const Q = THREE.Quaternion;

  // —— 朝向：只有一个入口，一次算到底 ——
  const boneOf = (n) => {
    try {
      return vrm.humanoid.getRawBoneNode?.(n) || node(n) || null;
    } catch {
      return node(n) || null;
    }
  };

  // 三个独立证据，谁先算出来用谁：
  //  1) 眼睛的网格相对头骨在前方（和骨骼系统完全无关，最硬）
  //  2) 脚趾相对脚掌的方向
  //  3) 左右肩连线叉乘向上 = 前方
  const eyeForward = () => {
    const head = boneOf('head');
    if (!head) return null;
    const hp = new V();
    head.getWorldPosition(hp);
    let best = null;
    vrm.scene.traverse((o) => {
      if (best || !o.isMesh) return;
      if (!/^eye/i.test(o.name || '')) return;
      // 用网格的世界包围盒中心（节点原点可能不在眼睛上）
      const box = new THREE.Box3().setFromObject(o);
      const p = box.isEmpty() ? o.getWorldPosition(new V()) : box.getCenter(new V());
      const d = p.clone().sub(hp).setY(0);
      if (d.lengthSq() > 1e-10) best = d.normalize();
    });
    return best;
  };

  const measureFacing = () => {
    scene.updateMatrixWorld(true);
    const eye = eyeForward();
    if (eye) return eye;
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

  const deg = (v) => (Math.atan2(v.x, v.z) * 180) / Math.PI;

  vrm.humanoid.update();
  {
    const qs = new URLSearchParams(globalThis.location?.search || '');
    const forced = Number(qs.get('face'));
    let extra = 0;
    if (qs.has('face') && Number.isFinite(forced)) {
      extra = forced;
    } else {
      let saved = Number(globalThis.localStorage?.getItem(FACE_KEY) || 0);
      if (Number.isFinite(saved)) {
        saved = ((saved % 360) + 360) % 360;
        if (saved > 180) saved -= 360;
        extra = saved;
      }
    }
    holder.rotation.y = (extra * Math.PI) / 180;
    scene.updateMatrixWorld(true);
    vrm.humanoid.update();
    faceProbe = extra ? `手动 ${extra}°` : '相机在她正面';
    onStatus?.(`已醒来 · 3D 身体（VRM）· ${faceProbe}`);
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

  // —— 把长发从身前挪到身后 ——
  // 模型原件的双马尾静止姿态是贴在身前的，把胳膊和裙子都挡住了。
  // 这里一次性给发根骨加一个“向后”的世界旋转偏移：轴不用猜，
  // 直接让“发根→下一节”的方向朝 +Z（她背后）偏一点。
  try {
    const HAIR_ROOTS = ['hair_01_01', 'hair_02_01', 'hair_03_01', 'ribbon_L', 'ribbon_R', 'hair1_L', 'hair1_R', 'mituami1'];
    const X = new V(1, 0, 0);
    const wqTmp = new Q();
    for (const name of HAIR_ROOTS) {
      const b = vrm.scene.getObjectByName(name);
      if (!b) continue;
      const kid = b.children?.[0];
      if (!kid) continue;
      const p0 = new V().setFromMatrixPosition(b.matrixWorld);
      const p1 = new V().setFromMatrixPosition(kid.matrixWorld);
      const dir = p1.clone().sub(p0).normalize();
      let tilt = 0.22; // 弧度
      // 选一个能让发梢朝 +Z（背后）转的方向
      const test = dir.clone().applyAxisAngle(X, tilt);
      if (test.z <= dir.z) tilt = -tilt;
      const target = dir.clone().applyAxisAngle(X, tilt).normalize();
      const w = new Q().setFromUnitVectors(dir, target);
      const parentQ = b.parent ? b.parent.getWorldQuaternion(wqTmp) : new Q();
      const inv = parentQ.clone().invert();
      b.quaternion.copy(inv.multiply(w).multiply(parentQ).multiply(b.quaternion));
    }
    scene.updateMatrixWorld(true);
    vrm.humanoid.update();
  } catch {
    /* 头发偏移失败不影响别的 */
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
    // 竖屏手机里她应该占满画面（原来她只占 2/3，上下全是黑）
    // 脚也要在画面里（上一版把她的小腿切掉了）
    // 上下各留一点余量：她的鞋尖之前正好被画面底边切掉
    const visH = height * 1.16;
    const dist = visH / (2 * Math.tan(camera.fov / 2 / DEG));
    camera.position.set(0, height * 0.57, FRONT * dist);
    camera.lookAt(0, height * 0.52, 0);
    camera.updateProjectionMatrix();
  }
  layout();

  // ————————————————— 每帧：世界四元数累积 —————————————————
  const wq = new Map(); // name -> 这一帧的目标世界四元数
  const aq = new Map(); // name -> 累积的世界增量（相对静止姿态）
  const IDENT = new Q();

  // 平滑：每根骨真正写入的四元数会朝目标慢慢追上。
  // 数据层再抖，屏幕上也是连续的 —— 抽搐基本都出在这个环节。
  const SMOOTH = 14; // 每秒追上多少（越大越跟手）
  let BAKING = false; // 烘焙关键帧时不做平滑
  const applied = new Map();
  const tmpQ = new Q();
  function writeLocal(name, targetWorldQ) {
    const b = node(name);
    if (!b) return;
    if (!Number.isFinite(targetWorldQ.x + targetWorldQ.y + targetWorldQ.z + targetWorldQ.w)) return;
    const pName = PARENT.get(name);
    const parentQ = pName ? (wq.get(pName) || restWorldQ.get(pName) || IDENT) : IDENT;
    const local = parentQ.clone().invert().multiply(targetWorldQ);
    const prev = applied.get(name);
    const k = BAKING ? 1 : 1 - Math.exp(-SMOOTH * Math.max(dt || 0, 0.001));
    if (prev && k < 1) {
      prev.slerp(local, Math.min(1, k));
      b.quaternion.copy(prev);
    } else {
      b.quaternion.copy(local);
      applied.set(name, local.clone());
    }
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

  // 相机移到 -Z 之后，她的“前方”就是 -Z。
  // 这里的常量必须跟着改：否则肘是往背后折的，脚是朝后长的。
  const FORWARD = new V(0, 0, -1);
  const BACK = new V(0, 0, 1);
  const DOWN = new V(0, -1, 0);

  const lastDiag = {};
  // 表情、眼动、整体位移 —— 与骨骼动画相互独立
  function applyFace(brain, face, gx, gy) {
    const f = face?.state || {};
    const gazeX = gx ?? clamp((f.gazeX ?? 0) / 3, -1, 1);
    const gazeY = gy ?? clamp((f.gazeY ?? 0) / 3, -1, 1);
    for (const side of ['left', 'right']) {
      const eye = node(`${side}Eye`);
      if (eye) eye.rotation.set(-gazeY * 0.28, gazeX * 0.4, 0);
    }
    const em = vrm.expressionManager;
    if (em) {
      const blink = clamp((f.blink ?? 0) + (1 - clamp(f.eyeOpen ?? 1, 0, 1)) * 0.6, 0, 1);
      em.setValue('blink', blink);
      const talking = brain?.state?.talking > 0 ? 1 : 0;
      const syllable = 0.5 + 0.5 * Math.sin(t * 18.7) * Math.sin(t * 4.3);
      em.setValue('a', clamp(talking * syllable, 0, 1));
      const mood = brain?.state?.mood || 'calm';
      for (const [k, name] of Object.entries(EXPRESSIONS)) {
        if (name) em.setValue(name, k === mood ? 0.75 : 0);
      }
    }
    holder.position.x = clamp((brain?.state?.root?.x || 0) * 0.006, -0.35, 0.35);
  }

  let dt = 0; // 当前帧时长，writeLocal 的平滑用
  function poseFromRig(brain, face, frameDt) {
    dt = frameDt;
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

    // 诊断：把“该动多少”和“实际写进去多少”都记下来
    lastDiag.poseSize = p.size ?? Object.keys(p).length;
    lastDiag.armA = j('arm_L_upper')?.a;
    lastDiag.armLA = j('arm_L_upper')?.a;
    lastDiag.armRA = j('arm_R_upper')?.a;
    lastDiag.foreLA = j('arm_L_fore')?.a;
    lastDiag.foreRA = j('arm_R_fore')?.a;
    lastDiag.handLA = j('hand_L')?.a;
    lastDiag.handRA = j('hand_R')?.a;

    // —— 躯干：绕世界 Z 轴侧倾，逐段累积 ——
    const pelvis = j('pelvis');
    const spine1 = j('spine1');
    const chest = j('chest');
    const neck = j('neck');
    const head = j('head');

    // 就算大脑在发呆，身体也不能像雕像：呼吸、重心、视线游移
    const breath = Math.sin(t * 1.15);
    const sway = Math.sin(t * 0.29);
    const swaySlow = Math.sin(t * 0.13 + 1.1);
    const glance = Math.sin(t * 0.23) * 0.6 + Math.sin(t * 0.61 + 0.7) * 0.4;

    const look = gazeX * 0.55 + glance * 0.28; // 她在“看哪儿”
    turn('hips', { x: 0, y: look * 0.16 + sway * 0.07, z: -(pelvis?.a || 0) * 0.5 + swaySlow * 0.035 });
    turn('spine', { x: breath * 0.012, y: look * 0.22 + swaySlow * 0.05, z: -(spine1?.a || 0) * 0.8 });
    turn('chest', { x: gazeY * 0.04 + breath * 0.035, y: look * 0.24, z: -(chest?.a || 0) * 0.9 });
    turn('upperChest', { x: breath * 0.02, y: 0, z: -(chest?.a || 0) * 0.35 });
    turn('neck', { x: -gazeY * 0.16 + breath * 0.01, y: look * 0.3, z: -(neck?.a || 0) * 0.8 });
    turn('head', {
      x: -gazeY * 0.24 + breath * 0.02,
      y: look * 0.55,
      z: -(head?.a || 0) * 1.0 + sway * 0.04,
    });

    // —— 手臂：先定上臂的世界方向，再依次“指向”前臂、手、每一节指骨 ——
    for (const side of ['L', 'R']) {
      // 我们骨架里的 L/R 是**画面**左右（L 在屏幕左边）；VRM 的 left/right 是**她本人**的左右。
      // 她面朝镜头，所以画面左边是她的右手 —— 这里必须反过来。
      const s = side === 'L' ? 'right' : 'left';
      const up = j(`arm_${side}_upper`);
      const fore = j(`arm_${side}_fore`);
      const hand = j(`hand_${side}`);
      if (!up) continue;

      // 手臂也要有一点自己的呼吸：几度的慢摆，避免“两根棍子”
      const armSway = Math.sin(t * 0.37 + (side === 'L' ? 0 : 1.7)) * 0.05 + Math.sin(t * 0.19 + (side === 'L' ? 2 : 0.4)) * 0.03;
      const aUp = (up.a ?? Math.PI) + armSway;
      // 我们的 a：0 朝上、π 朝下、顺时针为正；换成 3D 就是“在额状面里张开多少”
      // 再补一点向前的分量，避免像稻草人一样贴着身体
      const dirUp = new V(Math.sin(aUp), Math.cos(aUp), 0);
      dirUp.z = 0.18 * (side === 'L' ? 1 : 1);
      dirUp.normalize();
      // 手臂抬起来时，肩膀必须跟着抬一点 —— 否则就是一根从躯干里长出来的棍子。
      // raise: 0 = 完全垂下, 1 = 水平及以上
      const raise = clamp(1 + dirUp.y, 0, 1);
      const shoulderName = `${s}Shoulder`;
      const sRest = rest[shoulderName]?.dir;
      if (sRest) {
        const liftAxis = new V(0, 0, s === 'right' ? 1 : -1);
        aim(shoulderName, rotateAround(sRest, liftAxis, 0.20 * raise));
      }

      aim(`${s}UpperArm`, dirUp);

      // 屈肘：绕「上臂 × 前方向」的轴转，肘永远是往**前**弯的
      // 肘不能锁死：真实的手臂永远带一点弯，抬得越高弯得越多
      const flex = Math.max(Math.abs(wrap((fore?.a ?? aUp) - aUp)), 0.06 + 0.32 * raise);
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

    applyFace(brain, face, gazeX, gazeY);
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
    scene.updateMatrixWorld(true);
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

  let lastBrain = null;
  let lastFace = null;
  // ————————————————————————————————————————————————————————————
  // 标准做法：AnimationClip + AnimationMixer
  // 参考 three-vrm 官方示例与社区通用实现，要点三条：
  //   1. 关键帧写在 **normalized humanoid 骨骼的局部四元数** 上（不是世界四元数）；
  //   2. 轨道名 `<节点名>.quaternion`，插值与混合全部交给 mixer 做 slerp；
  //   3. 每帧顺序：mixer.update(dt) → vrm.update(dt) → render。
  // 之前的做法是每帧直接算世界朝向再硬写局部四元数 —— 那等于绕过整个动画系统，
  // 所以既没有过渡、又无法组合，看起来就僵。
  // ————————————————————————————————————————————————————————————

  const BONE_NAME = (bone) => `nrm_${bone}`; // 给 normalized 骨骼一个可绑定唯一名字

  // 把“这一帧的姿势函数”烘焙成局部四元数快照
  function bakePose(fn) {
    wq.clear();
    aq.clear();
    lastTarget.clear();
    applied.clear();
    BAKING = true;
    try {
      fn();
    } finally {
      BAKING = false;
    }
    const snap = new Map();
    for (const [bone, world] of wq) {
      const p = PARENT.get(bone);
      const parentWorld = p ? wq.get(p) || restWorldQ.get(p) || IDENT : IDENT;
      snap.set(bone, parentWorld.clone().invert().multiply(world));
    }
    return snap;
  }

  function bakeClip(name, keys) {
    const snaps = keys.map((k) => ({ t: k.t, snap: bakePose(k.fn) }));
    const bones = new Set();
    for (const s0 of snaps) for (const b of s0.snap.keys()) bones.add(b);
    const tracks = [];
    for (const bone of bones) {
      const n = node(bone);
      if (!n) continue;
      n.name = BONE_NAME(bone);
      const times = [];
      const values = [];
      for (const s0 of snaps) {
        times.push(s0.t);
        const q = s0.snap.get(bone) || new Q(); // 该帧没写 = 静止
        values.push(q.x, q.y, q.z, q.w);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${n.name}.quaternion`, times, values));
    }
    return new THREE.AnimationClip(name, keys[keys.length - 1].t, tracks);
  }

  // ————————————————— 腿：两段 IK（髋 → 膝 → 踝） —————————————————
  // 参考真实步态的做法：先定“脚落在哪里”，再用两段 IK 反解大腿和小腿。
  // 直接给大腿一个角度是画不出迈步的 —— 脚会飘、会插进地里。
  const X_AXIS = new V(1, 0, 0);
  const Z_AXIS = new V(0, 0, 1);
  const Y_AXIS = new V(0, 1, 0);
  const LEG = {};
  for (const s of ['left', 'right']) {
    const hip = rest[`${s}UpperLeg`];
    const knee = rest[`${s}LowerLeg`];
    const ankle = rest[`${s}Foot`];
    if (!hip || !knee || !ankle) continue;
    LEG[s] = {
      hip: hip.pos.clone(),
      L1: hip.pos.distanceTo(knee.pos),
      L2: knee.pos.distanceTo(ankle.pos),
      ankle: ankle.pos.clone(),
      footDir: rest[`${s}Foot`].dir.clone(),
    };
  }

  // 髋在 hip、踝想去 ankle，求膝的位置（膝盖朝前弯）
  function solveLeg(s, ankleTarget, sink = 0) {
    const L = LEG[s];
    if (!L) return;
    const hip = L.hip.clone().addScaledVector(Y_AXIS, -sink);
    const toA = ankleTarget.clone().sub(hip);
    const maxd = (L.L1 + L.L2) * 0.995;
    let d = toA.length();
    if (d > maxd) {
      toA.multiplyScalar(maxd / d);
      d = maxd;
    }
    if (d < 1e-4) return;
    const dir = toA.clone().normalize();
    const a = (L.L1 * L.L1 - L.L2 * L.L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L.L1 * L.L1 - a * a));
    let pole = FORWARD.clone().sub(dir.clone().multiplyScalar(FORWARD.dot(dir)));
    if (pole.lengthSq() < 1e-6) pole = new V(0, 0, -1);
    pole.normalize();
    const kneeP = hip.clone().addScaledVector(dir, a).addScaledVector(pole, h);
    const ankleP = hip.clone().addScaledVector(dir, d);
    aim(`${s}UpperLeg`, kneeP.clone().sub(hip).normalize());
    aim(`${s}LowerLeg`, ankleP.clone().sub(kneeP).normalize());
  }

  const WALK = { T: 1.05, stride: 0.26, lift: 0.055, duty: 0.62, sink: 0.035 };
  WALK.speed = (WALK.stride * 2) / WALK.T; // 米/秒 —— 步子多大就走多快，脚不打滑

  // 一个完整的步态周期：p=0 右脚跟着地
  function gaitLeg(s, p, cfg = WALK) {
    const L = LEG[s];
    if (!L) return;
    const base = L.ankle;
    let z;
    let y = base.y;
    let pitch;
    if (p < cfg.duty) {
      // 支撑相：脚定在地上，相对身体往后走 —— 这就是“不打滑”的关键
      const u = p / cfg.duty;
      z = -cfg.stride / 2 + cfg.stride * u;
      pitch = u < 0.18 ? ((0.18 - u) / 0.18) * 0.26 : u > 0.72 ? -((u - 0.72) / 0.28) * 0.5 : 0;
    } else {
      // 摆动相：抬脚、往前送
      const u = (p - cfg.duty) / (1 - cfg.duty);
      const e = u * u * (3 - 2 * u);
      z = cfg.stride / 2 - cfg.stride * e;
      y = base.y + cfg.lift * Math.sin(Math.PI * u);
      pitch = -0.18 + 0.42 * e;
    }
    solveLeg(s, new V(base.x, y, base.z + z), cfg.sink);
    aim(`${s}Foot`, rotateAround(L.footDir, X_AXIS, pitch));
  }

  // 手指：30 根，逐节卷曲。轴要跟着手腕一起转，否则手指会朝反方向翻。
  const FINGER_SEGS = ['Proximal', 'Intermediate', 'Distal'];
  const FINGER_WEIGHT = {
    Thumb: [0.6, 0.75, 0.6],
    Index: [0.5, 0.9, 0.55],
    Middle: [0.5, 0.95, 0.6],
    Ring: [0.5, 0.9, 0.55],
    Little: [0.55, 0.85, 0.5],
  };
  function poseFingers(bs, curl) {
    if (!curl) return;
    const dh = handDelta(`${bs}Hand`);
    const axis = Z_AXIS.clone().applyQuaternion(dh);
    const handDir = rest[`${bs}Hand`]?.dir;
    const sign = -(handDir && handDir.x < 0 ? -1 : 1); // 手心那一侧
    for (const f of Object.keys(FINGER_WEIGHT)) {
      const w = FINGER_WEIGHT[f];
      let acc = 0;
      for (let i = 0; i < 3; i++) {
        const n = `${bs}${f}${FINGER_SEGS[i]}`;
        const r = rest[n];
        if (!r || !node(n)) continue;
        acc += w[i] * curl;
        aim(n, rotateAround(r.dir.clone().applyQuaternion(dh), axis, sign * acc));
      }
    }
  }

  // 一条胳膊：肩 → 上臂 → 肘 → 手 → 手指
  const ARM_HANG = { L: new V(0.24, -0.95, 0.06), R: new V(-0.24, -0.95, 0.06) };
  function poseArm(bs, dirRaw, elbow = 0.16, hand = 0.08, curl = 0) {
    const dir = (dirRaw || ARM_HANG[bs === 'right' ? 'R' : 'L']).clone().normalize();
    const raise = clamp(1 + dir.y, 0, 1);
    const sRest = rest[`${bs}Shoulder`]?.dir;
    if (sRest) aim(`${bs}Shoulder`, rotateAround(sRest, Y_AXIS, (bs === 'right' ? 1 : -1) * 0.18 * raise));
    aim(`${bs}UpperArm`, dir);
    let axis = new V().crossVectors(dir, FORWARD);
    if (axis.lengthSq() < 1e-6) axis = X_AXIS.clone();
    axis.normalize();
    const flex = Math.max(elbow, 0.05 + 0.3 * raise);
    const dirFore = rotateAround(dir, axis, flex);
    aim(`${bs}LowerArm`, dirFore);
    aim(`${bs}Hand`, rotateAround(dirFore, axis, hand));
    poseFingers(bs, curl);
  }

  // 一具“站着”的身体：所有轨道都以它为底，差别只在参数
  function basePose(cfg = {}) {
    const {
      breath = 0,
      sway = 0,
      headYaw = 0,
      headPitch = 0,
      headRoll = 0,
      armL = null,
      armR = null,
      swing = 0,
      elbow = 0.16,
      hand = 0.08,
      curl = 0.14,
    } = cfg;

    turn('hips', { x: 0, y: sway * 0.05, z: sway * 0.022 });
    turn('spine', { x: breath * 0.012, y: sway * 0.03, z: 0 });
    turn('chest', { x: breath * 0.03, y: headYaw * 0.2, z: sway * 0.012 });
    turn('upperChest', { x: breath * 0.02, y: headYaw * 0.16, z: 0 });
    turn('neck', { x: headPitch * 0.3, y: headYaw * 0.3, z: headRoll * 0.3 });
    turn('head', { x: headPitch * 0.6, y: headYaw * 0.62, z: headRoll * 0.6 });

    // 站姿：双脚就在原地（腿也要解一次 IK，膝盖才不是锁死的）
    for (const s of ['left', 'right']) {
      if (!LEG[s]) continue;
      solveLeg(s, LEG[s].ankle.clone(), 0.006);
      aim(`${s}Foot`, LEG[s].footDir.clone());
    }

    poseArm('right', armL, elbow, hand, curl);
    poseArm('left', armR, elbow, hand, curl);
  }

  const NEUTRAL = () => basePose({});

  function walkPose(p) {
    const s2 = Math.sin(2 * Math.PI * p);
    turn('hips', { x: 0.03, y: -s2 * 0.06, z: s2 * 0.035 });
    turn('spine', { x: 0.02, y: s2 * 0.04, z: -s2 * 0.015 });
    turn('chest', { x: 0.02, y: s2 * 0.05 });
    turn('upperChest', { x: 0, y: s2 * 0.03 });
    turn('neck', { x: -0.05 });
    turn('head', { x: -0.03, y: -s2 * 0.05 });
    gaitLeg('left', p % 1);
    gaitLeg('right', (p + 0.5) % 1);
    // 手臂与同侧的腿反向摆
    const swingDir = (bs) => rotateAround(ARM_HANG[bs === 'right' ? 'R' : 'L'], X_AXIS, s2 * 0.42 * (bs === 'right' ? 1 : -1));
    poseArm('right', swingDir('right'), 0.3, 0.12, 0.25);
    poseArm('left', swingDir('left'), 0.3, 0.12, 0.25);
  }

  // 原地转身：重心移到一只脚上，另一只脚抬起来换个方向
  function turnPose(dir, k) {
    const yaw = dir * 0.6 * k;
    turn('hips', { x: 0.02, y: yaw * 0.6 });
    turn('spine', { x: 0.03, y: yaw * 0.2 });
    turn('chest', { x: 0.03, y: yaw * 0.15 });
    turn('neck', { y: yaw * 0.1 });
    turn('head', { y: yaw * 0.25 });
    const swingSide = dir > 0 ? 'right' : 'left';
    for (const s of ['left', 'right']) {
      if (!LEG[s]) continue;
      const base = LEG[s].ankle;
      const lift = s === swingSide ? Math.sin(Math.PI * k) * 0.07 : 0;
      solveLeg(s, new V(base.x, base.y + lift, base.z + (s === swingSide ? -0.02 : 0)), 0.012 + lift * 0.4);
      aim(`${s}Foot`, rotateAround(LEG[s].footDir, X_AXIS, lift > 0 ? 0.24 : 0));
    }
    poseArm('right', null, 0.22, 0.1, 0.16);
    poseArm('left', null, 0.22, 0.1, 0.16);
  }

  const CLIPS = {
    idle: bakeClip('idle', [
      { t: 0, fn: () => basePose({ breath: 0, sway: 0, headYaw: 0, curl: 0.12 }) },
      { t: 1.2, fn: () => basePose({ breath: 1, sway: 0.7, headYaw: 0.06, headRoll: 0.03, curl: 0.16 }) },
      { t: 2.4, fn: () => basePose({ breath: 0, sway: 0, headYaw: 0.02, curl: 0.2 }) },
      { t: 3.6, fn: () => basePose({ breath: -1, sway: -0.7, headYaw: -0.07, headRoll: -0.03, curl: 0.14 }) },
      { t: 4.8, fn: () => basePose({ breath: 0, sway: 0, headYaw: 0, curl: 0.12 }) },
    ]),
    // 走路：两个步幅一个循环，首尾同帧 —— 循环起来无缝
    walk: bakeClip('walk', Array.from({ length: 25 }, (_, i) => {
      const p = i / 24;
      return { t: p * WALK.T, fn: () => walkPose(p) };
    })),
    turnL: bakeClip('turnL', [0, 0.25, 0.5, 0.75, 1].map((k) => ({ t: k * 0.75, fn: () => turnPose(1, k) }))),
    turnR: bakeClip('turnR', [0, 0.25, 0.5, 0.75, 1].map((k) => ({ t: k * 0.75, fn: () => turnPose(-1, k) }))),
    // 手指：握一下再张开（30 根一起，是“她真的在用手”的证据）
    grip: bakeClip('grip', [
      { t: 0, fn: () => basePose({ curl: 0.15 }) },
      { t: 0.35, fn: () => basePose({ curl: 0.95, elbow: 0.34, hand: 0.2, headPitch: 0.12 }) },
      { t: 0.8, fn: () => basePose({ curl: 0.95, elbow: 0.34, hand: 0.2, headPitch: 0.12 }) },
      { t: 1.3, fn: () => basePose({ curl: 0.12 }) },
    ]),
    lookL: bakeClip('lookL', [
      { t: 0, fn: NEUTRAL },
      { t: 0.5, fn: () => basePose({ headYaw: 0.42, headPitch: -0.05, sway: 0.3 }) },
      { t: 1.6, fn: () => basePose({ headYaw: 0.4, headPitch: -0.04, sway: 0.28 }) },
      { t: 2.4, fn: NEUTRAL },
    ]),
    lookR: bakeClip('lookR', [
      { t: 0, fn: NEUTRAL },
      { t: 0.5, fn: () => basePose({ headYaw: -0.42, headPitch: -0.05, sway: -0.3 }) },
      { t: 1.6, fn: () => basePose({ headYaw: -0.4, headPitch: -0.04, sway: -0.28 }) },
      { t: 2.4, fn: NEUTRAL },
    ]),
    reachL: bakeClip('reachL', [
      { t: 0, fn: NEUTRAL },
      { t: 0.6, fn: () => basePose({ armL: new V(0.3, -0.28, -0.9), elbow: 0.42, hand: 0.16, curl: 0.3, headPitch: 0.12, sway: 0.25 }) },
      { t: 1.5, fn: () => basePose({ armL: new V(0.34, -0.24, -0.9), elbow: 0.5, hand: 0.18, curl: 0.1, headPitch: 0.14, sway: 0.3 }) },
      { t: 2.3, fn: NEUTRAL },
    ]),
    reachR: bakeClip('reachR', [
      { t: 0, fn: NEUTRAL },
      { t: 0.6, fn: () => basePose({ armR: new V(-0.3, -0.28, -0.9), elbow: 0.42, hand: 0.16, curl: 0.3, headPitch: 0.12, sway: -0.25 }) },
      { t: 1.5, fn: () => basePose({ armR: new V(-0.34, -0.24, -0.9), elbow: 0.5, hand: 0.18, curl: 0.1, headPitch: 0.14, sway: -0.3 }) },
      { t: 2.3, fn: NEUTRAL },
    ]),
    stretch: bakeClip('stretch', [
      { t: 0, fn: NEUTRAL },
      { t: 1.0, fn: () => basePose({ armL: new V(0.42, 0.86, -0.2), armR: new V(-0.42, 0.86, -0.2), elbow: 0.22, headPitch: -0.2, breath: 0.8, curl: 0.05 }) },
      { t: 2.0, fn: () => basePose({ armL: new V(0.5, 0.8, -0.3), armR: new V(-0.5, 0.8, -0.3), elbow: 0.3, headPitch: -0.24, breath: 0.6, curl: 0.05 }) },
      { t: 3.0, fn: NEUTRAL },
    ]),
  };

  const mixer = new THREE.AnimationMixer(vrm.scene);
  const actions = {};
  for (const [name, clip] of Object.entries(CLIPS)) {
    const a = mixer.clipAction(clip);
    if (name === 'idle' || name === 'walk') a.setLoop(THREE.LoopRepeat, Infinity);
    else {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = false;
    }
    actions[name] = a;
  }
  actions.idle.play();
  mixer.update(0); // 第一帧先摆好，否则会闪一帧 T-pose

  // 自检用：?freeze=0.25 停在走路的某个相位，?nav=walk 强制一直走
  const QS = new URLSearchParams(
    [globalThis.location?.search?.replace(/^\?/, '') || '', globalThis.__XXOO_FLAGS__ || ''].filter(Boolean).join('&'),
  );
  const FORCE_NAV = QS.get('nav');
  const FREEZE = QS.get('freeze');
  if (FREEZE != null) {
    actions.idle.stop();
    actions.walk.reset().play();
    actions.walk.paused = true;
    actions.walk.time = (parseFloat(FREEZE) || 0) * WALK.T;
  }

  let current = 'idle';
  let actsPlayed = 0;

  function playAction(name, fade = 0.45) {
    const to = actions[name];
    if (!to || name === current) return;
    const from = actions[current];
    to.reset();
    to.setEffectiveWeight(1);
    to.play();
    if (from) to.crossFadeFrom(from, fade, false);
    current = name;
    actsPlayed++;
  }

  mixer.addEventListener('finished', (e) => {
    if (!e.action || e.action === actions.idle) return;
    if (e.action === actions.walk) return;
    const idle = actions.idle;
    idle.reset();
    idle.setEffectiveWeight(1);
    idle.play();
    idle.crossFadeFrom(e.action, 0.4, false);
    current = 'idle';
  });

  // ————————————————— 她自己去哪 —————————————————
  // 走路用“世界反过来动”的办法：镜头不离她，她永远面对你；
  // 转身 = 世界绕她转过去一点 + 身上放一段原地转身的动作。
  const nav = {
    mode: 'idle',
    until: 2.2,
    yaw: 0,
    yawFrom: 0,
    yawTo: 0,
    t0: 0,
    dir: 1,
    travel: new V(),
    walked: 0,
  };

  function startTurn(dir) {
    nav.mode = 'turn';
    nav.dir = dir;
    nav.t0 = t;
    nav.yawFrom = nav.yaw;
    nav.yawTo = nav.yaw + dir * (0.55 + Math.random() * 0.5);
    playAction(dir > 0 ? 'turnL' : 'turnR', 0.3);
  }

  function startWalk(sec) {
    nav.mode = 'walk';
    nav.until = t + sec;
    playAction('walk', 0.35);
  }

  const wrapHalf = (v, span) => {
    const s0 = span;
    return ((((v + s0 / 2) % s0) + s0) % s0) - s0 / 2;
  };
  function applyStage() {
    if (!stage) return;
    if (!Number.isFinite(nav.travel.x + nav.travel.z + nav.yaw)) {
      nav.travel.set(0, 0, 0);
      nav.yaw = 0;
    }
    stage.rotation.y = -nav.yaw;
    // 地面：贴图反向滚，看起来就是地在她脚下往后走
    if (world.tex) {
      const rep = 24;
      world.tex.offset.set((nav.travel.x / 200) * rep, (-nav.travel.z / 200) * rep);
    }
    // 景物：出了格子就从对面绕回来；离镜头太近的先收起来，免得糊在脸上
    const camLocal = new V(0, 0, camera.position.z).applyAxisAngle(Y_AXIS, nav.yaw);
    for (const p of world.props) {
      p.position.x = wrapHalf(p.userData.base.x - nav.travel.x, world.span);
      p.position.z = wrapHalf(p.userData.base.y - nav.travel.z, world.span);
      const dx = p.position.x - camLocal.x;
      const dz = p.position.z - camLocal.z;
      p.visible = dx * dx + dz * dz > 2.2;
    }
  }

  function driveNav(dt) {
    if (FREEZE != null) {
      nav.mode = 'freeze';
      return;
    }
    if (FORCE_NAV === 'walk') {
      if (nav.mode !== 'walk') startWalk(600);
      nav.travel.z -= WALK.speed * dt;
      nav.walked += WALK.speed * dt;
      applyStage();
      return;
    }
    if (nav.mode === 'turn') {
      const k = clamp((t - nav.t0) / 0.75, 0, 1);
      const e = k * k * (3 - 2 * k);
      nav.yaw = nav.yawFrom + (nav.yawTo - nav.yawFrom) * e;
      if (k >= 1) {
        nav.mode = 'idle';
        nav.until = t + 0.8;
      }
    } else if (nav.mode === 'walk') {
      nav.travel.z -= WALK.speed * dt; // 她朝自己的前方走，脚下的地往后滑
      nav.walked += WALK.speed * dt;
      if (t > nav.until) {
        nav.mode = 'idle';
        nav.until = t + 1.6;
        playAction('idle', 0.45);
      }
    } else if (t > nav.until && current === 'idle') {
      const r = Math.random();
      if (r < 0.4) startTurn(Math.random() < 0.5 ? -1 : 1);
      else if (r < 0.62) startWalk(2.4 + Math.random() * 3);
      else if (r < 0.74) playAction('grip');
      else if (r < 0.85) playAction(r < 0.795 ? 'lookL' : 'lookR');
      else if (r < 0.94) playAction(r < 0.895 ? 'reachL' : 'reachR');
      else playAction('stretch');
      nav.until = t + 3 + Math.random() * 4;
    }
    applyStage();
  }

  const LEGACY = new URLSearchParams(globalThis.location?.search || '').get('anim') === 'legacy';

  function sync(brain, face, dt) {
    lastBrain = brain;
    lastFace = face;
    const step = Math.min(dt || clock.getDelta(), 0.05);
    t += step;
    if (LEGACY) {
      poseFromRig(brain, face, step);
    } else {
      driveNav(step); // 她自己决定走、转、还是做点什么
      mixer.update(step); // 标准插值 / 混合
      lastDiag.poseSize = 'mixer';
      lastDiag.clip = current;
      applyFace(brain, face);
    }
    vrm.update(step);
    renderer.render(scene, camera);
    ready = true;
  }

  // 弹簧骨复位后再跑一帧（别用 dt=0，物理里除零会让头发炸开）
  poseFromRig({ state: { pose: null } }, null, 0);
  try {
    vrm.springBoneManager?.reset?.();
  } catch {
    /* 没有就算了 */
  }
  vrm.update(1 / 60);
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
    // 手动转身：每按一次 +deg（默认 180），并记住到下次打开
    turnBody(deg = 180) {
      holder.rotation.y += (deg * Math.PI) / 180;
      scene.updateMatrixWorld(true);
      vrm.humanoid.update();
      const f = measureFacing();
      try {
        const prev = Number(globalThis.localStorage?.getItem(FACE_KEY) || 0);
        const next = ((((Number.isFinite(prev) ? prev : 0) + deg) % 360) + 360) % 360;
        globalThis.localStorage?.setItem(FACE_KEY, String(next));
      } catch {
        /* 隐私模式 */
      }
      faceProbe = `手动 ${deg}°`;
      return f ? (Math.atan2(f.x, f.z) * 180) / Math.PI : NaN;
    },
    // 把内部状态摊开：骨骼有没有真的被写进去
    debugState() {
      const q = (n) => {
        const b = node(n);
        if (!b) return null;
        return {
          local: b.quaternion.toArray().map((v) => +v.toFixed(3)),
          auto: vrm.humanoid.autoUpdateHumanBones,
        };
      };
      const deg = (k) => {
        const v = lastDiag[k];
        return v === undefined || v === null ? null : +((v * 180) / Math.PI).toFixed(1);
      };
      return {
        springOn,
        mode: LEGACY ? 'legacy' : 'mixer',
        clip: lastDiag.clip,
        played: actsPlayed,
        t: +t.toFixed(1),
        nav: nav.mode,
        cam: camera.position.toArray().map((x) => +x.toFixed(2)),
        floorY: +floorY.toFixed(3),
        travel: [+nav.travel.x.toFixed(2), +nav.travel.z.toFixed(2)],
        stageP: stage ? stage.position.toArray().map((x) => +x.toFixed(2)) : null,
        yaw: +nav.yaw.toFixed(2),
        walked: +nav.walked.toFixed(1),
        poseSize: lastDiag.poseSize,
        armA: lastDiag.armA === undefined ? null : +lastDiag.armA.toFixed(3),
        arms: { L: deg('armLA'), R: deg('armRA'), foreL: deg('foreLA'), foreR: deg('foreRA'), handL: deg('handLA'), handR: deg('handRA') },
        rightUpperArm: q('rightUpperArm'),
        spine: q('spine'),
        restDirArm: rest.rightUpperArm?.dir ? rest.rightUpperArm.dir.toArray().map((v) => +v.toFixed(3)) : null,
      };
    },
    get springOn() {
      return springOn;
    },
    // 抓一帧画面（缩小后转 jpeg），用来上传给服务器落盘检查
    snapshot(maxW = 460) {
      try {
        // 后台标签页里 rAF 会停，画布上留的是几千帧前的旧图。
        // 截图前强制推一帧，拍到的才是“现在”。
        if (lastBrain) {
          if (LEGACY) poseFromRig(lastBrain, lastFace, 1 / 60);
          else {
            mixer.update(1 / 60);
            applyFace(lastBrain, lastFace);
          }
          vrm.update(1 / 60);
          renderer.render(scene, camera);
        }
        const src = renderer.domElement;
        const w = Math.min(maxW, src.width);
        const h = Math.round((src.height / src.width) * w);
        const c2 = document.createElement('canvas');
        c2.width = w;
        c2.height = h;
        const ctx = c2.getContext('2d');
        ctx.drawImage(src, 0, 0, w, h);
        return c2.toDataURL('image/jpeg', 0.85);
      } catch {
        return '';
      }
    },
    // 她的正面是否朝着相机：+1 正对，-1 背对
    facingCamera() {
      const f = measureFacing();
      if (!f) return NaN;
      const toCam = new V().subVectors(camera.position, new V(0, 1.2, 0)).setY(0);
      if (toCam.lengthSq() < 1e-9) return NaN;
      return f.dot(toCam.normalize());
    },
    get faceProbe() {
      return faceProbe;
    },
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
