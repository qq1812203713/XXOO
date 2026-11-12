// 云端同步。
//
// 做法：主题、记录、标签、回顾各自是一份“文档”。本机每次改动后，和“上次已同步的样子”
// 对比，把变化的文档推到后端；启动和回到前台时从后端拉取，以后端为准。
// 没有网络时改动留在本机，下次能连上时补传。
import { watch } from 'vue'
import { api, backendEnabled, isLocalImage, syncState, uploadImage } from './api'
import { themes, records, tagMeta, reviews, applyCloud, isCloud, setCloud, isSeedRecord } from './store'

const SYNCED_KEY = 'zlm_synced_v1'
const RETRY_MS = 20000

const readSynced = () => {
  try {
    const v = uni.getStorageSync(SYNCED_KEY)
    return v && typeof v === 'object' ? v : {}
  } catch (e) {
    return {}
  }
}
// 文档键 → 内容摘要，记录“后端现在有什么”
let synced = readSynced()
const saveSynced = () => uni.setStorageSync(SYNCED_KEY, synced)

const digest = (obj) => {
  const s = JSON.stringify(obj)
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return s.length + ':' + h
}

function localDocs() {
  const m = {}
  themes.value.forEach((t) => (m['theme/' + t.id] = t))
  records.value.forEach((r) => (m['record/' + r.id] = r))
  tagMeta.value.forEach((t) => (m['tag/' + t.name] = t))
  Object.keys(reviews.value).forEach((k) => {
    // 示例回顾每台设备都自带，不上传
    if (reviews.value[k].by !== 'sample') m['review/' + k] = reviews.value[k]
  })
  return m
}

const split = (key) => {
  const i = key.indexOf('/')
  return { kind: key.slice(0, i), id: key.slice(i + 1) }
}

/** 把还留在本机的照片传上去，并把记录、主题里的地址换成云端地址 */
async function uploadLocalImages() {
  const cache = {}
  const up = async (p) => {
    if (!isLocalImage(p)) return p
    if (!cache[p]) cache[p] = await uploadImage(p)
    return cache[p]
  }
  for (const r of records.value) {
    const all = [...(r.images || []), r.image, r.imageWide]
    if (!all.some(isLocalImage)) continue
    const next = { ...r, images: [] }
    for (const p of r.images || []) next.images.push(await up(p))
    if (r.image) next.image = await up(r.image)
    if (r.imageWide) next.imageWide = await up(r.imageWide)
    records.value = records.value.map((x) => (x.id === r.id ? next : x))
  }
  for (const t of themes.value) {
    if (!isLocalImage(t.cover) && !isLocalImage(t.coverWide)) continue
    const next = { ...t, cover: await up(t.cover), coverWide: t.coverWide ? await up(t.coverWide) : t.coverWide }
    themes.value = themes.value.map((x) => (x.id === t.id ? next : x))
  }
}

/** 推送本机改动。返回是否有内容被推送 */
async function push() {
  await uploadLocalImages()
  const docs = localDocs()
  const next = {}
  const put = []
  const del = []
  Object.keys(docs).forEach((key) => {
    next[key] = digest(docs[key])
    if (synced[key] !== next[key]) put.push({ ...split(key), data: docs[key] })
  })
  Object.keys(synced).forEach((key) => {
    if (!(key in docs)) del.push(split(key))
  })
  if (!put.length && !del.length) return false
  // 分批，避免单次请求过大
  for (let i = 0; i < put.length || i === 0; i += 40) {
    await api('POST', '/api/sync', { put: put.slice(i, i + 40), del: i === 0 ? del : [] })
  }
  synced = next
  saveSynced()
  return true
}

const hasPending = () => {
  const docs = localDocs()
  return Object.keys(docs).some((k) => synced[k] !== digest(docs[k])) || Object.keys(synced).some((k) => !(k in docs))
}

/** 拉取后端数据并覆盖本机 */
async function pull(first) {
  const res = first || (await api('GET', '/api/sync'))
  const group = { theme: [], record: [], tag: [], review: {} }
  res.docs.forEach((d) => {
    if (d.kind === 'review') group.review[d.id] = d.data
    else if (group[d.kind]) group[d.kind].push(d.data)
  })
  applying = true
  applyCloud({ themes: group.theme, records: group.record, tags: group.tag, reviews: group.review })
  const docs = localDocs()
  synced = {}
  Object.keys(docs).forEach((k) => (synced[k] = digest(docs[k])))
  saveSynced()
  // watch 回调是异步触发的，等它跑完再放开
  setTimeout(() => (applying = false), 0)
}

let running = false
let again = false
let applying = false
let timer = 0
let retry = 0

async function run(withPull) {
  if (!backendEnabled) return
  if (running) {
    again = true
    return
  }
  running = true
  clearTimeout(retry)
  syncState.value = { ...syncState.value, status: 'syncing', message: '' }
  try {
    if (!isCloud()) {
      // 这台设备第一次连上后端
      const res = await api('GET', '/api/sync')
      if (res.docs.length) {
        // 账号里已经有数据：把本机自己写的记录补传上去，其余以云端为准
        const mine = records.value.filter((r) => !isSeedRecord(r))
        if (mine.length) {
          await uploadLocalImages()
          const fresh = records.value.filter((r) => !isSeedRecord(r))
          await api('POST', '/api/sync', { put: fresh.map((r) => ({ kind: 'record', id: String(r.id), data: r })) })
          await pull()
        } else await pull(res)
      } else {
        // 新账号：把本机现有内容（含示例）整体传上去
        setCloud()
        synced = {}
        await push()
      }
    } else {
      await push()
      if (withPull) await pull()
    }
    syncState.value = { status: 'ok', at: Date.now(), message: '' }
  } catch (e) {
    // 404 说明页面是纯静态托管、没有后端，按“未接入”处理
    if (e.status === 404 && !isCloud()) syncState.value = { status: 'off', at: 0, message: '' }
    else {
      syncState.value = { ...syncState.value, status: 'error', message: e.message || '同步失败' }
      retry = setTimeout(() => run(false), RETRY_MS)
    }
  }
  running = false
  if (again) {
    again = false
    run(false)
  }
}

let started = false

/** 应用启动时调用一次 */
export function startSync() {
  if (!backendEnabled || started) return
  started = true
  watch(
    [themes, records, tagMeta, reviews],
    () => {
      if (applying) return
      clearTimeout(timer)
      timer = setTimeout(() => run(false), 500)
    },
    { deep: true }
  )
  run(true)
}

/** 回到前台、或用户手动点“重试”时调用 */
export function syncNow() {
  if (!backendEnabled) return
  if (!started) return startSync()
  run(true)
}

/** 是否还有没传上去的改动 */
export const syncPending = () => backendEnabled && isCloud() && hasPending()
