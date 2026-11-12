// 数据层：主题与记录。记录保存在本地存储，后续可替换为云端接口。
import { ref } from 'vue'

const KEY = 'zlm_records_v1'
const DESC_KEY = 'zlm_theme_desc_v1'
const DAY = 86400000

// base：示例数据之外的历史条数，用来凑出设计稿上的数量
const themeSeed = [
  {
    id: 1,
    title: '带着相机去散步',
    cover: '/static/img/theme-1.jpg',
    coverWide: '/static/img/cover-1.jpg',
    start: '2025年10月1日',
    desc: '放慢一点，收集日常里容易错过的光。',
    hours: 6,
    tags: ['小确幸', '第一次', '留给自己'],
    base: 5,
  },
  {
    id: 2,
    title: '我的咖啡角落',
    cover: '/static/img/theme-2.jpg',
    start: '2025年9月12日',
    desc: '一杯咖啡的时间，留给自己发会儿呆。',
    hours: 4,
    base: 6,
  },
  {
    id: 3,
    title: '学吉他的第30天',
    cover: '/static/img/theme-3.jpg',
    start: '2025年9月27日',
    desc: '手指还是会疼，但和弦慢慢顺了。',
    hours: 15,
    base: 12,
  },
  {
    id: 4,
    title: '认真过周末',
    cover: '/static/img/theme-4.jpg',
    start: '2025年8月2日',
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

function load() {
  let saved = []
  try {
    saved = uni.getStorageSync(KEY)
  } catch (e) {}
  // 示例记录每次按当天重新生成，只持久化用户自己写的
  return [...(Array.isArray(saved) ? saved : []), ...seed()].sort((a, b) => b.time - a.time)
}

function persist() {
  uni.setStorageSync(KEY, records.value.filter((r) => !isSeed(r)))
}

/** 全部记录，按时间倒序。各页面共用同一份 */
export const records = ref(load())

function loadThemes() {
  let desc = {}
  try {
    desc = uni.getStorageSync(DESC_KEY) || {}
  } catch (e) {}
  return themeSeed.map((t) => ({ ...t, desc: desc[t.id] || t.desc }))
}

export const themes = ref(loadThemes())

export function setThemeDesc(id, text) {
  themes.value = themes.value.map((t) => (t.id === id ? { ...t, desc: text } : t))
  const map = {}
  themes.value.forEach((t) => (map[t.id] = t.desc))
  uni.setStorageSync(DESC_KEY, map)
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
