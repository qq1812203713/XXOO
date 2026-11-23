// 组装：把身体、神经、驱力、记忆、世界、渲染和 UI 接起来。
// 这个文件里没有任何“行为逻辑”——它只负责让这些东西同时活着。
import { createStore } from './core/store.js';
import { createLog, clamp } from './core/util.js';
import { buildRig } from './body/skeleton.js';
import { createServos } from './body/servo.js';
import { createMotors } from './body/motors/index.js';
import { createDrives } from './brain/drives.js';
import { createMemory } from './memory/memory.js';
import { createWorld } from './world/world.js';
import { createSpinal } from './brain/spinal.js';
import { createCortex } from './brain/cortex.js';
import { createBrain } from './brain/brain.js';
import { createRenderer } from './render/renderer.js';
import { createUI } from './ui/ui.js';
import { hasWebGL } from './render/gl.js';
import { createAnimeBody } from './render/live2d.js';
import { create3DBody, MODELS, MODEL_ORDER } from './render/vrm.js';

// 把浏览器里的错误回传到服务器日志：我看日志就等于看控制台
let reported = 0;
function reportToServer(msg, level = 'error') {
  if (reported++ > 12) return;
  try {
    fetch('./log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, msg: String(msg).slice(0, 900) }),
    }).catch(() => {});
  } catch {
    /* 断网就算了 */
  }
}
window.addEventListener('error', (e) => reportToServer(`${e.message} @${e.filename}:${e.lineno}`, 'error'));
window.addEventListener('unhandledrejection', (e) =>
  reportToServer(`unhandled: ${e.reason && e.reason.stack ? e.reason.stack : e.reason}`, 'reject'),
);

// 任何未捕获的错误都直接写在屏幕上，而不是留一个黑屏让人猜
function showFatal(message) {
  if (window.__report) {
    window.__report(message);
    return;
  }
  let el = document.getElementById('fatal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fatal';
    el.className = 'fatal';
    document.body.appendChild(el);
  }
  el.textContent = `出错了：${message}`;
  el.hidden = false;
}
window.addEventListener('error', (e) => showFatal(e.message || '脚本加载失败'));
window.addEventListener('unhandledrejection', (e) => showFatal(String(e.reason && e.reason.message ? e.reason.message : e.reason)));

const STORAGE_KEY = 'xxoo.life.v1';
const canvas = document.getElementById('stage');

const store = createStore(STORAGE_KEY);
const saved = store.load() || {};
const log = createLog(60);

// —— 身体 ——
const rig = buildRig();
const servos = createServos(rig);
const motors = createMotors({ rig, servos, log });

// —— 内在 ——
const drives = createDrives(saved.drives);
const memory = createMemory(saved.memory);
const world = createWorld(saved.world);
const spinal = createSpinal();
const cortex = createCortex({ settings: saved.settings?.llm, log });
const brain = createBrain({ rig, servos, motors, drives, memory, world, spinal, cortex, log });

// —— 表现 ——
const renderer = createRenderer(canvas);

function saveState() {
  store.save({
    v: 1,
    savedAt: Date.now(),
    lastSeen: Date.now(),
    rootX: brain.state.root.x,
    drives: drives.snapshot(),
    memory: memory.state,
    world: world.state,
    settings: {
      llm: {
        enabled: cortex.cfg.enabled,
        baseUrl: cortex.cfg.baseUrl,
        model: cortex.cfg.model,
        key: cortex.cfg.key,
      },
    },
  });
}

const ui = createUI({
  getBody: () => body3d,
  rig,
  brain,
  drives,
  world,
  memory,
  motors,
  cortex,
  renderer,
  log,
  onSave: saveState,
  onReset: () => {
    store.clear();
    try {
      localStorage.removeItem('xxoo.intro');
    } catch {
      /* ignore */
    }
    location.reload();
  },
});

// —— 恢复 ——
if (typeof saved.rootX === 'number' && Number.isFinite(saved.rootX)) {
  brain.state.root.x = saved.rootX;
  brain.state.root.targetX = saved.rootX;
  renderer.cam.x = saved.rootX;
  renderer.cam.targetX = saved.rootX;
}
if (saved.memory?.lastSeen) memory.state.lastSeen = saved.memory.lastSeen;

function handleAway(ms) {
  if (ms < 45 * 1000) return;
  drives.applyOffline(ms);
  memory.offlineEpisodes(ms, { plants: world.state.objects.length });
  memory.counts.visits = (memory.counts.visits || 0) + 1;
  brain.greetReturn(ms);
  log.push({ layer: 'cortex', motor: 'life', text: `你离开了 ${Math.round(ms / 60000)} 分钟，她一直在。` });
}

if (saved.lastSeen) handleAway(Date.now() - saved.lastSeen);

// —— 身体：3D VRM 优先，Live2D 次之，最后退回 2D 骨架 ——
// 加载慢、要 WebGL，所以不阻塞主循环；失败就顺着往下退，屏幕上不留白。
let anime = null; // Live2D
let body3d = null; // VRM
const girlCanvas = document.getElementById('girl');
const girl3dCanvas = document.getElementById('girl3d');
const bodyMode = (() => {
  try {
    const q = new URLSearchParams(location.search);
    const f = new URLSearchParams(globalThis.__XXOO_FLAGS__ || '');
    return q.get('body') || f.get('body') || null; // ?body=2d|live2d|vrm（.flags 里也能写，方便我自己看 2D 那层）
  } catch {
    return null;
  }
})();
const bodyErrors = [];

function markAwake(label) {
  const d = document.getElementById('intro-diag');
  if (d && window.__booted) d.textContent = `已醒来 · ${label} · 点任意处进去`;
}

let last3DFail = '';

// ————— 换建模 —————
// 都是 VRM 标准骨架，动作/手指/表情那一整套直接通用，换的只是“皮”。
const MODEL_KEY = 'xxoo.model';
function currentModelKey() {
  try {
    const q = new URLSearchParams(location.search);
    const f = new URLSearchParams(globalThis.__XXOO_FLAGS__ || '');
    const asked = q.get('model') || f.get('model');
    if (asked && MODELS[asked]) {
      globalThis.localStorage?.setItem(MODEL_KEY, asked);
      return asked;
    }
    const saved = globalThis.localStorage?.getItem(MODEL_KEY);
    if (saved && MODELS[saved]) return saved;
  } catch {
    /* 隐私模式 */
  }
  return 'alicia';
}
const modelKey = currentModelKey();
const MODEL_SELECT_TITLE = (k) => `${MODELS[k]?.cn || k} · ${MODELS[k]?.note || ''}`;

function showBodyHint() {
  const el = document.getElementById('bodyhint');
  if (!el) return;
  if (body3d) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = last3DFail
    ? `这具身体没起来（${last3DFail}）· 只剩这张地图 · 碰一下屏幕会再试`
    : '正在把她的身体接上来…';
}

async function tryBoot3D() {
  if (body3d) return true;
  try {
    const boot = (key) =>
      create3DBody({
        canvas: girl3dCanvas,
        modelUrl: MODELS[key].url,
        onStatus: (msg) => {
          const el = document.getElementById('ver');
          if (el) el.dataset.status = msg;
        },
      });
    let body = null;
    try {
      body = await boot(modelKey);
    } catch (err) {
      // 存档里那具身体已经不在 vendor/ 了（比如换过名单）—— 别让她掉回 2D，换成默认那具重来
      if (modelKey !== 'alicia') {
        reportToServer(`建模 ${modelKey} 加载失败，换回默认：${err && err.message}`, 'model');
        try {
          globalThis.localStorage?.setItem(MODEL_KEY, 'alicia');
        } catch {
          /* ignore */
        }
        body = await boot('alicia');
      } else {
        throw err;
      }
    }
    if (!body) {
      // 这里以前是静默失败 —— 直接掉回 2D，谁也不知道为什么
      last3DFail = `hasWebGL=${hasWebGL() ? 'yes' : 'no'}`;
      reportToServer(`3D 没起来：${last3DFail}`, 'boot3d');
      showBodyHint();
      return false;
    }
    body3d = body;
    document.getElementById('faceview')?.addEventListener('click', () => {
      if (!body3d) return;
      const on = body3d.setFaceView(!body3d.faceView);
      document.getElementById('faceview')?.classList.toggle('on', !!on);
      hudNote(on ? '推近 · 看她的脸' : '退回全身');
    });
    // 换身体：下拉选择，选中就换
    const modelSel = document.getElementById('model');
    if (modelSel) {
      modelSel.innerHTML = MODEL_ORDER.map(
        (k) => `<option value="${k}">${MODELS[k]?.cn || k}</option>`,
      ).join('');
      modelSel.value = modelKey;
      const opt = modelSel.querySelector(`option[value="${modelKey}"]`);
      modelSel.title = opt ? MODEL_SELECT_TITLE(modelKey) : '换一具身体';
      modelSel.addEventListener('change', () => {
        const next = modelSel.value;
        try {
          globalThis.localStorage?.setItem(MODEL_KEY, next);
        } catch {
          /* ignore */
        }
        hudNote(`换身体 · ${MODELS[next]?.cn || next}（重新加载中）`);
        setTimeout(() => location.reload(), 360);
      });
    }
    document.getElementById('flip')?.addEventListener('click', () => {
      const deg = body3d?.turnBody?.(180);
      hudNote(Number.isFinite(deg) ? `转身 → 朝 ${((deg * 180) / Math.PI).toFixed(0)}°` : '转身了');
    });
    if (typeof renderer.setBodyVisible === 'function') renderer.setBodyVisible(false);
    girlCanvas?.classList.remove('on'); // 3D 起来就把 2D / Live2D 那层彻底关掉
    girl3dCanvas?.classList.add('on');
    last3DFail = '';
    showBodyHint();
    // ?face=1（或写在 .flags 里）：一进来就是看脸模式，方便我自己核对细节
    try {
      const f = new URLSearchParams([location.search.replace(/^\?/, ''), globalThis.__XXOO_FLAGS__ || ''].filter(Boolean).join('&'));
      const act = f.get('act');
      if (act) {
        body3d.play(act);
        const at = f.get('at');
        if (at != null) body3d.freezeAt(act, parseFloat(at) || 0); // 自检：钉在某一帧
        else setInterval(() => body3d?.play(act), 4200); // 自检：一直重播，方便我抓帧
      }
      const mood = f.get('mood');
      if (mood) body3d.setMoodOverride(mood);
      const faceFlag = f.get('face');
      if (faceFlag === '1' || faceFlag === '0') {
        const want = faceFlag === '1';
        body3d.setFaceView(want);
        document.getElementById('faceview')?.classList.toggle('on', want);
        setInterval(() => body3d?.setFaceView(want), 4000); // 自检：钉住看脸/全身
      }
    } catch {
      /* ignore */
    }
    setTimeout(resizeAll, 150); // 3D 起来之后按真实可用高度重排一次（输入框会占掉底部）
    markAwake('3D 身体（VRM）');
    setTimeout(startSnapshots, 900);
    setTimeout(() => {
      try {
        const st = body3d?.debugState?.() ?? {};
        st.llm = { on: cortex.shouldUseLLM(), busy: cortex.busy, err: cortex.lastError, cfg: { base: cortex.cfg.baseUrl, model: cortex.cfg.model } };
        st.goal = brain?.state?.goal?.type || 'idle';
        st.bodyWish = brain?.state?.bodyWish?.clip || null;
        reportToServer(JSON.stringify(st), 'state');
      } catch (err) {
        reportToServer(`state failed: ${err}`, 'state');
      }
    }, 2500);
    setInterval(() => {
      try {
        const st = body3d?.debugState?.() ?? {};
        st.llm = { on: cortex.shouldUseLLM(), busy: cortex.busy, err: cortex.lastError, base: cortex.cfg.baseUrl, model: cortex.cfg.model, keyLen: (cortex.cfg.key || '').length };
        st.goal = brain?.state?.goal?.type || 'idle';
        st.bodyWish = brain?.state?.bodyWish?.clip || null;
        st.mood = brain?.state?.mood || '';
        reportToServer(JSON.stringify(st), 'state');
      } catch {
        /* ignore */
      }
    }, 6000);
    log.push({ layer: 'render', motor: 'body', text: '换上了 3D 身体：VRM / Alicia。' });
    return true;
  } catch (err) {
    const msg = `3D：${err && err.stack ? err.stack : err}`;
    bodyErrors.push(msg);
    last3DFail = `hasWebGL=${hasWebGL() ? 'yes' : 'no'} · ${String(err && err.message ? err.message : err).slice(0, 46)}`;
    reportToServer(msg, 'boot3d');
    showBodyHint();
    return false;
  }
}

async function bootBody() {
  if (bodyMode !== '2d' && bodyMode !== 'live2d') {
    if (await tryBoot3D()) return;
  }

  if (bodyMode !== '2d') {
    try {
      anime = await createAnimeBody({
        canvas: girlCanvas,
        modelUrl: './vendor/model/haru/haru_greeter_t03.model3.json',
      });
      if (anime) {
        if (typeof renderer.setBodyVisible === 'function') renderer.setBodyVisible(false);
        girlCanvas?.classList.add('on');
        markAwake('Live2D 模型');
        log.push({ layer: 'render', motor: 'body', text: '换上了 Live2D 模型（Haru）。' });
        return;
      }
    } catch (err) {
      const msg = `Live2D：${err && err.stack ? err.stack : err}`;
      bodyErrors.push(msg);
      reportToServer(msg, 'bootlive2d');
    }
  }

  if (bodyErrors.length) {
    window.__report?.(`身体的 3D / Live2D 都没起来，继续用 2D 骨架：\n  ${bodyErrors.join('\n  ')}`);
  }

  // 手机上很常见：页面在后台/被遮住时 WebGL 拿不到上下文。所以等它回到前台、
  // 或者用户碰一下，再试一次 3D —— 成功就自动把 2D 那层换掉，不需要人刷新。
  setTimeout(startSnapshots, 900);
  showBodyHint();
  if (bodyMode === '2d') renderer.setBodyVisible(true); // 只有我自检时才会看这具 2D 假身体

  if (!body3d) {
    let retrying = false;
    const retry = async () => {
      if (body3d || retrying || document.hidden) return;
      retrying = true;
      const ok = await tryBoot3D();
      retrying = false;
      if (!ok) reportToServer('3D 重试后仍然没起来', 'boot3d');
    };
    document.addEventListener('visibilitychange', retry);
    window.addEventListener('pointerdown', retry);
    setTimeout(retry, 2500);
    setTimeout(retry, 9000);
    // 一直试，直到把她接上来为止（最多 12 次，之后只在碰屏幕/回前台时试）
    let tries = 0;
    const iv = setInterval(() => {
      if (body3d) {
        clearInterval(iv);
        return;
      }
      if (++tries > 12) clearInterval(iv);
      retry();
    }, 3500);
  }
}

bootBody();

// —— 窗口 ——
let visibleAt = Date.now();
function resizeAll() {
  renderer.resize();
  anime?.resize();
  body3d?.resize();
}
window.addEventListener('resize', resizeAll);
window.addEventListener('orientationchange', () => setTimeout(resizeAll, 180));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    visibleAt = Date.now();
    saveState();
  } else {
    const away = Date.now() - visibleAt;
    if (away > 90 * 1000) handleAway(away);
    visibleAt = Date.now();
    last = performance.now();
    renderer.resize();
  }
});
window.addEventListener('pagehide', saveState);
window.addEventListener('beforeunload', saveState);

// —— 主循环 ——
const DEBUG = (() => {
  try {
    return new URLSearchParams(location.search).has('debug');
  } catch {
    return false;
  }
})();
const debugEl = DEBUG ? document.getElementById('dbg') : null;
if (debugEl) {
  debugEl.hidden = false;
  debugEl.textContent = 'diag…';
}
let frameN = 0;

let last = performance.now();
let lastSave = performance.now();

// —— 自动留档：加载完成后隔几秒抓几帧传回服务器，我能直接看到画面 ——
function startSnapshots() {
  if (typeof location === 'undefined') return; // 离线测试里没有 window
  const qs = new URLSearchParams([location.search.replace(/^\?/, ''), globalThis.__XXOO_FLAGS__ || ''].filter(Boolean).join('&'));
  if (qs.get('shot') === '0') return;
  const every = Math.max(0.15, parseFloat(qs.get('every')) || 1.4) * 1000;
  let n = 0;
  const timer = setInterval(() => {
    n += 1;
    const data = body3d?.snapshot?.() || renderer.snapshot?.();
    if (data) {
      fetch('./shot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: `t${n}-${body3d?.springOn ? 'spring' : 'rigid'}`, data }),
      }).catch(() => {});
    }
    // 不再拍六张就停：我要能一直看到她在干什么
  }, every);
}

// 一帧的全部工作。抽出来是为了给“看门狗”复用。
let lastFrameAt = performance.now();
const CLIP_CN = {
  walk: '走一段路',
  turnL: '向左转身',
  turnR: '向右转身',
  lookL: '往左看',
  lookR: '往右看',
  reachL: '伸手去够',
  reachR: '伸手去够',
  grip: '握了握手',
  stretch: '伸了个懒腰',
  idle: '停下来站着',
};
let lastActCount = 0;
let lastNav = 'idle';

function step(dt) {
  brain.tick(dt, { pointer: ui.pointer, petting: ui.petting });
  if (body3d) {
    body3d.sync(brain, motors.parts.face, dt);
    // 她身上真的发生的事，写进神经面板 —— 不是编的，是动作系统的回调
    const act = body3d.action?.();
    if (act && act.count !== lastActCount) {
      lastActCount = act.count;
      if (act.clip && act.clip !== 'idle') log.push({ layer: 'motor', motor: 'body', text: `身体：${CLIP_CN[act.clip] || act.clip}` });
    }
    if (act && act.nav !== lastNav && act.nav === 'walk') {
      log.push({ layer: 'cerebellum', motor: 'body', text: `小脑：开始走 · 已走 ${act.walked.toFixed(1)} m` });
    }
    if (act) lastNav = act.nav;
  }
  else if (anime) anime.sync(brain, motors.parts.face, dt);
  renderer.draw({ rig, brain, face: motors.parts.face, world, drives, cortex, memory }, dt);
  ui.frame(dt, Date.now());
  lastFrameAt = performance.now();
}

function loop(now) {
  const raw = (now - last) / 1000;
  last = now;
  const dt = clamp(raw, 0, 0.06) * ui.speed;

  try {
    step(dt);
    if (debugEl && body3d && (frameN++ % 20 === 0)) {
      const lines = body3d.debugLines ? body3d.debugLines() : [];
      debugEl.textContent = [`build v${BUILD.slice(-4)}`, ...lines].join('\n');
    }
  } catch (err) {
    console.error(err);
    reportToServer(`loop: ${err && err.stack ? err.stack : err}`, 'loop');
    ui.toast(`出错了：${err && err.message ? err.message : err}`, 6000);
  }

  if (now - lastSave > 5000) {
    lastSave = now;
    saveState();
  }
  requestAnimationFrame(loop);
}

// —— 看门狗 ——
// 后台标签页 / 被隐藏的 iframe 里 requestAnimationFrame 会彻底停掉，
// 页面就永远停在“加载时那一帧静止的 T-pose”。这就是我截图看不出毛病的原因。
// 只要 500ms 没推进过，就用定时器以 10fps 顶上。
setInterval(() => {
  if (performance.now() - lastFrameAt < 500) return;
  try {
    step(0.1);
  } catch (err) {
    reportToServer(`watchdog: ${err && err.stack ? err.stack : err}`, 'watchdog');
  }
}, 100);

// 开场前先把身体摆好，避免第一帧从“零姿势”弹出来
brain.tick(1 / 60, { pointer: null, petting: false });
renderer.resize();
requestAnimationFrame(loop);

// —— 版本徽章 + 旧版提醒 ——
// 这几个月最耗时间的坑不是代码，是“你看到的根本不是最新那版”。所以让它自己说出来。
const BUILD = document.querySelector('meta[name="build"]')?.content || 'dev';
function hudNote(msg) {
  const el = document.getElementById('hud-state');
  if (!el) return;
  const prev = el.textContent;
  el.textContent = msg;
  setTimeout(() => {
    if (el.textContent === msg) el.textContent = prev;
  }, 2600);
}

(function stampVersion() {
  const el = document.getElementById('ver');
  const paint = () => {
    const e = document.getElementById('ver');
    if (!e) return;
    const base = `v${document.querySelector('meta[name="version"]')?.content || '?'}`;
    let f = NaN;
    try {
      f = body3d?.facingCamera?.() ?? NaN;
    } catch {
      f = NaN;
    }
    const tag = Number.isFinite(f) ? (f > 0.3 ? '正' : f < -0.3 ? '背' : '侧') : '';
    e.textContent = tag ? `${base}·${tag}` : base;
  };
  paint();
  setInterval(paint, 1200);
  const check = async () => {
    try {
      const r = await fetch(`./version?t=${Date.now()}`, { cache: 'no-store' });
      const j = await r.json();
      if (j.build && j.build !== BUILD && !document.getElementById('stale')) {
        const btn = document.createElement('button');
        btn.id = 'stale';
        btn.textContent = '有新版本，正在自动刷新…';
        // 不再让用户手动刷新：3 秒后自己更新（存档每 5 秒落一次，不会丢）
        setTimeout(() => location.reload(), 3000);
        btn.style.cssText =
          'position:fixed;left:50%;top:calc(64px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:80;' +
          'padding:8px 16px;border-radius:999px;border:1px solid rgba(255,159,190,.6);background:rgba(90,18,42,.92);' +
          'color:#ffd9e6;font:12px/1 system-ui;cursor:pointer';
        btn.onclick = () => location.reload();
        document.body.appendChild(btn);
      }
    } catch {
      /* 离线就算了 */
    }
  };
  setTimeout(check, 1500);
  setInterval(check, 8000);
})();

// 报到：告诉页面“我活着”，并让开场卡显示实际画布尺寸（排查时一眼就能看明白）
window.__booted = true;
const diag = document.getElementById('intro-diag');
if (diag) diag.textContent = `已醒来 · 画面 ${canvas.clientWidth}×${canvas.clientHeight} · 点任意处进去`;
