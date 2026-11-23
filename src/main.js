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
import { createAnimeBody } from './render/live2d.js';
import { create3DBody } from './render/vrm.js';

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
    return new URLSearchParams(location.search).get('body'); // ?body=2d|live2d|vrm
  } catch {
    return null;
  }
})();
const bodyErrors = [];

function markAwake(label) {
  const d = document.getElementById('intro-diag');
  if (d && window.__booted) d.textContent = `已醒来 · ${label} · 点任意处进去`;
}

async function bootBody() {
  if (bodyMode !== '2d' && bodyMode !== 'live2d') {
    try {
      body3d = await create3DBody({
        canvas: girl3dCanvas,
        modelUrl: './vendor/model/alicia/AliciaSolid.vrm',
        onStatus: (msg) => {
          const el = document.getElementById('ver');
          if (el) el.dataset.status = msg;
        },
      });
      if (body3d) {
        document.getElementById('flip')?.addEventListener('click', () => {
          const deg = body3d?.turnBody?.(180);
          hudNote(Number.isFinite(deg) ? `转身 → 朝 ${((deg * 180) / Math.PI).toFixed(0)}°` : '转身了');
        });
        if (typeof renderer.setBodyVisible === 'function') renderer.setBodyVisible(false);
        girl3dCanvas?.classList.add('on');
        markAwake('3D 身体（VRM）');
        log.push({ layer: 'render', motor: 'body', text: '换上了 3D 身体：VRM / Alicia。' });
        return;
      }
    } catch (err) {
      bodyErrors.push(`3D：${err && err.message ? err.message : err}`);
    }
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
      bodyErrors.push(`Live2D：${err && err.message ? err.message : err}`);
    }
  }

  if (bodyErrors.length) {
    window.__report?.(`身体的 3D / Live2D 都没起来，继续用 2D 骨架：\n  ${bodyErrors.join('\n  ')}`);
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

function loop(now) {
  const raw = (now - last) / 1000;
  last = now;
  const dt = clamp(raw, 0, 0.06) * ui.speed;

  try {
    brain.tick(dt, { pointer: ui.pointer, petting: ui.petting });
    if (body3d) body3d.sync(brain, motors.parts.face, dt);
    else if (anime) anime.sync(brain, motors.parts.face, dt);

    if (debugEl && body3d && (frameN++ % 20 === 0)) {
      const lines = body3d.debugLines ? body3d.debugLines() : [];
      debugEl.textContent = [`build v${BUILD.slice(-4)}`, ...lines].join('\n');
    }
    renderer.draw({ rig, brain, face: motors.parts.face, world, drives, cortex, memory }, dt);
    ui.frame(dt, Date.now());
  } catch (err) {
    console.error(err);
    ui.toast(`出错了：${err && err.message ? err.message : err}`, 6000);
  }

  if (now - lastSave > 5000) {
    lastSave = now;
    saveState();
  }
  requestAnimationFrame(loop);
}

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
        btn.textContent = '有新版本，点此刷新';
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
