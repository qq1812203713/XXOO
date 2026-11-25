// MMD PMX 2.0 / 2.1 解析器与 VRM 人形适配器（零外部依赖）。
//
// 让 .pmx 模型（如 `jianmo/温迪.pmx`）可以直接接入 `vrm.js` 的同一套
// 骨骼重定向、AnimationMixer、30 根手指屈曲与面部表情管线：
//   1. 坐标系转换：PMX 为左手系（+X=模型左, +Y=上, -Z=前），对顶点/骨骼/变形目标
//      做 `x' = -x` 并翻转三角形绕序 `(a, b, c) -> (a, c, b)`，与 Three.js 右手系
//      （面向 -Z、left* 在 -X、right* 在 +X）完全一致。
//   2. 骨骼链与付与旋转（0x0100）：支持 BDEF1/BDEF2/BDEF4/SDEF/QDEF、D 骨（右/左足D 等）、
//      扭转辅助骨（肩C / 腕捩 / ひじ補助 / 腰キャンセル / 目戻），并利用刚体关节（Joint）
//      自动接回漏绑父骨的挂件链（如胸前飘带 `ys1` / `M-ys1`）。
//   3. 贴图容错：优先加载模型旁的真实贴图（或用户随文件一起选入的本地贴图）；
//      若外部 Texture 目录缺失，则为已知材质/UV 区域生成准确的兜底贴图（不卡死、不留白）。

const ROOT_BONE_NAMES = new Set([
  '操作中心', '全ての親', 'センター', 'グルーブ', '腰',
  'center', 'root', 'hips',
]);

// VRM 标准人形骨名 -> MMD 常见日/中/英骨骼名候选（按优先级顺序）
const BONE_MAP = {
  hips: ['腰', 'hips', 'pelvis'],
  spine: ['上半身', 'spine'],
  chest: ['上半身2', 'upperbody2', 'chest'],
  upperChest: ['上半身3', 'upperchest'],
  neck: ['首', 'neck'],
  head: ['頭', '头', 'head'],
  leftEye: ['左目', 'lefteye', 'eye_l'],
  rightEye: ['右目', 'righteye', 'eye_r'],

  leftShoulder: ['左肩', 'leftshoulder', 'shoulder_l'],
  leftUpperArm: ['左腕', 'leftupperarm', 'arm_l'],
  leftLowerArm: ['左ひじ', '左肘', 'leftlowerarm', 'elbow_l'],
  leftHand: ['左手首', '左手', 'lefthand', 'wrist_l'],

  rightShoulder: ['右肩', 'rightshoulder', 'shoulder_r'],
  rightUpperArm: ['右腕', 'rightupperarm', 'arm_r'],
  rightLowerArm: ['右ひじ', '右肘', 'rightlowerarm', 'elbow_r'],
  rightHand: ['右手首', '右手', 'righthand', 'wrist_r'],

  leftUpperLeg: ['左足', 'leftupperleg', 'leg_l'],
  leftLowerLeg: ['左ひざ', '左膝', 'leftlowerleg', 'knee_l'],
  leftFoot: ['左足首', 'leftfoot', 'ankle_l'],
  leftToes: ['左足先EX', '左つま先', 'lefttoes', 'toe_l'],

  rightUpperLeg: ['右足', 'rightupperleg', 'leg_r'],
  rightLowerLeg: ['右ひざ', '右膝', 'rightlowerleg', 'knee_r'],
  rightFoot: ['右足首', 'rightfoot', 'ankle_r'],
  rightToes: ['右足先EX', '右つま先', 'righttoes', 'toe_r'],
};

for (const [side, prefix] of [['left', '左'], ['right', '右']]) {
  const S = side[0].toUpperCase();
  BONE_MAP[`${side}ThumbProximal`] = [`${prefix}親指０`, `${prefix}親指0`, `${prefix}拇指0`, `thumb_01_${S.toLowerCase()}`];
  BONE_MAP[`${side}ThumbIntermediate`] = [`${prefix}親指１`, `${prefix}親指1`, `${prefix}拇指1`, `thumb_02_${S.toLowerCase()}`];
  BONE_MAP[`${side}ThumbDistal`] = [`${prefix}親指２`, `${prefix}親指2`, `${prefix}拇指2`, `thumb_03_${S.toLowerCase()}`];

  const FINGERS = [
    ['Index', ['人指', '人差し指', '食指']],
    ['Middle', ['中指']],
    ['Ring', ['薬指', '无名指']],
    ['Little', ['小指']],
  ];
  for (const [fName, stems] of FINGERS) {
    const segs = [
      ['Proximal', ['１', '1']],
      ['Intermediate', ['２', '2']],
      ['Distal', ['３', '3']],
    ];
    for (const [segName, nums] of segs) {
      const list = [];
      for (const st of stems) for (const n of nums) list.push(`${prefix}${st}${n}`);
      BONE_MAP[`${side}${fName}${segName}`] = list;
    }
  }
}

// VRM 表情 -> PMX Morph 组合配方（避免引用会拉出“表情”遮挡片或缩瞳孔的变形）
const EXPR_RECIPES = {
  neutral: [],
  blink: [['まばたき', 1], ['ウィンク２', 1], ['ｳｨﾝｸ２右', 1]],
  happy: [['笑い', 0.72], ['にこり', 0.65], ['口角上げ', 0.85], ['照れ', 0.18]],
  joy: [['笑い', 0.72], ['にこり', 0.65], ['口角上げ', 0.85], ['照れ', 0.18]],
  relaxed: [['にこり', 0.72], ['口角上げ', 0.62], ['なごみ左', 0.08], ['なごみ右', 0.08], ['照れ', 0.58]],
  fun: [['にこり', 0.72], ['口角上げ', 0.62], ['なごみ左', 0.08], ['なごみ右', 0.08], ['照れ', 0.58]],
  sad: [['困る', 0.9], ['Eye_WDown', 0.58], ['口角下げ', 0.78], ['下', 0.35]],
  sorrow: [['困る', 0.9], ['Eye_WDown', 0.58], ['口角下げ', 0.78], ['下', 0.35]],
  angry: [['ｷﾘｯ', 0.8], ['真面目', 0.85], ['口角下げ', 0.45]],
  surprised: [['びっくり', 0.85], ['上', 0.6]],
  aa: [['あ', 1]],
  a: [['あ', 1]],
  ih: [['い', 1]],
  i: [['い', 1]],
  ou: [['う', 1]],
  u: [['う', 1]],
  ee: [['え', 1]],
  e: [['え', 1]],
  oh: [['お', 1]],
  o: [['お', 1]],
};

const HUMANOID_ORDER = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftEye', 'rightEye',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
];
for (const side of ['left', 'right']) {
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
    for (const seg of ['Proximal', 'Intermediate', 'Distal']) {
      HUMANOID_ORDER.push(`${side}${f}${seg}`);
    }
  }
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function isPMXBuffer(buf) {
  if (!buf || buf.byteLength < 8) return false;
  const u8 = new Uint8Array(buf, 0, 4);
  return u8[0] === 0x50 && u8[1] === 0x4d && u8[2] === 0x58 && u8[3] === 0x20; // "PMX "
}

export function parsePMX(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  if (!isPMXBuffer(arrayBuffer)) throw new Error('不是有效的 PMX 文件');

  const version = view.getFloat32(4, true);
  const globalsCount = view.getUint8(8);
  const globals = [];
  for (let i = 0; i < globalsCount; i++) globals.push(view.getUint8(9 + i));
  let pos = 9 + globalsCount;

  const encoding = globals[0] === 1 ? 'utf-8' : 'utf-16le';
  const decoder = new TextDecoder(encoding);
  const addUV = globals[1] || 0;
  const vSize = globals[2];
  const tSize = globals[3];
  const mSize = globals[4];
  const bSize = globals[5];
  const moSize = globals[6];
  const rSize = globals[7];

  const rU8 = () => bytes[pos++];
  const rI32 = () => {
    const v = view.getInt32(pos, true);
    pos += 4;
    return v;
  };
  const rU16 = () => {
    const v = view.getUint16(pos, true);
    pos += 2;
    return v;
  };
  const rF32 = () => {
    const v = view.getFloat32(pos, true);
    pos += 4;
    return v;
  };
  const rIdx = (sz, signed = true) => {
    let v;
    if (sz === 1) v = signed ? view.getInt8(pos) : view.getUint8(pos);
    else if (sz === 2) v = signed ? view.getInt16(pos, true) : view.getUint16(pos, true);
    else v = view.getInt32(pos, true);
    pos += sz;
    return v;
  };
  const rText = () => {
    const len = rI32();
    const out = len > 0 ? decoder.decode(bytes.subarray(pos, pos + len)) : '';
    pos += Math.max(0, len);
    return out;
  };

  const nameJP = rText();
  const nameEN = rText();
  const commentJP = rText();
  const commentEN = rText();

  // —— 1. 顶点（先读原始坐标并算缩放系数） ——
  const vertexCount = rI32();
  const rawPos = new Float32Array(vertexCount * 3);
  const rawNorm = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const skinIndices = new Uint16Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);
  const boneVertCounts = new Map();

  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < vertexCount; i++) {
    const px = rF32();
    const py = rF32();
    const pz = rF32();
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    rawPos[i * 3] = -px;
    rawPos[i * 3 + 1] = py;
    rawPos[i * 3 + 2] = pz;

    rawNorm[i * 3] = -rF32();
    rawNorm[i * 3 + 1] = rF32();
    rawNorm[i * 3 + 2] = rF32();

    uvs[i * 2] = rF32();
    uvs[i * 2 + 1] = 1 - rF32(); // Three.js 默认 Texture.flipY = true

    pos += addUV * 16;

    const wt = rU8();
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0;
    let w0 = 0, w1 = 0, w2 = 0, w3 = 0;
    if (wt === 0) {
      b0 = rIdx(bSize, true);
      w0 = 1;
    } else if (wt === 1) {
      b0 = rIdx(bSize, true);
      b1 = rIdx(bSize, true);
      w0 = rF32();
      w1 = 1 - w0;
    } else if (wt === 2 || wt === 4) {
      b0 = rIdx(bSize, true);
      b1 = rIdx(bSize, true);
      b2 = rIdx(bSize, true);
      b3 = rIdx(bSize, true);
      w0 = rF32();
      w1 = rF32();
      w2 = rF32();
      w3 = rF32();
    } else if (wt === 3) {
      b0 = rIdx(bSize, true);
      b1 = rIdx(bSize, true);
      w0 = rF32();
      w1 = 1 - w0;
      pos += 36; // SDEF C, R0, R1
    }
    pos += 4; // edgeScale

    const bs = [b0, b1, b2, b3];
    const ws = [w0, w1, w2, w3];
    let wSum = 0;
    for (let k = 0; k < 4; k++) {
      if (bs[k] < 0 || ws[k] <= 0) {
        bs[k] = 0;
        ws[k] = 0;
      } else {
        wSum += ws[k];
      }
    }
    if (wSum > 1e-6) {
      for (let k = 0; k < 4; k++) ws[k] /= wSum;
    } else {
      bs[0] = 0;
      ws[0] = 1;
    }
    for (let k = 0; k < 4; k++) {
      skinIndices[i * 4 + k] = bs[k];
      skinWeights[i * 4 + k] = ws[k];
      if (ws[k] > 0) boneVertCounts.set(bs[k], (boneVertCounts.get(bs[k]) || 0) + 1);
    }
  }

  const rawHeight = maxY - minY;
  const scale = rawHeight > 4 ? 0.08 : 1;
  if (scale !== 1) {
    for (let i = 0; i < rawPos.length; i++) rawPos[i] *= scale;
  }

  // —— 2. 面索引（镜像后翻转绕序 (a, b, c) -> (a, c, b)） ——
  const indexCount = rI32();
  const indices = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i += 3) {
    const a = rIdx(vSize, false);
    const b = rIdx(vSize, false);
    const c = rIdx(vSize, false);
    indices[i] = a;
    indices[i + 1] = c;
    indices[i + 2] = b;
  }

  // —— 3. 贴图路径表 ——
  const textureCount = rI32();
  const textures = [];
  for (let i = 0; i < textureCount; i++) {
    textures.push(rText().replace(/\\/g, '/'));
  }

  // —— 4. 材质 ——
  const materialCount = rI32();
  const materials = [];
  let indexOffset = 0;
  for (let i = 0; i < materialCount; i++) {
    const name = rText();
    const mNameEN = rText();
    const diffuse = [rF32(), rF32(), rF32(), rF32()];
    const specular = [rF32(), rF32(), rF32()];
    const specularity = rF32();
    const ambient = [rF32(), rF32(), rF32()];
    const drawFlag = rU8();
    const edgeColor = [rF32(), rF32(), rF32(), rF32()];
    const edgeSize = rF32();
    const texIdx = rIdx(tSize, true);
    const sphIdx = rIdx(tSize, true);
    const sphMode = rU8();
    const toonFlag = rU8();
    const toonIdx = toonFlag === 1 ? rU8() : rIdx(tSize, true);
    const memo = rText();
    const faceCount = rI32();
    materials.push({
      name,
      nameEN: mNameEN,
      diffuse,
      specular,
      specularity,
      ambient,
      drawFlag,
      doubleSided: Boolean(drawFlag & 0x01),
      edgeColor,
      edgeSize,
      texIdx,
      sphIdx,
      sphMode,
      toonFlag,
      toonIdx,
      memo,
      indexOffset,
      faceCount,
    });
    indexOffset += faceCount;
  }

  // —— 5. 骨骼 ——
  const boneCount = rI32();
  const bones = [];
  for (let i = 0; i < boneCount; i++) {
    const name = rText();
    const bNameEN = rText();
    const posArr = [-rF32() * scale, rF32() * scale, rF32() * scale];
    const parent = rIdx(bSize, true);
    const layer = rI32();
    const flag = rU16();
    if (flag & 0x0001) pos += bSize;
    else pos += 12;

    let appendParent = -1;
    let appendRatio = 0;
    const appendRotate = Boolean(flag & 0x0100);
    const appendMove = Boolean(flag & 0x0200);
    if (appendRotate || appendMove) {
      appendParent = rIdx(bSize, true);
      appendRatio = rF32();
    }
    if (flag & 0x0400) pos += 12;
    if (flag & 0x0800) pos += 24;
    if (flag & 0x2000) pos += 4;
    if (flag & 0x0020) {
      pos += bSize + 8;
      const linkCount = rI32();
      for (let l = 0; l < linkCount; l++) {
        pos += bSize;
        if (rU8()) pos += 24;
      }
    }
    bones.push({
      index: i,
      name,
      nameEN: bNameEN,
      pos: posArr,
      parent,
      layer,
      flag,
      appendRotate,
      appendMove,
      appendParent,
      appendRatio,
      vertCount: boneVertCounts.get(i) || 0,
    });
  }

  // —— 6. 变形（Morphs） ——
  const morphCount = rI32();
  const morphs = [];
  for (let i = 0; i < morphCount; i++) {
    const name = rText();
    const moNameEN = rText();
    const panel = rU8();
    const type = rU8();
    const offsetCount = rI32();
    const offsets = [];
    for (let k = 0; k < offsetCount; k++) {
      if (type === 0 || type === 9) {
        offsets.push({ morphIdx: rIdx(moSize, true), ratio: rF32() });
      } else if (type === 1) {
        offsets.push({
          vertIdx: rIdx(vSize, false),
          dx: -rF32() * scale,
          dy: rF32() * scale,
          dz: rF32() * scale,
        });
      } else if (type === 2) {
        pos += bSize + 28;
      } else if (type >= 3 && type <= 7) {
        pos += vSize + 16;
      } else if (type === 8) {
        const matIdx = rIdx(mSize, true);
        const op = rU8();
        const diffuse = [rF32(), rF32(), rF32(), rF32()];
        pos += 12 + 4 + 12 + 16 + 4 + 16 + 16 + 16;
        offsets.push({ matIdx, op, diffuse });
      } else if (type === 10) {
        pos += rSize + 1 + 4 + 12 + 12;
      }
    }
    morphs.push({ index: i, name, nameEN: moNameEN, panel, type, offsets });
  }

  // —— 7. 显示框 ——
  if (pos + 4 <= bytes.length) {
    const displayCount = rI32();
    for (let i = 0; i < displayCount; i++) {
      rText();
      rText();
      rU8();
      const elemCount = rI32();
      for (let e = 0; e < elemCount; e++) {
        const et = rU8();
        pos += et === 0 ? bSize : moSize;
      }
    }
  }

  // —— 8. 刚体与关节：把未设父骨的物理挂件（如 `ys1` / `M-ys1`）接回真实父骨 ——
  const rigids = [];
  if (pos + 4 <= bytes.length) {
    const rigidCount = rI32();
    for (let i = 0; i < rigidCount; i++) {
      const rName = rText();
      rText();
      const boneIdx = rIdx(bSize, true);
      pos += 1 + 2 + 1 + 12 + 12 + 12 + 20 + 1;
      rigids.push({ name: rName, boneIdx });
    }
  }

  const joints = [];
  if (pos + 4 <= bytes.length) {
    const jointCount = rI32();
    for (let i = 0; i < jointCount; i++) {
      if (pos + 4 > bytes.length) break;
      const jName = rText();
      rText();
      rU8();
      const rbA = rIdx(rSize, true);
      const rbB = rIdx(rSize, true);
      pos += 12 * 8;
      joints.push({ name: jName, rbA, rbB });
    }
  }

  for (const j of joints) {
    const rA = rigids[j.rbA];
    const rB = rigids[j.rbB];
    if (!rA || !rB) continue;
    const bA = rA.boneIdx;
    const bB = rB.boneIdx;
    if (bA < 0 || bB < 0 || bA === bB) continue;
    const boneB = bones[bB];
    if (boneB && boneB.parent === -1 && !ROOT_BONE_NAMES.has(boneB.name)) {
      boneB.parent = bA;
    }
  }

  return {
    version,
    name: nameJP || nameEN || 'PMX',
    comment: commentJP || commentEN || '',
    scale,
    vertexCount,
    positions: rawPos,
    normals: rawNorm,
    uvs,
    skinIndices,
    skinWeights,
    indices,
    textures,
    materials,
    bones,
    morphs,
    joints,
  };
}

// 找出标准 VRM 骨名对应的 PMX 骨骼索引
export function mapPMXBones(bones) {
  const byName = new Map();
  for (const b of bones) {
    const key = b.name.trim();
    if (!byName.has(key)) byName.set(key, b.index);
    const low = key.toLowerCase();
    if (!byName.has(low)) byName.set(low, b.index);
  }
  const resolved = Object.create(null);
  for (const [vrmName, candidates] of Object.entries(BONE_MAP)) {
    for (const cand of candidates) {
      const idx = byName.get(cand) ?? byName.get(cand.toLowerCase());
      if (idx !== undefined) {
        // 特判：`左/右つま先` 权重为 0 时优先使用 `足先EX`
        if ((vrmName === 'leftToes' || vrmName === 'rightToes') && bones[idx].vertCount === 0) {
          const exName = vrmName === 'leftToes' ? '左足先EX' : '右足先EX';
          const exIdx = byName.get(exName);
          if (exIdx !== undefined && bones[exIdx].vertCount > 0) {
            resolved[vrmName] = exIdx;
            break;
          }
        }
        resolved[vrmName] = idx;
        break;
      }
    }
  }
  return resolved;
}

// ————————————————— UV 精确兜底贴图（缺少外部 Texture/ 时使用） —————————————————
function makeCanvas2D(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

function drawRoundedOval(ctx, cx, cy, rx, ry, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function buildVentiFallbackCanvas(kind, texName, createCanvasFn) {
  const lowTex = (texName || '').toLowerCase();
  const lowMat = (kind || '').toLowerCase();
  const W = 512;
  const H = 512;
  const c = createCanvasFn ? createCanvasFn(W, H) : makeCanvas2D(W, H);
  if (!c) return null;
  const g = c.getContext('2d');
  if (!g) return null;

  const rx = (u) => u * W;
  const ry = (v) => v * H;

  // 1) 皮肤独立兜底（避免与衣服 UV 区冲突）
  if (lowMat === '皮肤' || lowMat === 'skin') {
    g.fillStyle = '#ffe5d4';
    g.fillRect(0, 0, W, H);
    const rg = g.createRadialGradient(W * 0.5, H * 0.5, 20, W * 0.5, H * 0.5, W * 0.6);
    rg.addColorStop(0, '#ffeadb');
    rg.addColorStop(1, '#f8d5c2');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
    return c;
  }

  // 2) 袜子独立兜底
  if (lowMat === '袜子' || lowMat === 'socks') {
    g.fillStyle = '#f5f6fb';
    g.fillRect(0, 0, W, H);
    // 顶部暗青与金边装饰带（UV V ≈ 0.44..0.52）
    g.fillStyle = '#1d6b61';
    g.fillRect(0, ry(0.43), W, ry(0.055));
    g.fillStyle = '#d6b156';
    g.fillRect(0, ry(0.48), W, ry(0.012));
    return c;
  }

  // 3) 表情贴图（透明底！仅腮红区 `U:0.52..0.87, V:0.58..0.82` 有柔和粉红）
  if (lowTex.includes('表情') || lowMat === '表情') {
    g.clearRect(0, 0, W, H);
    const cx = rx(0.70);
    const cy = ry(0.70);
    const rg = g.createRadialGradient(cx, cy, 6, cx, cy, rx(0.14));
    rg.addColorStop(0, 'rgba(255, 118, 148, 0.78)');
    rg.addColorStop(0.55, 'rgba(255, 134, 160, 0.42)');
    rg.addColorStop(1, 'rgba(255, 140, 165, 0)');
    g.fillStyle = rg;
    g.fillRect(rx(0.50), ry(0.56), rx(0.40), ry(0.28));
    g.strokeStyle = 'rgba(255, 92, 130, 0.72)';
    g.lineWidth = 4;
    g.lineCap = 'round';
    for (let i = -2; i <= 2; i++) {
      const sx = cx + i * 16;
      g.beginPath();
      g.moveTo(sx - 6, cy + 12);
      g.lineTo(sx + 6, cy - 12);
      g.stroke();
    }
    return c;
  }

  // 4) 脸部皮肤（`脸` 单独生成，避免与 `眼白` UV 区重叠导致眼下泛白）
  if (lowMat === '脸') {
    g.fillStyle = '#ffe6d6';
    g.fillRect(0, 0, W, H);
    // 极淡暖颊底色
    for (const ux of [0.27, 0.73]) {
      const rg = g.createRadialGradient(rx(ux), ry(0.56), 4, rx(ux), ry(0.56), rx(0.11));
      rg.addColorStop(0, 'rgba(255, 168, 174, 0.20)');
      rg.addColorStop(1, 'rgba(255, 168, 174, 0)');
      g.fillStyle = rg;
      g.fillRect(rx(ux - 0.13), ry(0.43), rx(0.26), ry(0.26));
    }
    // 柔和鼻子阴影 & 嘴唇微红
    drawRoundedOval(g, rx(0.50), ry(0.52), rx(0.018), ry(0.028), 'rgba(225, 165, 145, 0.25)');
    drawRoundedOval(g, rx(0.50), ry(0.67), rx(0.045), ry(0.012), 'rgba(235, 140, 145, 0.38)');
    return c;
  }

  // 4b) 眼白 + 眉毛 + 睫毛 + 口腔 (`眼白` 或通用 `脸.jpg`)
  if (lowTex.includes('脸') || lowMat === '眼白') {
    // 默认暖白底（供眼白主区域使用）
    g.fillStyle = '#fafbff';
    g.fillRect(0, 0, W, H);
    // 眼白上方浅灰蓝阴影（U: 0.27..0.41 / 0.59..0.73, V: 0.40..0.48）
    for (const [u0, u1] of [[0.27, 0.42], [0.58, 0.73]]) {
      const sg = g.createLinearGradient(0, ry(0.40), 0, ry(0.45));
      sg.addColorStop(0, '#c8d2e8');
      sg.addColorStop(1, 'rgba(250, 251, 255, 0)');
      g.fillStyle = sg;
      g.fillRect(rx(u0), ry(0.40), rx(u1 - u0), ry(0.05));
    }
    // 睫毛与上眼线区（U: 0.13..0.29, V: 0.00..0.125）
    g.fillStyle = '#182132';
    g.fillRect(rx(0.13), ry(0.0), rx(0.16), ry(0.125));
    // 眉毛区（U: 0.28..0.47, V: 0.00..0.032）
    g.fillStyle = '#1c2b42';
    g.fillRect(rx(0.28), ry(0.0), rx(0.19), ry(0.032));
    // 牙齿（U: 0.38..0.48, V: 0.91..1.00）
    g.fillStyle = '#fcf8f6';
    g.fillRect(rx(0.38), ry(0.91), rx(0.10), ry(0.09));
    // 舌头与口腔内壁（U: 0.60..0.82, V: 0.87..1.00）
    g.fillStyle = '#752936';
    g.fillRect(rx(0.60), ry(0.87), rx(0.22), ry(0.13));
    g.fillStyle = '#cf6374';
    g.fillRect(rx(0.61), ry(0.91), rx(0.095), ry(0.09));
    return c;
  }

  // 5) 头发 + 虹膜（`头发.jpg`）
  if (lowTex.includes('头') || lowMat === '头发' || lowMat === '眼睛') {
    // 温迪标志性深藏蓝发色 + 发丝明暗渐变
    const hg = g.createLinearGradient(0, 0, 0, H);
    hg.addColorStop(0, '#142034');
    hg.addColorStop(0.55, '#192a44');
    hg.addColorStop(1, '#203b58');
    g.fillStyle = hg;
    g.fillRect(0, 0, W, H);
    // 竖向发丝纹理
    g.fillStyle = 'rgba(64, 128, 175, 0.14)';
    for (let i = 0; i < 48; i++) {
      g.fillRect((i * W) / 48, 0, 3, H);
    }
    // 麻花辫发梢青绿渐变（U: 0.00..0.21, V: 0.78..1.00）与散落发尾青绿高光
    const bg = g.createLinearGradient(0, ry(0.75), 0, ry(1.0));
    bg.addColorStop(0, 'rgba(26, 46, 70, 0)');
    bg.addColorStop(0.38, '#1e8a8d');
    bg.addColorStop(0.78, '#36d6c3');
    bg.addColorStop(1, '#6ef7e0');
    g.fillStyle = bg;
    g.fillRect(0, ry(0.75), rx(0.22), ry(0.25));

    const tg = g.createLinearGradient(0, ry(0.46), 0, ry(0.82));
    tg.addColorStop(0, 'rgba(42, 165, 160, 0)');
    tg.addColorStop(0.72, 'rgba(44, 198, 184, 0.45)');
    tg.addColorStop(1, 'rgba(84, 240, 220, 0.72)');
    g.fillStyle = tg;
    g.fillRect(0, ry(0.46), rx(0.18), ry(0.36));

    // 高光条（U: 0.94..1.00, V: 0.81..0.97）
    g.fillStyle = '#ffffff';
    g.fillRect(rx(0.94), ry(0.81), rx(0.06), ry(0.16));

    // 原神温迪湖绿双色虹膜（U: 0.864..0.997, V: 0.663..0.803）
    const cx = rx(0.930);
    const cy = ry(0.733);
    const rad = rx(0.068);
    g.save();
    g.beginPath();
    g.arc(cx, cy, rad, 0, Math.PI * 2);
    g.clip();
    const ig = g.createLinearGradient(0, cy - rad, 0, cy + rad);
    ig.addColorStop(0, '#0f273c');
    ig.addColorStop(0.38, '#196f82');
    ig.addColorStop(0.72, '#34cfb9');
    ig.addColorStop(1, '#98f2ba');
    g.fillStyle = ig;
    g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    // 深色外环
    g.strokeStyle = '#0d2236';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cy, rad - 1.5, 0, Math.PI * 2);
    g.stroke();
    // 瞳孔
    drawRoundedOval(g, cx, cy - 1, rad * 0.38, rad * 0.44, '#0b1829');
    // 下缘金绿微光
    drawRoundedOval(g, cx, cy + rad * 0.42, rad * 0.48, rad * 0.22, 'rgba(218, 244, 150, 0.55)');
    // 双高光点
    drawRoundedOval(g, cx - rad * 0.34, cy - rad * 0.34, rad * 0.22, rad * 0.22, '#ffffff');
    drawRoundedOval(g, cx + rad * 0.32, cy + rad * 0.36, rad * 0.11, rad * 0.11, '#ffffff');
    g.restore();
    return c;
  }

  // 6) 衣服 + 披风 + 帽子 + 塞西莉亚花 + 羽毛 + 神之眼（`衣服.jpg`）
  g.fillStyle = '#1f6c61'; // 默认温迪吟游诗人翠绿底
  g.fillRect(0, 0, W, H);

  // 白色衬衫上衣 + 金领滚边（U: 0.00..0.27, V: 0.00..0.28）
  g.fillStyle = '#f3f5fa';
  g.fillRect(0, 0, rx(0.272), ry(0.285));
  // 颈部皮肤领口条（V: 0.00..0.044）
  g.fillStyle = '#ffe5d4';
  g.fillRect(rx(0.08), 0, rx(0.13), ry(0.044));
  // 金边与深青领带结
  g.fillStyle = '#d7b258';
  g.fillRect(0, ry(0.042), rx(0.272), ry(0.014));
  g.fillStyle = '#18544b';
  g.fillRect(rx(0.11), ry(0.06), rx(0.05), ry(0.19));

  // 绿色紧身马甲（U: 0.00..0.27, V: 0.28..0.45）+ 金色腰饰
  g.fillStyle = '#1c665b';
  g.fillRect(0, ry(0.285), rx(0.272), ry(0.165));
  g.fillStyle = '#d7b258';
  g.fillRect(0, ry(0.282), rx(0.272), ry(0.016));
  g.fillRect(0, ry(0.425), rx(0.272), ry(0.014));

  // 白色灯笼袖（U: 0.272..0.515, V: 0.00..0.36）与翠绿金边袖口（V: 0.36..0.46）
  g.fillStyle = '#f5f6fb';
  g.fillRect(rx(0.272), 0, rx(0.243), ry(0.36));
  g.fillStyle = '#1d6b60';
  g.fillRect(rx(0.272), ry(0.36), rx(0.243), ry(0.10));
  g.fillStyle = '#d7b258';
  g.fillRect(rx(0.272), ry(0.358), rx(0.243), ry(0.015));

  // 白色袜子 UV 区（U: 0.06..0.272, V: 0.44..0.79）
  g.fillStyle = '#f2f4fa';
  g.fillRect(rx(0.06), ry(0.45), rx(0.212), ry(0.34));
  g.fillStyle = '#1d6b60';
  g.fillRect(rx(0.06), ry(0.45), rx(0.212), ry(0.045));

  // 绿色灯笼短裤（U: 0.00..0.64, V: 0.79..1.00）
  g.fillStyle = '#1e6e62';
  g.fillRect(0, ry(0.79), rx(0.645), ry(0.21));
  g.fillStyle = '#e7ecdf';
  for (let i = 0; i < 8; i++) {
    g.fillRect(rx(0.04 + i * 0.075), ry(0.81), rx(0.022), ry(0.16));
  }
  g.fillStyle = '#d7b258';
  g.fillRect(0, ry(0.79), rx(0.645), ry(0.016));
  g.fillRect(0, ry(0.975), rx(0.645), ry(0.025));

  // 棕色吟游诗人短靴 + 金扣（U: 0.24..0.485, V: 0.60..0.79）
  g.fillStyle = '#5c3926';
  g.fillRect(rx(0.242), ry(0.605), rx(0.243), ry(0.185));
  g.fillStyle = '#261812';
  g.fillRect(rx(0.242), ry(0.755), rx(0.243), ry(0.035));
  g.fillStyle = '#d9b55c';
  g.fillRect(rx(0.242), ry(0.62), rx(0.243), ry(0.016));

  // 胸前白金蝴蝶结 + 小披肩（U: 0.24..0.68, V: 0.50..0.82）
  g.fillStyle = '#f4f6fa';
  g.fillRect(rx(0.24), ry(0.505), rx(0.16), ry(0.095));
  g.fillRect(rx(0.42), ry(0.625), rx(0.26), ry(0.185));
  g.fillStyle = '#d9b55c';
  g.fillRect(rx(0.24), ry(0.585), rx(0.16), ry(0.014));
  g.fillRect(rx(0.42), ry(0.785), rx(0.26), ry(0.015));

  // 胸口风系宝石（U: 0.58..0.64, V: 0.80..0.92）
  g.fillStyle = '#3de6d1';
  g.fillRect(rx(0.58), ry(0.80), rx(0.06), ry(0.125));

  // 腰间神之眼（U: 0.65..0.91, V: 0.41..0.47）
  g.fillStyle = '#e0ba5c';
  g.fillRect(rx(0.655), ry(0.41), rx(0.25), ry(0.06));
  drawRoundedOval(g, rx(0.77), ry(0.44), rx(0.035), ry(0.025), '#43ecd6');

  // 后背斗篷：外深翠绿（V: 0.10..0.50）、内浅薄荷白（V: 0.47..1.00）、金边
  g.fillStyle = '#195a52';
  g.fillRect(rx(0.645), ry(0.10), rx(0.355), ry(0.385));
  g.fillStyle = '#eef5f0';
  g.fillRect(rx(0.645), ry(0.485), rx(0.355), ry(0.515));
  g.fillStyle = '#d9b45a';
  g.fillRect(rx(0.645), ry(0.475), rx(0.355), ry(0.022));
  g.fillRect(rx(0.645), ry(0.955), rx(0.355), ry(0.025));

  // 贝雷帽（U: 0.46..0.76, V: 0.00..0.52）+ 白色塞西莉亚花 + 羽毛
  g.fillStyle = '#1f7063';
  g.fillRect(rx(0.46), 0, rx(0.30), ry(0.515));
  g.fillStyle = '#d9b55c';
  g.fillRect(rx(0.46), ry(0.255), rx(0.30), ry(0.018));
  // 塞西莉亚花（U: 0.67..0.78, V: 0.21..0.42）
  g.fillStyle = '#fcfdff';
  g.fillRect(rx(0.674), ry(0.215), rx(0.105), ry(0.205));
  drawRoundedOval(g, rx(0.725), ry(0.315), rx(0.02), ry(0.022), '#efc454');
  // 帽羽（U: 0.755..0.92, V: 0.00..0.18 —— 避开贝雷帽右缘 0.749）
  const fg = g.createLinearGradient(0, 0, 0, ry(0.175));
  fg.addColorStop(0, '#fcfdff');
  fg.addColorStop(0.65, '#8ce8d8');
  fg.addColorStop(1, '#26a69a');
  g.fillStyle = fg;
  g.fillRect(rx(0.755), 0, rx(0.165), ry(0.175));

  return c;
}

async function blobToTexture(THREE, blob) {
  let img;
  let needsFlipY = true;
  if (typeof Image !== 'undefined' && typeof URL?.createObjectURL === 'function') {
    // 优先解码为 HTMLImageElement：Three.js WebGLTextures 会对 ImageBitmap 跳过 UNPACK_FLIP_Y_WEBGL，
    // 导致 tex.flipY = true 被忽略、贴图整张上下颠倒；HTMLImageElement 才能正常应用 flipY 与色彩空间转换
    const objUrl = URL.createObjectURL(blob);
    img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => { URL.revokeObjectURL(objUrl); resolve(el); };
      el.onerror = (e) => { URL.revokeObjectURL(objUrl); reject(e); };
      el.src = objUrl;
    });
  } else if (typeof createImageBitmap === 'function') {
    // 无 DOM Image 的环境（如 Worker/测试桩）：显式要求解码期翻转，并仅对真实 ImageBitmap 设 flipY=false
    img = await createImageBitmap(blob, { imageOrientation: 'flipY' });
    if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
      needsFlipY = false;
    }
  } else {
    throw new Error('No image decoder available');
  }
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = needsFlipY;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

async function fetchTexture(THREE, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return blobToTexture(THREE, blob);
}

function buildRampTexture(THREE, shadowRgb, litRgb, lowEnd = 6, highStart = 9) {
  const h = 16;
  const data = new Uint8Array(h * 4);
  for (let y = 0; y < h; y++) {
    const t = y <= lowEnd ? 0 : y >= highStart ? 1 : (y - lowEnd) / Math.max(1, highStart - lowEnd);
    const s = t * t * (3 - 2 * t);
    const i = y * 4;
    data[i] = Math.round(shadowRgb[0] + (litRgb[0] - shadowRgb[0]) * s);
    data[i + 1] = Math.round(shadowRgb[1] + (litRgb[1] - shadowRgb[1]) * s);
    data[i + 2] = Math.round(shadowRgb[2] + (litRgb[2] - shadowRgb[2]) * s);
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 1, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function buildToonRamp(THREE) {
  return buildRampTexture(THREE, [169, 179, 219], [255, 255, 255], 6, 8);
}

function buildSkinToonRamp(THREE) {
  return buildRampTexture(THREE, [222, 174, 176], [255, 255, 255], 7, 11);
}

function buildEyeToonRamp(THREE) {
  return buildRampTexture(THREE, [238, 243, 255], [255, 255, 255], 4, 9);
}

function buildDummySphereTex(THREE) {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// 给 MeshToonMaterial 注入真实 PMX 彩色卡通阶梯（toon.png / 柔和肤色阶梯）、
// 加法球面环境反射（mc3.png）、方向高光与天空 Fresnel 轮廓光，强化 3D 立体层次与反光质感
export function patchPMXToonFragmentShader(src) {
  let out = src.replace(
    '#include <gradientmap_pars_fragment>',
    `uniform sampler2D uPmxToonMap;
uniform sampler2D uPmxSphereMap;
uniform float uPmxHasSphere;
uniform float uPmxSphereWeight;
uniform float uPmxSpecPower;
uniform float uPmxSpecStrength;
uniform float uPmxRimStrength;
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
\tfloat dotNL = dot( normal, lightDirection );
\tfloat rampY = clamp( dotNL * 0.5 + 0.42, 0.02, 0.98 );
\treturn texture2D( uPmxToonMap, vec2( 0.36, rampY ) ).rgb;
}`,
  );
  out = out.replace(
    '#include <lights_toon_pars_fragment>',
    `varying vec3 vViewPosition;
struct ToonMaterial {
\tvec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
\tfloat dotNL = dot( geometryNormal, directLight.direction );
\tvec3 irradiance;
\tif ( directLight.direction.z < -0.15 ) {
\t\tirradiance = vec3( smoothstep( -0.08, 0.58, dotNL ) ) * directLight.color;
\t} else {
\t\tirradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
\t}
\treflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
\tif ( uPmxSpecStrength > 0.001 ) {
\t\tvec3 halfSum = directLight.direction + geometryViewDir;
\t\tfloat halfLen2 = dot( halfSum, halfSum );
\t\tif ( halfLen2 > 1e-6 ) {
\t\t\tvec3 halfDir = halfSum * inversesqrt( halfLen2 );
\t\t\tfloat nh = max( dot( geometryNormal, halfDir ), 1e-4 );
\t\t\tfloat spec = pow( nh, max( uPmxSpecPower, 1.0 ) ) * uPmxSpecStrength;
\t\t\tfloat specMask = smoothstep( -0.02, 0.32, dotNL );
\t\t\tvec3 tint = mix( vec3( 1.0 ), normalize( material.diffuseColor + vec3( 0.18 ) ), 0.28 );
\t\t\treflectedLight.directSpecular += directLight.color * tint * spec * specMask;
\t\t}
\t}
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
\treflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct\t\t\t\tRE_Direct_Toon
#define RE_IndirectDiffuse\t\tRE_IndirectDiffuse_Toon`,
  );
  out = out.replace(
    'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
    `vec3 pmxSphere = vec3( 0.0 );
\tif ( uPmxHasSphere > 0.5 ) {
\t\tvec2 spUv = clamp( geometryNormal.xy * 0.5 + 0.5, 0.002, 0.998 );
\t\tvec3 spTex = texture2D( uPmxSphereMap, spUv ).rgb;
\t\tfloat lum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
\t\tfloat damp = mix( 1.0, 0.42, saturate( lum ) );
\t\tvec3 spTint = mix( vec3( 1.0 ), normalize( diffuseColor.rgb + vec3( 0.22 ) ), 0.34 );
\t\tpmxSphere = spTex * spTint * uPmxSphereWeight * damp;
\t}
\tfloat pmxFresnel = pow( max( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 1e-4 ), 3.0 ) * uPmxRimStrength;
\tfloat rimTopMask = 0.40 + 0.60 * saturate( geometryNormal.y * 0.5 + 0.5 );
\tvec3 pmxRim = vec3( 0.88, 0.95, 1.0 ) * pmxFresnel * rimTopMask;
\tvec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + pmxSphere + pmxRim + totalEmissiveRadiance;`,
  );
  return out;
}

function getPMXMaterialProfile(matName, { isExprDecal, matToonTex, defaultToonRamp, skinToonRamp, eyeToonRamp, hasSphere }) {
  if (isExprDecal) {
    return { toonMap: eyeToonRamp, hasSphere: false, sphereWeight: 0, specPower: 8, specStrength: 0, rimStrength: 0 };
  }
  if (matName === '眼睛') {
    return { toonMap: eyeToonRamp, hasSphere: false, sphereWeight: 0, specPower: 68, specStrength: 0.34, rimStrength: 0.05 };
  }
  if (matName === '眼白') {
    return { toonMap: eyeToonRamp, hasSphere: false, sphereWeight: 0, specPower: 36, specStrength: 0.05, rimStrength: 0.03 };
  }
  if (matName === '脸' || matName === '皮肤') {
    return { toonMap: skinToonRamp, hasSphere: false, sphereWeight: 0, specPower: 22, specStrength: 0.025, rimStrength: 0.14 };
  }
  if (matName === '头发') {
    return { toonMap: matToonTex || defaultToonRamp, hasSphere, sphereWeight: 2.35, specPower: 46, specStrength: 0.28, rimStrength: 0.34 };
  }
  if (matName === '披风' || matName === '衣服' || matName === '帽子') {
    return { toonMap: matToonTex || defaultToonRamp, hasSphere, sphereWeight: 1.85, specPower: 58, specStrength: 0.24, rimStrength: 0.26 };
  }
  if (matName === '袜子') {
    return { toonMap: matToonTex || defaultToonRamp, hasSphere: false, sphereWeight: 0, specPower: 32, specStrength: 0.12, rimStrength: 0.22 };
  }
  return { toonMap: matToonTex || defaultToonRamp, hasSphere, sphereWeight: 1.5, specPower: 42, specStrength: 0.18, rimStrength: 0.22 };
}

// 绕轴缩放四元数（支持负比例，用于 `腰キャンセル (-1.0)` 和 `目戻 (-0.7)`）
function scaleQuaternion(q, ratio, target) {
  if (Math.abs(ratio) < 1e-6) return target.identity();
  let x = q.x, y = q.y, z = q.z, w = q.w;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const clampedW = clamp(w, -1, 1);
  const s = Math.sqrt(Math.max(0, 1 - clampedW * clampedW));
  if (s < 1e-6) return target.identity();
  const half = Math.acos(clampedW) * ratio;
  const sinH = Math.sin(half) / s;
  return target.set(x * sinH, y * sinH, z * sinH, Math.cos(half));
}

// 把解析好的 PMX 数据构造成 Three.js 场景与 VRM 兼容接口（可供浏览器与 Node 测试复用）
export function buildPMXVRM(THREE, parsed, resolvedTextures = new Map(), opt = {}) {
  const root = new THREE.Group();
  root.name = parsed.name || 'PMX';

  // —— 1. 构造 Raw Three.js Bone 数组与层级 ——
  const rawBones = parsed.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    return bone;
  });

  const restLocalPos = parsed.bones.map((b) => {
    if (b.parent >= 0) {
      const p = parsed.bones[b.parent].pos;
      return new THREE.Vector3(b.pos[0] - p[0], b.pos[1] - p[1], b.pos[2] - p[2]);
    }
    return new THREE.Vector3(b.pos[0], b.pos[1], b.pos[2]);
  });

  for (let i = 0; i < parsed.bones.length; i++) {
    const b = parsed.bones[i];
    rawBones[i].position.copy(restLocalPos[i]);
    if (b.parent >= 0 && rawBones[b.parent]) rawBones[b.parent].add(rawBones[i]);
    else root.add(rawBones[i]);
  }

  // —— 2. 几何体与 MorphTargets ——
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(parsed.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(parsed.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(parsed.uvs, 2));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(parsed.skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(parsed.skinWeights, 4));
  geometry.setIndex(new THREE.BufferAttribute(parsed.indices, 1));

  // 展开组变形（如 まばたき -> ウィンク２ + ｳｨﾝｸ２右），仅保留配方和常用顶点变形
  const morphByName = new Map(parsed.morphs.map((m) => [m.name, m]));
  const neededMorphNames = new Set();
  for (const recipe of Object.values(EXPR_RECIPES)) {
    for (const [mName] of recipe) {
      const m = morphByName.get(mName);
      if (!m) continue;
      if (m.type === 0) {
        for (const sub of m.offsets) {
          const sm = parsed.morphs[sub.morphIdx];
          if (sm && sm.type === 1) neededMorphNames.add(sm.name);
        }
      } else if (m.type === 1) {
        neededMorphNames.add(m.name);
      }
    }
  }
  for (const m of parsed.morphs) {
    if (m.type === 1 && neededMorphNames.size < 36) neededMorphNames.add(m.name);
  }

  const morphTargets = [];
  const morphIndexByName = new Map();
  for (const mName of neededMorphNames) {
    const m = morphByName.get(mName);
    if (!m || m.type !== 1 || !m.offsets.length) continue;
    const arr = new Float32Array(parsed.positions);
    for (const o of m.offsets) {
      const k = o.vertIdx * 3;
      if (k + 2 < arr.length) {
        arr[k] += o.dx;
        arr[k + 1] += o.dy;
        arr[k + 2] += o.dz;
      }
    }
    const attr = new THREE.Float32BufferAttribute(arr, 3);
    attr.name = m.name;
    morphIndexByName.set(m.name, morphTargets.length);
    morphTargets.push(attr);
  }
  if (morphTargets.length) {
    geometry.morphAttributes.position = morphTargets;
  }

  // —— 3. 材质 ——
  const defaultToonRamp = buildToonRamp(THREE);
  const skinToonRamp = buildSkinToonRamp(THREE);
  const eyeToonRamp = buildEyeToonRamp(THREE);
  const dummySphereTex = buildDummySphereTex(THREE);
  const threeMaterials = [];
  let missingTextures = 0;

  for (const mat of parsed.materials) {
    geometry.addGroup(mat.indexOffset, mat.faceCount, threeMaterials.length);
    const texRel = mat.texIdx >= 0 ? parsed.textures[mat.texIdx] : '';
    let map = resolvedTextures.get(mat.name) || (texRel ? resolvedTextures.get(texRel) : null) || null;
    if (!map && texRel) {
      missingTextures++;
      const fbCanvas = buildVentiFallbackCanvas(mat.name, texRel, opt.createCanvas);
      if (fbCanvas) {
        map = new THREE.CanvasTexture(fbCanvas);
        map.colorSpace = THREE.SRGBColorSpace;
        map.flipY = true;
        map.needsUpdate = true;
      }
    }

    const toonRel = mat.toonFlag === 0 && mat.toonIdx >= 0 ? parsed.textures[mat.toonIdx] : '';
    const matToonTex = toonRel ? resolvedTextures.get(toonRel) || null : null;
    if (matToonTex) {
      matToonTex.wrapS = THREE.ClampToEdgeWrapping;
      matToonTex.wrapT = THREE.ClampToEdgeWrapping;
      matToonTex.colorSpace = THREE.SRGBColorSpace;
      matToonTex.needsUpdate = true;
    }

    const sphRel = mat.sphMode === 2 && mat.sphIdx >= 0 ? parsed.textures[mat.sphIdx] : '';
    const matSphTex = sphRel ? resolvedTextures.get(sphRel) || null : null;
    if (matSphTex) {
      matSphTex.wrapS = THREE.ClampToEdgeWrapping;
      matSphTex.wrapT = THREE.ClampToEdgeWrapping;
      matSphTex.colorSpace = THREE.NoColorSpace;
      matSphTex.needsUpdate = true;
    }

    const isExprDecal = mat.name === '表情' || /表情/i.test(texRel);
    const isEyeGlow = mat.name === '眼睛' || mat.name === '眼白';
    const profile = getPMXMaterialProfile(mat.name, {
      isExprDecal,
      matToonTex,
      defaultToonRamp,
      skinToonRamp,
      eyeToonRamp,
      hasSphere: Boolean(matSphTex),
    });

    const isSkinMat = mat.name === '脸' || mat.name === '皮肤';
    const baseColor = map
      ? (isSkinMat ? new THREE.Color(0.93, 0.89, 0.88) : new THREE.Color(1, 1, 1))
      : new THREE.Color(mat.diffuse[0], mat.diffuse[1], mat.diffuse[2]);

    const mOpts = {
      name: mat.name,
      color: baseColor,
      map,
      gradientMap: profile.toonMap,
      side: mat.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      transparent: isExprDecal || mat.diffuse[3] < 0.99,
      opacity: mat.diffuse[3],
      depthWrite: !isExprDecal && mat.diffuse[3] >= 0.99,
    };
    if (isExprDecal) {
      mOpts.alphaTest = 0.02;
      mOpts.polygonOffset = true;
      mOpts.polygonOffsetFactor = -2;
      mOpts.polygonOffsetUnits = -2;
      mOpts.opacity = 0;
    }
    if (isEyeGlow && map) {
      mOpts.emissive = new THREE.Color(0xffffff);
      mOpts.emissiveMap = map;
      mOpts.emissiveIntensity = 0.12;
    }

    const threeMat = new THREE.MeshToonMaterial(mOpts);
    const pmxUniforms = {
      uPmxToonMap: { value: profile.toonMap },
      uPmxSphereMap: { value: profile.hasSphere ? matSphTex : dummySphereTex },
      uPmxHasSphere: { value: profile.hasSphere ? 1.0 : 0.0 },
      uPmxSphereWeight: { value: profile.sphereWeight },
      uPmxSpecPower: { value: profile.specPower },
      uPmxSpecStrength: { value: profile.specStrength },
      uPmxRimStrength: { value: profile.rimStrength },
    };
    threeMat.userData.pmxUniforms = pmxUniforms;
    threeMat.customProgramCacheKey = () => 'pmx-cel-v1';
    threeMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, pmxUniforms);
      shader.fragmentShader = patchPMXToonFragmentShader(shader.fragmentShader);
    };
    threeMaterials.push(threeMat);
  }

  const mesh = new THREE.SkinnedMesh(geometry, threeMaterials);
  mesh.name = parsed.name || 'PMXMesh';
  mesh.frustumCulled = false;
  root.add(mesh);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(rawBones);
  mesh.bind(skeleton, new THREE.Matrix4());

  // —— 4. 构造 VRM 兼容的 Normalized Humanoid 骨架 ——
  const boneMap = mapPMXBones(parsed.bones);
  const normRoot = new THREE.Group();
  normRoot.name = 'NormalizedHumanoid';
  root.add(normRoot);

  const normNodes = Object.create(null);
  const normParents = {
    hips: null,
    spine: 'hips',
    chest: 'spine',
    upperChest: 'chest',
    neck: 'upperChest',
    head: 'neck',
    leftEye: 'head',
    rightEye: 'head',
    leftShoulder: 'upperChest',
    leftUpperArm: 'leftShoulder',
    leftLowerArm: 'leftUpperArm',
    leftHand: 'leftLowerArm',
    rightShoulder: 'upperChest',
    rightUpperArm: 'rightShoulder',
    rightLowerArm: 'rightUpperArm',
    rightHand: 'rightLowerArm',
    leftUpperLeg: 'hips',
    leftLowerLeg: 'leftUpperLeg',
    leftFoot: 'leftLowerLeg',
    leftToes: 'leftFoot',
    rightUpperLeg: 'hips',
    rightLowerLeg: 'rightUpperLeg',
    rightFoot: 'rightLowerLeg',
    rightToes: 'rightFoot',
  };
  for (const side of ['left', 'right']) {
    for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
      normParents[`${side}${f}Proximal`] = `${side}Hand`;
      normParents[`${side}${f}Intermediate`] = `${side}${f}Proximal`;
      normParents[`${side}${f}Distal`] = `${side}${f}Intermediate`;
    }
  }

  const findNormParent = (name) => {
    let p = normParents[name];
    while (p && !normNodes[p]) p = normParents[p];
    return p || null;
  };

  for (const name of HUMANOID_ORDER) {
    const rawIdx = boneMap[name];
    if (rawIdx === undefined) continue;
    const b = parsed.bones[rawIdx];
    const obj = new THREE.Object3D();
    obj.name = name;
    const pName = findNormParent(name);
    if (pName && normNodes[pName]) {
      const pPos = parsed.bones[boneMap[pName]].pos;
      obj.position.set(b.pos[0] - pPos[0], b.pos[1] - pPos[1], b.pos[2] - pPos[2]);
      normNodes[pName].add(obj);
    } else {
      obj.position.set(b.pos[0], b.pos[1], b.pos[2]);
      normRoot.add(obj);
    }
    normNodes[name] = obj;
  }

  const normHipsRest = normNodes.hips ? normNodes.hips.position.clone() : new THREE.Vector3();
  const rawHipsIdx = boneMap.hips;

  // —— 5. 骨骼同步（含 PMX 付与旋转 0x0100 与 D 骨/辅助骨传播） ——
  const IDENT = new THREE.Quaternion();
  const baseLocalQ = parsed.bones.map(() => new THREE.Quaternion());
  const effLocalQ = parsed.bones.map(() => new THREE.Quaternion());
  const worldQ = parsed.bones.map(() => new THREE.Quaternion());
  const worldState = new Int8Array(parsed.bones.length); // 0=未算, 1=算中, 2=已算
  const effState = new Int8Array(parsed.bones.length);
  const tmpQ1 = new THREE.Quaternion();
  const tmpQ2 = new THREE.Quaternion();
  const tmpW = new THREE.Quaternion();
  const normWorldQ = Object.create(null);

  // 筛选可安全加微风摆动的次级饰品骨（避免影响主躯干/四肢）
  const swayBones = [];
  for (let i = 0; i < parsed.bones.length; i++) {
    const nm = parsed.bones[i].name;
    if (/^(pf_\d+_[2-8]|zb_[2-9]|yb_[2-9]|ys[2-5]|M-ys[2-5])$/.test(nm)) {
      swayBones.push({
        idx: i,
        phase: (i * 0.73) % (Math.PI * 2),
        amp: nm.startsWith('pf_') ? 0.022 : 0.016,
        backBias: nm.startsWith('pf_') ? -0.04 : (nm.includes('ys') ? 0.025 : 0),
      });
    }
  }

  function getEffLocalQ(idx) {
    if (effState[idx] === 2) return effLocalQ[idx];
    if (effState[idx] === 1) return baseLocalQ[idx]; // 防循环
    effState[idx] = 1;
    const b = parsed.bones[idx];
    effLocalQ[idx].copy(baseLocalQ[idx]);
    if (b.appendRotate && b.appendParent >= 0 && b.appendParent < parsed.bones.length) {
      const src = getEffLocalQ(b.appendParent);
      scaleQuaternion(src, b.appendRatio, tmpQ1);
      effLocalQ[idx].multiply(tmpQ1);
    }
    effState[idx] = 2;
    return effLocalQ[idx];
  }

  function getWorldQ(idx) {
    if (worldState[idx] === 2) return worldQ[idx];
    if (worldState[idx] === 1) return IDENT;
    worldState[idx] = 1;
    const b = parsed.bones[idx];
    if (b.parent >= 0 && b.parent < parsed.bones.length) {
      worldQ[idx].copy(getWorldQ(b.parent)).multiply(getEffLocalQ(idx));
    } else {
      worldQ[idx].copy(getEffLocalQ(idx));
    }
    worldState[idx] = 2;
    return worldQ[idx];
  }

  let swayTime = 0;
  function syncHumanoidToPMX(dt = 0) {
    if (dt > 0) swayTime += dt;
    for (let i = 0; i < parsed.bones.length; i++) {
      baseLocalQ[i].identity();
      worldState[i] = 0;
      effState[i] = 0;
    }

    // 微弱自然垂坠风动（只做极小幅度正弦，不采用易炸飞的弹簧积分）
    if (swayTime > 0) {
      for (const s of swayBones) {
        const ax = s.backBias + Math.sin(swayTime * 1.35 + s.phase) * s.amp;
        const az = Math.cos(swayTime * 0.95 + s.phase) * s.amp * 0.6;
        baseLocalQ[s.idx].setFromEuler(new THREE.Euler(ax, 0, az));
      }
    }

    // 同步 hips 平移
    if (rawHipsIdx !== undefined && normNodes.hips) {
      rawBones[rawHipsIdx].position
        .copy(restLocalPos[rawHipsIdx])
        .add(normNodes.hips.position)
        .sub(normHipsRest);
    }

    // 自上而下把 Normalized 骨骼世界旋转写入 Raw PMX 骨骼
    for (const name of HUMANOID_ORDER) {
      const nNode = normNodes[name];
      const rawIdx = boneMap[name];
      if (!nNode || rawIdx === undefined) continue;
      const pName = findNormParent(name);
      const nw = pName && normWorldQ[pName]
        ? normWorldQ[pName].clone().multiply(nNode.quaternion)
        : nNode.quaternion.clone();
      normWorldQ[name] = nw;

      const b = parsed.bones[rawIdx];
      const pWorld = b.parent >= 0 ? getWorldQ(b.parent) : IDENT;
      tmpW.copy(pWorld).invert().multiply(nw);
      baseLocalQ[rawIdx].copy(tmpW);
      // 刷新当前节点及依赖它的后续骨骼缓存
      effState[rawIdx] = 0;
      worldState[rawIdx] = 0;
      getWorldQ(rawIdx);
    }

    // 最终写出全部有效局部四元数（含 `左足D`/`右足D`/`ひじ補助`/`腰キャンセル` 等）
    for (let i = 0; i < parsed.bones.length; i++) {
      rawBones[i].quaternion.copy(getEffLocalQ(i));
    }
    root.updateMatrixWorld(true);
  }

  // —— 6. 表情管理器（兼容 VRM expressionManager） ——
  const exprValues = Object.create(null);
  const resolvedRecipes = Object.create(null);
  for (const [vrmExpr, parts] of Object.entries(EXPR_RECIPES)) {
    const expanded = [];
    for (const [mName, w] of parts) {
      const m = morphByName.get(mName);
      if (!m) continue;
      if (m.type === 0) {
        for (const sub of m.offsets) {
          const sm = parsed.morphs[sub.morphIdx];
          if (sm && morphIndexByName.has(sm.name)) {
            expanded.push([morphIndexByName.get(sm.name), w * sub.ratio]);
          }
        }
      } else if (morphIndexByName.has(mName)) {
        expanded.push([morphIndexByName.get(mName), w]);
      }
    }
    if (expanded.length || vrmExpr === 'neutral') {
      resolvedRecipes[vrmExpr] = expanded;
      exprValues[vrmExpr] = 0;
    }
  }

  const blushIdx = morphIndexByName.get('照れ');
  const exprDecalMats = threeMaterials.filter((m) => m.name === '表情');

  function applyMorphs() {
    if (!mesh.morphTargetInfluences) return;
    mesh.morphTargetInfluences.fill(0);
    for (const [eName, weight] of Object.entries(exprValues)) {
      if (!weight) continue;
      const recipe = resolvedRecipes[eName];
      if (!recipe) continue;
      for (const [mIdx, factor] of recipe) {
        mesh.morphTargetInfluences[mIdx] = clamp(
          mesh.morphTargetInfluences[mIdx] + weight * factor,
          0,
          1,
        );
      }
    }
    if (blushIdx !== undefined) {
      const blushStrength = mesh.morphTargetInfluences[blushIdx];
      const showBlush = blushStrength > 0.18;
      mesh.morphTargetInfluences[blushIdx] = showBlush ? 1.0 : 0;
      for (const m of exprDecalMats) {
        m.opacity = showBlush ? clamp((blushStrength - 0.18) * 3.5, 0, 1) : 0;
      }
    }
  }

  const expressionManager = {
    expressionMap: resolvedRecipes,
    setValue(name, value) {
      if (!(name in resolvedRecipes)) return;
      exprValues[name] = clamp(Number(value) || 0, 0, 1);
      applyMorphs();
    },
    getValue(name) {
      return exprValues[name] ?? 0;
    },
  };

  const humanoid = {
    autoUpdateHumanBones: true,
    getNormalizedBoneNode(name) {
      return normNodes[name] || null;
    },
    getRawBoneNode(name) {
      const idx = boneMap[name];
      return idx !== undefined ? rawBones[idx] : null;
    },
    update() {
      syncHumanoidToPMX(0);
    },
  };

  syncHumanoidToPMX(0);

  return {
    isPMX: true,
    scene: root,
    mesh,
    parsed,
    boneMap,
    missingTextures,
    humanoid,
    expressionManager,
    springBoneManager: null,
    update(dt = 0) {
      syncHumanoidToPMX(dt);
    },
  };
}

// 异步加载器：支持 URL（如 `./jianmo/温迪.pmx`）及可选本地贴图 Map（文件名 -> ArrayBuffer/Blob）
export async function loadPMXAsVRM(THREE, modelUrl, { localTextures, createCanvas } = {}) {
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`加载 PMX 失败：HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const parsed = parsePMX(buf);

  const baseDir = modelUrl.startsWith('blob:')
    ? ''
    : modelUrl.replace(/[^/]*$/, '');
  const resolvedTextures = new Map();
  let preferFlat = false;

  async function loadOneTexture(texRel) {
    if (!texRel) return;
    const fileBase = texRel.split('/').pop();
    try {
      // 1) 若用户顺带选入了本地贴图文件，优先使用
      const localEntry =
        localTextures?.get?.(texRel) ||
        localTextures?.get?.(fileBase) ||
        localTextures?.get?.(fileBase?.toLowerCase?.());
      if (localEntry) {
        const blob = localEntry instanceof Blob ? localEntry : new Blob([localEntry]);
        const tex = await blobToTexture(THREE, blob);
        resolvedTextures.set(texRel, tex);
        return;
      }
      // 2) 从服务器相对路径拉取（支持 `Texture/xxx` 子目录或与 `.pmx` 同目录扁平存放）
      if (baseDir) {
        const nestedUrl = baseDir + texRel.split('/').map((s) => encodeURIComponent(s)).join('/');
        const flatUrl = fileBase && fileBase !== texRel ? baseDir + encodeURIComponent(fileBase) : null;
        const urls = preferFlat && flatUrl ? [flatUrl, nestedUrl] : flatUrl ? [nestedUrl, flatUrl] : [nestedUrl];
        let tex = null;
        for (let i = 0; i < urls.length; i++) {
          try {
            tex = await fetchTexture(THREE, urls[i]);
            if (tex) {
              if (!preferFlat && flatUrl && urls[i] === flatUrl) preferFlat = true;
              break;
            }
          } catch {
            /* 尝试下一个候选路径 */
          }
        }
        if (tex) {
          resolvedTextures.set(texRel, tex);
        }
      }
    } catch {
      // 外部贴图未放置时走 buildVentiFallbackCanvas 兜底
    }
  }

  // 先探测第一张带子目录的贴图：若直接放在 `.pmx` 同目录（如 `jianmo/脸.jpg`），其余贴图不再重复请求 `Texture/`
  const hasLocal = Boolean(localTextures && localTextures.size > 0);
  const firstIdx = parsed.textures.findIndex((t) => t && t.includes('/'));
  if (firstIdx >= 0 && !hasLocal) {
    await loadOneTexture(parsed.textures[firstIdx]);
  }
  await Promise.all(
    parsed.textures.map((texRel, idx) => (idx === firstIdx && !hasLocal ? null : loadOneTexture(texRel))),
  );

  return buildPMXVRM(THREE, parsed, resolvedTextures, { createCanvas });
}
