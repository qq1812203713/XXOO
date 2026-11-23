// 3D 身体：VRM 模型 + three.js。
//
// 这一次是真的把「每根手指一个 motor」画出来了：Alicia 这个 VRM 有 55 根 humanoid 骨骼，
// 其中 30 根是手指（每只手 5 指 × 3 节）。我们骨架里 40 多个关节的局部角度，
// 逐一映射到这些骨骼的旋转上 —— 不是播动画，是每帧解出来的。
//
// 只有三件事必须记住：
//   1. 模型用 T-pose 作为归一化姿态，所以「手臂垂下」= 绕 Z 轴转 ∓90°；
//   2. 2D 里 a 增大是顺时针，three 里 rotation.z 增大是逆时针，符号要反过来；
//   3. 左右手的镜像不是简单取负 —— 左臂指 +X、右臂指 -X，旋转基准差 180°。

import { hasWebGL } from './gl.js';

// three 有 1.4MB，只在真的要上 3D 时才加载（也避免 jsdom 测试去解析它）
let THREE = null;
let GLTFLoader = null;

async function loadThree() {
  if (THREE) return;
  THREE = await import('../../vendor/three.module.js');
  const mod = await import('../../vendor/gltf/GLTFLoader.js');
  GLTFLoader = mod.GLTFLoader;
}

const DEG = 180 / Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// 模型侧可能需要翻的符号，肉眼确认后只改这里
const SIGN = { armZL: 1, armZR: 1, elbow: 1, hand: 1, finger: 1, knee: 1, headZ: 1 };

// 我们的骨架：拇指只有 2 节，其余四指 3 节；模型是 5 指 × 3 节。
// 所以拇指的第三根骨（Distal）由第二关节带 0.7 的系数带动——这是唯一一处“一对多”。
const FINGERS = [
  { bone: 'Thumb', rig: 'thumb', seg: 2, distalFrom: 1 },
  { bone: 'Index', rig: 'index', seg: 3 },
  { bone: 'Middle', rig: 'middle', seg: 3 },
  { bone: 'Ring', rig: 'ring', seg: 3 },
  { bone: 'Little', rig: 'pinky', seg: 3 },
];
const SEGS = ['Proximal', 'Intermediate', 'Distal'];

// Alicia 自带的 blendShape 只有这几个：joy / angry / sorrow / fun
const EXPRESSIONS = {
  happy: 'joy',
  sad: 'sorrow',
  shy: 'fun',
  startled: 'angry',
  curious: 'fun',
  sleepy: 'sorrow',
  calm: null,
};

// 我们一定会去写这些骨骼。测试会拿它跟 .vrm 文件里的 humanoid 列表逐条核对，
// 少一根就说明这份映射在这具模型上是断的。
export const REQUIRED_BONES = (() => {
  const out = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftEye', 'rightEye',
  ];
  for (const s of ['left', 'right']) {
    out.push(`${s}UpperArm`, `${s}LowerArm`, `${s}Hand`);
    out.push(`${s}UpperLeg`, `${s}LowerLeg`, `${s}Foot`, `${s}Toes`);
    for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
      for (const seg of ['Proximal', 'Intermediate', 'Distal']) out.push(`${s}${f}${seg}`);
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

  // 灯光：一盏主光、一盏补光、一盏背后的轮廓光（让她从深色背景里浮出来）
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

  // VRM 0.x 的模型是背对镜头的，官方工具函数帮你转过来
  try {
    VRMUtils.rotateVRM0(vrm);
  } catch {
    /* 新版可能没有这个函数，那就自己转 */
    if (vrm.meta?.metaVersion === '0') vrm.scene.rotation.y = Math.PI;
  }
  scene.add(vrm.scene);

  const bone = (name) => vrm.humanoid.getNormalizedBoneNode(name);
  const setRot = (node, x, y, z) => {
    if (node) node.rotation.set(x, y, z);
  };

  // 量一下她的身高，决定镜头怎么摆
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = box.getSize(new THREE.Vector3());
  const height = size.y || 1.55;

  let t = 0;
  let ready = false;

  function layout() {
    const w = canvas.clientWidth || window.innerWidth || 1;
    const h = canvas.clientHeight || window.innerHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 竖屏：让她从头顶到膝盖占满画面
    const targetY = height * 0.62;
    const dist = (height * 0.62) / Math.tan((camera.fov / 2) / DEG);
    camera.position.set(0, height * 0.72, dist * 1.06);
    camera.lookAt(0, targetY, 0);
    camera.updateProjectionMatrix();
  }
  layout();

  // 每个关节：拿局部角（相对父关节的偏移），映射成骨骼旋转
  function poseFromRig(brain, face, dt) {
    t += dt;
    const p = brain.state.pose;
    if (!p) return;
    const j = (id) => p.get?.(id) || null;
    const f = face?.state || {};
    const mood = brain.state.mood || 'calm';

    const gazeX = clamp((f.gazeX ?? 0) / 3, -1, 1);
    const gazeY = clamp((f.gazeY ?? 0) / 3, -1, 1);
    const breath = 0.5 + 0.5 * Math.sin(t * 1.35);

    // —— 躯干 ——
    const chest = j('chest');
    const spine1 = j('spine1');
    const pelvis = j('pelvis');
    setRot(bone('hips'), 0, clamp((chest?.a || 0) * 0.15, -0.2, 0.2), -(pelvis?.a || 0) * 0.6);
    setRot(bone('spine'), 0, 0, -(spine1?.a || 0) * 0.8);
    setRot(bone('chest'), 0, 0, -(chest?.a || 0) * 0.9);
    setRot(bone('upperChest'), 0, 0, -(chest?.a || 0) * 0.4);

    // —— 头颈 ——
    const neck = j('neck');
    const head = j('head');
    setRot(bone('neck'), -gazeY * 0.18, gazeX * 0.32, -(neck?.a || 0) * 0.8);
    setRot(bone('head'), -gazeY * 0.26, gazeX * 0.5, -(head?.a || 0) * SIGN.headZ);

    // —— 眼睛：真的在看你 ——
    for (const side of ['left', 'right']) {
      const eye = bone(`${side}Eye`);
      if (eye) eye.rotation.set(-gazeY * 0.28, gazeX * 0.4, 0);
    }

    // —— 手臂：T-pose 是 +X（左）/ -X（右），我们的 a 是“从正上方顺时针” ——
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? 'left' : 'right';
      const up = j(`arm_${side}_upper`);
      const fore = j(`arm_${side}_fore`);
      const hand = j(`hand_${side}`);
      if (!up) continue;
      const aUp = up.a ?? Math.PI;
      // 左：φ = π/2 - a；右：φ = -π/2 - a
      const phi = side === 'L' ? Math.PI / 2 - aUp : -Math.PI / 2 - aUp;
      setRot(bone(`${s}UpperArm`), 0, 0, (side === 'L' ? SIGN.armZL : SIGN.armZR) * phi);

      // 屈肘：手臂垂下时，真人的肘是往前弯的（绕 X），不是往侧面折
      const flex = wrap((fore?.a ?? aUp) - aUp);
      setRot(bone(`${s}LowerArm`), 0, 0, SIGN.elbow * flex * -1);

      const wrist = wrap((hand?.a ?? fore?.a ?? 0) - (fore?.a ?? 0));
      setRot(bone(`${s}Hand`), 0, 0, SIGN.hand * wrist * -1.2);

      // —— 手指：每根指骨单独 ——
      for (const fdef of FINGERS) {
        for (let i = 0; i < 3; i++) {
          const b = bone(`${s}${fdef.bone}${SEGS[i]}`);
          if (!b) continue;
          // 拇指只有两节：Distal 借用最后一节的角
          const rigIdx = i < fdef.seg ? i : fdef.distalFrom ?? fdef.seg - 1;
          const factor = i < fdef.seg ? 1 : 0.7;
          const jn = j(`${side}_${fdef.rig}_${rigIdx}`);
          const curl = (jn?.local ?? 0) * factor;
          // 左手手指朝 +X，卷曲 = 绕 Z 负转；右手朝 -X，方向相反
          const sgn = side === 'L' ? -1 : 1;
          b.rotation.set(0, 0, sgn * SIGN.finger * (curl + (i === 0 ? 0.05 : 0)) * 1.15);
        }
      }
    }

    // —— 腿：胯/膝/踝。膝盖在矢状面弯，所以绕 X ——
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? 'left' : 'right';
      const thigh = j(`leg_${side}_thigh`);
      const shin = j(`leg_${side}_shin`);
      const foot = j(`foot_${side}`);
      if (thigh) setRot(bone(`${s}UpperLeg`), 0, 0, (Math.PI - (thigh.a ?? Math.PI)) * (side === 'L' ? 1 : -1));
      if (shin) {
        const knee = wrap((shin.a ?? Math.PI) - (thigh?.a ?? Math.PI));
        setRot(bone(`${s}LowerLeg`), SIGN.knee * Math.abs(knee) * 1.1, 0, 0);
      }
      if (foot) setRot(bone(`${s}Foot`), wrap((foot.a ?? 0) - 1.2) * 0.8, 0, 0);

      // 脚趾：模型只有一根骨，把五根脚趾的卷曲平均给它
      const toes = ['big', 'second', 'third', 'fourth', 'little'].map((n) => j(`${side}_toe_${n}_0`)).filter(Boolean);
      const toesBone = bone(`${s}Toes`);
      if (toesBone && toes.length) {
        const avg = toes.reduce((sum, tt) => sum + (tt.local ?? 0), 0) / toes.length;
        toesBone.rotation.set(-avg * 1.2, 0, 0);
      }
    }

    // —— 表情：眨眼、说话、情绪 ——
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
    const chestBone = bone('chest');
    if (chestBone) chestBone.position.y = (breath - 0.5) * 0.012;

    // 她在世界里左右走动时，整个人跟着平移一点（相机基本不动，像在看她的生活）
    vrm.scene.position.x = clamp((brain.state.root.x || 0) * 0.006, -0.35, 0.35);
  }

  const clock = new THREE.Clock();

  function sync(brain, face, dt) {
    poseFromRig(brain, face, dt);
    vrm.update(Math.min(dt || clock.getDelta(), 0.05));
    renderer.render(scene, camera);
    ready = true;
  }

  // 第一帧
  vrm.update(0);
  renderer.render(scene, camera);

  return {
    vrm,
    scene,
    camera,
    renderer,
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
