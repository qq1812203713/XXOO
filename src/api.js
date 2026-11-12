// 与后端通信的最底层：发请求、传图片。页面和数据层不直接碰 uni.request / wx.cloud。
import { ref } from 'vue'
import { CLOUD_ENV, CLOUD_SERVICE, API_BASE } from './config'

/**
 * 同步状态，给“我的”页面显示。
 * status: off（没有后端）| syncing | ok | error
 */
export const syncState = ref({ status: 'off', at: 0, message: '' })

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

let enabled = false
let send = () => Promise.reject(new ApiError('没有可用的后端', 0))
let upload = () => Promise.reject(new ApiError('没有可用的后端', 0))

const finish = (ok, fail, status, data) => {
  if (status >= 200 && status < 300) ok(data)
  else fail(new ApiError((data && data.error) || '服务返回错误 ' + status, status))
}

// #ifdef H5
const DEVICE_KEY = 'zlm_device_v1'
function deviceId() {
  let id = uni.getStorageSync(DEVICE_KEY)
  if (!id) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    uni.setStorageSync(DEVICE_KEY, id)
  }
  return id
}
enabled = true
send = (method, path, data) =>
  new Promise((ok, fail) => {
    uni.request({
      url: API_BASE + path,
      method,
      data,
      timeout: 70000,
      header: { 'X-Device-Id': deviceId(), 'Content-Type': 'application/json' },
      success: (res) => finish(ok, fail, res.statusCode, res.data),
      fail: () => fail(new ApiError('无法连接服务器', 0)),
    })
  })
// H5 上压缩后的照片是 data URL，直接交给后端保存
upload = (path) => send('POST', '/api/files', { dataUrl: path }).then((r) => API_BASE + r.url)
// #endif

// #ifdef MP-WEIXIN
enabled = !!(CLOUD_ENV && CLOUD_SERVICE)
let inited = false
const cloud = () => {
  if (!inited) {
    wx.cloud.init({ env: CLOUD_ENV })
    inited = true
  }
  return wx.cloud
}
if (enabled) {
  send = (method, path, data) =>
    new Promise((ok, fail) => {
      cloud().callContainer({
        config: { env: CLOUD_ENV },
        path,
        method,
        data: method === 'GET' || method === 'DELETE' ? undefined : data,
        timeout: 60000,
        header: { 'X-WX-SERVICE': CLOUD_SERVICE, 'content-type': 'application/json' },
        success: (res) => finish(ok, fail, res.statusCode, res.data),
        fail: (e) => fail(new ApiError('无法连接服务器' + (e && e.errMsg ? '：' + e.errMsg : ''), 0)),
      })
    })
  // 小程序上照片传到云托管自带的对象存储，得到 cloud:// 开头的文件 ID，可直接用在 <image> 上
  upload = (path) =>
    new Promise((ok, fail) => {
      const ext = (/\.(\w+)$/.exec(path) || [])[1] || 'jpg'
      cloud().uploadFile({
        cloudPath: `photos/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`,
        filePath: path,
        config: { env: CLOUD_ENV },
        success: (res) => ok(res.fileID),
        fail: (e) => fail(new ApiError('照片上传失败' + (e && e.errMsg ? '：' + e.errMsg : ''), 0)),
      })
    })
}
// #endif

/** 当前平台是否配置了后端 */
export const backendEnabled = enabled

/** 调用后端接口，失败时抛出带中文说明的错误（err.status 为 HTTP 状态码，连不上时为 0） */
export const api = (method, path, data) => send(method, path, data)

/** 还没上传的本机图片：H5 的 data URL，或小程序的本地文件路径 */
export const isLocalImage = (p) => typeof p === 'string' && /^(data:|wxfile:|http:\/\/(tmp|usr|store)\/)/.test(p)

/** 上传一张本机图片，返回可长期使用的地址 */
export const uploadImage = (path) => upload(path)
