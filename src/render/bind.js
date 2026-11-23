// 骨骼 → Live2D 参数。
//
// 这一层是回答「骨骼和模型怎么真正接起来」的地方：
// 骨架里每一个关节解出来的角度/位移，都被翻译成模型能听懂的参数，
// 模型再根据自己的网格、蒙版、物理去变形。我们从不直接摆模型的顶点。
//
// 三条约定：
//   1. 只读骨骼解算结果（pose），不反过来影响身体——模型是输出端；
//   2. 任何一条映射都带增益和上下限，模型不会因为某个关节越界而拧成麻花；
//   3. 方向不确定的地方集中写成 SIGN_*，肉眼确认后改一个符号就能翻过来。

const DEG = 180 / Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// 手臂静息角：我们的约定是 a=0 朝上、顺时针为正，所以自然下垂 ≈ π
const ARM_REST = { L: Math.PI + 0.19, R: Math.PI - 0.15 };
const HEAD_REST = 0.03;

// 模型侧的正负号（Live2D 里 +Z 是往哪边歪，取决于模型画师，肉眼确认后改这里）
const SIGN = {
  angleZ: -1, // 我们的 +a 顺时针（往右歪）↔ 模型 ParamAngleZ
  bodyZ: -1,
  armL: -1,
  armR: -1,
  hand: 1,
};

const MOUTH_FORM = { calm: 0.35, happy: 1, shy: 0.45, curious: 0.5, sleepy: 0.1, sad: -0.8, startled: -0.3 };
const EYE_SMILE = { calm: 0.1, happy: 0.85, shy: 0.4, curious: 0.25, sleepy: 0.05, sad: 0, startled: 0 };
const BROW = { calm: 0, happy: 0.25, shy: 0.4, curious: 0.55, sleepy: -0.2, sad: 0.5, startled: 0.9 };

// 面板里要好读的名字
const LABELS = {
  head: '头骨',
  neck: '颈',
  chest: '胸',
  spine: '脊柱',
  handL: '左手',
  handR: '右手',
  armL: '左臂',
  armR: '右臂',
  face: '表情',
  breath: '呼吸',
};

export function createBinder() {
  const cur = Object.create(null);
  const get = (k, target, rate, dt, min, max) => {
    const from = cur[k] ?? target;
    cur[k] = clamp(damp(from, target, rate, dt), min, max);
    return cur[k];
  };

  const rows = [];
  let prevTilt = 0;
  let headVel = 0;

  /**
   * 每帧调用：把解算好的骨骼 + 表情 + 大脑状态压成 Live2D 参数。
   * 返回 { set(id, value) } 供渲染层写进模型。
   */
  function compute(pose, face, brain, dt) {
    const out = Object.create(null);
    rows.length = 0;
    if (!pose) return out;

    const bone = (id) => pose.get?.(id) || null;
    const head = bone('head');
    const neck = bone('neck');
    const chest = bone('chest');
    const spine2 = bone('spine2');
    const spine1 = bone('spine1');
    const pelvis = bone('pelvis');
    const armLU = bone('arm_L_upper');
    const armLF = bone('arm_L_fore');
    const armRU = bone('arm_R_upper');
    const armRF = bone('arm_R_fore');
    const handL = bone('hand_L');
    const handR = bone('hand_R');

    const f = face?.state || {};
    const mood = brain?.state?.mood || 'calm';
    const t = brain?.state?.t ?? 0;

    // —— 头：三轴。我们的骨架是 2D 的，能给出「歪」和「探出去」，
    //        偏航(yaw)用注意力方向补上 —— 所以她会「看着你在哪」。——
    const headTilt = wrap((head?.a ?? HEAD_REST) - HEAD_REST) + wrap(neck?.a ?? 0) * 0.45;
    const leanX = ((head?.x ?? 0) - (chest?.x ?? 0)) * 0.55;
    const gazeX = clamp((f.gazeX ?? 0) / 3, -1, 1);
    const gazeY = clamp((f.gazeY ?? 0) / 3, -1, 1);

    out.ParamAngleZ = get('az', SIGN.angleZ * headTilt * DEG * 0.62, 7, dt, -30, 30);
    out.ParamAngleX = get('ax', clamp(leanX * 2.2 + gazeX * 14, -30, 30), 5, dt, -30, 30);
    out.ParamAngleY = get('ay', clamp(-gazeY * 12 + (Math.sin(t * 0.7) * 1.2), -30, 30), 4, dt, -30, 30);

    // —— 躯干：脊柱链的累加角 → 身体三段 ——
    const bodyZ = wrap((chest?.a ?? 0) + (spine2?.a ?? 0) * 0.8 + (spine1?.a ?? 0) * 0.5);
    const upper = wrap((chest?.a ?? 0) - (spine1?.a ?? 0));
    out.ParamBodyAngleZ = get('bz', SIGN.bodyZ * bodyZ * DEG * 0.26, 5, dt, -10, 10);
    out.ParamBodyAngleX = get('bx', clamp(leanX * 0.8 + (pelvis ? (pelvis.x * 0.15) : 0), -10, 10), 4, dt, -10, 10);
    out.ParamBodyAngleY = get('by', clamp(-(head?.y ?? 0) * 0.02, -10, 10), 3, dt, -10, 10);
    out.ParamBodyUpper = get('bu', clamp(upper * DEG * -0.28, -10, 10), 4, dt, -10, 10);
    out.ParamBustY = get('bust', clamp(Math.sin(t * 1.35) * 0.15 + 0.1, -1, 1), 3, dt, -1, 1);

    // —— 手臂：肩=ParamArmLA，肘=ParamArmLB（0 直 … 5 全弯）——
    if (armLU && armRU) {
      const raiseL = wrap(ARM_REST.L - armLU.a); // 抬得越高越大
      const raiseR = wrap(ARM_REST.R - armRU.a);
      out.ParamArmLA = get('al', SIGN.armL * clamp(raiseL * 1.25, -1, 1), 8, dt, -1, 1);
      out.ParamArmRA = get('ar', SIGN.armR * clamp(raiseR * 1.25, -1, 1), 8, dt, -1, 1);

      const flexL = Math.abs(wrap((armLF?.a ?? armLU.a) - armLU.a));
      const flexR = Math.abs(wrap((armRF?.a ?? armRU.a) - armRU.a));
      out.ParamArmLB = get('alb', clamp(flexL / 1.5 * 5, 0, 5), 10, dt, 0, 5);
      out.ParamArmRB = get('arb', clamp(flexR / 1.5 * 5, 0, 5), 10, dt, 0, 5);

      if (handL) out.ParamHandAngleL = get('hl', SIGN.hand * clamp(wrap(handL.a - (armLF?.a ?? 0)) * 2.4, -1, 1), 10, dt, -1, 1);
      if (handR) out.ParamHandAngleR = get('hr', SIGN.hand * clamp(wrap(handR.a - (armRF?.a ?? 0)) * 2.4, -1, 1), 10, dt, -1, 1);
    }

    // —— 脸：眨眼、嘴型、眉毛、眼笑、泪 ——
    const blink = f.blink ?? 0;
    const open = clamp((f.eyeOpen ?? 1) * (1 - blink) * (1 - 0.5 * (f.drowsy || 0)), 0, 2);
    out.ParamEyeLOpen = get('el', open, 26, dt, 0, 2);
    out.ParamEyeROpen = get('er', open, 26, dt, 0, 2);
    out.ParamEyeBallX = get('ebx', clamp(gazeX * 0.9, -1, 1), 9, dt, -1, 1);
    out.ParamEyeBallY = get('eby', clamp(-gazeY * 0.7, -1, 1), 9, dt, -1, 1);
    out.ParamEyeLSmile = get('els', EYE_SMILE[mood] ?? 0, 4, dt, 0, 1);
    out.ParamEyeRSmile = out.ParamEyeLSmile;

    const brow = clamp(BROW[mood] ?? 0, -1, 1);
    out.ParamBrowLY = get('bly', brow, 4, dt, -1, 1);
    out.ParamBrowRY = out.ParamBrowLY;
    out.ParamBrowLAngle = get('bla', brow * 0.6, 4, dt, -1, 1);
    out.ParamBrowRAngle = out.ParamBrowLAngle;

    // 说话：嘴一张一合跟着音节
    const talking = brain?.state?.talking > 0 ? 1 : 0;
    const syllable = 0.5 + 0.5 * Math.sin(t * 18.7) * Math.sin(t * 4.3);
    out.ParamMouthOpenY = get('mo', clamp(talking * syllable * 0.95, 0, 1), 18, dt, 0, 1);
    out.ParamMouthForm = get('mf', MOUTH_FORM[mood] ?? 0.15, 4, dt, -1, 1);

    out.ParamTear = get('tear', mood === 'sad' ? 0.6 : 0, 1.5, dt, 0, 1);

    // 呼吸：脑干的节律，不是随便一个正弦
    const breath = brain?.state?.posture?.breath ?? 0.5 + 0.5 * Math.sin(t * 1.35);
    out.ParamBreath = get('br', clamp(breath, 0, 1), 3, dt, 0, 1);

    // 围巾/头发：跟着头的角速度甩（物理会再叠一层）
    const rawVel = (headTilt - prevTilt) / Math.max(dt, 0.001);
    prevTilt = headTilt;
    headVel = damp(headVel, rawVel, 6, dt);
    out.ParamScarf = get('scarf', clamp(headVel * 6, -1, 1), 4, dt, -1, 1);
    out.ParamHairFront = get('hf', clamp(headVel * 4, -1, 1), 5, dt, -1, 1);
    out.ParamHairSide = get('hs', clamp(headVel * 3, -1, 1), 5, dt, -1, 1);

    // —— 面板用：挑几条最能说明「骨骼在驱动模型」的 ——
    rows.push(
      { bone: LABELS.head, param: 'ParamAngleZ', value: `${out.ParamAngleZ.toFixed(1)}°` },
      { bone: LABELS.neck, param: 'ParamAngleY', value: `${out.ParamAngleY.toFixed(1)}°` },
      { bone: LABELS.armL, param: 'ParamArmLA', value: out.ParamArmLA?.toFixed(2) ?? '—' },
      { bone: LABELS.armR, param: 'ParamArmLB', value: out.ParamArmLB?.toFixed(2) ?? '—' },
      { bone: LABELS.handL, param: 'ParamHandAngleL', value: out.ParamHandAngleL?.toFixed(2) ?? '—' },
      { bone: LABELS.chest, param: 'ParamBodyAngleZ', value: `${out.ParamBodyAngleZ.toFixed(1)}°` },
      { bone: LABELS.face, param: 'ParamMouthOpenY', value: out.ParamMouthOpenY.toFixed(2) },
      { bone: LABELS.breath, param: 'ParamBreath', value: out.ParamBreath.toFixed(2) },
    );

    return out;
  }

  return { compute, rows };
}
