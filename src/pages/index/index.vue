<template>
  <view class="page">
    <!-- 状态栏：小程序用真实状态栏高度；H5 预览画一条与设计稿一致的假状态栏 -->
    <!-- #ifdef H5 -->
    <image class="statusbar" src="/static/img/statusbar.png" />
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <view :style="{ height: statusBarHeight + 'px' }" />
    <!-- #endif -->

    <!-- ================= 首页 ================= -->
    <view v-if="tab === 0">
      <view class="hero">
        <image class="logo" src="/static/img/logo.png" />
        <view class="gear" :style="gearStyle" @tap="tab = 3">
          <image class="gear-icon" src="/static/icons/gear.svg" />
        </view>
        <text class="h1">把生活，记成自己的答案。</text>
        <text class="h2">今天，也有一些值得记住的小事。</text>
        <image class="brush" src="/static/img/brush.png" />
      </view>

      <view class="banner" @tap="openEditor">
        <image class="banner-bg" src="/static/img/banner.jpg" />
        <text class="banner-title">今天想记点什么？</text>
        <text class="banner-sub">一段经历，一个念头，都可以。</text>
        <view class="plus"><view class="plus-h" /><view class="plus-v" /></view>
      </view>

      <view class="sec sec-themes">
        <view class="sec-bar" />
        <text class="sec-title">我的主题</text>
        <view class="sec-more">
          <text>查看全部</text>
          <image class="chev" src="/static/icons/chevron-right.svg" />
        </view>
      </view>

      <view class="grid">
        <view v-for="t in themeList" :key="t.id" class="card" @tap="openEditor(t.id)">
          <image class="card-img" :src="t.cover" mode="aspectFill" />
          <text class="card-title">{{ t.title }}</text>
          <text class="card-sub">{{ t.count }} 条经历</text>
          <image class="card-chev" src="/static/icons/chevron-right.svg" />
        </view>
      </view>

      <view class="sec sec-recent">
        <view class="sec-bar" />
        <text class="sec-title">最近记录</text>
        <view class="pill" @tap="pickRange">
          <text>{{ ranges[range] }}</text>
          <image class="pill-chev" src="/static/icons/chevron-down.svg" />
        </view>
      </view>

      <view class="records">
        <record-card v-for="r in filtered" :key="r.id" :record="r" @remove="remove(r)" />
        <view v-if="!filtered.length" class="empty">这段时间还没有记录</view>
      </view>
    </view>

    <!-- ================= 标签 ================= -->
    <view v-else-if="tab === 1" class="sub-page">
      <text class="sub-h">标签</text>
      <view class="tag-cloud">
        <view v-for="t in tagList" :key="t.name" class="tag-big"># {{ t.name }}<text class="tag-n">{{ t.count }}</text></view>
      </view>
      <view v-if="!tagList.length" class="empty">记录时加上标签，就会出现在这里</view>
    </view>

    <!-- ================= 回顾 ================= -->
    <view v-else-if="tab === 2" class="sub-page">
      <text class="sub-h">回顾</text>
      <view class="records flush">
        <record-card v-for="r in records" :key="r.id" :record="r" @remove="remove(r)" />
      </view>
    </view>

    <!-- ================= 我的 ================= -->
    <view v-else class="sub-page">
      <text class="sub-h">我的</text>
      <view class="stats">
        <view class="stat"><text class="stat-n">{{ totalCount }}</text><text class="stat-l">条经历</text></view>
        <view class="stat"><text class="stat-n">{{ themeList.length }}</text><text class="stat-l">个主题</text></view>
        <view class="stat"><text class="stat-n">{{ tagList.length }}</text><text class="stat-l">个标签</text></view>
      </view>
    </view>

    <view class="tabbar-space" />

    <!-- ================= 底部导航 ================= -->
    <view class="tabbar">
      <view class="tabs">
        <view v-for="(t, i) in tabs" :key="t.key" class="tab" @tap="tab = i">
          <image class="tab-icon" :src="`/static/icons/tab-${t.key}${tab === i ? '-on' : ''}.svg`" />
          <text class="tab-label" :class="{ on: tab === i }">{{ t.label }}</text>
        </view>
      </view>
      <!-- #ifdef H5 -->
      <view class="home-indicator"><view class="home-pill" /></view>
      <!-- #endif -->
    </view>

    <!-- ================= 写记录 ================= -->
    <view v-if="editor.show" class="mask" @tap="editor.show = false">
      <view class="sheet" @tap.stop>
        <text class="sheet-title">今天想记点什么？</text>
        <textarea v-model="editor.text" class="sheet-input" placeholder="一段经历，一个念头，都可以。" maxlength="300" :auto-height="false" :show-confirm-bar="false" />
        <text class="sheet-label">放进哪个主题</text>
        <view class="chips">
          <view v-for="t in themeList" :key="t.id" class="chip" :class="{ on: editor.themeId === t.id }" @tap="editor.themeId = t.id">{{ t.title }}</view>
        </view>
        <text class="sheet-label">标签（空格分隔，可不填）</text>
        <input v-model="editor.tags" class="sheet-tags" placeholder="小确幸 留给自己" />
        <view class="sheet-btn" :class="{ off: !editor.text.trim() }" @tap="save">记下来</view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import RecordCard from '../../components/record-card.vue'
import { themes, ranges, loadRecords, saveRecords, inRange } from '../../store'

const tabs = [
  { key: 'home', label: '首页' },
  { key: 'tag', label: '标签' },
  { key: 'clock', label: '回顾' },
  { key: 'user', label: '我的' },
]
const tab = ref(0)
const range = ref(0)
const records = ref(loadRecords())
const editor = reactive({ show: false, text: '', themeId: 1, tags: '' })

const statusBarHeight = ref(20)
const gearStyle = ref('')
// #ifndef H5
const sys = uni.getSystemInfoSync()
statusBarHeight.value = sys.statusBarHeight || 20
// #endif
// #ifdef MP
// 小程序右上角有胶囊按钮，设置图标挪到胶囊左侧并与其垂直对齐
const cap = uni.getMenuButtonBoundingClientRect()
if (cap && cap.width) {
  const size = (sys.windowWidth * 64) / 852
  const top = cap.top + cap.height / 2 - statusBarHeight.value - size / 2
  gearStyle.value = `left:auto;right:${sys.windowWidth - cap.left + 10}px;top:${top}px;`
}
// #endif

const themeList = computed(() =>
  themes.map((t) => ({ ...t, count: t.base + records.value.filter((r) => r.themeId === t.id).length }))
)
const totalCount = computed(() => themeList.value.reduce((n, t) => n + t.count, 0))
const filtered = computed(() => records.value.filter((r) => inRange(r.time, range.value)))
const tagList = computed(() => {
  const m = {}
  records.value.forEach((r) => (r.tags || []).forEach((t) => (m[t] = (m[t] || 0) + 1)))
  return Object.keys(m)
    .map((name) => ({ name, count: m[name] }))
    .sort((a, b) => b.count - a.count)
})

function openEditor(themeId) {
  editor.text = ''
  editor.tags = ''
  if (typeof themeId === 'number') editor.themeId = themeId
  editor.show = true
}

function save() {
  const text = editor.text.trim()
  if (!text) return
  const tags = editor.tags.split(/[\s,，#]+/).filter(Boolean).slice(0, 3)
  records.value = [
    { id: 'r-' + Date.now(), time: Date.now(), themeId: editor.themeId, text, tags, image: '', synced: false },
    ...records.value,
  ]
  saveRecords(records.value)
  editor.show = false
}

function remove(r) {
  uni.showModal({
    title: '删除这条记录？',
    content: '删除后无法恢复',
    confirmColor: '#f9844e',
    success: (res) => {
      if (!res.confirm) return
      records.value = records.value.filter((x) => x.id !== r.id)
      saveRecords(records.value)
    },
  })
}

function pickRange() {
  uni.showActionSheet({ itemList: ranges, success: (res) => (range.value = res.tapIndex) })
}
</script>

<style lang="scss" scoped>
.page {
  /* 750rpx 在手机上等于屏宽；桌面浏览器里则居中成一列手机宽度 */
  width: 750rpx;
  min-height: 100vh;
  margin: 0 auto;
  background: $bg;
}
.statusbar {
  display: block;
  width: p(852);
  height: p(84);
}

/* ---------- 顶部 ---------- */
.hero {
  position: relative;
  height: p(308);
}
.logo {
  position: absolute;
  left: p(40);
  top: 0;
  width: p(212);
  height: p(94);
}
.gear {
  position: absolute;
  left: p(757);
  top: p(30);
  width: p(64);
  height: p(64);
}
.gear-icon {
  display: block;
  width: 100%;
  height: 100%;
}
.h1 {
  position: absolute;
  left: p(45);
  top: p(135);
  font-size: p(46);
  line-height: p(60);
  font-weight: 600;
  color: $ink;
  white-space: nowrap;
}
.h2 {
  position: absolute;
  left: p(45);
  top: p(215);
  font-size: p(33.6);
  line-height: p(44);
  color: #777b7d;
  white-space: nowrap;
}
.brush {
  position: absolute;
  left: p(40);
  top: p(254);
  width: p(370);
  height: p(26);
}

/* ---------- 横幅 ---------- */
.banner {
  position: relative;
  margin: 0 p(34) 0 p(32);
  height: p(164);
}
.banner-bg {
  position: absolute;
  left: p(-4);
  top: p(-46);
  width: p(796);
  height: p(214);
}
.banner-title {
  position: absolute;
  left: p(36);
  top: p(38);
  font-size: p(36.5);
  line-height: p(50);
  font-weight: 600;
  color: $ink;
  white-space: nowrap;
}
.banner-sub {
  position: absolute;
  left: p(38);
  top: p(96);
  font-size: p(27.8);
  line-height: p(40);
  color: #77756f;
  white-space: nowrap;
}
.plus {
  position: absolute;
  left: p(663);
  top: p(40);
  width: p(94);
  height: p(94);
  border-radius: 50%;
  background: linear-gradient(160deg, #fb8d57, #f57a45);
}
.plus-h,
.plus-v {
  position: absolute;
  left: 50%;
  top: 50%;
  background: #fff;
  border-radius: p(3);
  transform: translate(-50%, -50%);
}
.plus-h {
  width: p(40);
  height: p(5);
}
.plus-v {
  width: p(5);
  height: p(40);
}

/* ---------- 分区标题 ---------- */
.sec {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 p(34) 0 p(67);
}
.sec-themes {
  margin-top: p(50);
  height: p(46);
}
.sec-recent {
  margin-top: p(50);
  height: p(47);
}
.sec-bar {
  position: absolute;
  left: p(33);
  top: 50%;
  width: p(7);
  height: p(34);
  margin-top: p(-17);
  border-radius: p(4);
  background: $orange;
}
.sec-recent .sec-bar {
  margin-top: p(-21);
}
.sec-title {
  flex: 1;
  font-size: p(38);
  line-height: p(46);
  font-weight: 600;
  color: $ink;
}
.sec-recent .sec-title {
  transform: translateY(p(-4));
}
.sec-more {
  display: flex;
  align-items: center;
  font-size: p(26.5);
  color: #6f7375;
}
.chev {
  width: p(30);
  height: p(30);
  margin-left: p(10);
}
.pill {
  display: flex;
  align-items: center;
  height: p(47);
  padding: 0 p(16) 0 p(20);
  border: 1px solid #e6e3dd;
  border-radius: p(24);
  background: #fff;
  font-size: p(22);
  color: #2b2b2b;
}
.pill-chev {
  width: p(26);
  height: p(26);
  margin-left: p(12);
}

/* ---------- 主题卡片 ---------- */
.grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  margin-top: p(23);
  padding: 0 p(35) 0 p(41);
}
.card {
  position: relative;
  width: p(374);
  height: p(301);
  margin-bottom: p(36);
  border-radius: p(22);
  background: #fff;
  box-shadow: 0 p(2) p(12) rgba(90, 70, 40, 0.07);
  overflow: hidden;
}
.card:nth-child(n + 3) {
  margin-bottom: 0;
}
.card-img {
  display: block;
  width: 100%;
  height: p(192);
}
.card-title {
  position: absolute;
  left: p(26);
  right: p(20);
  top: p(213);
  font-size: p(28.4);
  line-height: p(36);
  font-weight: 500;
  color: $text;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-sub {
  position: absolute;
  left: p(26);
  top: p(258);
  font-size: p(24);
  line-height: p(30);
  color: $grey;
}
.card-chev {
  position: absolute;
  left: p(322);
  top: p(258);
  width: p(30);
  height: p(30);
}

/* ---------- 记录 ---------- */
.records {
  margin-top: p(11);
  padding: 0 p(34);
}
.records.flush {
  margin-top: p(30);
}
.empty {
  padding: p(80) 0;
  text-align: center;
  font-size: p(26);
  color: #a6a39c;
}

/* ---------- 其它 tab ---------- */
.sub-page {
  padding-top: p(30);
}
.sub-h {
  display: block;
  padding: 0 p(45);
  font-size: p(46);
  line-height: p(60);
  font-weight: 600;
  color: $ink;
}
.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  padding: p(30) p(34) 0;
}
.tag-big {
  margin: 0 p(16) p(16) 0;
  padding: 0 p(24);
  height: p(60);
  line-height: p(60);
  border-radius: p(30);
  background: #dfeedd;
  color: #2e6a4b;
  font-size: p(28);
}
.tag-n {
  margin-left: p(12);
  opacity: 0.6;
}
.stats {
  display: flex;
  margin: p(30) p(34) 0;
  padding: p(36) 0;
  border-radius: p(22);
  background: #fff;
  box-shadow: 0 p(2) p(12) rgba(90, 70, 40, 0.07);
}
.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.stat-n {
  font-size: p(48);
  font-weight: 600;
  color: $ink;
}
.stat-l {
  margin-top: p(6);
  font-size: p(24);
  color: $grey;
}

/* ---------- 底部导航 ---------- */
.tabbar-space {
  height: calc(#{p(150)} + env(safe-area-inset-bottom));
}
.tabbar {
  position: fixed;
  left: 50%;
  width: 750rpx;
  margin-left: -375rpx;
  bottom: 0;
  z-index: 10;
  background: #fff;
  border-top: 1px solid #efede9;
  padding-bottom: env(safe-area-inset-bottom);
}
.tabs {
  display: flex;
  height: p(108);
}
.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.tab-icon {
  width: p(54);
  height: p(54);
  margin-top: p(13);
}
.tab-label {
  margin-top: p(3);
  font-size: p(22);
  line-height: p(30);
  color: $grey;
}
.tab-label.on {
  color: $orange;
}
.home-indicator {
  height: p(48);
}
.home-pill {
  width: p(302);
  height: p(10);
  margin: 0 auto;
  transform: translateY(p(20));
  border-radius: p(5);
  background: #000;
}

/* ---------- 写记录弹层 ---------- */
.mask {
  position: fixed;
  left: 50%;
  width: 750rpx;
  margin-left: -375rpx;
  top: 0;
  height: 100%;
  z-index: 20;
  display: flex;
  align-items: flex-end;
  background: rgba(30, 25, 20, 0.4);
}
.sheet {
  width: 100%;
  padding: p(44) p(40) calc(#{p(44)} + env(safe-area-inset-bottom));
  border-radius: p(36) p(36) 0 0;
  background: $bg;
}
.sheet-title {
  display: block;
  font-size: p(38);
  font-weight: 600;
  color: $ink;
}
.sheet-input {
  width: 100%;
  height: p(220);
  margin-top: p(26);
  padding: p(24);
  border-radius: p(22);
  background: #fff;
  font-size: p(30);
  line-height: p(42);
}
.sheet-label {
  display: block;
  margin-top: p(30);
  font-size: p(24);
  color: $grey;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  margin-top: p(14);
}
.chip {
  margin: 0 p(14) p(14) 0;
  padding: 0 p(22);
  height: p(56);
  line-height: p(56);
  border-radius: p(28);
  background: #fff;
  border: 1px solid #e6e3dd;
  font-size: p(25);
  color: #4a4a48;
}
.chip.on {
  border-color: $orange;
  background: #fff1e8;
  color: #d9622c;
}
.sheet-tags {
  height: p(76);
  margin-top: p(14);
  padding: 0 p(24);
  border-radius: p(22);
  background: #fff;
  font-size: p(28);
}
.sheet-btn {
  margin-top: p(36);
  height: p(92);
  line-height: p(92);
  border-radius: p(46);
  background: linear-gradient(160deg, #fb8d57, #f57a45);
  color: #fff;
  text-align: center;
  font-size: p(32);
  font-weight: 600;
}
.sheet-btn.off {
  opacity: 0.45;
}
</style>
