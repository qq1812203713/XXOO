<template>
  <view class="page">
    <!-- 顶部留白：小程序为系统状态栏高度，H5 为固定间距 -->
    <!-- #ifdef H5 -->
    <view class="top-gap" />
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <view :style="{ height: statusBarHeight + 'px' }" />
    <!-- #endif -->

    <view class="nav" :style="navStyle">
      <text class="nav-cancel" @tap="cancel">取消</text>
      <text class="nav-title">记一件事</text>
      <view class="nav-save" :class="{ off: !canSave }" :style="saveStyle" @tap="save">保存</view>
    </view>

    <!-- 主题 -->
    <view class="theme" @tap="pickTheme">
      <image class="theme-spark" src="/static/img/edit-spark.png" />
      <image class="theme-img" :src="theme.cover" mode="aspectFill" />
      <text class="theme-title">{{ theme.title }}</text>
      <text class="theme-sub">点击切换主题</text>
      <image class="theme-chev" src="/static/icons/chevron-right.svg" />
    </view>

    <!-- 正文与照片 -->
    <view class="box body">
      <view class="body-head">
        <image class="body-icon" src="/static/icons/pencil.svg" />
        <text>发生了什么？写下你想记住的。</text>
      </view>
      <textarea
        v-model="form.text"
        class="body-input"
        auto-height
        maxlength="1000"
        :show-confirm-bar="false"
        cursor-color="#f9844e"
      />
      <text class="body-count">{{ form.text.length }}/1000</text>
      <view class="photos">
        <view v-for="(src, i) in form.images" :key="src" class="photo">
          <image class="photo-img" :src="src" mode="aspectFill" @tap="previewPhoto(i)" />
          <view class="photo-del" @tap.stop="form.images.splice(i, 1)">
            <image class="photo-del-icon" src="/static/icons/x-white.svg" />
          </view>
        </view>
        <view v-if="form.images.length < MAX_PHOTOS" class="photo-add" @tap="addPhoto">
          <image class="photo-add-icon" src="/static/icons/camera.svg" />
          <text>添加照片</text>
        </view>
      </view>
    </view>

    <!-- 标签 -->
    <view class="box tags">
      <view class="row-head">
        <image class="row-icon" src="/static/icons/tag-ink.svg" />
        <text>标签</text>
      </view>
      <view class="tag-list">
        <view v-for="(t, i) in form.tags" :key="t" class="tag" @tap="form.tags.splice(i, 1)">
          <text>{{ t }}</text>
          <image class="tag-x" src="/static/icons/x-green.svg" />
        </view>
        <view v-if="form.tags.length < MAX_TAGS" class="tag tag-new" @tap="addTag">
          <image class="tag-plus" src="/static/icons/plus-grey.svg" />
          <text>新标签</text>
        </view>
      </view>
    </view>

    <!-- 发生时间：日期和时刻各是一个选择器 -->
    <view class="box time">
      <image class="row-icon" src="/static/icons/clock-ink.svg" />
      <text class="time-label">发生时间</text>
      <picker mode="date" :value="dateValue" :end="today" @change="onDate">
        <text class="time-value">{{ fullDate(when) }}</text>
      </picker>
      <picker mode="time" :value="hm(when)" @change="onTime">
        <text class="time-value time-hm">{{ hm(when) }}</text>
      </picker>
      <image class="time-chev" src="/static/icons/chevron-right.svg" />
    </view>

    <!-- 投入与感受 -->
    <view class="box extra">
      <view class="extra-head" @tap="extraOpen = !extraOpen">
        <image class="extra-icon" src="/static/icons/heart.svg" />
        <text class="extra-title">投入与感受</text>
        <text class="extra-opt">（选填）</text>
        <image class="extra-chev" :class="{ closed: !extraOpen }" src="/static/icons/chevron-down.svg" />
      </view>
      <view v-if="extraOpen" class="extra-rows">
        <view class="field">
          <image class="field-icon" src="/static/icons/coins.svg" />
          <text class="field-label">花费</text>
          <input v-model="form.cost" class="field-input" type="digit" placeholder="例如：50 元" placeholder-class="field-ph" />
        </view>
        <view class="field">
          <image class="field-icon" src="/static/icons/clock.svg" />
          <text class="field-label">用时</text>
          <input v-model="form.hours" class="field-input" type="digit" placeholder="例如：2 小时" placeholder-class="field-ph" />
        </view>
        <view class="field field-mood">
          <image class="field-icon" src="/static/icons/smile.svg" />
          <text class="field-label">当时的感受</text>
          <view class="faces">
            <image
              v-for="n in 5"
              :key="n"
              class="face"
              :src="`/static/icons/face-${n}${form.mood === n - 1 ? '-fill' : ''}.svg`"
              @tap="form.mood = form.mood === n - 1 ? -1 : n - 1"
            />
          </view>
        </view>
      </view>
    </view>

    <view class="draft">
      <image class="draft-icon" src="/static/icons/check.svg" />
      <text>{{ hasContent ? '草稿已保存到本机' : '写下的内容会自动存为草稿' }}</text>
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
import { computed, reactive, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { themes, addRecord, loadDraft, saveDraft, clearDraft, emptyDraft, fullDate, hm } from '../../store'

const MAX_PHOTOS = 9
const MAX_TAGS = 5

const form = reactive(emptyDraft())
const extraOpen = ref(true)
const openedAt = Date.now()

const statusBarHeight = ref(20)
const navStyle = ref('')
const saveStyle = ref('')
// #ifndef H5
const sys = uni.getSystemInfoSync()
statusBarHeight.value = sys.statusBarHeight || 20
// #endif
// #ifdef MP
// 小程序右上角是系统胶囊按钮：导航栏与胶囊对齐，“保存”让到胶囊左侧并与其等高
const cap = uni.getMenuButtonBoundingClientRect()
if (cap && cap.width) {
  const gap = cap.top - statusBarHeight.value
  navStyle.value = `height:${cap.height + gap * 2}px;`
  saveStyle.value = `right:${sys.windowWidth - cap.left + 8}px;height:${cap.height}px;line-height:${cap.height}px;margin-top:${-cap.height / 2}px;`
}
// #endif

const isBlank = (d) => !d.text.trim() && !d.images.length

onLoad((q) => {
  const draft = loadDraft()
  const id = Number(q && q.themeId)
  if (draft && !isBlank(draft)) {
    Object.assign(form, draft)
  } else if (themes.value.some((t) => t.id === id)) {
    form.themeId = id
  }
})

const theme = computed(() => themes.value.find((t) => t.id === form.themeId) || themes.value[0])
const hasContent = computed(() => !isBlank(form))
const canSave = hasContent
const when = computed(() => form.time || openedAt)

const pad = (n) => String(n).padStart(2, '0')
const ymd = (ts) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const dateValue = computed(() => ymd(when.value))
const today = ymd(Date.now())

// 自动存草稿
let timer = 0
watch(
  form,
  () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const { sample, ...rest } = form
      saveDraft({ ...rest, images: [...form.images], tags: [...form.tags] })
    }, 300)
  },
  { deep: true }
)

function pickTheme() {
  uni.showActionSheet({
    itemList: themes.value.map((t) => t.title),
    success: (res) => (form.themeId = themes.value[res.tapIndex].id),
  })
}

function onDate(e) {
  const [y, m, d] = e.detail.value.split('-').map(Number)
  const t = new Date(when.value)
  t.setFullYear(y, m - 1, d)
  form.time = t.getTime()
}

function onTime(e) {
  const [h, m] = e.detail.value.split(':').map(Number)
  const t = new Date(when.value)
  t.setHours(h, m, 0, 0)
  form.time = t.getTime()
}

function addTag() {
  uni.showModal({
    title: '新标签',
    editable: true,
    placeholderText: '最多 6 个字',
    confirmColor: '#f9844e',
    success: (res) => {
      const t = (res.content || '').replace(/[#\s]/g, '').slice(0, 6)
      if (res.confirm && t && !form.tags.includes(t)) form.tags.push(t)
    },
  })
}

// H5：把选中的照片压缩成 dataURL，刷新后仍能显示；小程序：存成本地文件
function keepPhoto(path) {
  return new Promise((resolve) => {
    // #ifdef H5
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, 900 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k)
      c.height = Math.round(img.height * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      resolve(c.toDataURL('image/jpeg', 0.72))
    }
    img.onerror = () => resolve(path)
    img.src = path
    // #endif
    // #ifndef H5
    uni.saveFile({ tempFilePath: path, success: (r) => resolve(r.savedFilePath), fail: () => resolve(path) })
    // #endif
  })
}

function addPhoto() {
  uni.chooseImage({
    count: MAX_PHOTOS - form.images.length,
    sizeType: ['compressed'],
    success: async (res) => {
      for (const p of res.tempFilePaths) {
        const kept = await keepPhoto(p)
        if (form.images.length < MAX_PHOTOS) form.images.push(kept)
      }
    },
  })
}

function previewPhoto(i) {
  uni.previewImage({ urls: form.images, current: i })
}

function leave() {
  if (getCurrentPages().length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/index/index' })
}

function cancel() {
  leave()
}

function save() {
  if (!canSave.value) {
    uni.showToast({ title: '先写点什么吧', icon: 'none' })
    return
  }
  clearTimeout(timer)
  addRecord({
    text: form.text.trim(),
    themeId: form.themeId,
    tags: [...form.tags],
    time: when.value,
    images: [...form.images],
    cost: form.cost === '' ? undefined : Number(form.cost),
    hours: form.hours === '' ? undefined : Number(form.hours),
    mood: form.mood < 0 ? undefined : form.mood,
  })
  clearDraft()
  leave()
}
</script>

<style lang="scss" scoped>
$bg3: #fcf9f5;
$label: #4d5251;

.page {
  width: 750rpx;
  min-height: 100vh;
  margin: 0 auto;
  background: $bg3;
}
.top-gap {
  height: p(28);
}
.box {
  margin: 0 p(27) 0 p(29);
  border-radius: p(30);
  background: #fff;
  box-shadow: 0 p(2) p(14) rgba(90, 70, 40, 0.05);
}

/* ---------- 导航栏 ---------- */
.nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: p(108);
  margin-bottom: p(13);
}
.nav-cancel {
  position: absolute;
  left: p(36);
  top: 50%;
  margin-top: p(-22);
  font-size: p(30);
  line-height: p(44);
  color: #646a69;
}
.nav-title {
  font-size: p(37);
  font-weight: 500;
  color: $ink;
}
.nav-save {
  position: absolute;
  right: p(27);
  top: 50%;
  width: p(144);
  height: p(66);
  margin-top: p(-33);
  border-radius: p(40);
  background: linear-gradient(120deg, #fe8a57, #fc7940);
  color: #fff;
  text-align: center;
  font-size: p(33);
  line-height: p(66);
  font-weight: 500;
}
.nav-save.off {
  opacity: 0.45;
}

/* ---------- 主题 ---------- */
.theme {
  position: relative;
  height: p(155);
  margin: 0 p(27) 0 p(29);
  border-radius: p(34);
  background: #feeddb;
}
.theme-spark {
  position: absolute;
  left: p(527);
  top: p(-19);
  width: p(54);
  height: p(54);
}
.theme-img {
  position: absolute;
  left: p(25);
  top: p(19);
  width: p(190);
  height: p(116);
  border-radius: p(18);
}
.theme-title {
  position: absolute;
  left: p(243);
  top: p(39);
  font-size: p(34);
  line-height: p(44);
  font-weight: 500;
  color: #1a3029;
  white-space: nowrap;
}
.theme-sub {
  position: absolute;
  left: p(243);
  top: p(94);
  font-size: p(23);
  line-height: p(30);
  color: #8a8a85;
}
.theme-chev {
  position: absolute;
  left: p(739);
  top: p(62);
  width: p(34);
  height: p(34);
}

/* ---------- 正文 ---------- */
.body {
  margin-top: p(31);
  padding: 0 p(32) p(30);
}
.body-head {
  display: flex;
  align-items: center;
  height: p(104);
  padding-top: p(6);
  font-size: p(29);
  color: #8c8f8d;
}
.body-icon {
  width: p(46);
  height: p(46);
  margin: 0 p(18) 0 p(-2);
}
.body-input {
  display: block;
  /* 比卡片略窄：与设计稿一致，一行 16 个字 */
  width: p(650);
  min-height: p(233);
  margin: p(4) 0 0 p(9);
  font-size: p(39.5);
  line-height: p(62);
  color: $text;
  caret-color: $orange;
}
.body-count {
  display: block;
  text-align: right;
  font-size: p(23);
  line-height: p(30);
  color: #9a9d9b;
}
.photos {
  display: flex;
  flex-wrap: wrap;
  margin-top: p(31);
}
.photo,
.photo-add {
  position: relative;
  flex: none;
  width: p(222);
  height: p(208);
  margin: 0 p(17) p(17) 0;
}
.photo:nth-child(3n),
.photo-add:nth-child(3n) {
  margin-right: 0;
}
.photo-img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: p(20);
}
.photo-del {
  position: absolute;
  right: p(2);
  top: p(2);
  width: p(40);
  height: p(40);
  border-radius: 50%;
  background: #5d6468;
  display: flex;
  align-items: center;
  justify-content: center;
}
.photo-del-icon {
  width: p(28);
  height: p(28);
}
.photo-add {
  width: p(216);
  display: flex;
  flex-direction: column;
  align-items: center;
  border: p(2.4) dashed #dedbd5;
  border-radius: p(22);
  font-size: p(27);
  color: #8c8f8d;
}
.photo-add-icon {
  width: p(64);
  height: p(64);
  margin: p(46) 0 p(14);
}
/* 照片行的最后一排不需要下边距 */
.photos {
  margin-bottom: p(-17);
}

/* ---------- 标签 ---------- */
.tags {
  margin-top: p(22);
  padding: 0 p(20) p(20);
}
.row-head {
  display: flex;
  align-items: center;
  height: p(81);
  font-size: p(28);
  color: $label;
}
.row-icon {
  flex: none;
  width: p(42);
  height: p(42);
  margin: 0 p(15) 0 p(-4);
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: p(-15);
}
.tag {
  display: flex;
  align-items: center;
  height: p(62);
  margin: 0 p(15) p(15) 0;
  padding: 0 p(24) 0 p(28);
  border-radius: p(31);
  background: #e2f0e0;
  font-size: p(28);
  color: #2e6a4b;
  white-space: nowrap;
}
.tag-x {
  width: p(28);
  height: p(28);
  margin-left: p(10);
}
.tag-new {
  padding: 0 p(27) 0 p(24);
  border: 1px solid #e6e3dd;
  background: #fffdfb;
  color: #7b7f82;
}
.tag-plus {
  width: p(32);
  height: p(32);
  margin-right: p(8);
}

/* ---------- 发生时间 ---------- */
.time {
  display: flex;
  align-items: center;
  height: p(86);
  margin-top: p(21);
  padding: 0 p(20);
}
.time-label {
  flex: 1;
  font-size: p(28);
  color: $label;
}
.time-value {
  display: block;
  font-size: p(28);
  line-height: p(40);
  color: #4d5251;
  white-space: nowrap;
}
.time-hm {
  margin-left: p(12);
}
.time-chev {
  width: p(32);
  height: p(32);
  margin: 0 p(-1) 0 p(10);
}

/* ---------- 投入与感受 ---------- */
.extra {
  margin-top: p(22);
}
.extra-head {
  display: flex;
  align-items: center;
  height: p(81);
  padding: 0 p(20);
}
.extra-icon {
  width: p(46);
  height: p(46);
  margin: 0 p(14) 0 p(2);
}
.extra-title {
  font-size: p(30);
  font-weight: 500;
  color: $ink;
}
.extra-opt {
  flex: 1;
  font-size: p(30);
  color: #7b7f82;
}
.extra-chev {
  width: p(34);
  height: p(34);
  transform: rotate(180deg);
  transition: transform 0.2s;
}
.extra-chev.closed {
  transform: none;
}
.extra-rows {
  padding: 0 p(20) p(24) p(21);
}
.field {
  display: flex;
  align-items: center;
  height: p(62);
  margin-bottom: p(12);
  padding: 0 p(20);
  border-radius: p(18);
  background: #f9f6f1;
}
.field-mood {
  height: p(69);
  margin-bottom: 0;
}
.field-icon {
  flex: none;
  width: p(40);
  height: p(40);
  margin-right: p(17);
}
.field-label {
  flex: none;
  width: p(175);
  font-size: p(26);
  color: #5a5e5d;
  white-space: nowrap;
}
.field-input {
  flex: 1;
  height: p(56);
  font-size: p(26);
  color: $text;
}
.faces {
  display: flex;
  margin-left: p(1);
}
.face {
  width: p(48);
  height: p(48);
  margin-right: p(28.5);
}

/* ---------- 草稿提示 ---------- */
.draft {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: p(59);
  font-size: p(28);
  line-height: p(34);
  color: #6f7375;
}
.draft-icon {
  width: p(40);
  height: p(40);
  margin-right: p(13);
}
.home-indicator {
  height: p(84);
  padding-top: p(40);
}
.home-pill {
  width: p(302);
  height: p(10);
  margin: 0 auto;
  border-radius: p(5);
  background: #000;
}
.safe-bottom {
  height: calc(#{p(40)} + env(safe-area-inset-bottom));
}
</style>

<style lang="scss">
.field-ph {
  color: #a4a6a3;
}
</style>
