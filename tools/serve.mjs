// 极简静态服务：托管 H5 构建产物，用于在线预览。用法: node tools/serve.mjs [端口]
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = 'dist/build/h5'
const PORT = Number(process.argv[2]) || 5173
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
}

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  const file = join(ROOT, path === '/' || path === '\\' ? 'index.html' : path)
  try {
    const body = await readFile(file)
    // 不缓存，保证每次重新构建后刷新就能看到最新效果
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(body)
  } catch {
    res.writeHead(404).end('Not found')
  }
}).listen(PORT, '0.0.0.0', () => console.log(`H5 preview: http://0.0.0.0:${PORT}`))
