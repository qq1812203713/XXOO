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

// —— 二次元身体（Live2D）——
// 不阻塞主循环：文件大、要 WebGL，允许它慢慢来。成功了就把 2D 身体换掉，
// 失败了就安静地继续用 2D 身体，屏幕上不会多出任何东西。
let anime = null;
const girlCanvas = document.getElementById('girl');
createAnimeBody({
  canvas: girlCanvas,
  modelUrl: './vendor/model/haru/haru_greeter_t03.model3.json',
})
  .then((body) => {
    if (!body) return;
    anime = body;
    // 渲染器若是旧版（module 缓存混用），宁可退回 2D 也不要两具身体叠在一起
    if (typeof renderer.setBodyVisible !== 'function') throw new Error('渲染器版本不一致，请强制刷新一次');
    girlCanvas?.classList.add('on');
    const d = document.getElementById('intro-diag');
    if (d && window.__booted) d.textContent = '已醒来 · Live2D 模型 · 点任意处进去';
    log.push({ layer: 'render', motor: 'body', text: '换上了 Live2D 模型（Haru）。' });
  })
  .catch((err) => {
    window.__report?.(`Live2D 没起来，继续用 2D 身体：${err && err.message ? err.message : err}`);
  });

// —— 窗口 ——
let visibleAt = Date.now();
window.addEventListener('resize', () => {
  renderer.resize();
  anime?.resize();
});
window.addEventListener('orientationchange', () =>
  setTimeout(() => {
    renderer.resize();
    anime?.resize();
  }, 180),
);
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
let last = performance.now();
let lastSave = performance.now();

function loop(now) {
  const raw = (now - last) / 1000;
  last = now;
  const dt = clamp(raw, 0, 0.06) * ui.speed;

  try {
    brain.tick(dt, { pointer: ui.pointer, petting: ui.petting });
    if (anime) anime.sync(brain, motors.parts.face, dt);
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

// 报到：告诉页面“我活着”，并让开场卡显示实际画布尺寸（排查时一眼就能看明白）
window.__booted = true;
const diag = document.getElementById('intro-diag');
if (diag) diag.textContent = `已醒来 · 画面 ${canvas.clientWidth}×${canvas.clientHeight} · 点任意处进去`;
