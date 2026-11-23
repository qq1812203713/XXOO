// 世界：一开始什么都没有。她种下的东西会按“真实时间”生长，
// 所以她离开多久、回来看到什么，都是同一个连续的世界。
import { clamp, rand, pick, uid } from '../core/util.js';

export const KINDS = {
  flower: { label: '花', grow: 90, hue: 338 },
  grass: { label: '草', grow: 25, hue: 158 },
  tree: { label: '树', grow: 900, hue: 285 },
  stone: { label: '石头', grow: 0, hue: 220 },
  lamp: { label: '光', grow: 0, hue: 44 },
};

const WORLD_RANGE = 210;

export function createWorld(saved) {
  const state = {
    objects: [],
    homeX: 0,
    totalCreated: 0,
    ...(saved || {}),
  };

  const now = () => Date.now();

  function plant(x, kind = 'flower') {
    const obj = {
      id: uid(),
      kind: KINDS[kind] ? kind : 'flower',
      x: clamp(x, -WORLD_RANGE, WORLD_RANGE),
      born: now(),
      size: rand(0.85, 1.15),
      seed: Math.random(),
    };
    state.objects.push(obj);
    state.totalCreated += 1;
    if (state.objects.length > 80) state.objects.shift();
    return obj;
  }

  function growth(obj, t = now()) {
    const k = KINDS[obj.kind] || KINDS.flower;
    if (!k.grow) return 1;
    return clamp((t - obj.born) / (k.grow * 1000), 0, 1);
  }

  // “自己优化世界”：把新东西摆在已有东西附近，形成她自己的秩序
  function preferredSpot(hintX) {
    if (state.objects.length < 2) return clamp(hintX + rand(-30, 30), -WORLD_RANGE, WORLD_RANGE);
    const near = state.objects[state.objects.length - 1];
    return clamp(near.x + rand(18, 34) * (Math.random() < 0.5 ? -1 : 1), -WORLD_RANGE, WORLD_RANGE);
  }

  function nearest(x) {
    let best = null;
    let bd = Infinity;
    for (const o of state.objects) {
      const d = Math.abs(o.x - x);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best ? { obj: best, dist: bd } : null;
  }

  // 把某个东西挪到靠近另一个东西的位置（世界变得更“有设计”）
  function arrange() {
    if (state.objects.length < 2) return null;
    const obj = pick(state.objects);
    const anchor = pick(state.objects.filter((o) => o !== obj));
    if (!anchor) return null;
    const target = clamp(anchor.x + (obj.x < anchor.x ? -22 : 22), -WORLD_RANGE, WORLD_RANGE);
    obj.x = obj.x + (target - obj.x) * 0.85;
    return { obj, anchor };
  }

  function tick() {
    // 世界不主动生长到模型里，渲染时按真实时间算；这里只清理过旧的杂物
    const t = now();
    if (state.objects.length > 60) {
      state.objects = state.objects.filter((o) => t - o.born < 86400000 * 14 || KINDS[o.kind].grow === 0);
    }
  }

  function summary() {
    const counts = {};
    for (const o of state.objects) counts[o.kind] = (counts[o.kind] || 0) + 1;
    return { total: state.objects.length, counts, totalCreated: state.totalCreated };
  }

  return { state, plant, growth, preferredSpot, nearest, arrange, tick, summary, KINDS, WORLD_RANGE };
}
