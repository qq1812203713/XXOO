// 骨架：一个 2D 视图中的人形骨骼树。
// 每个关节只知道自己相对于「父关节」的偏移与角度——这正是“每个趾头一个脚本”能够成立的前提：
// 大脑永远不需要操作 60 个关节，它只需要说“我想靠近你”，下面的运动程序自己把这件事分解到每根指骨。

export const FINGERS = [
  { name: 'thumb', dx: -4.8, dy: 2.0, segs: [4.4, 3.4], rest: [-0.9, -0.25], bend: [0.45, 0.6] },
  { name: 'index', dx: -2.9, dy: 5.4, segs: [4.3, 3.1, 2.2], rest: [-0.15, 0.05, 0.08], bend: [0.5, 0.7, 0.45] },
  { name: 'middle', dx: -1.0, dy: 5.8, segs: [4.7, 3.4, 2.4], rest: [-0.04, 0.03, 0.07], bend: [0.52, 0.72, 0.45] },
  { name: 'ring', dx: 1.0, dy: 5.5, segs: [4.3, 3.1, 2.2], rest: [0.07, 0.03, 0.07], bend: [0.5, 0.7, 0.45] },
  { name: 'pinky', dx: 2.7, dy: 4.8, segs: [3.6, 2.6, 1.9], rest: [0.19, 0.04, 0.07], bend: [0.45, 0.65, 0.4] },
];

export const TOES = [
  { name: 'big', dx: -3.6, segs: [3.0, 2.1], rest: [0.02, 0.0] },
  { name: 'second', dx: -1.7, segs: [2.7, 1.9], rest: [0.1, 0.0] },
  { name: 'third', dx: 0.3, segs: [2.4, 1.7], rest: [0.18, 0.0] },
  { name: 'fourth', dx: 2.1, segs: [2.1, 1.5], rest: [0.26, 0.0] },
  { name: 'little', dx: 3.6, segs: [1.8, 1.2], rest: [0.34, 0.0] },
];

export const GROUND_Y = 70; // 世界坐标里地面的高度（脚底）

export function buildRig() {
  const joints = Object.create(null);
  const order = [];

  function add(id, parent, spec = {}) {
    const rest = spec.rest ?? 0;
    const limit = spec.limit ?? 2.6;
    const j = {
      id,
      parent,
      dx: spec.dx ?? 0,
      dy: spec.dy ?? 0,
      rest,
      local: rest,
      target: rest,
      vel: 0,
      limit,
      min: rest - limit,
      max: rest + limit,
      stiff: spec.stiff ?? 400,
      slew: spec.slew ?? 9,
      group: spec.group ?? 'body',
      side: spec.side ?? null,
      depth: parent ? joints[parent].depth + 1 : 0,
      tip: spec.tip || 0,
    };
    joints[id] = j;
    order.push(id);
    return j;
  }

  // —— 躯干：从骨盆向上 —— //
  add('pelvis', null, { group: 'torso' });
  joints.pelvis.x = 0;
  joints.pelvis.y = 0;
  add('spine1', 'pelvis', { dy: 17, limit: 0.22, stiff: 210, group: 'torso' });
  add('spine2', 'spine1', { dy: 16, rest: 0.018, limit: 0.2, stiff: 210, group: 'torso' });
  add('chest', 'spine2', { dy: 15, limit: 0.16, stiff: 210, group: 'torso' });
  add('neck', 'chest', { dy: 4, limit: 0.34, stiff: 260, group: 'head' });
  add('head', 'neck', { dy: 11, rest: 0.03, limit: 0.42, stiff: 260, group: 'head' });

  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;

    // —— 手臂 —— //
    add(`arm_${side}_upper`, 'chest', {
      dx: s * 16.2,
      dy: -2.5,
      rest: Math.PI - s * (s < 0 ? 0.19 : 0.15),
      limit: 2.85,
      stiff: 240,
      group: 'arm',
      side,
    });
    add(`arm_${side}_fore`, `arm_${side}_upper`, {
      dy: 23,
      rest: -s * 0.1,
      limit: 2.45,
      stiff: 240,
      group: 'arm',
      side,
    });

    // —— 手 —— //
    add(`hand_${side}`, `arm_${side}_fore`, {
      dy: 20,
      rest: 0,
      limit: 1.5,
      stiff: 300,
      group: 'hand',
      side,
    });

    for (const f of FINGERS) {
      const n = f.segs.length;
      for (let i = 0; i < n; i++) {
        const id = `${side}_${f.name}_${i}`;
        const parent = i === 0 ? `hand_${side}` : `${side}_${f.name}_${i - 1}`;
        add(id, parent, {
          dx: i === 0 ? s * f.dx : 0,
          dy: i === 0 ? f.dy : f.segs[i - 1],
          rest: s * f.rest[i] + (i === 0 ? 0 : 0),
          limit: i === 0 ? 1.1 : 1.25,
          stiff: 420,
          slew: 14,
          group: 'finger',
          side,
          tip: i === n - 1 ? f.segs[i] : 0,
        });
      }
    }

    // —— 腿 —— //
    add(`leg_${side}_thigh`, 'pelvis', {
      dx: s * 9,
      dy: -4,
      rest: Math.PI + s * 0.045,
      limit: 1.75,
      stiff: 260,
      group: 'leg',
      side,
    });
    add(`leg_${side}_shin`, `leg_${side}_thigh`, {
      dy: 33,
      rest: s < 0 ? -0.02 : 0.05,
      limit: 1.5,
      stiff: 280,
      group: 'leg',
      side,
    });
    add(`foot_${side}`, `leg_${side}_shin`, {
      dy: 30,
      rest: 0,
      limit: 0.85,
      stiff: 300,
      group: 'foot',
      side,
    });

    for (const t of TOES) {
      const n = t.segs.length;
      for (let i = 0; i < n; i++) {
        const id = `${side}_toe_${t.name}_${i}`;
        const parent = i === 0 ? `foot_${side}` : `${side}_toe_${t.name}_${i - 1}`;
        add(id, parent, {
          dx: i === 0 ? s * t.dx : 0,
          dy: i === 0 ? 5.2 : t.segs[i - 1],
          rest: -s * t.rest[i],
          limit: i === 0 ? 0.8 : 0.9,
          stiff: 460,
          slew: 16,
          group: 'toe',
          side,
          tip: i === n - 1 ? t.segs[i] : 0,
        });
      }
    }
  }

  return { joints, order, root: 'pelvis', groundY: GROUND_Y };
}

// 一次性解算整棵树：返回 id -> {x, y, a, sx, sy, len}
// 关节角度约定：a = 0 指向上方，角度增大顺时针；dir = (sin a, -cos a)
export function solvePose(rig, out = new Map()) {
  const { joints, order } = rig;
  const root = joints.pelvis;
  out.set('pelvis', { x: root.x, y: root.y, a: 0, sx: 0, sy: -1, len: 0 });

  for (let i = 1; i < order.length; i++) {
    const id = order[i];
    const j = joints[id];
    const p = out.get(j.parent);
    const a = p.a + j.local;
    // 自身方向
    const sx = Math.sin(a);
    const sy = -Math.cos(a);
    // 偏移量表达在「父关节」的坐标系里
    const px = Math.cos(p.a);
    const py = Math.sin(p.a);
    out.set(id, {
      x: p.x + sx * j.dy + px * j.dx,
      y: p.y + sy * j.dy + py * j.dx,
      a,
      sx,
      sy,
      len: Math.hypot(j.dx, j.dy),
    });
  }
  return out;
}

// 便利查询：给 UI / 大脑用的部件中心点
export function bodyAnchors(pose) {
  const g = (id) => pose.get(id) || { x: 0, y: 0 };
  return {
    head: g('head'),
    chest: g('chest'),
    pelvis: g('pelvis'),
    handL: g('hand_L'),
    handR: g('hand_R'),
    footL: g('foot_L'),
    footR: g('foot_R'),
    kneeL: g('leg_L_shin'),
    kneeR: g('leg_R_shin'),
  };
}
