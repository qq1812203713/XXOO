// 值了吗 后端：一个不依赖框架的 Node HTTP 服务。
//
// 身份：
// - 微信云托管：小程序用 wx.cloud.callContainer 调用时，平台会带上请求头 x-wx-openid
// - 开发 / H5 预览：允许用请求头 x-device-id（浏览器里随机生成的一串字符）当作用户，
//   由 deviceAuth 开关控制，正式环境应关闭
import { randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { extname, join, normalize, resolve, sep } from 'node:path'

const KINDS = new Set(['theme', 'record', 'tag', 'review'])
const MAX_BODY = 4 * 1024 * 1024 // 单次请求体上限
const MAX_DOC = 256 * 1024 // 单个文档上限
const MAX_DOCS = 20000 // 每个用户的文档数上限
const MAX_IMAGE = 1024 * 1024 // 单张图片上限（前端会压到 80KB 左右）
const MAX_SHARE = 256 * 1024

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const bad = (msg) => new HttpError(400, msg)

/** 按文件头判断图片类型，只接受 JPEG / PNG / WebP */
function imageExt(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg'
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return '.png'
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return '.webp'
  return ''
}

/** 是否内网 / 本机地址。AI 转发时用来拦截指向内部网络的地址 */
export function isPrivateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const v = ip.toLowerCase()
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7))
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        fail(new HttpError(413, '请求内容太大'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      if (!size) return ok({})
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (e) {
        fail(bad('请求内容不是合法的 JSON'))
      }
    })
    req.on('error', fail)
  })
}

/**
 * @param {object} o
 * @param {object} o.db          db.mjs 打开的数据库
 * @param {string} o.dataDir     上传图片保存目录的上级
 * @param {string} [o.staticDir] H5 构建产物目录；给了就顺带托管页面
 * @param {boolean} [o.deviceAuth] 是否允许 x-device-id 作为身份
 * @param {boolean} [o.allowPrivateAi] 是否允许 AI 地址指向内网（仅测试用）
 * @param {Function} [o.fetch]   测试时可替换
 */
export function createApp({ db, dataDir, staticDir = '', deviceAuth = false, allowPrivateAi = false, fetch: fetchFn = fetch }) {
  const filesDir = resolve(dataDir, 'files')
  const staticRoot = staticDir ? resolve(staticDir) : ''

  function userOf(req) {
    const openid = req.headers['x-wx-openid']
    if (openid && /^[\w-]{6,64}$/.test(openid)) return 'wx:' + openid
    const dev = req.headers['x-device-id']
    if (deviceAuth && dev && /^[\w-]{16,64}$/.test(dev)) return 'dev:' + dev
    throw new HttpError(401, '未登录')
  }

  const routes = []
  const on = (method, pattern, handler) => routes.push({ method, pattern, handler })

  on('GET', /^\/api\/health$/, async () => ({ ok: true, db: db.name, time: Date.now() }))

  /* ---------- 数据同步 ---------- */
  on('GET', /^\/api\/sync$/, async ({ req }) => {
    const rows = await db.listDocs(userOf(req))
    return { docs: rows.map((r) => ({ kind: r.kind, id: r.id, data: JSON.parse(r.data), updatedAt: Number(r.updatedAt) })), time: Date.now() }
  })

  on('POST', /^\/api\/sync$/, async ({ req, body }) => {
    const user = userOf(req)
    const put = Array.isArray(body.put) ? body.put : []
    const del = Array.isArray(body.del) ? body.del : []
    const check = (d) => {
      if (!d || !KINDS.has(d.kind)) throw bad('未知的数据类型')
      if (typeof d.id !== 'string' || !d.id || d.id.length > 64) throw bad('数据编号不合法')
    }
    const items = put.map((d) => {
      check(d)
      if (!d.data || typeof d.data !== 'object') throw bad('数据内容不合法')
      const data = JSON.stringify(d.data)
      if (data.length > MAX_DOC) throw new HttpError(413, '单条内容太大')
      return { ...d, data }
    })
    del.forEach(check)
    if (items.length && (await db.countDocs(user)) + items.length > MAX_DOCS) throw new HttpError(413, '数据条数超出上限')
    const now = Date.now()
    for (const d of items) await db.putDoc(user, d.kind, d.id, d.data, now)
    for (const d of del) await db.delDoc(user, d.kind, d.id)
    return { ok: true, put: items.length, del: del.length, time: now }
  })

  on('DELETE', /^\/api\/account$/, async ({ req }) => {
    await db.wipeUser(userOf(req))
    return { ok: true }
  })

  /* ---------- 图片 ---------- */
  on('POST', /^\/api\/files$/, async ({ req, body }) => {
    userOf(req)
    const m = /^data:image\/[\w.+-]+;base64,(.+)$/s.exec(body.dataUrl || '')
    if (!m) throw bad('图片格式不正确')
    const buf = Buffer.from(m[1], 'base64')
    if (buf.length > MAX_IMAGE) throw new HttpError(413, '图片太大')
    const ext = imageExt(buf)
    if (!ext) throw bad('只支持 JPEG、PNG、WebP 图片')
    const name = randomBytes(12).toString('hex') + ext
    await mkdir(filesDir, { recursive: true })
    await writeFile(join(filesDir, name), buf)
    return { url: '/files/' + name, size: buf.length }
  })

  /* ---------- 分享快照 ---------- */
  on('POST', /^\/api\/shares$/, async ({ req, body }) => {
    const user = userOf(req)
    if (!body.snapshot || typeof body.snapshot !== 'object') throw bad('分享内容不合法')
    const data = JSON.stringify(body.snapshot)
    if (data.length > MAX_SHARE) throw new HttpError(413, '分享内容太大')
    const id = randomBytes(9).toString('base64url')
    const now = Date.now()
    await db.putShare(id, user, data, now)
    return { id, at: now }
  })

  // 任何人拿到编号都能看，不需要登录；内容只有分享者确认公开的那部分
  on('GET', /^\/api\/shares\/([\w-]{6,32})$/, async ({ params }) => {
    const row = await db.getShare(params[0])
    if (!row) throw new HttpError(404, '这份分享不存在或已撤回')
    return { ...JSON.parse(row.data), id: row.id, at: Number(row.createdAt) }
  })

  on('GET', /^\/api\/shares$/, async ({ req }) => {
    const rows = await db.listShares(userOf(req))
    return { shares: rows.map((r) => ({ id: r.id, at: Number(r.createdAt), title: JSON.parse(r.data).title || '' })) }
  })

  on('DELETE', /^\/api\/shares\/([\w-]{6,32})$/, async ({ req, params }) => {
    if (!(await db.delShare(userOf(req), params[0]))) throw new HttpError(404, '这份分享不存在或已撤回')
    return { ok: true }
  })

  /* ---------- AI 转发 ---------- */
  // 小程序不能直接请求任意域名，所以由后端转发到用户自己填写的 OpenAI 兼容接口。
  // 密钥只随本次请求经过，不落库、不写日志。
  on('POST', /^\/api\/ai$/, async ({ req, body }) => {
    userOf(req)
    const { base, key, model, messages, test } = body
    if (typeof base !== 'string' || typeof key !== 'string' || !base || !key) throw bad('请先填写服务地址和 API Key')
    let url
    try {
      url = new URL(base.replace(/\/+$/, '') + (test ? '/models' : '/chat/completions'))
    } catch (e) {
      throw bad('服务地址不是合法的网址')
    }
    if (!allowPrivateAi) {
      if (url.protocol !== 'https:') throw bad('服务地址必须以 https:// 开头')
      let addrs = []
      try {
        addrs = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true })
      } catch (e) {
        throw new HttpError(502, '无法解析服务地址')
      }
      if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw bad('不允许使用内网地址')
    }
    if (!test && (!model || !Array.isArray(messages) || !messages.length)) throw bad('缺少模型名称或对话内容')
    let res
    try {
      res = await fetchFn(url, {
        method: test ? 'GET' : 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: test ? undefined : JSON.stringify({ model, messages }),
        redirect: 'error',
        signal: AbortSignal.timeout(55000),
      })
    } catch (e) {
      throw new HttpError(502, e.name === 'TimeoutError' ? '连接超时' : '无法连接到服务地址')
    }
    const text = await res.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch (e) {}
    if (!res.ok) {
      const msg = data && data.error && (data.error.message || data.error)
      if (res.status === 401 || res.status === 403) throw new HttpError(502, '密钥无效或没有权限')
      if (res.status === 404) throw new HttpError(502, typeof msg === 'string' ? msg : '地址或模型不存在')
      throw new HttpError(502, typeof msg === 'string' ? msg : '服务返回错误 ' + res.status)
    }
    if (test) return { ok: true }
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    if (!content) throw new HttpError(502, '接口没有返回内容')
    return { text: String(content).trim() }
  })

  /* ---------- 静态文件 ---------- */
  async function sendFile(res, root, rel, cache) {
    const file = resolve(root, '.' + normalize('/' + rel))
    if (file !== root && !file.startsWith(root + sep)) throw new HttpError(404, 'Not found')
    let buf
    try {
      buf = await readFile(file)
    } catch (e) {
      throw new HttpError(404, 'Not found')
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' })
    res.end(buf)
  }

  return async function handler(req, res) {
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(obj))
    }
    try {
      let path
      try {
        path = decodeURIComponent(req.url.split('?')[0])
      } catch (e) {
        throw bad('网址不合法')
      }
      if (path.startsWith('/api/')) {
        for (const r of routes) {
          const m = r.method === req.method && r.pattern.exec(path)
          if (!m) continue
          const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {}
          return send(200, await r.handler({ req, body, params: m.slice(1) }))
        }
        throw new HttpError(404, '接口不存在')
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed')
      if (path.startsWith('/files/')) return await sendFile(res, filesDir, path.slice(7), 'public, max-age=31536000, immutable')
      if (staticRoot) return await sendFile(res, staticRoot, path === '/' ? 'index.html' : path, 'no-store')
      throw new HttpError(404, 'Not found')
    } catch (e) {
      if (res.headersSent) return res.end()
      if (e instanceof HttpError) return send(e.status, { error: e.message })
      console.error(e)
      send(500, { error: '服务器出错了' })
    }
  }
}
