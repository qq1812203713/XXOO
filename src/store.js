// 记录数据：本地存储，后续可替换为云端接口
const KEY = 'zlm_records_v1'

export const themes = [
  { id: 1, title: '带着相机去散步', cover: '/static/img/theme-1.jpg', base: 7 },
  { id: 2, title: '我的咖啡角落', cover: '/static/img/theme-2.jpg', base: 6 },
  { id: 3, title: '学吉他的第30天', cover: '/static/img/theme-3.jpg', base: 12 },
  { id: 4, title: '认真过周末', cover: '/static/img/theme-4.jpg', base: 10 },
]

function todayAt(h, m) {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

const seed = () => [
  {
    id: 'seed-1',
    time: todayAt(18, 30),
    themeId: 1,
    text: '下班绕路去了河边。拍到落日的那一刻，觉得这趟散步很值得。',
    tags: ['小确幸', '留给自己'],
    image: '/static/img/record-1.jpg',
    synced: true,
  },
]

export function loadRecords() {
  try {
    const saved = uni.getStorageSync(KEY)
    // 示例记录始终显示为“今天”，只持久化用户自己写的
    return [...(Array.isArray(saved) ? saved : []), ...seed()].sort((a, b) => b.time - a.time)
  } catch (e) {
    return seed()
  }
}

export function saveRecords(list) {
  uni.setStorageSync(KEY, list.filter((r) => !String(r.id).startsWith('seed-')))
}

const pad = (n) => String(n).padStart(2, '0')

export function formatTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (ts >= day0) return `今天 ${hm}`
  if (ts >= day0 - 86400000) return `昨天 ${hm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}

export const ranges = ['全部时间', '今天', '最近7天', '最近30天']

export function inRange(ts, index) {
  if (index === 0) return true
  const now = new Date()
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (index === 1) return ts >= day0
  return ts >= day0 - (index === 2 ? 6 : 29) * 86400000
}
