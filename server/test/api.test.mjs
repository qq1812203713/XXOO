import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, isPrivateAddress } from '../src/app.mjs'
import { openSqlite } from '../src/db.mjs'

let server, base, dir, db, aiCalls
const A = { 'x-device-id': 'device-aaaaaaaaaaaaaaaa' }
const B = { 'x-wx-openid': 'openid-bbbbbbbb' }

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, data: await res.json() }
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'zlm-'))
  db = await openSqlite(join(dir, 't.db'))
  aiCalls = []
  const fakeFetch = async (url, opt) => {
    aiCalls.push({ url: String(url), opt })
    if (opt.headers.Authorization === 'Bearer wrong') return new Response('{"error":{"message":"bad key"}}', { status: 401 })
    if (String(url).endsWith('/models')) return new Response('{"data":[]}', { status: 200 })
    return new Response(JSON.stringify({ choices: [{ message: { content: ' 你好 ' } }] }), { status: 200 })
  }
  const app = createApp({ db, dataDir: dir, deviceAuth: true, fetch: fakeFetch })
  server = createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = 'http://127.0.0.1:' + server.address().port
})
after(async () => {
  server.close()
  await db.close()
  rmSync(dir, { recursive: true, force: true })
})

test('需要身份', async () => {
  assert.equal((await call('GET', '/api/sync')).status, 401)
  assert.equal((await call('GET', '/api/sync', null, { 'x-device-id': 'short' })).status, 401)
  assert.equal((await call('GET', '/api/health')).status, 200)
})

test('同步：写入、覆盖、删除，用户之间互相隔离', async () => {
  let r = await call('POST', '/api/sync', { put: [{ kind: 'record', id: 'r-1', data: { text: '第一条' } }, { kind: 'theme', id: '1', data: { title: '散步' } }] }, A)
  assert.equal(r.status, 200)
  assert.equal(r.data.put, 2)
  r = await call('GET', '/api/sync', null, A)
  assert.equal(r.data.docs.length, 2)
  assert.equal(r.data.docs.find((d) => d.kind === 'record').data.text, '第一条')

  await call('POST', '/api/sync', { put: [{ kind: 'record', id: 'r-1', data: { text: '改过了' } }], del: [{ kind: 'theme', id: '1' }] }, A)
  r = await call('GET', '/api/sync', null, A)
  assert.deepEqual(r.data.docs.map((d) => [d.kind, d.id, d.data.text]), [['record', 'r-1', '改过了']])

  r = await call('GET', '/api/sync', null, B)
  assert.equal(r.data.docs.length, 0)
})

test('同步：拒绝不合法的数据', async () => {
  assert.equal((await call('POST', '/api/sync', { put: [{ kind: 'hack', id: '1', data: {} }] }, A)).status, 400)
  assert.equal((await call('POST', '/api/sync', { put: [{ kind: 'record', id: '', data: {} }] }, A)).status, 400)
  assert.equal((await call('POST', '/api/sync', { put: [{ kind: 'record', id: 'x', data: 'str' }] }, A)).status, 400)
  assert.equal((await call('POST', '/api/sync', { put: [{ kind: 'record', id: 'x', data: { t: 'a'.repeat(300000) } }] }, A)).status, 413)
  const res = await fetch(base + '/api/sync', { method: 'POST', headers: A, body: '{oops' })
  assert.equal(res.status, 400)
})

test('图片上传：只收图片，能取回', async () => {
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)])
  let r = await call('POST', '/api/files', { dataUrl: 'data:image/webp;base64,' + webp.toString('base64') }, A)
  assert.equal(r.status, 200)
  assert.match(r.data.url, /^\/files\/[0-9a-f]{24}\.webp$/)
  const got = await fetch(base + r.data.url)
  assert.equal(got.status, 200)
  assert.equal(got.headers.get('content-type'), 'image/webp')
  assert.equal((await got.arrayBuffer()).byteLength, webp.length)

  r = await call('POST', '/api/files', { dataUrl: 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64') }, A)
  assert.equal(r.status, 400)
  assert.equal((await call('POST', '/api/files', { dataUrl: 'nope' }, A)).status, 400)
  assert.equal((await call('POST', '/api/files', { dataUrl: 'data:image/webp;base64,AAAA' })).status, 401)
  assert.equal((await fetch(base + '/files/..%2Ft.db')).status, 404)
  assert.equal((await fetch(base + '/files/%2e%2e/t.db')).status, 404)
})

test('分享：公开读取，只有本人能撤回', async () => {
  let r = await call('POST', '/api/shares', { snapshot: { title: '散步', text: '值了' } }, A)
  assert.equal(r.status, 200)
  const id = r.data.id
  r = await call('GET', '/api/shares/' + id)
  assert.equal(r.status, 200)
  assert.equal(r.data.title, '散步')
  assert.equal(r.data.userId, undefined)
  assert.equal((await call('GET', '/api/shares', null, A)).data.shares.length, 1)
  assert.equal((await call('DELETE', '/api/shares/' + id, null, B)).status, 404)
  assert.equal((await call('GET', '/api/shares/' + id)).status, 200)
  assert.equal((await call('DELETE', '/api/shares/' + id, null, A)).status, 200)
  assert.equal((await call('GET', '/api/shares/' + id)).status, 404)
})

test('AI 转发：拦截内网和非 https 地址', async () => {
  const msg = [{ role: 'user', content: 'hi' }]
  for (const b of ['http://example.com/v1', 'https://127.0.0.1/v1', 'https://10.0.0.8/v1', 'https://169.254.169.254/v1', 'https://localhost/v1', 'https://[::1]/v1', 'not a url']) {
    const r = await call('POST', '/api/ai', { base: b, key: 'k', model: 'm', messages: msg }, A)
    assert.ok(r.status === 400 || r.status === 502, b + ' -> ' + r.status)
  }
  assert.equal(aiCalls.length, 0)
  assert.equal((await call('POST', '/api/ai', { base: 'https://1.1.1.1/v1', key: 'k', model: 'm', messages: msg })).status, 401)
  assert.ok(isPrivateAddress('192.168.1.1') && isPrivateAddress('::ffff:10.0.0.1') && isPrivateAddress('fd00::1') && !isPrivateAddress('8.8.8.8'))
})

test('AI 转发：正常返回与错误提示', async () => {
  const msg = [{ role: 'user', content: 'hi' }]
  let r = await call('POST', '/api/ai', { base: 'https://1.1.1.1/v1/', key: 'good', model: 'm', messages: msg }, A)
  assert.equal(r.status, 200)
  assert.equal(r.data.text, '你好')
  assert.equal(aiCalls.at(-1).url, 'https://1.1.1.1/v1/chat/completions')
  r = await call('POST', '/api/ai', { base: 'https://1.1.1.1/v1', key: 'good', test: true }, A)
  assert.deepEqual(r.data, { ok: true })
  assert.equal(aiCalls.at(-1).url, 'https://1.1.1.1/v1/models')
  r = await call('POST', '/api/ai', { base: 'https://1.1.1.1/v1', key: 'wrong', model: 'm', messages: msg }, A)
  assert.equal(r.status, 502)
  assert.equal(r.data.error, '密钥无效或没有权限')
})

test('删除账号数据', async () => {
  await call('POST', '/api/shares', { snapshot: { title: 'x' } }, A)
  assert.equal((await call('DELETE', '/api/account', null, A)).status, 200)
  assert.equal((await call('GET', '/api/sync', null, A)).data.docs.length, 0)
  assert.equal((await call('GET', '/api/shares', null, A)).data.shares.length, 0)
})
