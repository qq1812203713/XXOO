// 二次元身体：把 Live2D（Cubism 4）模型接到大脑上。
//
// 分工没有变：大脑照旧只下达「想要」——注意力、情绪、呼吸、说话的嘴型，
// 这里把这些意图翻译成 Live2D 的参数（ParamAngleX/Y/Z、ParamEyeOpen、ParamMouthOpenY…）。
// 大脑依旧不下发任何关节角，模型自己决定肌肉怎么收缩。
//
// 全部文件都在本地 vendor/ 里，不联网、不依赖 CDN。加载失败就返回 null，
// 主程序会安静地退回到原来那具 2D 身体，不会白屏。

import { createBinder } from './bind.js';

const VENDOR = './vendor/';

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
    return !!(gl && typeof gl.createTexture === 'function' && typeof gl.createBuffer === 'function');
  } catch {
    return false;
  }
}

function loadScript(src, timeout = 15000) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-vendor="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.dataset.vendor = src;
    const timer = setTimeout(() => reject(new Error(`加载超时：${src}`)), timeout);
    s.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`加载失败：${src}`));
    };
    document.head.appendChild(s);
  });
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export async function createAnimeBody({ canvas, modelUrl, onStatus }) {
  if (!canvas) throw new Error('没有给画布');
  if (!hasWebGL()) return null;

  onStatus?.('正在唤醒模型…');
  await loadScript(VENDOR + 'live2dcubismcore.min.js');
  await loadScript(VENDOR + 'pixi.min.js');
  await loadScript(VENDOR + 'cubism4.min.js');

  const PIXI = window.PIXI;
  if (!PIXI || !PIXI.live2d || !PIXI.live2d.Live2DModel) throw new Error('Live2D 插件没有就位');

  const W = () => canvas.clientWidth || window.innerWidth || 1;
  const H = () => canvas.clientHeight || window.innerHeight || 1;

  const app = new PIXI.Application({
    view: canvas,
    width: W(),
    height: H(),
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    powerPreference: 'high-performance',
  });

  const model = await PIXI.live2d.Live2DModel.from(modelUrl, { autoInteract: false, autoUpdate: true });
  app.stage.addChild(model);

  // 模型自带的尺寸（scale = 1 时）
  const baseW = model.width || 1;
  const baseH = model.height || 1;

  const core = model.internalModel.coreModel;
  const hasParam = (id) => {
    try {
      return core.getParameterIndex(id) >= 0;
    } catch {
      return false;
    }
  };
  const set = (id, v) => {
    if (hasParam(id)) core.setParameterValueById(id, v);
  };

  // 骨骼 → 参数：bind.js 负责翻译，这里只负责写进模型
  const binder = createBinder();
  let params = Object.create(null);
  // 这几个参数模型自带的 idle 动作也在动。全盖会让她的手臂变成棍子，
  // 所以按比例混：七成听骨骼的，三成留给模型自己的小动作。
  const BLEND = new Set([
    'ParamArmLA', 'ParamArmRA', 'ParamArmLB', 'ParamArmRB',
    'ParamHandAngleL', 'ParamHandAngleR', 'ParamBodyUpper',
    'ParamScarf', 'ParamHairFront', 'ParamHairSide',
  ]);
  const read = (id) => {
    try {
      return core.getParameterValueById(id);
    } catch {
      return 0;
    }
  };
  const applyParams = () => {
    for (const k in params) {
      if (!hasParam(k)) continue;
      const v = BLEND.has(k) ? read(k) * 0.3 + params[k] * 0.7 : params[k];
      core.setParameterValueById(k, v);
    }
  };
  let t = 0;
  let lastTouch = 0;
  let lastMood = null;
  let alpha = 0;
  let bindTick = 0;
  let bindEl = null;

  // 顺序很关键：动作/表情先算完 → 我们把骨骼映射的参数盖上去 → 物理与求解 → 绘制
  model.internalModel.on('afterMotionUpdate', applyParams);

  function layout() {
    const w = W();
    const h = H();
    if (app.renderer.width !== w || app.renderer.height !== h) app.renderer.resize(w, h);
    // 以「让她占满竖屏的 0.94 高」为基准，同时不许横向溢出
    const k = Math.min((h * 0.94) / baseH, (w * 0.98) / baseW);
    model.scale.set(k);
    model.anchor.set(0.5, 0.5);
    model.position.set(w * 0.5, h * 0.5 + baseH * k * 0.02);
  }
  layout();

  // 神经面板里那几行字：让「骨骼 → 参数」这件事看得见
  function paintBindPanel() {
    if (!bindEl) bindEl = document.getElementById('bind-list');
    if (!bindEl) return;
    const panel = document.getElementById('nerves');
    if (!panel || panel.hidden) return;
    const rows = binder.rows;
    if (!rows.length) return;
    bindEl.hidden = false;
    bindEl.textContent = '';
    for (const r of rows) {
      const line = document.createElement('div');
      line.className = 'bind-row';
      line.innerHTML = `<span class="bind-bone">${r.bone}</span><span class="bind-arrow">→</span><span class="bind-param">${r.param}</span><span class="bind-val">${r.value}</span>`;
      bindEl.appendChild(line);
    }
  }

  function sync(brain, face, dt) {
    t += dt;

    // ① 骨骼解算结果 → 42 个模型参数（真正的“接起来”在这一行）
    params = binder.compute(brain.state.pose, face, brain, dt);
    applyParams();

    const mood = brain.state.mood || 'calm';

    // 被戳 → 播一个反应动作（她自己的运动程序，不是我们摆的姿势）
    const touch = brain.state.stats?.touches || 0;
    if (touch > lastTouch) {
      lastTouch = touch;
      try {
        model.motion('Tap');
      } catch {
        /* 没有这组动作就算了 */
      }
    }

    // 面板里那几行“骨骼 → 参数”，实时刷
    bindTick++;
    if (bindTick % 8 === 0) paintBindPanel();

    // 换情绪时换表情（模型自带 8 套，失败就跳过）
    if (mood !== lastMood) {
      lastMood = mood;
      const map = { calm: 0, happy: 1, shy: 2, curious: 3, sleepy: 4, sad: 5, startled: 6 };
      try {
        model.expression(map[mood] ?? 0);
      } catch {
        /* ignore */
      }
    }

    // 出场淡入
    alpha = damp(alpha, 1, 2.2, dt);
    model.alpha = alpha;

    layout();
  }

  return {
    model,
    app,
    sync,
    resize: layout,
    destroy() {
      try {
        app.destroy(true, { children: true });
      } catch {
        /* ignore */
      }
    },
  };
}
