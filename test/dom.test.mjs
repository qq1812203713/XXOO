// 端到端冒烟测试：在 jsdom 里真的加载 index.html，跑主循环、点她、跟她说话、打开面板。
// 目的不是视觉，而是抓「浏览器里一打开就白屏」这类问题。
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'https://example.test/', pretendToBeVisual: true });
const { window } = dom;

// —— 静态守卫：.intro/.sheet 用了 display:grid，必须有一条 [hidden] !important 兜底 ——
const css = fs.readFileSync(new URL('../assets/styles.css', import.meta.url), 'utf8');
if (!/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(css)) {
  throw new Error('styles.css 缺少 [hidden] { display: none !important }，遮罩会关不掉');
}

// —— 让 jsdom 的 canvas 真的能画 ——
const realCanvases = new WeakMap();
window.HTMLCanvasElement.prototype.getContext = function getContext() {
  let c = realCanvases.get(this);
  if (!c) {
    c = createCanvas(430, 800);
    realCanvases.set(this, c);
  }
  return c.getContext('2d');
};
Object.defineProperty(window.HTMLCanvasElement.prototype, 'clientWidth', { get: () => 430, configurable: true });
Object.defineProperty(window.HTMLCanvasElement.prototype, 'clientHeight', { get: () => 800, configurable: true });

// —— 把浏览器全局搬进 Node ——
const g = globalThis;
for (const key of [
  'window',
  'document',
  'localStorage',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'HTMLElement',
  'HTMLCanvasElement',
  'Event',
  'PointerEvent',
  'KeyboardEvent',
  'getComputedStyle',
]) {
  if (key in window) {
    try {
      Object.defineProperty(g, key, { value: window[key], configurable: true, writable: true });
    } catch {
      /* 有些全局属性只读，跳过 */
    }
  }
}
g.devicePixelRatio = 2;
g.innerWidth = 430;
g.innerHeight = 800;

const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));
const origError = console.error;
console.error = (...args) => {
  errors.push(args.map(String).join(' '));
  origError(...args);
};

// —— 真正加载应用 ——
await import('../src/main.js');
if (document.getElementById('model') !== null) throw new Error('应去掉模型选择下拉框 #model');
if (document.getElementById('flip') !== null) throw new Error('应去掉转身按钮 #flip');

// —— 开场遮罩必须真的能关掉（display:grid 会盖掉 hidden，这是必测点）——
const introEl = document.getElementById('intro');
const introBefore = window.getComputedStyle(introEl).display;
document.getElementById('enter').dispatchEvent(new window.Event('click', { bubbles: true }));
const introAfter = window.getComputedStyle(introEl).display;
console.log('开场遮罩 display：', introBefore, '→', introAfter);
if (introEl.hidden !== true) throw new Error('点“进去”后 intro.hidden 不是 true');
if (introAfter !== 'none') throw new Error(`点“进去”后遮罩仍然显示（display=${introAfter}）`);

// 跑一段时间，让她自己动起来
await new Promise((r) => setTimeout(r, 1200));

function firePointer(type, x, y) {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { clientX: x, clientY: y, pointerId: 1 });
  document.getElementById('stage').dispatchEvent(ev);
}

// 戳一下画面中间（大概率是她的身体）
firePointer('pointerdown', 215, 520);
firePointer('pointermove', 230, 530);
firePointer('pointerup', 230, 530);

// 说话
const input = document.getElementById('say');
input.value = '你好呀，我叫小林';
document.getElementById('send').dispatchEvent(new window.Event('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 1600));

// 打开神经面板与设置
document.getElementById('open-nerves').dispatchEvent(new window.Event('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 400));
const settingsEl = document.getElementById('settings');
document.getElementById('open-settings').dispatchEvent(new window.Event('click', { bubbles: true }));
const sheetDisplay = window.getComputedStyle(settingsEl).display;
document.querySelector('[data-close="settings"]').dispatchEvent(new window.Event('click', { bubbles: true }));
const sheetClosed = window.getComputedStyle(settingsEl).display;
console.log('设置面板 display：', sheetDisplay, '→', sheetClosed);
if (sheetClosed !== 'none') throw new Error('设置面板关不掉');

// 存档是否写进去了
const saved = JSON.parse(localStorage.getItem('xxoo.life.v1') || 'null');
const bubble = document.getElementById('bubble-text').textContent;
const hud = document.getElementById('hud-state').textContent;
const logCount = document.querySelectorAll('#motor-log li').length;

console.log('气泡：', JSON.stringify(bubble));
console.log('状态：', hud);
console.log('日志条目：', logCount);
console.log('存档：', saved ? `记忆 ${saved.memory?.episodes?.length} 条，世界 ${saved.world?.objects?.length} 个` : '无');
console.log('错误：', errors.length ? errors : '无');

if (errors.length) {
  console.log('❌ 有运行时错误');
  process.exit(1);
}
if (!saved) throw new Error('没有写入存档');
if (!saved.memory.episodes.some((e) => e.text.includes('小林'))) throw new Error('她没记住用户说的话');
if (logCount === 0) throw new Error('神经日志是空的');
console.log('OK');
process.exit(0);
