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

  // 当前构建号：页面拿它比较自己是不是旧版
  if (rel === '/version') {
    const out = JSON.stringify({ build: BUILD });
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
      body = Buffer.from(buf.toString('utf8').replaceAll('__BUILD__', BUILD), 'utf8');
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
