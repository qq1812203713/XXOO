// 「保险丝」测试：模拟最坏的浏览器情况 —— ES 模块整块没跑起来。
// 这时也必须满足两件事：
//   1. 用户点一下就能关掉开场遮罩（不会被困在一张说明卡里）；
//   2. 屏幕上出现可读的中文错误，而不是一片沉默。
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// 故意不给 resources，jsdom 就不会去取 <script type="module">，
// 等于「模块脚本根本没执行」——正是要防的那种失败。
const dom = new JSDOM(html, {
  url: 'https://example.test/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;
const fail = (m) => {
  console.log('❌', m);
  process.exit(1);
};

if (typeof window.__report !== 'function') fail('index.html 的内联保险丝没有运行（window.__report 不存在）');
if (typeof window.__enter !== 'function') fail('window.__enter 不存在');

const intro = document.getElementById('intro');
if (intro.hidden) fail('开场遮罩一开始就是隐藏的，测试前提不成立');
const diag = document.getElementById('intro-diag');
console.log('开场诊断行：', diag?.textContent);

// —— 点任何地方都能进 ——
const tap = new window.Event('pointerdown', { bubbles: true, cancelable: true });
document.body.dispatchEvent(tap);
if (!intro.hidden) fail('模块没跑起来时，点一下也关不掉遮罩');
if (window.getComputedStyle(intro).display !== 'none') fail('遮罩 hidden 了但 display 不是 none');

// —— 错误必须写在屏幕上 ——
const err = new window.ErrorEvent('error', { message: 'boom from nowhere' });
window.dispatchEvent(err);
const note = document.getElementById('boot-note');
if (!note || note.hidden) fail('错误没有显示到 #boot-note');
if (!note.textContent.includes('boom from nowhere')) fail('#boot-note 里没有错误内容：' + note.textContent);
console.log('屏幕上的错误：', note.textContent.replace(/\n/g, ' / '));

// —— 3 秒后必须自己报告「主程序没启动」 ——
await new Promise((r) => setTimeout(r, 3200));
if (!note.textContent.includes('主程序 3 秒内没有启动')) fail('没有报告“主程序未启动”：' + note.textContent);
console.log('3 秒看门狗：', note.textContent.split('\n').pop());

console.log('OK');
window.close();
process.exit(0);
