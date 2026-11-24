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
// 可以换的「建模」。都是 VRM 标准骨架，所以同一套动作、同一套 30 根手指全部通用。
// 想加新的：把 .vrm 丢进 vendor/model/ 下，在这里加一行就行。
export const MODELS = {
  alicia: { url: './vendor/model/alicia/AliciaSolid.vrm', cn: '爱丽丝', note: 'VRoid 官方 · 白裙金发' },
  sampleA: { url: './vendor/model/sampleA/AvatarSample_A.vrm', cn: '小明', note: 'VRoid 官方样张 A · 制服' },
  victoria: { url: './vendor/model/victoria/Victoria_Rubin.vrm', cn: '维多利亚', note: 'Victoria Rubin · 成熟体型' },
  vita: { url: './vendor/model/vita/Vita.vrm', cn: '薇塔', note: 'Vita · 曲线' },
};
export const MODEL_ORDER = ['alicia', 'sampleA', 'victoria', 'vita'];

// 有的建模把「外衣」做成独立网格（Alicia 就是这样），可以只穿里面那层。
export const OUTFITS = {
  alicia: [{ id: 'light', cn: '清凉', hide: '^cloth' }],
};

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

export const USED_EXPRESSIONS = [
  ...new Set([...Object.values(EXPRESSIONS).filter(Boolean), 'blink', 'a', 'i', 'u', 'e', 'o', 'neutral']),
];

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
  // 脸贴得很近时，原来的直出会把皮肤打成一团白（高光全clip）。
  // ACES 把高光压回来，睫毛/腮红/瞳孔才有层次。
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearAlpha(0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);

  // 这套模型的脸在 -Z 一侧（拆 GLB 量过：眼睛 z≈-0.051，脚趾 z≈-0.060）。
  // 与其反复拧模型，不如把相机放到她脸的那一边 —— 这是几何事实，不会被
  // 矩阵缓存、保存的角度、版本号里的隐藏旋转任何一项抵消。
  const FRONT = -1;
  const key = new THREE.DirectionalLight(0xfff2f6, 1.45);
  key.position.set(1.2, 2.4, 2.2 * FRONT);
  const fill = new THREE.DirectionalLight(0x9fb8ff, 0.45);
  fill.position.set(-2, 1.2, 1.4 * FRONT);
  const rim = new THREE.DirectionalLight(0xff9fbe, 0.8);
  rim.position.set(0.4, 1.6, -2.4 * FRONT);
  const amb = new THREE.HemisphereLight(0xbfd4ff, 0x281a30, 0.55);
  scene.add(key, fill, rim, amb);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(modelUrl);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('这个文件不是 VRM（没有 humanoid）');

  // 这个模型到底有哪些表情 —— 不查表写死，直接问它自己。
  // （写死的名字如果不在这具模型里，setValue 会安静地什么也不干，看起来就是「没有表情」。）
  // 这具模型是老 VRM0，three-vrm 会把老名字翻成新名字：
  //   a→aa  i→ih  u→ou  e→ee  o→oh   joy→happy  sorrow→sad  fun→relaxed
  // 以前我们直接 setValue('joy', …)：名字对不上，three-vrm 就安静地什么都不做 ——
  // 所以「没有表情」不是权重太小，是名字根本不存在。
  const EXPR_ALIAS = {
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
  const EXPR_NAME = {}; // 我们说的名字 → 这具模型真名（没有就是 null）
  (() => {
    const em = vrm.expressionManager;
    let keys = [];
    try {
      keys = Object.keys(em?.expressionMap || {});
      if (!keys.length) keys = (em?.expressions || []).map((e) => e.expressionName);
    } catch {
      keys = [];
    }
    const lower = new Map(keys.map((k) => [String(k).toLowerCase(), k]));
    for (const [want, aliases] of Object.entries(EXPR_ALIAS)) {
      let hit = null;
      for (const a of aliases) {
        const k = lower.get(a.toLowerCase());
        if (k) {
          hit = k;
          break;
        }
      }
      EXPR_NAME[want] = hit;
    }
  })();

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

  // 场景全撤了：没有地面网格、没有树、没有石头、没有草。
  // 她是这画面里唯一的实体，脚下一圈很淡的光只负责让她“站在地上”。
  const world = { tex: null, props: [], tile: 4.5, span: 27 };
  {
    stage.position.y = floorY;
    const glowTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const rg = g.createRadialGradient(64, 64, 2, 64, 64, 62);
      rg.addColorStop(0, 'rgba(255,214,236,0.85)');
      rg.addColorStop(0.45, 'rgba(240,150,200,0.26)');
      rg.addColorStop(1, 'rgba(255,150,200,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.6,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.004;
    glow.renderOrder = -1;
    stage.add(glow);
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

  // ————————————————— 掌心的横轴 —————————————————
  // aim() 只管骨头的「方向」，不管绕骨头轴的「拧」。手臂从 T 字横举放下来时，
  // 是「最小旋转」把骨头带过去的 —— 掌心于是朝后、朝外，看起来就是手腕拧断了。
  // 真人自然站立时掌心贴着大腿：指根那条连线（掌心横轴）基本是身体的前后方向。
  // 这里从模型自己量出这条线（不写死），摆完姿势再把前臂拧过去。
  const PALM_LINE = Object.create(null); // 侧 -> 前臂骨局部坐标下的单位向量
  const FINGER_SIGN = Object.create(null); // 侧 -> 手指往掌心弯的旋转方向
  // 每根手指自己的屈曲轴（手骨局部坐标）。手指不是在同一根轴上一起转的 ——
  // 一根轴转全部，它们会像扇子一样摊平；所以逐指算。
  const FINGER_AXIS = Object.create(null);
  const BODY_FWD = new V(0, 0, -1).applyQuaternion(holder.quaternion).normalize();
  try {
    for (const sd of ['left', 'right']) {
      const lower = rest[`${sd}LowerArm`];
      const idx = rest[`${sd}IndexProximal`];
      const lit = rest[`${sd}LittleProximal`];
      if (!lower || !idx || !lit) continue;
      const line = lit.pos.clone().sub(idx.pos);
      if (line.lengthSq() < 1e-8) continue;
      PALM_LINE[sd] = line.normalize().applyQuaternion(lower.q.clone().invert()).normalize();
      // 掌心的那一侧：中指指向 × 指根连线，取指向身体中线的那一头
      const mid = rest[`${sd}MiddleProximal`];
      const medial = new V(sd === 'right' ? 1 : -1, 0, 0);
      if (mid) {
        const kWorld = line.clone().normalize();
        const fWorld = mid.dir.clone();
        const p = new V().crossVectors(kWorld, fWorld);
        FINGER_SIGN[sd] = p.dot(medial) >= 0 ? 1 : -1;
      }
    }
    for (const sd of ['left', 'right']) {
      FINGER_AXIS[sd] = Object.create(null);
      for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
        const a = rest[`${sd}${f}Proximal`];
        const b = rest[`${sd}${f}Intermediate`];
        if (!a || !b) continue;
        // 静止时这两节的夹角：叉积方向 = 继续弯下去该绕的轴
        const c = new V().crossVectors(a.dir, b.dir);
        if (c.lengthSq() < 1e-6) continue;
        const inv = rest[`${sd}Hand`].q.clone().invert();
        FINGER_AXIS[sd][f] = c.normalize().applyQuaternion(inv).normalize();
      }
    }
  } catch {
    /* 量不出来就退化成不拧 */
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

  // ?hide=cloth（正则，逗号分隔）：临时藏掉某几层网格，方便核对「衣服下面是什么」
  try {
    const qp = new URLSearchParams(globalThis.location?.search || '');
    const fp = new URLSearchParams(globalThis.__XXOO_FLAGS__ || '');
    let saved = '';
    try {
      saved = globalThis.localStorage?.getItem('xxoo.hide') || '';
    } catch {
      /* 隐私模式 */
    }
    const hide = qp.get('hide') || fp.get('hide') || saved;
    if (hide) {
      const res = hide.split(',').filter(Boolean).map((t) => new RegExp(t, 'i'));
      vrm.scene.traverse((o) => {
        if (!o.isMesh) return;
        const nm = o.name || '';
        if (res.some((r) => r.test(nm))) o.visible = false;
      });
    }
  } catch {
    /* 只是自检用 */
  }

  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = box.getSize(new V());
  const height = size.y || 1.55;
  // 每具建模的静止站姿都不一样（有的自带屈膝）。载入后会算出「腿伸直」要抬多少，
  // 这里先占个位，镜头按「抬高之后」的身高构图。
  let STANCE = 0;
  // 腿的长短不一样：步幅/抬脚/下沉都按腿长等比缩放，否则矮个子走起来像半蹲
  let LEG_SCALE = 1;

  let t = 0;
  let ready = false;
  // 镜头原位（全身）—— 看脸的时候从它慢慢推过去
  const camHome = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  const tmpV3 = new THREE.Vector3();

  function layout() {
    const w = canvas.clientWidth || window.innerWidth || 1;
    const h = canvas.clientHeight || window.innerHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 竖向构图：脚不能被底下的输入框挡住。
    // 先量出输入框有多高，再从画面里把这块让出去，剩下的区域正好装下她的全身。
    let barH = 0;
    try {
      const bar = globalThis.document?.querySelector('.composer');
      if (bar && bar.getBoundingClientRect) {
        const r = bar.getBoundingClientRect();
        if (r.height > 0) barH = r.height + 18; // 输入框上方再留一点呼吸
      }
    } catch {
      /* 没有 DOM 就算了 */
    }
    const padFrac = clamp(barH / h, 0, 0.3);
    const usable = 1 - padFrac;
    const span = (height + STANCE) * 1.04;
    const dist = span / (2 * Math.tan(camera.fov / 2 / DEG)) / usable;
    // 把她的中心对到「可用区域」的正中 —— 也就是整体往画面上方挪 padFrac/2
    const worldPerScreen = 2 * dist * Math.tan(camera.fov / 2 / DEG);
    const lift = (padFrac / 2) * worldPerScreen;
    const centerY = height * 0.5 - lift;
    camera.position.set(0, centerY + height * 0.045, FRONT * dist);
    // 自检用：?view=side / ?view=back 转到侧面看轮廓（判断弯腰、迈步对不对，正面会透视压缩看不出真形）
    let sideView = 0;
    try {
      const q = new URLSearchParams(
        [globalThis.location?.search?.replace(/^\?/, '') || '', globalThis.__XXOO_FLAGS__ || ''].filter(Boolean).join('&'),
      );
      const v = q.get('view');
      if (v === 'side') sideView = Math.PI / 2;
      else if (v === 'back') sideView = Math.PI;
      else if (v) sideView = (parseFloat(v) * Math.PI) / 180 || 0;
    } catch {
      /* ignore */
    }
    if (sideView) camera.position.applyAxisAngle(new V(0, 1, 0), sideView);
    // 自检：?zoom=1.2&zoomY=0.6 把镜头贴到某个高度，抓下来的图才有像素判断细节
    let lookY = centerY;
    try {
      const q = new URLSearchParams(
        [globalThis.location?.search?.replace(/^\?/, '') || '', globalThis.__XXOO_FLAGS__ || ''].filter(Boolean).join('&'),
      );
      const zd = parseFloat(q.get('zoom') || '');
      if (zd > 0.2) {
        const zy = (height + STANCE) * clamp(parseFloat(q.get('zoomY') || '0.62'), 0, 1);
        camera.position.set(0, zy, FRONT * zd);
        if (sideView) camera.position.applyAxisAngle(new V(0, 1, 0), sideView);
        lookY = zy;
      }
    } catch {
      /* ignore */
    }
    camera.lookAt(0, lookY, 0);
    camHome.pos.copy(camera.position);
    camHome.tgt.set(0, lookY, 0);
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
  // ——————————————— 脸 ———————————————
  // 这个模型有 17 组表情（a/i/u/e/o、blink、joy、angry、sorrow、fun、look*）。
  // 以前只写 blink + 一个固定 0.75 的表情，所以看上去「没有表情」。现在是连续权重：
  // 情绪慢慢靠过去，眨眼是随机的，说话时嘴形在 a/i/u/e/o 之间走。
  const FACE_W = { joy: 0, sorrow: 0, fun: 0, angry: 0, neutral: 0 };
  const MOUTH_W = { a: 0, i: 0, u: 0, e: 0, o: 0 };
  // 权重不是越大越好：joy 拉到 0.9 这具模型的眼睛会直接眯成一条缝。
  // VRM 的脸没有肌肉 —— 它只有一组烘好的「表情权重」（blendShape：happy/sad/angry/relaxed
  // /blink + 五个口型）。真实感只能靠组合：眼型（blink 眯眼）+ 眉/嘴的权重 + 视线 + 头颈角度。
  // 所以每个情绪是一整套，不是给一根“肌肉”。
  const EMO = {
    calm: { joy: 0.26, fun: 0.12, neutral: 0.22 },
    happy: { joy: 0.55, fun: 0.4 },
    shy: { fun: 0.55, joy: 0.3, squint: 0.3, gazeX: -0.35, gazeY: 0.22 },
    love: { joy: 0.6, fun: 0.4, squint: 0.16, gazeX: 0.05, gazeY: -0.05 },
    curious: { joy: 0.3, fun: 0.22, gazeX: 0.22, gazeY: -0.12 },
    sleepy: { sorrow: 0.36, neutral: 0.34, squint: 0.4 },
    sad: { sorrow: 0.7, squint: 0.12, gazeY: 0.3 },
    pout: { angry: 0.3, sorrow: 0.22, squint: 0.1, gazeX: -0.2 },
    surprised: { joy: 0.1, neutral: 0.55, squint: -0.0, gazeY: -0.15 },
    startled: { angry: 0.18, joy: 0.14 },
  };
  let moodOverride = null; // 自检用：?mood=happy
  let blinkNext = 2.4;
  let blinkLeft = 0;
  let mouthPhase = 0;
  let mouthIdx = 0;
  const VOWELS = ['a', 'i', 'u', 'e', 'o'];

  function applyFace(brain, face, gx, gy, step) {
    const h = 1 / 60;
    const d = clamp(step || h, 1 / 240, 0.1);
    const f = face?.state || {};
    let gazeX = gx ?? clamp((f.gazeX ?? 0) / 3, -1, 1);
    let gazeY = gy ?? clamp((f.gazeY ?? 0) / 3, -1, 1);
    // 情绪自带的视线（害羞会瞟开、难过会垂下）——眼球在这一步之前就得定下来
    {
      const m0 = moodOverride || brain?.state?.mood || 'calm';
      const t0 = EMO[m0] || EMO.calm;
      if (Number.isFinite(t0.gazeX)) gazeX = gazeX * 0.5 + t0.gazeX * 0.5;
      if (Number.isFinite(t0.gazeY)) gazeY = gazeY * 0.5 + t0.gazeY * 0.5;
    }

    // 眼球：VRM 的 eye 骨，往他要看的方向转
    for (const side of ['left', 'right']) {
      const eye = node(`${side}Eye`);
      if (eye) eye.rotation.set(-gazeY * 0.3, gazeX * 0.42, 0);
    }

    const em = vrm.expressionManager;
    if (em) {
      // —— 情绪：朝目标慢慢靠，别硬切 ——
      const mood = moodOverride || brain?.state?.mood || 'calm';
      const target = EMO[mood] || EMO.calm;
      const k = 1 - Math.exp(-4.5 * d);
      for (const key of Object.keys(FACE_W)) {
        const want = target[key] || 0;
        FACE_W[key] += (want - FACE_W[key]) * k;
        if (EXPRESSIONS[mood] === key) {
          // 情绪峰值时再多给一点点，别让她永远停在“标准微笑”
          FACE_W[key] = clamp(FACE_W[key] + 0.0, 0, 1);
        }
        const kn = EXPR_NAME[key];
        if (kn) em.setValue(kn, clamp(FACE_W[key], 0, 1));
      }

      // —— 眨眼：自己的节奏（2~6 秒一次，偶尔连眨两下）——
      blinkNext -= d;
      if (blinkNext <= 0) {
        blinkLeft = 0.14;
        blinkNext = 2 + Math.random() * 4;
        if (Math.random() < 0.22) blinkNext = 0.32; // 连眨
      }
      if (blinkLeft > 0) blinkLeft = Math.max(0, blinkLeft - d);
      const auto = blinkLeft > 0 ? Math.sin((1 - blinkLeft / 0.14) * Math.PI) : 0;
      const eyeMid = clamp(1 - (f.eyeOpen ?? 1), 0, 1);
      const sleep = mood === 'sleepy' ? 0.45 : 0;
      // 情绪自带的眼型（害羞/困/难过会微微眯）——这是“肌肉感”最便宜也最有效的一招
      const squint = clamp(target.squint || 0, 0, 1);
      if (EXPR_NAME.blink) {
        em.setValue(EXPR_NAME.blink, clamp(Math.max(auto, eyeMid, f.blink ?? 0) + sleep + squint, 0, 1));
      }


      // —— 说话：嘴形在 a/i/u/e/o 之间走，不是开合 ——
      const talking = (brain?.state?.talking || 0) > 0 ? 1 : 0;
      mouthPhase += d * 13;
      if (mouthPhase > Math.PI) {
        mouthPhase -= Math.PI;
        if (Math.random() < 0.6) mouthIdx = Math.floor(Math.random() * VOWELS.length);
      }
      const env = talking * (0.35 + 0.5 * Math.abs(Math.sin(mouthPhase)));
      for (const v of VOWELS) {
        const want = v === VOWELS[mouthIdx] ? env : 0;
        MOUTH_W[v] += (want - MOUTH_W[v]) * (1 - Math.exp(-14 * d));
        const vn = EXPR_NAME[v];
        if (vn) em.setValue(vn, clamp(MOUTH_W[v], 0, 1));
      }
      // 不说话的抿嘴笑：joy 高的时候嘴巴有一点形状
      if (!talking) {
        const smile = clamp(FACE_W.joy * 0.22, 0, 1);
        if (EXPR_NAME.a) em.setValue(EXPR_NAME.a, Math.max(MOUTH_W.a, smile * 0.5));
      }
    }

    holder.position.x = clamp((brain?.state?.root?.x || 0) * 0.006, -0.35, 0.35);
  }

  // —— 看脸：镜头推近到她的头，细节才看得见 ——
  let faceView = 0;
  let faceViewTo = 0;
  function setFaceView(on) {
    faceViewTo = on ? 1 : 0;
    return faceViewTo;
  }
  function applyCamera(d) {
    faceView += (faceViewTo - faceView) * (1 - Math.exp(-4 * d));
    if (faceView < 0.002) {
      camera.position.copy(camHome.pos);
      camera.lookAt(camHome.tgt);
      return;
    }
    const headNode = node('head');
    if (!headNode) {
      camera.position.copy(camHome.pos);
      camera.lookAt(camHome.tgt);
      return;
    }
    headNode.getWorldPosition(tmpV3);
    // 头的骨点在下颌附近 —— 往上看一点，才是「脸」在画面正中
    const faceAt = tmpV3.clone().add(new V(0, height * 0.042, 0));
    // 0.9 m：头顶的蝴蝶结、下巴、肩膀上缘都在框里
    const near = faceAt.clone().add(new V(0, height * 0.02, FRONT * 0.9));
    camera.position.lerpVectors(camHome.pos, near, faceView);
    const lookAt = new V().lerpVectors(camHome.tgt, faceAt, faceView);
    camera.lookAt(lookAt);
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

  const clipErrors = [];
  function safeClip(name, keys) {
    try {
      return bakeClip(name, keys);
    } catch (err) {
      clipErrors.push(`${name}: ${err && err.message ? err.message : err}`);
      return null;
    }
  }

  // 关键帧只有 4~5 个，直接丢给 mixer 就是「一条直线冲过去」—— 关节看起来像机器人。
  // 这里按 30 fps 重新采样，并且给每一段加 smoothstep 缓动（起手慢、中间快、收手慢），
  // 动作才是连贯的、有重量的，也永远不会「抽搐」。
  const smoothEase = (u) => u * u * (3 - 2 * u);
  function bakeClip(name, keys, opt = {}) {
    const fps = opt.fps || 30;
    const ease = opt.ease || smoothEase;
    const hipsNode = node('hips');
    const snaps = keys.map((k) => ({
      t: k.t,
      snap: bakePose(k.fn),
      // 胯的平移也要烘进去（弯腰时屁股往后坐、蹲下时往下沉）
      hips: hipsNode ? hipsNode.position.clone() : new V(),
    }));
    const bones = new Set();
    for (const s0 of snaps) for (const b of s0.snap.keys()) bones.add(b);
    const end = Math.max(0.01, keys[keys.length - 1].t);
    const n = Math.max(2, Math.round(end * fps));
    const times = [];
    for (let i = 0; i <= n; i++) times.push(+((end * i) / n).toFixed(4));
    const tracks = [];
    const tmpQ = new Q();
    for (const bone of bones) {
      const nn = node(bone);
      if (!nn) continue;
      nn.name = BONE_NAME(bone);
      const values = [];
      for (const tt of times) {
        let i = 0;
        while (i < snaps.length - 2 && tt > snaps[i + 1].t) i++;
        const a = snaps[i];
        const b = snaps[i + 1] || snaps[i];
        const span = Math.max(1e-6, b.t - a.t);
        const u = clamp((tt - a.t) / span, 0, 1);
        const qa = a.snap.get(bone) || new Q();
        const qb = b.snap.get(bone) || new Q();
        tmpQ.copy(qa).slerp(qb, ease(u));
        values.push(tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${nn.name}.quaternion`, times, values));
    }
    // 胯的位移轨道（骨骼的旋转走四元数，位移单独一条）
    if (hipsNode) {
      const vals = [];
      const pa = new V();
      for (const tt of times) {
        let i = 0;
        while (i < snaps.length - 2 && tt > snaps[i + 1].t) i++;
        const a = snaps[i];
        const b = snaps[i + 1] || snaps[i];
        const span = Math.max(1e-6, b.t - a.t);
        const u = clamp((tt - a.t) / span, 0, 1);
        pa.copy(a.hips).lerp(b.hips, ease(u));
        vals.push(pa.x, pa.y, pa.z);
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${BONE_NAME('hips')}.position`, times, vals));
    }
    return new THREE.AnimationClip(name, end, tracks);
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
  // —— 站姿归一化 ——
  // 有的模型自带屈膝站姿（比如 VRoid 样张 A），如果不处理，换身体之后就一直是半蹲着走路。
  // 做法：算出「腿伸直」时胯应该在多高，把胯（和整条上身）抬到那个高度，脚不动。
  for (const s of ['left', 'right']) {
    const L = LEG[s];
    if (!L) continue;
    STANCE = Math.max(STANCE, L.ankle.y + (L.L1 + L.L2) * 0.995 - L.hip.y);
  }
  STANCE = clamp(STANCE, 0, 0.12);
  if (STANCE > 0) for (const s of ['left', 'right']) if (LEG[s]) LEG[s].hip.y += STANCE;

  // 胯可以平移（弯腰时屁股往后坐）：记住原始位置，好还原
  const HIPS_REST = (() => {
    const h = node('hips');
    const p0 = h ? h.position.clone() : new V();
    p0.y += STANCE;
    return p0;
  })();
  if (STANCE > 0) {
    const h = node('hips');
    if (h) h.position.copy(HIPS_REST);
  }
  LEG_SCALE = ((LEG.left ? LEG.left.L1 + LEG.left.L2 : 0.78) || 0.78) / 0.78;
  layout(); // 身高变了，镜头按新的身高重排一次
  // 把胯挪到 (0, -drop, +back)，返回位移量给腿部 IK 用
  const hipOffset = new V();
  function shiftHips(back = 0, drop = 0) {
    hipOffset.set(0, -drop, back);
    const h = node('hips');
    if (h) h.position.copy(HIPS_REST).add(hipOffset);
    return hipOffset;
  }

  // 髋在 hip、踝想去 ankle，求膝的位置（膝盖朝前弯）
  function solveLeg(s, ankleTarget, sink = 0, off = null) {
    const L = LEG[s];
    if (!L) return;
    // 胯一旦平移，髋关节也跟着走 —— IK 必须从新的髋点解，否则脚会飘
    const hip = L.hip.clone().addScaledVector(Y_AXIS, -sink).add(off ? off : new V());
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

  const WALK = {
    T: 1.05,
    stride: 0.26 * LEG_SCALE,
    lift: 0.055 * LEG_SCALE,
    duty: 0.62,
    sink: 0.035 * LEG_SCALE,
  };
  WALK.speed = (WALK.stride * 2) / WALK.T; // 米/秒 —— 步子多大就走多快，脚不打滑

  // 一个完整的步态周期：p=0 右脚跟着地
  // 一只脚在一个步态周期里的位置（相对髋的前后位移 z、离地高度 y、脚掌俯仰）
  function gaitFoot(p, cfg = WALK) {
    if (p < cfg.duty) {
      // 支撑相：脚定在地上，身体相对它往前过去 —— 这就是「不打滑」
      const u = p / cfg.duty;
      return {
        z: -cfg.stride / 2 + cfg.stride * u,
        y: 0,
        pitch: u < 0.18 ? ((0.18 - u) / 0.18) * 0.26 : u > 0.72 ? -((u - 0.72) / 0.28) * 0.5 : 0,
      };
    }
    // 摆动相：抬脚、往前送
    const u = (p - cfg.duty) / (1 - cfg.duty);
    const e = u * u * (3 - 2 * u);
    return {
      z: cfg.stride / 2 - cfg.stride * e,
      y: cfg.lift * Math.sin(Math.PI * u),
      pitch: -0.18 + 0.42 * e,
    };
  }

  function gaitLeg(s, p, cfg = WALK, hipOff = null) {
    const L = LEG[s];
    if (!L) return;
    const base = L.ankle;
    const f = gaitFoot(p, cfg);
    solveLeg(s, new V(base.x, base.y + f.y, base.z + f.z), 0, hipOff);
    aim(`${s}Foot`, rotateAround(L.footDir, X_AXIS, f.pitch));
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
    const hq = wq.get(`${bs}Hand`);
    const d = handDelta(`${bs}Hand`);
    if (!hq) return;
    // 静止时手指就是弯的：MCP 18°、PIP 23°、DIP 10°（手休息位，康复教材的常规值）。
    // curl 再往上加，加到 1 就是握拳（~70°/85°/35°）。
    const REST_FLEX = [0.31, 0.4, 0.17];
    const GRIP_FLEX = [0.85, 1.05, 0.45];
    const axes = FINGER_AXIS[bs] || {};
    for (const f of Object.keys(FINGER_WEIGHT)) {
      const w = FINGER_WEIGHT[f];
      const local = axes[f];
      if (!local) continue;
      const axis = local.clone().applyQuaternion(hq).normalize();
      let acc = 0;
      for (let i = 0; i < 3; i++) {
        const n = `${bs}${f}${FINGER_SEGS[i]}`;
        const r = rest[n];
        if (!r || !node(n)) continue;
        acc += REST_FLEX[i] + clamp(curl, 0, 1) * GRIP_FLEX[i] * (w[i] * 1.25);
        aim(n, rotateAround(r.dir.clone().applyQuaternion(d), axis, acc));
      }
    }
  }

  // 把骨头绕自己的轴拧一下（世界空间里表达，内部转成局部）
  function rollBone(name, axisWorld, angle) {
    if (!angle || !Number.isFinite(angle)) return;
    const q = wq.get(name);
    if (!q) return;
    const roll = new Q().setFromAxisAngle(axisWorld.clone().normalize(), angle);
    writeLocal(name, roll.clone().multiply(q));
  }

  // 掌心对齐：让「指根连线」落到身体的前后方向上（取离当前最近的那一头）
  function alignPalm(bs, dirWorld, weight) {
    if (!weight || weight < 0.01) return;
    try {
        const local = PALM_LINE[bs];
        const lq = wq.get(`${bs}LowerArm`);
    if (!local || !lq) return;
      const axis = dirWorld.clone().normalize();
      const cur = local.clone().applyQuaternion(lq).projectOnPlane(axis);
      const tgt = BODY_FWD.clone().projectOnPlane(axis);
      if (cur.lengthSq() < 1e-6 || tgt.lengthSq() < 1e-6) return;
      cur.normalize();
      tgt.normalize();
      if (tgt.dot(cur) < 0) tgt.negate();
      const ang = Math.atan2(new V().crossVectors(cur, tgt).dot(axis), cur.dot(tgt));
      rollBone(`${bs}LowerArm`, axis, ang * weight);
    } catch {
      /* 拧不动就不拧，不能因为手不好看把整个身体卡死 */
    }
  }

  // 一条胳膊：肩 → 上臂 → 肘 → 手 → 手指
  const ARM_HANG = { L: new V(0.24, -0.95, 0.06), R: new V(-0.24, -0.95, 0.06) };
  const REST_CURL = 0.15; // 自然放松的手：指节微屈，不是笔直张开
  // 手腕静止时是「略背伸」（10–15°），不是垂着屈 —— 这是手看起来活的关键之一
  function poseArm(bs, dirRaw, elbow = 0.16, hand = -0.15, curl = REST_CURL) {
    const dir = (dirRaw || ARM_HANG[bs === 'right' ? 'L' : 'R']).clone().normalize();
    const raise = clamp(1 + dir.y, 0, 1);
    const sRest = rest[`${bs}Shoulder`]?.dir;
    // 肩胛骨：胳膊抬起来时跟着抬一点（绕 Z 轴才是“抬”，绕 Y 是“转”）
    if (sRest) aim(`${bs}Shoulder`, rotateAround(sRest, Z_AXIS, (bs === 'right' ? -1 : 1) * 0.18 * raise));
    aim(`${bs}UpperArm`, dir);
    let axis = new V().crossVectors(dir, FORWARD);
    if (axis.lengthSq() < 1e-6) axis = X_AXIS.clone();
    axis.normalize();
    const flex = Math.max(elbow, 0.05 + 0.3 * raise);
    let dirFore = rotateAround(dir, axis, flex);
    // 提携角：前臂并不和上臂成一条直线，自然状态下往外偏 5–15°（女性更大）。
    // 少了这一下，两条胳膊会像两根垂直的棍子。
    dirFore = dirFore.clone();
    dirFore.x += (bs === 'right' ? -0.13 : 0.13);
    dirFore.normalize();
    aim(`${bs}LowerArm`, dirFore);
    // 胳膊越接近垂下，掌心越该贴着身体；举起来时这条不适用
    alignPalm(bs, dirFore, clamp(1 - raise * 1.25, 0, 1));
    aim(`${bs}Hand`, rotateAround(dirFore, axis, hand));
    poseFingers(bs, curl);
  }

  // ————————————————— 方向约定 —————————————————
  // 解剖学上「往前倾、低头」是正数；但 three 里绕 +X 转是把 +Y 推向 +Z，
  // 而她的正面是 -Z —— 所以世界 pitch 必须取负。
  // 上一版弯腰往后折，就是因为这里少了这个负号。
  const FWD = (rad) => -rad;

  // 一具「站着」的身体：所有轨道都以它为底，差别只在参数
  function basePose(cfg = {}) {
    const {
      breath = 0,
      sway = 0, // 左右重心（+1 = 压到她自己的左边）
      hipYaw = 0, // 胯的朝向
      torsoYaw = 0, // 上身相对胯再扭一点（转身/回头的跟随）
      headYaw = 0,
      headPitch = 0, // + = 低头
      headRoll = 0,
      bend = 0, // 0..1：弯腰。髋-腰-胸-上胸分摊，不是只折腰
      hipBack = 0, // 米：屁股往后坐（弯腰的髋铰链）
      hipDrop = 0, // 米：胯往下沉（膝就自然弯了）
      kneeSoft = 0, // 0..1：膝盖吃一点力（落地、负重）
      armL = null,
      armR = null,
      swing = 0,
      elbow = 0.16,
      hand = 0.08,
      curl = 0.14,
    } = cfg;

    // 弯腰的正确分法（参考髋铰链 / 关节活动度）：
    // 胯先折一点 → 腰椎、胸椎、上胸按 0.30/0.26/0.18 分摊 → 颈椎最后补 0.10，
    // 全程背是平的，脑袋跟着脊柱走，不是单独低头。
    const b = clamp(bend, 0, 1.15);
    turn('hips', {
      x: FWD(b * 0.1) + breath * 0.004 + kneeSoft * 0.03,
      y: hipYaw * 0.45 + sway * 0.05,
      z: sway * 0.022 + kneeSoft * 0.01,
    });
    turn('spine', {
      x: FWD(b * 0.3) + breath * 0.012,
      y: hipYaw * 0.25 + torsoYaw * 0.3 + sway * 0.03,
      z: sway * 0.012,
    });
    turn('chest', {
      x: FWD(b * 0.26) + breath * 0.03,
      y: hipYaw * 0.15 + torsoYaw * 0.35 + headYaw * 0.18,
      z: sway * 0.01,
    });
    turn('upperChest', {
      x: FWD(b * 0.18) + breath * 0.02,
      y: torsoYaw * 0.2 + headYaw * 0.14,
      z: 0,
    });
    turn('neck', {
      x: FWD(b * 0.1) + FWD(headPitch * 0.3),
      y: headYaw * 0.3 - hipYaw * 0.15,
      z: headRoll * 0.3,
    });
    turn('head', {
      x: FWD(b * 0.06) + FWD(headPitch * 0.6),
      y: headYaw * 0.62 - hipYaw * 0.1 + torsoYaw * 0.1,
      z: headRoll * 0.6,
    });

    // 站姿：脚钉在原地，胯一沉一坐，腿的 IK 就自动弯膝 —— 这才是「髋铰链」
    const off = shiftHips(hipBack + kneeSoft * 0.01, hipDrop + kneeSoft * 0.008);
    for (const s of ['left', 'right']) {
      if (!LEG[s]) continue;
      solveLeg(s, LEG[s].ankle.clone(), 0.004, off);
      aim(`${s}Foot`, LEG[s].footDir.clone());
    }

    poseArm('right', armL, elbow, hand, curl);
    poseArm('left', armR, elbow, hand, curl);
  }

  const NEUTRAL = () => basePose({});

  function walkPose(p) {
    const s2 = Math.sin(2 * Math.PI * p);
    // 骨盆高度由「支撑脚」决定：脚离髋越远，骨盆越低、膝越弯。
    // 以前骨盆高度是写死的，脚一迈出去腿就有富余，于是永远半蹲着走路。
    const legLen = (LEG.left ? LEG.left.L1 + LEG.left.L2 : 0.78) * 0.995;
    const dz = Math.max(
      Math.abs(gaitFoot(p % 1).z),
      Math.abs(gaitFoot((p + 0.5) % 1).z),
    );
    const drop = Math.max(0, legLen - Math.sqrt(Math.max(1e-4, legLen * legLen - dz * dz)));
    const hipOff = shiftHips(0, drop);
    // 走路是往前走的：躯干往前 3° 左右，头保持水平（眼睛看前面）
    turn('hips', { x: FWD(0.03), y: -s2 * 0.06, z: s2 * 0.035 });
    turn('spine', { x: FWD(0.02), y: s2 * 0.04, z: -s2 * 0.015 });
    turn('chest', { x: FWD(0.02), y: s2 * 0.05 });
    turn('upperChest', { x: 0, y: s2 * 0.03 });
    turn('neck', { x: FWD(-0.02) });
    turn('head', { x: FWD(-0.04), y: -s2 * 0.05 });
    gaitLeg('left', p % 1, WALK, hipOff);
    gaitLeg('right', (p + 0.5) % 1, WALK, hipOff);
    // 手臂与同侧的腿反向摆
    const swingDir = (bs) => rotateAround(ARM_HANG[bs === 'right' ? 'L' : 'R'], X_AXIS, s2 * 0.42 * (bs === 'right' ? 1 : -1));
    poseArm('right', swingDir('right'), 0.3, 0.12, 0.25);
    poseArm('left', swingDir('left'), 0.3, 0.12, 0.25);
  }

  // 原地转身 —— 按真实的重心转移拆成四段（参考 Animation Mentor 的 turnaround 分解）：
  //   0.00–0.18  预判：头先转过去，上身跟一点点，脚还没动
  //   0.18–0.58  主力：胯跟着转，外侧脚抬起、走一条小弧线
  //   0.58–0.84  落地：脚掌先着地、膝盖吃一下力，上身轻微过冲
  //   0.84–1.00  收尾：头最后回正，手臂的跟随甩尾
  function turnPose(dir, k) {
    shiftHips(0, 0);
    const seg = (a, b) => clamp((k - a) / (b - a), 0, 1);
    const sm = (u) => u * u * (3 - 2 * u);
    const headLead = sm(seg(0, 0.22)) - sm(seg(0.72, 1)) * 0.7; // 头先走、最后收
    const chestF = sm(seg(0.06, 0.5));
    const hipF = sm(seg(0.16, 0.7));
    const settle = sm(seg(0.62, 1));
    const over = Math.sin(Math.PI * seg(0.5, 0.92)) * 0.14; // 过冲再回来
    const step = Math.sin(Math.PI * seg(0.2, 0.8)); // 脚抬起-落下的弧

    const hipYaw = dir * (0.62 * hipF + over * 0.4 - 0.04 * (1 - sm(seg(0, 0.3))));
    const torsoYaw = dir * (0.26 * chestF + 0.1 * headLead - over * 0.5);
    const hYaw = dir * (0.5 * headLead + over * 0.5);

    turn('hips', { x: FWD(0.02) - step * 0.02, y: hipYaw, z: dir * -0.05 * step });
    turn('spine', { x: FWD(0.03), y: torsoYaw * 0.5, z: dir * 0.02 * step });
    turn('chest', { x: FWD(0.02), y: torsoYaw * 0.7 + hipYaw * 0.15, z: 0 });
    turn('upperChest', { x: 0, y: torsoYaw * 0.3, z: 0 });
    turn('neck', { x: FWD(0.02), y: hYaw * 0.28, z: 0 });
    turn('head', { x: FWD(0.02), y: hYaw * 0.6, z: dir * -0.04 * step });

    // 支撑腿：重心压上去，膝盖吃一点力
    const plantSide = dir > 0 ? 'left' : 'right';
    const freeSide = dir > 0 ? 'right' : 'left';
    for (const s of ['left', 'right']) {
      if (!LEG[s]) continue;
      const base = LEG[s].ankle;
      if (s === freeSide) {
        // 抬起来的那只脚：弧线往前上方摆，落地时已经换了个朝向
        const t = base.clone();
        t.y += step * 0.075;
        t.x += dir * step * 0.035;
        t.z += step * 0.03;
        solveLeg(s, t, 0.014 + step * 0.03);
        aim(`${s}Foot`, rotateAround(LEG[s].footDir, X_AXIS, step * 0.3));
      } else {
        solveLeg(s, base, 0.006 + settle * 0.014);
        aim(`${s}Foot`, LEG[s].footDir.clone());
      }
    }
    void plantSide;
    // 手臂：甩尾 —— 起步慢半拍，停下还在动
    const lag = Math.sin(Math.PI * seg(0.1, 0.95)) * 0.16;
    const armSwing = (side) =>
      rotateAround(ARM_HANG[side], X_AXIS, dir * lag * (side === 'L' ? 1.0 : -0.8));
    poseArm('right', armSwing('L'), 0.24 + step * 0.06, 0.1, 0.16);
    poseArm('left', armSwing('R'), 0.24 + step * 0.06, 0.1, 0.16);
  }

  const CLIPS = {
    idle: safeClip('idle', [
      { t: 0, fn: () => basePose({ breath: 0, sway: 0, headYaw: 0, curl: 0.12 }) },
      { t: 1.2, fn: () => basePose({ breath: 1, sway: 0.7, headYaw: 0.06, headRoll: 0.03, curl: 0.16 }) },
      { t: 2.4, fn: () => basePose({ breath: 0, sway: 0, headYaw: 0.02, curl: 0.2 }) },
      { t: 3.6, fn: () => basePose({ breath: -1, sway: -0.7, headYaw: -0.07, headRoll: -0.03, curl: 0.14 }) },
      { t: 4.8, fn: () => basePose({ breath: 0, sway: 0, headYaw: 0, curl: 0.12 }) },
    ]),
    // 走路：两个步幅一个循环，首尾同帧 —— 循环起来无缝
    walk: safeClip('walk', Array.from({ length: 25 }, (_, i) => {
      const p = i / 24;
      return { t: p * WALK.T, fn: () => walkPose(p) };
    })),
    // 转身 1.5 秒：预判 0.25s + 转体 0.7s + 落地收尾 0.55s。快过这个数就一定像瞬移。
    turnL: safeClip('turnL', Array.from({ length: 13 }, (_, i) => ({ t: (i / 12) * 1.5, fn: () => turnPose(1, i / 12) }))),
    turnR: safeClip('turnR', Array.from({ length: 13 }, (_, i) => ({ t: (i / 12) * 1.5, fn: () => turnPose(-1, i / 12) }))),
    // 手指：握一下再张开（30 根一起，是“她真的在用手”的证据）
    grip: safeClip('grip', [
      { t: 0, fn: () => basePose({ curl: 0.15 }) },
      { t: 0.35, fn: () => basePose({ curl: 0.95, elbow: 0.34, hand: 0.2, headPitch: 0.12 }) },
      { t: 0.8, fn: () => basePose({ curl: 0.95, elbow: 0.34, hand: 0.2, headPitch: 0.12 }) },
      { t: 1.3, fn: () => basePose({ curl: 0.12 }) },
    ]),
    lookL: safeClip('lookL', [
      { t: 0, fn: NEUTRAL },
      { t: 0.5, fn: () => basePose({ headYaw: 0.42, headPitch: -0.05, sway: 0.3 }) },
      { t: 1.6, fn: () => basePose({ headYaw: 0.4, headPitch: -0.04, sway: 0.28 }) },
      { t: 2.4, fn: NEUTRAL },
    ]),
    lookR: safeClip('lookR', [
      { t: 0, fn: NEUTRAL },
      { t: 0.5, fn: () => basePose({ headYaw: -0.42, headPitch: -0.05, sway: -0.3 }) },
      { t: 1.6, fn: () => basePose({ headYaw: -0.4, headPitch: -0.04, sway: -0.28 }) },
      { t: 2.4, fn: NEUTRAL },
    ]),
    reachL: safeClip('reachL', [
      { t: 0, fn: NEUTRAL },
      // 伸手不是把胳膊平举：上臂垂到 45° 以下、肘弯着、掌朝下，才像「去够一个东西」。
      { t: 0.6, fn: () => basePose({ armL: new V(0.3, -0.6, -0.74), elbow: 0.58, hand: 0.14, curl: 0.34, headPitch: 0.12, sway: 0.25 }) },
      { t: 1.5, fn: () => basePose({ armL: new V(0.36, -0.52, -0.78), elbow: 0.7, hand: 0.16, curl: 0.12, headPitch: 0.14, sway: 0.3 }) },
      { t: 2.3, fn: NEUTRAL },
    ]),
    reachR: safeClip('reachR', [
      { t: 0, fn: NEUTRAL },
      { t: 0.6, fn: () => basePose({ armR: new V(-0.3, -0.6, -0.74), elbow: 0.58, hand: 0.14, curl: 0.34, headPitch: 0.12, sway: -0.25 }) },
      { t: 1.5, fn: () => basePose({ armR: new V(-0.36, -0.52, -0.78), elbow: 0.7, hand: 0.16, curl: 0.12, headPitch: 0.14, sway: -0.3 }) },
      { t: 2.3, fn: NEUTRAL },
    ]),
    // 这几个是「听得懂人话」的那部分：你让她弯腰、点头、摇头、挥手，她真的会做
    // 鞠躬（お辞儀）的真实节奏：先轻轻拔一下背 → 45° 慢慢下去 → 停 0.5 秒 → 起得比下得慢
    // 手臂是垂下去的（世界空间里朝地面），所以躯干折下去时手会自然吊在身体前面，不会张着。
    bow: safeClip('bow', [
      { t: 0, fn: NEUTRAL },
      { t: 0.3, fn: () => basePose({ bend: -0.08, breath: 0.4, elbow: 0.18, curl: 0.16 }) },
      { t: 1.0, fn: () => basePose({ bend: 0.72, hipBack: 0.045, hipDrop: 0.012, breath: -0.3, elbow: 0.2, curl: 0.2, armL: new V(0.1, -0.99, -0.04), armR: new V(-0.1, -0.99, -0.04) }) },
      { t: 1.35, fn: () => basePose({ bend: 0.82, hipBack: 0.06, hipDrop: 0.02, breath: -0.4, elbow: 0.22, curl: 0.22, armL: new V(0.1, -0.99, -0.02), armR: new V(-0.1, -0.99, -0.02) }) },
      { t: 2.0, fn: () => basePose({ bend: 0.8, hipBack: 0.058, hipDrop: 0.019, breath: -0.35, elbow: 0.22, curl: 0.22, armL: new V(0.1, -0.99, -0.02), armR: new V(-0.1, -0.99, -0.02) }) },
      { t: 2.9, fn: () => basePose({ bend: 0.16, hipBack: 0.012, hipDrop: 0.004, breath: 0.2, elbow: 0.2, curl: 0.16 }) },
      { t: 3.4, fn: NEUTRAL },
    ]),
    // 点头：头带着一点点胸口，两次，第二次小一点 —— 人不会只点一下还点得一样大
    nod: safeClip('nod', [
      { t: 0, fn: NEUTRAL },
      { t: 0.26, fn: () => basePose({ headPitch: 0.3, bend: 0.05, breath: 0.2 }) },
      { t: 0.52, fn: () => basePose({ headPitch: -0.03 }) },
      { t: 0.78, fn: () => basePose({ headPitch: 0.2, bend: 0.03 }) },
      { t: 1.1, fn: NEUTRAL },
    ]),
    shake: safeClip('shake', [
      { t: 0, fn: NEUTRAL },
      { t: 0.22, fn: () => basePose({ headYaw: 0.36 }) },
      { t: 0.48, fn: () => basePose({ headYaw: -0.36 }) },
      { t: 0.74, fn: () => basePose({ headYaw: 0.24 }) },
      { t: 1.0, fn: NEUTRAL },
    ]),
    wave: safeClip('wave', [
      { t: 0, fn: NEUTRAL },
      { t: 0.45, fn: () => basePose({ armR: new V(-0.62, 0.55, -0.25), elbow: 1.05, hand: 0.2, curl: 0.02, headPitch: -0.06 }) },
      { t: 0.85, fn: () => basePose({ armR: new V(-0.78, 0.42, -0.2), elbow: 1.15, hand: 0.28, curl: 0.02, headPitch: -0.06 }) },
      { t: 1.25, fn: () => basePose({ armR: new V(-0.52, 0.62, -0.3), elbow: 1.0, hand: 0.16, curl: 0.02, headPitch: -0.04 }) },
      { t: 1.7, fn: () => basePose({ armR: new V(-0.7, 0.5, -0.24), elbow: 1.1, hand: 0.26, curl: 0.02 }) },
      { t: 2.2, fn: NEUTRAL },
    ]),
    stretch: safeClip('stretch', [
      { t: 0, fn: NEUTRAL },
      { t: 1.0, fn: () => basePose({ armL: new V(0.42, 0.86, -0.2), armR: new V(-0.42, 0.86, -0.2), elbow: 0.22, headPitch: -0.2, breath: 0.8, curl: 0.05 }) },
      { t: 2.0, fn: () => basePose({ armL: new V(0.5, 0.8, -0.3), armR: new V(-0.5, 0.8, -0.3), elbow: 0.3, headPitch: -0.24, breath: 0.6, curl: 0.05 }) },
      { t: 3.0, fn: NEUTRAL },
    ]),
  };

  const mixer = new THREE.AnimationMixer(vrm.scene);
  const actions = {};
  for (const [name, clip] of Object.entries(CLIPS)) {
    if (!clip) continue;
    const a = mixer.clipAction(clip);
    if (name === 'idle' || name === 'walk') a.setLoop(THREE.LoopRepeat, Infinity);
    else {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = false;
    }
    actions[name] = a;
  }
  actions.idle?.play();
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
    if (!idle) return;
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
    nav.yawTo = nav.yaw + dir * (0.6 + Math.random() * 0.45);
    playAction(dir > 0 ? 'turnL' : 'turnR', 0.22);
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

  // ————— 身体听谁的：大模型点名的动作 > 大脑的目标 > 自己发呆 —————
  // 以前这一段是 Math.random() 掷骰子，所以她看起来「有动作，但和她想的事无关」。
  let wishSeen = 0;
  function cueFromBrain() {
    const s = lastBrain?.state;
    if (!s) return null;

    // 1) 大模型刚刚点了名：「抬一下手」
    const wish = s.bodyWish;
    if (wish && wish.id && wish.id !== wishSeen) {
      wishSeen = wish.id;
      if (wish.clip === 'walk') return { walk: true, sec: 2.6 };
      if (wish.clip === 'turnL') return { turn: -1 };
      if (wish.clip === 'turnR') return { turn: 1 };
      return { clip: wish.clip, hold: 2.6 };
    }

    // 2) 她自己在做的事（目标）
    const goal = s.goal || { type: 'idle', phase: 1 };
    const mood = s.mood || 'calm';
    switch (goal.type) {
      case 'create':
        return { clip: goal.phase >= 2 ? 'grip' : 'reachR', hold: 1.8 };
      case 'approach': {
        const px = s.pointer && s.pointer.active ? s.pointer.x : s.root.x;
        const far = Math.abs(px - s.root.x) > 22;
        if (far) return { walk: true, sec: 2.2 };
        return { clip: Math.random() < 0.5 ? 'reachL' : 'reachR', hold: 1.6 };
      }
      case 'wander':
        return Math.random() < 0.55 ? { walk: true, sec: 2.8 } : { turn: Math.random() < 0.5 ? -1 : 1 };
      case 'arrange':
        return { clip: Math.random() < 0.5 ? 'reachL' : 'reachR', hold: 1.8 };
      case 'observe':
        return { clip: Math.random() < 0.5 ? 'lookL' : 'lookR', hold: 2.6 };
      case 'rest':
        return null; // 她说要休息，就别再给她加动作
      default:
        break;
    }

    // 3) 什么都没在发生：很少地自己动一下（心情好才伸懒腰）
    if (mood === 'happy' && Math.random() < 0.34) return { clip: 'stretch', hold: 2.6 };
    if (mood === 'curious' && Math.random() < 0.4) return { clip: Math.random() < 0.5 ? 'lookL' : 'lookR', hold: 2.4 };
    if (Math.random() < 0.16) return { clip: 'grip', hold: 2.0 };
    return null;
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
      // 1.5 秒，而且开头先反向「预备」一下 —— 这是真人转身的做法，不是瞬间掉头
      const k = clamp((t - nav.t0) / 1.5, 0, 1);
      const pre = k < 0.16 ? -0.06 * Math.sin((k / 0.16) * Math.PI * 0.5) : 0;
      const e = Math.max(0, k * k * (3 - 2 * k) + pre);
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
      const cue = cueFromBrain();
      if (cue && cue.walk) startWalk(cue.sec || 2.6);
      else if (cue && cue.turn) startTurn(cue.turn);
      else if (cue && cue.clip) {
        playAction(cue.clip, 0.28);
        nav.until = t + (cue.hold || 2.2);
      } else {
        // 大脑没有吩咐：她也不需要一直有动作，安安静静站一会儿也是她
        nav.until = t + 2.6 + Math.random() * 2.6;
      }
    }
    applyStage();
  }

  // ————————————————— 神经面板要的“真实数据” —————————————————
  // 这里不画示意图：每一帧从 VRM 的归一化骨骼上读真实世界坐标和真实转角，
  // 所以面板里动的那根线，就是她身上动的那根骨。
  const nerveHeat = new Map();
  const nervePrev = new Map();
  const tmpQ2 = new Q();
  const tmpV2 = new V();
  const handNow = new Q();
  const FINGER_NAMES = ['ThumbMetacarpal', 'ThumbProximal', 'ThumbIntermediate', 'ThumbDistal', 'IndexProximal', 'IndexIntermediate', 'IndexDistal', 'MiddleProximal', 'MiddleIntermediate', 'MiddleDistal', 'RingProximal', 'RingIntermediate', 'RingDistal', 'LittleProximal', 'LittleIntermediate', 'LittleDistal'];

  function nerveFrame() {
    if (!vrm) return null;
    vrm.scene.updateMatrixWorld();
    const bones = [];
    const seen = new Set();
    const add = (name) => {
      const b = node(name);
      if (!b || seen.has(name)) return;
      seen.add(name);
      b.getWorldQuaternion(tmpQ2);
      const prev = nervePrev.get(name);
      let d = 0;
      if (prev) d = 2 * Math.acos(Math.min(1, Math.abs(prev.dot(tmpQ2))));
      nervePrev.set(name, tmpQ2.clone());
      const heat = Math.max(clamp(d * 26, 0, 1), (nerveHeat.get(name) || 0) * 0.93);
      nerveHeat.set(name, heat);
      b.getWorldPosition(tmpV2);
      bones.push({ n: name, x: tmpV2.x, y: tmpV2.y, z: tmpV2.z, a: heat });
    };
    for (const chain of CHAINS) for (const name of chain) add(name);
    for (const side of ['left', 'right']) for (const f of FINGER_NAMES) add(`${side}${f}`);

    // 手指/脚趾的弯曲量：现在朝向和静止朝向差了多少度
    const fingers = [];
    for (const side of ['left', 'right']) {
      for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
        const segs = [];
        // 弯多少 = 相对“手掌”的转角变化（直接拿世界转角会把整条胳膊的姿势算进去）
        const handName = `${side}Hand`;
        const handNode = node(handName);
        if (handNode) handNode.getWorldQuaternion(handNow);
        for (const seg of FINGER_NAMES.filter((n) => n.startsWith(f))) {
          const name = `${side}${seg}`;
          const b = node(name);
          const r = rest[name];
          if (!b || !r || !handNode || !rest[handName]) continue;
          b.getWorldQuaternion(tmpQ2);
          const rel = handNow.clone().invert().multiply(tmpQ2);
          const relRest = rest[handName].q.clone().invert().multiply(r.q);
          const bend = 2 * Math.acos(Math.min(1, Math.abs(rel.dot(relRest))));
          segs.push({ n: name, bend: (bend * 180) / Math.PI });
        }
        if (!segs.length) continue;
        fingers.push({
          side: side === 'left' ? 'L' : 'R',
          finger: f,
          maxBend: Math.max(...segs.map((s) => s.bend)),
          segs,
        });
      }
    }

    return {
      clip: current,
      nav: nav.mode,
      yaw: nav.yaw,
      walked: nav.walked,
      t,
      bones,
      chains: CHAINS,
      fingers,
      height,
      mode: 'vrm',
    };
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
      applyFace(brain, face, undefined, undefined, step);
    }
    applyCamera(step);
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
    nerveFrame,
    // 她把镜头拉近到自己脸上（细节模式）
    setFaceView,
    // 自检用：直接播一段动作 / 钉住一个情绪
    play(name) {
      if (!actions[name]) return false;
      playAction(name, 0.15);
      nav.until = t + 3;
      return true;
    },
    // 自检：把某段动作钉在某一秒，方便我抓帧核对姿势
    freezeAt(name, sec) {
      const a = actions[name];
      if (!a) return false;
      playAction(name, 0.01);
      a.paused = true;
      a.time = clamp(sec, 0, a.getClip().duration - 0.001);
      return a.time;
    },
    setMoodOverride(m) {
      moodOverride = m || null;
      return moodOverride;
    },
    get faceView() {
      return faceViewTo;
    },
    // 她现在在演哪一段 —— 让“神经系统”里写的字和画面对得上
    action: () => ({ clip: current, count: actsPlayed, nav: nav.mode, walked: nav.walked }),
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
        stance: +STANCE.toFixed(3),
        legScale: +LEG_SCALE.toFixed(2),
        legs: (() => {
          const L = LEG.left;
          if (!L) return null;
          const a = node('leftUpperLeg');
          const b = node('leftLowerLeg');
          const c = node('leftFoot');
          if (!a || !b || !c) return null;
          const pa = new THREE.Vector3();
          const pb = new THREE.Vector3();
          const pc = new THREE.Vector3();
          a.getWorldPosition(pa);
          b.getWorldPosition(pb);
          c.getWorldPosition(pc);
          const v1 = pb.clone().sub(pa).normalize();
          const v2 = pc.clone().sub(pb).normalize();
          return {
            kneeDeg: +((Math.acos(clamp(v1.dot(v2), -1, 1)) * 180) / Math.PI).toFixed(0),
            hipY: +pa.y.toFixed(3),
            ankleY: +pc.y.toFixed(3),
            span: +(L.L1 + L.L2).toFixed(3),
          };
        })(),
        hipPos: node('hips') ? node('hips').position.toArray().map((v) => +v.toFixed(3)) : null,
        hipRest: HIPS_REST.toArray().map((v) => +v.toFixed(3)),
        clipT: +(actions[current]?.time || 0).toFixed(2),
        clipLen: +(actions[current]?.getClip()?.duration || 0).toFixed(2),
        mode: LEGACY ? 'legacy' : 'mixer',
        clip: lastDiag.clip,
        played: actsPlayed,
        t: +t.toFixed(1),
        nav: nav.mode,
        clipErr: clipErrors.length ? clipErrors.slice(0, 2) : null,
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
        expr: Object.fromEntries(
          ['joy', 'fun', 'sorrow', 'angry', 'blink', 'a'].map((k) => {
            const nm = EXPR_NAME[k];
            const v = nm ? vrm.expressionManager?.getValue?.(nm) : null;
            return [k, +(Number(v) || 0).toFixed(2)];
          }),
        ),
        exprNames: EXPR_NAME,
        spine: q('spine'),
        restDirArm: rest.rightUpperArm?.dir ? rest.rightUpperArm.dir.toArray().map((v) => +v.toFixed(3)) : null,
      };
    },
    get springOn() {
      return springOn;
    },
    // 抓一帧画面（缩小后转 jpeg），用来上传给服务器落盘检查
    snapshot(maxW = 960) {
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
