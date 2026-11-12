<template>
  <view class="page">
    <!-- #ifdef H5 -->
    <view class="top-gap" />
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <view :style="{ height: statusBarHeight + 'px' }" />
    <!-- #endif -->

    <view class="nav" :style="navStyle">
      <text class="nav-cancel" @tap="leave">取消</text>
      <view class="nav-title">
        <text>{{ isNew ? '新建主题' : '编辑主题' }}</text>
        <image class="nav-spark" src="/static/img/edit-spark.png" />
      </view>
      <view class="nav-save" :class="{ off: !form.title.trim() }" :style="saveStyle" @tap="save">保存</view>
    </view>

    <view class="cover" @tap="changeCover">
      <image class="cover-img" :src="form.coverWide || form.cover" mode="aspectFill" />
      <view class="cover-btn">
        <image class="cover-btn-icon" src="/static/icons/camera-ink.svg" />
        <text>更换封面</text>
      </view>
    </view>

    <view class="box name">
      <text class="label">主题名称</text>
      <view class="name-field">
        <input v-model="form.title" class="name-input" maxlength="20" placeholder="给这件事起个名字" placeholder-class="ph" />
        <image v-if="form.title" class="name-brush" src="/static/img/title-brush.png" />
        <image class="name-mic" src="/static/icons/mic.svg" @tap="voice" />
      </view>
      <text class="count">{{ form.title.length }}/20</text>
    </view>

    <view class="box desc">
      <view class="label"><text>初始期待</text><text class="opt">（选填）</text></view>
      <textarea v-model="form.desc" class="desc-input" maxlength="100" placeholder="开始之前，你期待它带来什么？" placeholder-class="ph" :show-confirm-bar="false" />
      <text class="count">{{ form.desc.length }}/100</text>
    </view>

    <picker mode="date" :value="dateValue" :end="today" @change="onDate">
      <view class="box time">
        <image class="time-icon" src="/static/icons/clock-ink.svg" />
        <text class="time-label">开始时间</text>
        <text class="time-value">{{ ymdCn(form.startAt) }}</text>
        <image class="time-chev" src="/static/icons/chevron-right.svg" />
      </view>
    </picker>

    <view class="box items">
      <view class="items-title"><text>记录项</text><text class="opt">（选填，可跳过）</text></view>
      <view class="chips">
        <view v-for="it in allItems" :key="it" class="chip" :class="{ off: !form.items.includes(it) }" @tap="toggleItem(it)">
          <image class="chip-icon" :src="it === '用时' ? '/static/icons/clock-dk.svg' : '/static/icons/circle-check-dk.svg'" />
          <text>{{ it }}</text>
          <image v-if="form.items.includes(it)" class="chip-check" src="/static/icons/check-dk.svg" />
        </view>
        <view class="chip add" @tap="addItem">
          <image class="chip-icon" src="/static/icons/plus-dk.svg" />
          <text>新增记录项</text>
        </view>
      </view>
    </view>

    <view v-if="!isNew" class="del" @tap="remove">
      <image class="del-icon" src="/static/icons/trash-red.svg" />
      <text>删除这个主题</text>
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
import { compressPhoto } from '../../utils/image'
import { themes, updateTheme, addTheme, removeTheme, themeCount, ymdCn, DEFAULT_ITEMS } from '../../store'

const DEFAULT_COVERS = ['/static/img/theme-1.jpg', '/static/img/theme-2.jpg', '/static/img/theme-3.jpg', '/static/img/theme-4.jpg']

const id = ref(0)
const isNew = computed(() => !id.value)
const form = reactive({
  title: '',
  desc: '',
  startAt: Date.now(),
  cover: DEFAULT_COVERS[themes.value.length % DEFAULT_COVERS.length],
  coverWide: '',
  items: [...DEFAULT_ITEMS],
})
const extraItems = ref([])

const statusBarHeight = ref(20)
const navStyle = ref('')
const saveStyle = ref('')
// #ifndef H5
const sys = uni.getSystemInfoSync()
statusBarHeight.value = sys.statusBarHeight || 20
// #endif
// #ifdef MP
// 右上角是系统胶囊按钮：“保存”让到胶囊左侧并与其等高
const cap = uni.getMenuButtonBoundingClientRect()
if (cap && cap.width) {
  const gap = cap.top - statusBarHeight.value
  navStyle.value = `height:${cap.height + gap * 2}px;`
  saveStyle.value = `right:${sys.windowWidth - cap.left + 8}px;height:${cap.height}px;line-height:${cap.height}px;margin-top:${-cap.height / 2}px;`
}
// #endif

onLoad((q) => {
  const t = themes.value.find((x) => x.id === Number(q && q.id))
  if (!t) return
  id.value = t.id
  Object.assign(form, {
    title: t.title,
    desc: t.desc || '',
    startAt: t.startAt || Date.now(),
    cover: t.cover,
    coverWide: t.coverWide || '',
    items: [...(t.items || DEFAULT_ITEMS)],
  })
})

const allItems = computed(() => [...new Set([...DEFAULT_ITEMS, ...form.items, ...extraItems.value])])

const pad = (n) => String(n).padStart(2, '0')
const ymd = (ts) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const dateValue = computed(() => ymd(form.startAt))
const today = ymd(Date.now())

function onDate(e) {
  const [y, m, d] = e.detail.value.split('-').map(Number)
  form.startAt = new Date(y, m - 1, d).getTime()
}

function toggleItem(it) {
  const i = form.items.indexOf(it)
  if (i >= 0) form.items.splice(i, 1)
  else form.items.push(it)
}

function addItem() {
  uni.showModal({
    title: '新增记录项',
    editable: true,
    placeholderText: '例如：距离、心情分',
    confirmColor: '#f9844e',
    success: (res) => {
      const name = (res.content || '').trim().slice(0, 6)
      if (!res.confirm || !name) return
      if (!allItems.value.includes(name)) extraItems.value.push(name)
      if (!form.items.includes(name)) form.items.push(name)
    },
  })
}

function changeCover() {
  uni.chooseImage({
    count: 1,
    sizeType: ['original'],
    success: async (res) => {
      uni.showLoading({ title: '压缩照片…', mask: true })
      const photo = await compressPhoto(res.tempFilePaths[0])
      uni.hideLoading()
      form.cover = photo.path
      form.coverWide = photo.path
    },
  })
}

function voice() {
  uni.showToast({ title: '语音输入将在后续版本接入', icon: 'none' })
}

function leave() {
  if (getCurrentPages().length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/index/index' })
}

function save() {
  const title = form.title.trim()
  if (!title) {
    uni.showToast({ title: '先给主题起个名字', icon: 'none' })
    return
  }
  const data = { title, desc: form.desc.trim(), startAt: form.startAt, cover: form.cover, coverWide: form.coverWide, items: [...form.items] }
  if (isNew.value) addTheme(data)
  else updateTheme(id.value, data)
  leave()
}

function remove() {
  if (themes.value.length <= 1) {
    uni.showToast({ title: '至少保留一个主题', icon: 'none' })
    return
  }
  const t = themes.value.find((x) => x.id === id.value)
  uni.showModal({
    title: '删除这个主题？',
    content: `「${t.title}」和它下面的 ${themeCount(t)} 条经历都会被删除，无法恢复。`,
    confirmText: '删除',
    confirmColor: '#e0502f',
    success: (res) => {
      if (!res.confirm) return
      removeTheme(id.value)
      uni.reLaunch({ url: '/pages/index/index' })
    },
  })
}
</script>

<style lang="scss" scoped>
@function d($px) {
  @return dw($px, 704);
}

.page {
  width: 750rpx;
  min-height: 100vh;
  margin: 0 auto;
  background: #fcf9f5;
}
.top-gap {
  height: d(22);
}
.box {
  margin: 0 d(24);
  border-radius: d(26);
  background: #fff;
  box-shadow: 0 d(2) d(12) rgba(90, 70, 40, 0.05);
}
.opt {
  font-size: d(25);
  font-weight: 400;
  color: #7b7f82;
}
.count {
  display: block;
  text-align: right;
  font-size: d(22);
  line-height: d(30);
  color: #8c8f8d;
}

/* ---------- 导航栏 ---------- */
.nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: d(70);
  margin-bottom: d(22);
}
.nav-cancel {
  position: absolute;
  left: d(30);
  top: 50%;
  margin-top: d(-20);
  font-size: d(26);
  line-height: d(40);
  color: #646a69;
}
.nav-title {
  position: relative;
  font-size: d(31);
  font-weight: 600;
  color: #1a3029;
}
.nav-spark {
  position: absolute;
  right: d(-38);
  top: d(-22);
  width: d(38);
  height: d(38);
}
.nav-save {
  position: absolute;
  right: d(23);
  top: 50%;
  width: d(117);
  height: d(56);
  margin-top: d(-28);
  border-radius: d(30);
  background: linear-gradient(120deg, #fe8a57, #fc7940);
  color: #fff;
  text-align: center;
  font-size: d(27);
  line-height: d(56);
  font-weight: 500;
}
.nav-save.off {
  opacity: 0.45;
}

/* ---------- 封面 ---------- */
.cover {
  position: relative;
  margin: 0 d(24);
  height: d(242);
}
.cover-img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: d(28);
}
.cover-btn {
  position: absolute;
  right: d(13);
  bottom: d(14);
  display: flex;
  align-items: center;
  height: d(45);
  padding: 0 d(17) 0 d(15);
  border-radius: d(23);
  background: rgba(255, 255, 255, 0.84);
  font-size: d(23);
  color: #2b2f2e;
}
.cover-btn-icon {
  width: d(30);
  height: d(30);
  margin-right: d(8);
}

/* ---------- 名称 ---------- */
.name {
  margin-top: d(25);
  padding: d(26) d(19) d(22);
}
.label {
  display: block;
  padding-left: d(9);
  font-size: d(27);
  line-height: d(36);
  font-weight: 500;
  color: #1f302c;
}
.name-field {
  position: relative;
  height: d(72);
  margin-top: d(15);
  border-radius: d(20);
  background: #f6f3ee;
}
.name-input {
  position: relative;
  z-index: 1;
  height: d(72);
  padding: 0 d(70) 0 d(14);
  font-size: d(37);
  color: #1c1b1c;
}
.name-brush {
  position: absolute;
  left: d(10);
  top: d(56);
  width: d(266);
  height: d(18);
}
.name-mic {
  position: absolute;
  z-index: 2;
  right: d(16);
  top: d(18);
  width: d(36);
  height: d(36);
}
.name .count {
  margin-top: d(12);
}

/* ---------- 初始期待 ---------- */
.desc {
  margin-top: d(18);
  padding: d(27) d(19) d(22);
}
.desc-input {
  display: block;
  width: 100%;
  height: d(195);
  margin-top: d(14);
  padding: d(18) d(14);
  border-radius: d(20);
  background: #f6f3ee;
  font-size: d(28);
  line-height: d(40);
  color: #1c1b1c;
}
.desc .count {
  margin-top: d(12);
}

/* ---------- 开始时间 ---------- */
.time {
  display: flex;
  align-items: center;
  height: d(72);
  margin-top: d(18);
  padding: 0 d(16);
}
.time-icon {
  width: d(34);
  height: d(34);
  margin-right: d(13);
}
.time-label {
  flex: 1;
  font-size: d(29);
  color: #1f302c;
}
.time-value {
  font-size: d(27);
  color: #2b2f2e;
}
.time-chev {
  width: d(28);
  height: d(28);
  margin-left: d(8);
}

/* ---------- 记录项 ---------- */
.items {
  margin-top: d(18);
  padding: d(23) d(19) d(7);
}
.items-title {
  font-size: d(29);
  line-height: d(36);
  font-weight: 500;
  color: #1f302c;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  margin-top: d(15);
}
.chip {
  display: flex;
  align-items: center;
  height: d(55);
  margin: 0 d(14) d(13) 0;
  padding: 0 d(22) 0 d(20);
  border: 1px solid transparent;
  border-radius: d(28);
  background: #dcecd9;
  font-size: d(25);
  color: #24523b;
  white-space: nowrap;
}
.chip.off,
.chip.add {
  border-color: #b9d4b6;
  background: #fbfdfb;
}
.chip-icon {
  width: d(32);
  height: d(32);
  margin-right: d(9);
}
.chip-check {
  width: d(26);
  height: d(26);
  margin-left: d(10);
}

/* ---------- 删除 ---------- */
.del {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: d(95);
  font-size: d(27);
  line-height: d(34);
  color: #e0582f;
}
.del-icon {
  width: d(34);
  height: d(34);
  margin-right: d(10);
}
.home-indicator {
  height: d(84);
  padding-top: d(56);
}
.home-pill {
  width: d(250);
  height: d(8);
  margin: 0 auto;
  border-radius: d(4);
  background: #000;
}
.safe-bottom {
  height: calc(#{d(50)} + env(safe-area-inset-bottom));
}
</style>

<style lang="scss">
.ph {
  color: #b0b2af;
}
</style>
