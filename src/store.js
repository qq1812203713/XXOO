// 数据层：主题与记录。记录保存在本地存储，后续可替换为云端接口。
import { ref } from 'vue'
import { api, backendEnabled } from './api'

const KEY = 'zlm_records_v1'
const THEMES_KEY = 'zlm_themes_v2'
const TAGS_KEY = 'zlm_tags_v1'
const AI_KEY = 'zlm_ai_v1'
const REVIEW_KEY = 'zlm_reviews_v1'
const SHARE_KEY = 'zlm_shares_v1'
const CLOUD_KEY = 'zlm_cloud_v1'
const DAY = 86400000

// 以下均为示例（模拟）数据。base / costBase / tagBase：示例记录之外的历史数量，用来凑出设计稿上的数字
const themeSeed = [
  {
    id: 1,
    title: '带着相机去散步',
    cover: '/static/img/theme-1.jpg',
    coverWide: '/static/img/cover-1.jpg',
    startAt: new Date(2025, 9, 1).getTime(),
    desc: '放慢一点，收集日常里容易错过的光。',
    hours: 6,
    costBase: 126,
    tagBase: { 小确幸: 4, 留给自己: 2, 第一次: 1 },
    tags: ['小确幸', '第一次', '留给自己'],
    base: 5,
  },
  {
    id: 2,
    title: '我的咖啡角落',
    cover: '/static/img/theme-2.jpg',
    startAt: new Date(2025, 8, 12).getTime(),
    desc: '一杯咖啡的时间，留给自己发会儿呆。',
    hours: 4,
    base: 6,
  },
  {
    id: 3,
    title: '学吉他的第30天',
    cover: '/static/img/theme-3.jpg',
    startAt: new Date(2025, 8, 27).getTime(),
    desc: '手指还是会疼，但和弦慢慢顺了。',
    hours: 15,
    base: 12,
  },
  {
    id: 4,
    title: '认真过周末',
    cover: '/static/img/theme-4.jpg',
    startAt: new Date(2025, 7, 2).getTime(),
    desc: '不赶时间的两天，做点喜欢的事。',
    hours: 20,
    base: 10,
  },
]

function daysAgoAt(days, h, m) {
  const d = new Date(Date.now() - days * DAY)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

// 示例记录。日期相对今天生成；正文里的换行与设计稿的断行一致
const seed = () => [
  {
    id: 'seed-1',
    time: daysAgoAt(0, 18, 30),
    themeId: 1,
    text: '下班绕路去了河边。拍到落日的\n那一刻，觉得这趟散步很值得。',
    tags: ['小确幸', '留给自己'],
    image: '/static/img/record-1.jpg',
    imageWide: '/static/img/record-1-wide.jpg',
    imageH: 155,
    synced: true,
  },
  {
    id: 'seed-2',
    time: daysAgoAt(6, 20, 15),
    themeId: 1,
    text: '在街角的咖啡店，拍下了这杯拿铁。\n生活的仪式感，可能就是一杯咖啡。',
    tags: ['第一次', '咖啡'],
    imageWide: '/static/img/record-2.jpg',
    imageH: 106,
    synced: true,
  },
  {
    id: 'seed-3',
    time: daysAgoAt(14, 16, 40),
    themeId: 1,
    text: '公园的银杏好美，秋天真的来了。',
    tags: ['留给自己', '风景'],
    imageWide: '/static/img/record-3.jpg',
    imageH: 155,
    synced: true,
  },
]

const isSeed = (r) => String(r.id).startsWith('seed-')
export const isSeedRecord = isSeed

const readFlag = (key) => {
  try {
    return uni.getStorageSync(key)
  } catch (e) {
    return ''
  }
}
/** 是否已经和云端建立同步。建立后本机数据完全以云端为准，示例记录也成为普通记录 */
export const isCloud = () => !!readFlag(CLOUD_KEY)
export const setCloud = () => {
  uni.setStorageSync(CLOUD_KEY, 1)
  persist()
}

function load() {
  let saved = []
  try {
    saved = uni.getStorageSync(KEY)
  } catch (e) {}
  if (isCloud()) return (Array.isArray(saved) ? saved : []).sort((a, b) => b.time - a.time)
  // 示例记录每次按当天重新生成，只持久化用户自己写的
  return [...(Array.isArray(saved) ? saved : []), ...seed()].sort((a, b) => b.time - a.time)
}

function persist() {
  uni.setStorageSync(KEY, isCloud() ? records.value : records.value.filter((r) => !isSeed(r)))
}

/** 全部记录，按时间倒序。各页面共用同一份 */
export const records = ref(load())

const read = (key) => {
  try {
    return uni.getStorageSync(key)
  } catch (e) {
    return ''
  }
}

/* ---------- 主题 ---------- */
export const DEFAULT_ITEMS = ['花费', '用时', '感受']

function loadThemes() {
  const saved = read(THEMES_KEY)
  const list = Array.isArray(saved) && saved.length ? saved : themeSeed
  return list.map((t) => ({ base: 0, hours: 0, items: [...DEFAULT_ITEMS], ...t }))
}

export const themes = ref(loadThemes())

const saveThemes = () => uni.setStorageSync(THEMES_KEY, themes.value)

export function updateTheme(id, patch) {
  themes.value = themes.value.map((t) => (t.id === id ? { ...t, ...patch } : t))
  saveThemes()
}

export function addTheme(data) {
  const id = themes.value.reduce((n, t) => Math.max(n, t.id), 0) + 1
  themes.value = [...themes.value, { id, base: 0, hours: 0, startAt: Date.now(), items: [...DEFAULT_ITEMS], ...data }]
  saveThemes()
  return id
}

/** 删除主题及其下的全部记录 */
export function removeTheme(id) {
  themes.value = themes.value.filter((t) => t.id !== id)
  records.value = records.value.filter((r) => r.themeId !== id)
  saveThemes()
  persist()
}

export function themeCost(t) {
  const extra = records.value.filter((r) => r.themeId === t.id).reduce((n, r) => n + (Number(r.cost) || 0), 0)
  return Math.round(((t.costBase || 0) + extra) * 100) / 100
}

/** 主题内各标签的使用次数，按次数从多到少 */
export function themeTagCounts(t) {
  const m = { ...(t.tagBase || {}) }
  records.value
    .filter((r) => r.themeId === t.id)
    .forEach((r) => (r.tags || []).forEach((x) => (m[x] = (m[x] || 0) + 1)))
  return Object.keys(m)
    .map((name) => ({ name, count: m[name] }))
    .sort((a, b) => b.count - a.count)
}

export function themeCount(t) {
  return t.base + records.value.filter((r) => r.themeId === t.id).length
}

/** 主题累计时长：预设的历史时长 + 各条记录填写的用时 */
export function themeHours(t) {
  const extra = records.value.filter((r) => r.themeId === t.id).reduce((n, r) => n + (Number(r.hours) || 0), 0)
  return Math.round((t.hours + extra) * 10) / 10
}

export function addRecord({ text, themeId, tags, time, images = [], cost, hours, mood }) {
  const rec = {
    id: 'r-' + Date.now(),
    time: time || Date.now(),
    themeId,
    text,
    tags,
    images,
    image: images[0] || '',
    cost,
    hours,
    mood,
    synced: false,
  }
  records.value = [rec, ...records.value].sort((a, b) => b.time - a.time)
  persist()
}

/* ---------- 草稿 ---------- */
const DRAFT_KEY = 'zlm_draft_v1'

export const emptyDraft = (themeId = 1) => ({
  themeId,
  text: '',
  images: [],
  tags: [],
  time: 0, // 0 表示“现在”
  cost: '',
  hours: '',
  mood: -1,
})

// 首次使用时的示例草稿，内容与设计稿一致；保存或清空后不再出现
const sampleDraft = () => ({
  themeId: 1,
  text: '今天沿着河边走了很久，发现熟悉的城市也有新的风景。',
  images: ['/static/img/draft-1.jpg', '/static/img/draft-2.jpg'],
  tags: ['小确幸', '留给自己'],
  time: daysAgoAt(0, 18, 30),
  cost: '',
  hours: '',
  mood: -1,
  sample: true,
})

export function loadDraft() {
  let d
  try {
    d = uni.getStorageSync(DRAFT_KEY)
  } catch (e) {}
  if (d === '' || d === undefined || d === null) return sampleDraft()
  return d && d.themeId ? { ...emptyDraft(), ...d } : null
}

export function saveDraft(d) {
  uni.setStorageSync(DRAFT_KEY, d)
}

/** 保存成记录后清掉草稿（写入 0 作为“已用过”的标记，示例草稿不再出现） */
export function clearDraft() {
  uni.setStorageSync(DRAFT_KEY, 0)
}

export function removeRecord(id) {
  records.value = records.value.filter((r) => r.id !== id)
  persist()
}

/** 长按删除前的确认 */
export function confirmRemove(r) {
  uni.showModal({
    title: '删除这条记录？',
    content: '删除后无法恢复',
    confirmColor: '#f9844e',
    success: (res) => res.confirm && removeRecord(r.id),
  })
}

const pad = (n) => String(n).padStart(2, '0')
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export const hm = (ts) => {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const monthDay = (ts) => {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export const ymdCn = (ts) => {
  const d = new Date(ts)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export const weekday = (ts) => WEEK[new Date(ts).getDay()]

export const fullDate = (ts) => {
  const d = new Date(ts)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekday(ts)}`
}

/** 首页用的相对时间：今天 18:30 / 昨天 18:30 / 10月26日 18:30 */
export function formatTime(ts) {
  const now = new Date()
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= day0) return `今天 ${hm(ts)}`
  if (ts >= day0 - DAY) return `昨天 ${hm(ts)}`
  return `${monthDay(ts)} ${hm(ts)}`
}

export const ranges = ['全部时间', '今天', '最近7天', '最近30天']

export function inRange(ts, index) {
  if (index === 0) return true
  const now = new Date()
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (index === 1) return ts >= day0
  return ts >= day0 - (index === 2 ? 6 : 29) * DAY
}

/* ---------- 标签 ---------- */
const tagSeed = [
  { name: '小确幸', base: 11 },
  { name: '留给自己', base: 7 },
  { name: '第一次', base: 4 },
  { name: '咖啡', base: 3 },
  { name: '风景', base: 2 },
  { name: '和朋友', base: 2 },
  { name: '加班', base: 0, disabled: true },
  { name: '冲动消费', base: 0, disabled: true },
]

function loadTags() {
  const saved = read(TAGS_KEY)
  return Array.isArray(saved) && saved.length ? saved : tagSeed
}

/** 标签登记表：名称、是否停用。记录里用到但没登记的标签会在 allTags 里自动补上 */
export const tagMeta = ref(loadTags())
const saveTags = () => uni.setStorageSync(TAGS_KEY, tagMeta.value)

/** 全部标签及关联记录数，按数量从多到少 */
export function allTags() {
  const used = {}
  records.value.forEach((r) => (r.tags || []).forEach((t) => (used[t] = (used[t] || 0) + 1)))
  const known = tagMeta.value.map((t) => ({ name: t.name, disabled: !!t.disabled, count: (t.base || 0) + (used[t.name] || 0) }))
  const extra = Object.keys(used)
    .filter((n) => !tagMeta.value.some((t) => t.name === n))
    .map((name) => ({ name, disabled: false, count: used[name] }))
  return [...known, ...extra].sort((a, b) => b.count - a.count)
}

const cleanTag = (name) => String(name || '').replace(/[#\s]/g, '').slice(0, 6)

/** 新建标签。返回错误提示，成功返回空串 */
export function addTag(name) {
  const n = cleanTag(name)
  if (!n) return '请输入标签名'
  if (allTags().some((t) => t.name === n)) return '这个标签已经有了'
  tagMeta.value = [...tagMeta.value, { name: n, base: 0 }]
  saveTags()
  return ''
}

/** 重命名：同时更新所有记录、主题预设里的名字 */
export function renameTag(from, to) {
  const n = cleanTag(to)
  if (!n) return '请输入标签名'
  if (n === from) return ''
  if (allTags().some((t) => t.name === n)) return '这个标签已经有了'
  const swap = (list) => (list || []).map((t) => (t === from ? n : t))
  const known = tagMeta.value.some((t) => t.name === from)
  tagMeta.value = known ? tagMeta.value.map((t) => (t.name === from ? { ...t, name: n } : t)) : [...tagMeta.value, { name: n, base: 0 }]
  records.value = records.value.map((r) => ({ ...r, tags: swap(r.tags) }))
  themes.value = themes.value.map((t) => {
    const next = { ...t, tags: t.tags && swap(t.tags) }
    if (t.tagBase && from in t.tagBase) {
      next.tagBase = { ...t.tagBase, [n]: t.tagBase[from] }
      delete next.tagBase[from]
    }
    return next
  })
  saveTags()
  saveThemes()
  persist()
  return ''
}

export function setTagDisabled(name, disabled) {
  const known = tagMeta.value.some((t) => t.name === name)
  tagMeta.value = known
    ? tagMeta.value.map((t) => (t.name === name ? { ...t, disabled } : t))
    : [...tagMeta.value, { name, base: 0, disabled }]
  saveTags()
}

/* ---------- 个人资料（示例） ---------- */
export const profile = { name: '小林', days: 26, avatar: '/static/img/avatar.jpg' }

/* ---------- AI 配置与回顾 ---------- */
// 注意：目前配置只保存在本机。接入云端后应改为服务端加密保存，并由云函数转发请求。
export const aiConfig = ref({ base: '', key: '', model: '', ...(read(AI_KEY) || {}) })

export function saveAiConfig(patch) {
  aiConfig.value = { ...aiConfig.value, ...patch }
  uni.setStorageSync(AI_KEY, aiConfig.value)
}

export const aiReady = () => !!(aiConfig.value.base && aiConfig.value.key && aiConfig.value.model)

const aiUrl = (path) => aiConfig.value.base.replace(/\/+$/, '') + path

function aiDirect(options) {
  return new Promise((resolve, reject) => {
    uni.request({
      timeout: 60000,
      ...options,
      header: { Authorization: 'Bearer ' + aiConfig.value.key, 'Content-Type': 'application/json' },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data)
        const msg = res.data && res.data.error && (res.data.error.message || res.data.error)
        if (res.statusCode === 401 || res.statusCode === 403) reject(new Error('密钥无效或没有权限'))
        else if (res.statusCode === 404) reject(new Error(msg ? String(msg) : '地址或模型不存在'))
        else reject(new Error(msg ? String(msg) : '服务返回错误 ' + res.statusCode))
      },
      fail: (e) => reject(new Error(/timeout/i.test(e.errMsg || '') ? '连接超时' : '无法连接到服务地址')),
    })
  })
}

/** 连接测试：请求模型列表 */
export function testAi() {
  if (!aiReady()) return Promise.reject(new Error('请先填写服务地址、API Key 和模型名称'))
  return aiCall({ test: true })
}

/**
 * 调用 AI。有后端时由后端转发（小程序不能直接请求任意域名），否则从本机直接请求。
 * 返回 { text }；test 为 true 时只检查能否连通。
 */
async function aiCall({ messages, test }) {
  const { base, key, model } = aiConfig.value
  if (backendEnabled) {
    try {
      return await api('POST', '/api/ai', { base, key, model, messages, test })
    } catch (e) {
      // 页面是纯静态托管、没有后端时退回直连
      if (e.status !== 404) throw e
    }
  }
  if (test) return aiDirect({ url: aiUrl('/models'), method: 'GET' })
  const data = await aiDirect({ url: aiUrl('/chat/completions'), method: 'POST', data: { model, messages } })
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
  if (!text) throw new Error('接口没有返回内容')
  return { text: String(text).trim() }
}

export const reviewRanges = [
  { label: '最近7天', days: 7 },
  { label: '最近30天', days: 30 },
  { label: '最近90天', days: 90 },
  { label: '全部时间', days: 0 },
]

export function recordsInRange(themeId, rangeIndex) {
  const days = reviewRanges[rangeIndex].days
  const from = days ? Date.now() - days * DAY : 0
  return records.value.filter((r) => r.themeId === themeId && r.time >= from)
}

const yesterdayAt = (h, m) => {
  const d = new Date(Date.now() - DAY)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

// 示例回顾，内容与设计稿一致
const reviewSeed = () => ({
  '1-1': {
    text: '这个月你出门拍了 8 次，多数在傍晚的河边。记录里出现最多的词是“落日”和“慢下来”。你写到的收获，是重新注意到熟悉的城市。',
    at: yesterdayAt(21, 4),
    by: 'sample',
  },
})

export const reviews = ref({ ...reviewSeed(), ...(read(REVIEW_KEY) || {}) })

function saveReview(key, review) {
  reviews.value = { ...reviews.value, [key]: review }
  const mine = {}
  Object.keys(reviews.value).forEach((k) => {
    if (reviews.value[k].by !== 'sample') mine[k] = reviews.value[k]
  })
  uni.setStorageSync(REVIEW_KEY, mine)
}

export function setReviewText(key, text) {
  const old = reviews.value[key]
  if (old) saveReview(key, { ...old, text, edited: true })
}

// 没有配置 AI 时的本地统计式总结
function localSummary(theme, list, rangeLabel) {
  if (!list.length) return `${rangeLabel}里，「${theme.title}」还没有新的记录。`
  const tags = {}
  list.forEach((r) => (r.tags || []).forEach((t) => (tags[t] = (tags[t] || 0) + 1)))
  const top = Object.keys(tags)
    .sort((a, b) => tags[b] - tags[a])
    .slice(0, 2)
  const hours = list.reduce((n, r) => n + (Number(r.hours) || 0), 0)
  const cost = list.reduce((n, r) => n + (Number(r.cost) || 0), 0)
  let s = `${rangeLabel}里，你在「${theme.title}」记下了 ${list.length} 条经历。`
  if (top.length) s += `用得最多的标签是${top.map((t) => `“${t}”`).join('和')}。`
  if (hours) s += `一共花了约 ${hours} 小时。`
  if (cost) s += `花费约 ${cost} 元。`
  return s
}

/**
 * 生成回顾。配置了 AI 就调用用户自己的接口，否则给出本地统计。
 * 返回 { text, at, by: 'ai' | 'local' }，AI 调用失败时抛出带中文说明的错误。
 */
export async function generateReview(theme, rangeIndex) {
  const key = `${theme.id}-${rangeIndex}`
  const list = recordsInRange(theme.id, rangeIndex)
  const label = reviewRanges[rangeIndex].label
  let review
  if (aiReady()) {
    const lines = list
      .slice(0, 60)
      .map((r) => `- ${monthDay(r.time)} ${r.text.replace(/\n/g, '')}${r.tags && r.tags.length ? '（标签：' + r.tags.join('、') + '）' : ''}`)
      .join('\n')
    const { text } = await aiCall({
      messages: [
        { role: 'system', content: '你是一个帮用户回顾生活记录的助手。只根据给出的记录，用第二人称、平实的中文写 2 到 3 句总结，不超过 90 个字，不编造记录里没有的内容。' },
        { role: 'user', content: `主题：${theme.title}\n时间范围：${label}\n记录共 ${list.length} 条：\n${lines || '（没有记录）'}` },
      ],
    })
    review = { text, at: Date.now(), by: 'ai', sources: list.map((r) => r.id) }
  } else {
    review = { text: localSummary(theme, list, label), at: Date.now(), by: 'local', sources: list.map((r) => r.id) }
  }
  saveReview(key, review)
  return review
}

/* ---------- 分享快照 ---------- */
// 有后端时快照存在后端，别人凭编号可以打开；没有后端时只存在本机。
const localShares = () => read(SHARE_KEY) || {}
const MY_SHARES_KEY = 'zlm_my_shares_v1'
const myShares = () => {
  const v = read(MY_SHARES_KEY)
  return Array.isArray(v) ? v : []
}

/** 这份分享是不是在这台设备上发出的（是的话可以撤回） */
export const isMyShare = (id) => !!localShares()[id] || myShares().includes(id)

/** 撤回分享：之后别人再打开就看不到了 */
export async function revokeSnapshot(id) {
  const all = localShares()
  if (all[id]) {
    delete all[id]
    uni.setStorageSync(SHARE_KEY, all)
    return
  }
  await api('DELETE', '/api/shares/' + encodeURIComponent(id))
  uni.setStorageSync(MY_SHARES_KEY, myShares().filter((x) => x !== id))
}

export async function createSnapshot(snap) {
  if (backendEnabled) {
    try {
      const res = await api('POST', '/api/shares', { snapshot: snap })
      uni.setStorageSync(MY_SHARES_KEY, [...myShares(), res.id])
      return res.id
    } catch (e) {
      if (e.status !== 404) throw e
    }
  }
  const id = 'local-' + Date.now().toString(36)
  const all = localShares()
  all[id] = { ...snap, id, at: Date.now() }
  uni.setStorageSync(SHARE_KEY, all)
  return id
}

/** 读取分享内容；不存在或已撤回时返回 null */
export async function loadSnapshot(id) {
  const local = localShares()[id]
  if (local) return local
  if (!backendEnabled) return null
  try {
    return await api('GET', '/api/shares/' + encodeURIComponent(id))
  } catch (e) {
    if (e.status === 404) return null
    throw e
  }
}

/** 按当前数据组一份分享内容 */
export function buildSnapshot(themeId, opts, text) {
  const t = themes.value.find((x) => x.id === themeId) || themes.value[0]
  const list = records.value.filter((r) => r.themeId === t.id)
  return {
    opts,
    author: profile.name,
    days: profile.days,
    avatar: profile.avatar,
    title: t.title,
    cover: t.coverWide || t.cover,
    startAt: t.startAt,
    count: themeCount(t),
    hours: themeHours(t),
    cost: themeCost(t),
    text,
    tags: themeTagCounts(t)
      .slice(0, 2)
      .map((x) => x.name),
    records: list.slice(0, 3).map((r) => ({
      time: r.time,
      text: r.text.replace(/\n/g, ''),
      image: r.image || r.imageWide || '',
    })),
  }
}

/* ---------- 导出与清空 ---------- */
export function exportData() {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), themes: themes.value, tags: allTags(), records: records.value, reviews: reviews.value },
    null,
    2
  )
}

/** 清空本机数据；有后端时连同云端的记录和分享一起删除 */
export async function wipeAll() {
  if (backendEnabled && isCloud()) await api('DELETE', '/api/account')
  uni.clearStorageSync()
  // 小程序里重新打开首页不会重置内存中的数据，这里手动恢复成初始示例
  themes.value = loadThemes()
  records.value = load()
  tagMeta.value = loadTags()
  reviews.value = reviewSeed()
  aiConfig.value = { base: '', key: '', model: '' }
}

/** 用云端数据覆盖本机（由 sync.js 调用） */
export function applyCloud(data) {
  uni.setStorageSync(CLOUD_KEY, 1)
  if (data.themes.length) themes.value = data.themes.map((t) => ({ base: 0, hours: 0, items: [...DEFAULT_ITEMS], ...t })).sort((a, b) => a.id - b.id)
  records.value = [...data.records].sort((a, b) => b.time - a.time)
  if (data.tags.length) tagMeta.value = data.tags
  reviews.value = { ...reviewSeed(), ...data.reviews }
  saveThemes()
  persist()
  saveTags()
  uni.setStorageSync(REVIEW_KEY, data.reviews)
}
