// 照片压缩：把用户选的照片压到几十 KB 再保存。
//
// - H5：用 canvas 缩小尺寸并编码成 WebP；浏览器不支持 WebP 编码（如部分 Safari）时退回 JPEG。
// - 微信小程序：官方接口只能输出 JPEG（不支持在端上编码 WebP），这里先压成小体积 JPEG；
//   接入云存储后，可在云端再统一转成 WebP。

export const PHOTO_TARGET_BYTES = 80 * 1024 // 目标体积上限
const MAX_SIDE = 1280 // 长边上限（像素）
const MIN_SIDE = 640 // 再小就太糊了，到此为止
const QUALITIES = [0.75, 0.6, 0.45]

// #ifdef H5
const dataUrlBytes = (url) => Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4)

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function draw(img, side) {
  const k = Math.min(1, side / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.width * k))
  c.height = Math.max(1, Math.round(img.height * k))
  const ctx = c.getContext('2d')
  // JPEG 没有透明通道，先铺白底
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return c
}

async function compressH5(path) {
  const img = await loadImage(path)
  let best = ''
  for (let side = MAX_SIDE; side >= MIN_SIDE; side = Math.round(side * 0.75)) {
    const canvas = draw(img, side)
    // 不支持 WebP 编码的浏览器会悄悄返回 PNG，需要检查前缀
    const webp = canvas.toDataURL('image/webp', 0.5).startsWith('data:image/webp')
    const type = webp ? 'image/webp' : 'image/jpeg'
    for (const q of QUALITIES) {
      best = canvas.toDataURL(type, q)
      if (dataUrlBytes(best) <= PHOTO_TARGET_BYTES) return { path: best, size: dataUrlBytes(best), type }
    }
  }
  return { path: best, size: dataUrlBytes(best), type: best.slice(5, best.indexOf(';')) }
}
// #endif

// #ifndef H5
const promisify = (fn, args) => new Promise((success, fail) => fn({ ...args, success, fail }))

async function fileSize(filePath) {
  try {
    const r = await promisify(uni.getFileSystemManager().getFileInfo, { filePath })
    return r.size
  } catch (e) {
    return 0
  }
}

async function compressMp(path) {
  const info = await promisify(uni.getImageInfo, { src: path })
  const landscape = info.width >= info.height
  const longSide = Math.max(info.width, info.height)
  let out = path
  let size = await fileSize(path)
  for (let side = Math.min(MAX_SIDE, longSide); side >= Math.min(MIN_SIDE, longSide); side = Math.round(side * 0.75)) {
    for (const q of QUALITIES) {
      const opt = { src: path, quality: Math.round(q * 100) }
      if (landscape) opt.compressedWidth = side
      else opt.compressedHeight = side
      const r = await promisify(uni.compressImage, opt)
      out = r.tempFilePath
      size = await fileSize(out)
      if (size && size <= PHOTO_TARGET_BYTES) break
    }
    if (size && size <= PHOTO_TARGET_BYTES) break
    if (side <= MIN_SIDE) break
  }
  // 临时文件会被系统清理，存成本地文件
  try {
    const saved = await promisify(uni.saveFile, { tempFilePath: out })
    out = saved.savedFilePath
  } catch (e) {}
  return { path: out, size, type: 'image/jpeg' }
}
// #endif

/**
 * 压缩一张照片。
 * @param {string} path chooseImage 返回的临时路径
 * @returns {Promise<{path: string, size: number, type: string}>} 失败时原样返回 path
 */
export async function compressPhoto(path) {
  try {
    // #ifdef H5
    return await compressH5(path)
    // #endif
    // #ifndef H5
    return await compressMp(path)
    // #endif
  } catch (e) {
    return { path, size: 0, type: '' }
  }
}
