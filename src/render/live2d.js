// 二次元身体：把 Live2D（Cubism 4）模型接到大脑上。
//
// 分工没有变：大脑照旧只下达「想要」——注意力、情绪、呼吸、说话的嘴型，
// 这里把这些意图翻译成 Live2D 的参数（ParamAngleX/Y/Z、ParamEyeOpen、ParamMouthOpenY…）。
// 大脑依旧不下发任何关节角，模型自己决定肌肉怎么收缩。
//
// 全部文件都在本地 vendor/ 里，不联网、不依赖 CDN。加载失败就返回 null，
// 主程序会安静地退回到原来那具 2D 身体，不会白屏。

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

// 情绪 → 嘴型曲率（ParamMouthForm）
const MOUTH_FORM = { calm: 0.15, happy: 0.85, shy: 0.25, curious: 0.3, sleepy: -0.15, sad: -0.6, startled: -0.2 };

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

  // 大脑 → 模型参数：只有“想要”，没有关节角
  const now = { angleX: 0, angleY: 0, angleZ: 0, eye: 1, mouth: 0, form: 0, breath: 0 };
  let t = 0;
  let lastTouch = 0;
  let lastMood = null;
  let alpha = 0;
  let talkLevel = 0;

  model.internalModel.on('afterMotionUpdate', () => {
    set('ParamAngleX', now.angleX);
    set('ParamAngleY', now.angleY);
    set('ParamAngleZ', now.angleZ);
    set('ParamEyeLOpen', clamp(now.eye, 0, 1));
    set('ParamEyeROpen', clamp(now.eye, 0, 1));
    set('ParamEyeBallX', clamp(now.angleX / 30, -1, 1));
    set('ParamEyeBallY', clamp(-now.angleY / 30, -1, 1));
    set('ParamMouthOpenY', clamp(now.mouth, 0, 1));
    set('ParamMouthForm', clamp(now.form, -1, 1));
    set('ParamBrowLY', clamp(now.form * 0.6, -1, 1));
    set('ParamBrowRY', clamp(now.form * 0.6, -1, 1));
    set('ParamBreath', now.breath);
    set('ParamBodyAngleX', clamp(now.angleX * 0.25, -10, 10));
    set('ParamBodyAngleZ', clamp(now.angleZ * 0.3, -10, 10));
  });

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

  function sync(brain, face, dt) {
    t += dt;
    const pose = brain.state.pose;
    const head = pose?.get?.('head');
    const chest = pose?.get?.('chest');
    const f = face?.state || {};
    const mood = brain.state.mood || 'calm';

    const gazeX = clamp((f.gazeX || 0) / 3, -1, 1);
    const gazeY = clamp((f.gazeY || 0) / 3, -1, 1);

    now.angleX = damp(now.angleX, gazeX * 26, 5, dt);
    now.angleY = damp(now.angleY, -gazeY * 20, 5, dt);
    now.angleZ = damp(now.angleZ, clamp(-(head?.a || 0) * 34, -26, 26), 6, dt);

    const blinking = f.blink || 0;
    const open = clamp((f.eyeOpen ?? 1) * (1 - blinking) * (1 - 0.45 * (f.drowsy || 0)), 0, 1);
    now.eye = damp(now.eye, open, 22, dt);

    // 说话时嘴形跟着音节起伏
    talkLevel = damp(talkLevel, brain.state.talking > 0 ? 1 : 0, 8, dt);
    const syllable = 0.5 + 0.5 * Math.sin(t * 17.3) * Math.sin(t * 5.1);
    now.mouth = clamp(talkLevel * syllable * 0.9 + (mood === 'happy' ? 0.1 : 0), 0, 1);
    now.form = damp(now.form, MOUTH_FORM[mood] ?? 0.15, 4, dt);
    now.breath = 0.5 + 0.5 * Math.sin(t * 1.35);

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
