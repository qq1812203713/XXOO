<template>
  <view class="page">
    <!-- #ifdef H5 -->
    <view class="top-gap" />
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <view :style="{ height: statusBarHeight + 'px' }" />
    <!-- #endif -->

    <view class="nav">
      <view class="nav-back" @tap="back"><image class="nav-back-icon" src="/static/icons/back.svg" /></view>
      <text class="nav-title">分享预览</text>
    </view>

    <view class="card">
      <view v-if="opts.cover" class="card-cover">
        <image class="card-cover-img" :src="cardCover" mode="aspectFill" />
        <image class="card-logo" src="/static/img/logo-white.png" mode="widthFix" />
      </view>
      <view class="card-body">
        <view v-if="opts.cover" class="card-title">
          <text class="card-title-text">{{ snap.title }}</text>
          <image class="card-brush" src="/static/img/title-brush.png" />
          <image class="card-spark" src="/static/img/title-spark.png" />
        </view>
        <text class="card-stats">{{ statsLine }}</text>
        <text v-if="opts.text" class="card-text" @tap="editText">{{ text }}</text>
        <view class="card-tags">
          <text v-for="t in snap.tags" :key="t" class="card-tag"># {{ t }}</text>
        </view>
        <view class="card-foot">
          <text class="card-hint">长按识别，我也记一件</text>
          <image class="card-qr" src="/static/img/qr-demo.jpg" />
        </view>
      </view>
    </view>

    <view class="panel">
      <text class="panel-title">公开哪些内容</text>
      <view v-for="o in options" :key="o.key" class="opt" @tap="opts[o.key] = !opts[o.key]">
        <text class="opt-label">{{ o.label }}</text>
        <view class="switch" :class="{ on: opts[o.key] }"><view class="knob" /></view>
      </view>
    </view>

    <view class="note">
      <image class="note-icon" src="/static/icons/lock.svg" />
      <text>只公开你勾选的内容，其他记录仍然只有自己可见。</text>
    </view>

    <view class="btns">
      <view class="btn btn-save" @tap="saveImage">
        <image class="btn-icon" src="/static/icons/download.svg" />
        <text>保存图片</text>
      </view>
      <view class="btn btn-share" @tap="share">
        <image class="btn-icon" src="/static/icons/nodes-white.svg" />
        <text>分享给朋友</text>
      </view>
    </view>

    <!-- #ifdef H5 -->
    <view class="home-indicator"><view class="home-pill" /></view>
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <view class="safe-bottom" />
    <!-- #endif -->
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { themes, reviews, buildSnapshot, createSnapshot } from '../../store'

// 示例回顾对应的分享文案（设计稿里的第一人称短句）
const SAMPLE_SHARE_TEXT = '这个月我出门拍了 8 次，多数在傍晚的河边。重新注意到了熟悉的城市。'

const options = [
  { key: 'cover', label: '封面和主题名' },
  { key: 'text', label: 'AI 回顾文字' },
  { key: 'cost', label: '花费金额' },
  { key: 'photos', label: '照片' },
]
const opts = reactive({ cover: true, text: true, cost: false, photos: true })
const themeId = ref(themes.value[0].id)
const text = ref('')

const statusBarHeight = ref(20)
// #ifndef H5
statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 20
// #endif

onLoad((q) => {
  const id = Number(q && q.themeId)
  if (themes.value.some((t) => t.id === id)) themeId.value = id
  const review = reviews.value[`${themeId.value}-${Number((q && q.range) || 1)}`]
  if (review) text.value = review.by === 'sample' ? SAMPLE_SHARE_TEXT : review.text
  else opts.text = false
})

const snap = computed(() => buildSnapshot(themeId.value, { ...opts }, text.value))
// 卡片封面比例接近 3:2，用主题的小封面裁切更合适
const cardCover = computed(() => (themes.value.find((t) => t.id === themeId.value) || {}).cover || snap.value.cover)
const statsLine = computed(() => {
  const s = snap.value
  return `${s.count} 条经历 · ${s.hours} 小时` + (opts.cost ? ` · ¥${s.cost}` : '')
})

function back() {
  if (getCurrentPages().length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/index/index?tab=2' })
}

function editText() {
  uni.showModal({
    title: '修改分享文字',
    editable: true,
    content: text.value,
    confirmColor: '#f9844e',
    success: (res) => {
      const v = (res.content || '').trim()
      if (res.confirm && v) text.value = v
    },
  })
}

function share() {
  if (!opts.text && !opts.cover && !opts.photos) {
    uni.showToast({ title: '至少公开一项内容', icon: 'none' })
    return
  }
  uni.showModal({
    title: '确认公开？',
    content: '将按上面的开关生成一份公开内容，朋友打开后只能看到这些。',
    confirmText: '确认',
    confirmColor: '#f9844e',
    success: async (res) => {
      if (!res.confirm) return
      uni.showLoading({ title: '生成中…', mask: true })
      try {
        const id = await createSnapshot(snap.value)
        uni.hideLoading()
        // 落地页右上角可以转发给朋友（小程序），也可以撤回
        uni.navigateTo({ url: '/pages/share/landing?id=' + id + '&mine=1' })
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: e.message || '生成失败，请稍后再试', icon: 'none' })
      }
    },
  })
}

function saveImage() {
  // #ifdef H5
  drawCard().then((url) => {
    const a = document.createElement('a')
    a.href = url
    a.download = '值了吗-分享卡.png'
    a.click()
    uni.showToast({ title: '已生成图片', icon: 'none' })
  })
  // #endif
  // #ifndef H5
  uni.showToast({ title: '保存图片将在接入小程序码后开放', icon: 'none' })
  // #endif
}

// #ifdef H5
const loadImg = (src) =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })

function wrap(ctx, str, maxWidth) {
  const lines = []
  let line = ''
  for (const ch of str) {
    if (ctx.measureText(line + ch).width > maxWidth) {
      lines.push(line)
      line = ch
    } else line += ch
  }
  if (line) lines.push(line)
  return lines
}

async function drawCard() {
  const s = snap.value
  const W = 840
  const pad = 54
  const font = (size, weight = 400) => `${weight} ${size}px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')
  ctx.font = font(40)
  const lines = opts.text ? wrap(ctx, text.value, W - pad * 2) : []
  const coverH = opts.cover ? 516 : 0
  const H = coverH + (opts.cover ? 150 : 40) + 70 + lines.length * 62 + 110 + 200
  c.width = W
  c.height = H
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'top'
  let y = 0
  if (opts.cover) {
    const img = await loadImg(cardCover.value)
    if (img) {
      const r = Math.max(W / img.width, coverH / img.height)
      ctx.drawImage(img, (W - img.width * r) / 2, (coverH - img.height * r) / 2, img.width * r, img.height * r)
    }
    ctx.fillStyle = '#fff'
    ctx.font = font(44, 500)
    ctx.fillText('值了吗', pad, coverH - 84)
    y = coverH + 50
    ctx.fillStyle = '#1c1b1c'
    ctx.font = font(74, 700)
    ctx.fillText(s.title, pad, y)
    ctx.fillStyle = '#f6b48f'
    ctx.fillRect(pad, y + 88, Math.min(ctx.measureText(s.title).width, W - pad * 2), 6)
    y += 124
  } else y = 50
  ctx.fillStyle = '#2b4a40'
  ctx.font = font(42)
  ctx.fillText(statsLine.value, pad, y)
  y += 74
  ctx.fillStyle = '#1c1b1c'
  ctx.font = font(40)
  lines.forEach((l) => {
    ctx.fillText(l, pad, y)
    y += 62
  })
  y += 16
  let x = pad
  ctx.font = font(36)
  s.tags.forEach((t) => {
    const label = '# ' + t
    const w = ctx.measureText(label).width + 60
    ctx.fillStyle = '#dcecd9'
    ctx.beginPath()
    ctx.roundRect(x, y, w, 68, 34)
    ctx.fill()
    ctx.fillStyle = '#24523b'
    ctx.fillText(label, x + 30, y + 14)
    x += w + 24
  })
  ctx.fillStyle = '#2b4a40'
  ctx.font = font(36)
  ctx.fillText('长按识别，我也记一件', pad, H - 110)
  const qr = await loadImg('/static/img/qr-demo.jpg')
  if (qr) ctx.drawImage(qr, W - pad - 140, H - 176, 140, 140)
  return c.toDataURL('image/png')
}
// #endif
</script>

<style lang="scss" scoped>
@function d($px) {
  @return dw($px, 768);
}
/* 分享卡片整体比设计稿放大 30%，文字才看得清 */
@function c($px) {
  @return dw($px * 1.3, 768);
}

.page {
  width: 750rpx;
  min-height: 100vh;
  margin: 0 auto;
  background: #fcf9f5;
}
.top-gap {
  height: d(25);
}
.nav {
  position: relative;
  height: d(82);
  text-align: center;
}
.nav-back {
  position: absolute;
  left: d(70);
  top: d(15);
  width: d(52);
  height: d(52);
}
.nav-back-icon {
  width: d(52);
  height: d(52);
}
.nav-title {
  font-size: d(31);
  line-height: d(82);
  font-weight: 600;
  color: #1a3029;
}

.card {
  width: c(420);
  margin: c(13) auto 0;
  border-radius: c(16);
  overflow: hidden;
  background: #fff;
  box-shadow: 0 c(6) c(22) rgba(60, 45, 25, 0.16);
}
.card-cover {
  position: relative;
  height: c(258);
}
.card-cover-img {
  display: block;
  width: 100%;
  height: 100%;
}
.card-logo {
  position: absolute;
  left: c(25);
  bottom: c(14);
  width: c(76);
}
.card-body {
  padding: c(24) c(27) c(20);
}
.card-title {
  position: relative;
  height: c(64);
  margin-bottom: c(8);
}
.card-title-text {
  position: relative;
  z-index: 1;
  font-size: c(38);
  line-height: c(56);
  font-weight: 700;
  color: #1c1b1c;
  white-space: nowrap;
}
.card-brush {
  position: absolute;
  left: 0;
  top: c(50);
  width: c(266);
  height: c(16);
}
.card-spark {
  position: absolute;
  left: c(268);
  top: c(-16);
  width: c(46);
  height: c(46);
}
.card-stats {
  display: block;
  font-size: c(22);
  line-height: c(34);
  color: #2b4a40;
}
.card-text {
  display: block;
  margin-top: c(10);
  font-size: c(22.8);
  line-height: c(35);
  color: #1c1b1c;
}
.card-tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: c(16);
}
.card-tag {
  height: c(36);
  margin: 0 c(12) c(8) 0;
  padding: 0 c(16);
  border-radius: c(18);
  background: #dcecd9;
  font-size: c(20);
  line-height: c(36);
  color: #24523b;
}
.card-foot {
  display: flex;
  align-items: center;
  height: c(72);
  margin-top: c(28);
}
.card-hint {
  flex: 1;
  font-size: c(20);
  color: #2b4a40;
}
.card-qr {
  width: c(72);
  height: c(72);
}

.panel {
  margin: d(36) d(36) 0;
  padding: d(30) d(30) d(18) d(32);
  border-radius: d(28);
  background: #fff;
  box-shadow: 0 d(2) d(12) rgba(90, 70, 40, 0.06);
}
.panel-title {
  display: block;
  margin-bottom: d(8);
  font-size: d(32);
  line-height: d(40);
  font-weight: 600;
  color: #1c1b1c;
}
.opt {
  display: flex;
  align-items: center;
  height: d(84);
}
.opt-label {
  flex: 1;
  font-size: d(29);
  color: #1c1b1c;
}
.switch {
  position: relative;
  width: d(80);
  height: d(46);
  border-radius: d(23);
  background: #cdcdcc;
  transition: background 0.2s;
}
.switch.on {
  background: #f9844e;
}
.knob {
  position: absolute;
  left: d(4);
  top: d(4);
  width: d(38);
  height: d(38);
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.switch.on .knob {
  transform: translateX(#{d(34)});
}

.note {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: d(24);
  font-size: d(23);
  line-height: d(30);
  color: #7b7f82;
}
.note-icon {
  width: d(28);
  height: d(28);
  margin-right: d(10);
}

.btns {
  display: flex;
  margin-top: d(36);
  padding: 0 d(36);
}
.btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: d(80);
  border-radius: d(40);
  font-size: d(29);
  font-weight: 500;
}
.btn-save {
  margin-right: d(20);
  border: 1px solid #2b4a40;
  color: #1f302c;
}
.btn-share {
  background: #f98850;
  color: #fff;
}
.btn-icon {
  width: d(38);
  height: d(38);
  margin-right: d(12);
}
.home-indicator {
  height: d(58);
  padding-top: d(34);
}
.home-pill {
  width: d(272);
  height: d(9);
  margin: 0 auto;
  border-radius: d(5);
  background: #000;
}
.safe-bottom {
  height: calc(#{d(40)} + env(safe-area-inset-bottom));
}
</style>
