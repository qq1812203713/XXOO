// 零依赖静态服务器。比 `python3 -m http.server` 多做三件必要的事：
//   1. 所有响应都带 `Cache-Control: no-store` —— 预览里绝不可能再拿到旧文件；
//   2. 正确的 MIME（ES 模块必须 text/javascript，否则浏览器直接拒绝执行）；
//   3. 每个请求都打到 stdout，出问题时能直接看到“浏览器到底取了哪些文件、状态码是什么”。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8000);

// 每次启动生成一个构建号。它不是装饰：下面会把每个 ES 模块的相对 import
// 改写成 `./x.js?b=<构建号>`，这样浏览器/代理手里的旧模块副本永远不会被复用。
// 之前「改了代码但你看到的还是旧页面」就是死在这里。
const BUILD = Date.now().toString(36);
// 改了 .flags 就当成新版本：页面会自动刷新，自检时切换视角/模型不用手动刷
function flagsStamp() {
  try {
    const t = fs.readFileSync(path.join(ROOT, '.flags'), 'utf8').trim();
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
    return BUILD + '.' + Math.abs(h).toString(36);
  } catch {
    return BUILD;
  }
}
const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+?\.m?js)\2/g;

function bustImports(src) {
  return src.replace(IMPORT_RE, (m, head, q, spec) => {
    // vendor/ 里的第三方库互相引用时不能加查询串，否则 three 会被加载成两份实例
    if (spec.includes('/vendor/')) return m;
    return `${head}${q}${spec}?b=${BUILD}${q}`;
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';

  // 给预览一个“从没被缓存过”的入口：/play、/w 都等价于首页。
  // 要是某个代理把 / 的旧 HTML 缓存住了，换个新路径就一定能打到源站。
  if (rel === '/play' || rel === '/play/' || rel === '/w' || rel === '/w/') rel = '/index.html';

  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  const done = (code, extra = '') => {
    const ms = Date.now() - started;
    console.log(`${code} ${req.method} ${rel}${extra} ${ms}ms`);
  };

  if (!file.startsWith(ROOT)) {
    res.writeHead(403, { 'Cache-Control': 'no-store' }).end('forbidden');
    return done(403);
  }

  // —— 大模型代理 ——
  // 浏览器直连第三方 API 十有八九被 CORS 拦（Failed to fetch）。
  // 这里让页面打到同源的 /llm，由服务器转发出去：没有跨域，没有预检。
  if (rel === '/llm') {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Cache-Control': 'no-store',
      });
      res.end();
      return done(204);
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let payload = {};
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: '请求体不是 JSON' }));
        return done(400);
      }
      const base = String(payload.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const key = String(payload.key || '');
      if (!key) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: '没有 API Key' }));
        return done(400);
      }
      try {
        const upstream = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: payload.model || 'gpt-4o-mini',
            temperature: payload.temperature ?? 0.95,
            max_tokens: payload.max_tokens ?? 220,
            messages: payload.messages || [],
          }),
        });
        const text = await upstream.text();
        res.writeHead(upstream.status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(text);
        done(upstream.status, ` ← 代理到 ${base}`);
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: `服务器也没连上：${err && err.message ? err.message : err}` }));
        done(502, ` ← 代理失败 ${base}`);
      }
    });
    return;
  }

  // 页面把错误发回来，直接打在服务器日志上（我看日志就等于看控制台）
  if (rel === '/log' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let msg = '';
      try {
        const j = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        msg = `${j.level || 'info'}: ${j.msg}`;
      } catch {
        msg = Buffer.concat(chunks).toString('utf8').slice(0, 500);
      }
      console.log(`[page] ${msg}`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end('{"ok":true}');
    });
    return;
  }

  // 页面自己截图发回来，落盘到 shots/。
  // 这样我不必再让用户“帮我截一张”，能直接看到屏幕上是什么。
  if (rel === '/shot' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        const { data, tag } = JSON.parse(body);
        const base64 = String(data || '').replace(/^data:image\/\w+;base64,/, '');
        if (!base64) throw new Error('空图');
        const dir = path.join(ROOT, 'shots');
        fs.mkdirSync(dir, { recursive: true });
        const name = `${String(tag || 'shot').replace(/[^\w.-]/g, '_')}-${Date.now()}.jpg`;
        fs.writeFileSync(path.join(dir, name), Buffer.from(base64, 'base64'));
        console.log(`shot saved: shots/${name} (${Math.round(base64.length / 1024)}KB)`);
        // 只留最近 80 张，免得来回堆
        try {
          const files = fs
            .readdirSync(dir)
            .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.t - a.t);
          for (const old of files.slice(80)) fs.unlinkSync(path.join(dir, old.f));
        } catch {
          /* ignore */
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, file: `shots/${name}` }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
      }
    });
    return;
  }

  // 当前构建号：页面拿它比较自己是不是旧版
  if (rel === '/version') {
    const out = JSON.stringify({ build: flagsStamp() });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(out), 'Cache-Control': 'no-store' });
    res.end(out);
    return done(200);
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('not found: ' + rel + '\n（要加载世界，请打开 /index.html）');
      return done(404, ' ← 找不到，检查路径大小写');
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    let body = buf;
    if (type.startsWith('text/html')) {
      // 把构建号写进 HTML，页面上就能显示“我是哪一版”——排查缓存问题全靠它
      let html = buf.toString('utf8').replaceAll('__BUILD__', flagsStamp());
      // 自检开关：仓库里放一个 .flags 文件（如 freeze=0.25&every=0.4），
      // 注入到页面里 —— 我不需要用户帮我改地址栏，也不用重定向。
      let flags = '';
      try {
        flags = fs.readFileSync(path.join(ROOT, '.flags'), 'utf8').trim();
      } catch {
        /* 没有就不管 */
      }
      if (flags) {
        html = html.replace('</head>', `<script>window.__XXOO_FLAGS__=${JSON.stringify(flags)}</script></head>`);
      }
      body = Buffer.from(html, 'utf8');
    }
    if (type.startsWith('text/javascript') && !rel.includes('/vendor/')) {
      const rewritten = bustImports(buf.toString('utf8'));
      if (rewritten !== buf.toString('utf8')) body = Buffer.from(rewritten, 'utf8');
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'Access-Control-Allow-Origin': '*',
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(body);
    }
    done(200);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`息 · 世界 已经开在 0.0.0.0:${PORT}（root=${ROOT}，全部 no-store）`);
});
