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
      <view class="nav-back" @tap="back"><image class="nav-back-icon" src="/static/icons/back.svg" /></view>
      <text class="nav-title">主题详情</text>
      <view class="nav-edit" :style="editStyle" @tap="editDesc">
        <image class="nav-edit-icon" src="/static/icons/pencil.svg" />
        <text>编辑</text>
      </view>
    </view>

    <image class="cover" :src="theme.coverWide || theme.cover" mode="aspectFill" />

    <view class="head">
      <text class="title">{{ theme.title }}</text>
      <image class="title-brush" src="/static/img/title-brush.png" />
      <image class="title-spark" src="/static/img/title-spark.png" />
      <image class="start-icon" src="/static/icons/calendar.svg" />
      <text class="start">开始于 {{ theme.start }}</text>
      <view class="desc-wrap">
        <text class="desc">{{ theme.desc }}</text>
        <view class="desc-line" />
      </view>
    </view>

    <view class="stats">
      <view class="stat">
        <image class="stat-icon" src="/static/icons/doc.svg" />
        <text class="stat-n">{{ count }}</text>
        <text class="stat-l">条经历</text>
      </view>
      <view class="stat-div" />
      <view class="stat stat-r">
        <image class="stat-icon" src="/static/icons/clock.svg" />
        <text class="stat-l">累计</text>
        <text class="stat-n mid">{{ hours }}</text>
        <text class="stat-l">小时</text>
      </view>
    </view>

    <scroll-view class="chips" scroll-x :show-scrollbar="false">
      <view class="chips-in">
        <view class="chip" :class="{ on: tag === '' }" @tap="tag = ''">全部</view>
        <view v-for="t in tagOptions" :key="t" class="chip" :class="{ on: tag === t }" @tap="tag = t">{{ t }}</view>
      </view>
    </scroll-view>

    <view class="timeline">
      <view v-for="r in list" :key="r.id" class="item" @longpress="confirmRemove(r)">
        <view class="item-line" />
        <view class="item-dot" />
        <text class="item-date">{{ monthDay(r.time) }}</text>
        <text class="item-time">{{ weekday(r.time) }} {{ hm(r.time) }}</text>
        <view class="rec">
          <text class="rec-text">{{ r.text }}</text>
          <view v-if="r.tags && r.tags.length" class="rec-tags">
            <text v-for="t in r.tags" :key="t" class="rec-tag"># {{ t }}</text>
          </view>
          <image
            v-if="r.imageWide || r.image"
            class="rec-img"
            :style="{ height: imgHeight(r) }"
            :src="r.imageWide || r.image"
            mode="aspectFill"
            @tap="preview(r)"
          />
          <view class="rec-sync">
            <image class="rec-sync-icon" src="/static/icons/check.svg" />
            <text>{{ r.synced ? '已同步' : '已保存在本机' }}</text>
          </view>
        </view>
      </view>
      <view v-if="!list.length" class="empty">{{ tag ? '这个标签下还没有记录' : '还没有记录，写下第一条吧' }}</view>
    </view>

    <view class="bar-space" />

    <view class="bar">
      <view class="bar-btns">
        <view class="btn-review" @tap="review">
          <image class="btn-icon" src="/static/icons/history.svg" />
          <text>回顾</text>
        </view>
        <view class="btn-add" @tap="addNew">
          <image class="btn-icon" src="/static/icons/plus-white.svg" />
          <text>记录新经历</text>
        </view>
      </view>
      <!-- #ifdef H5 -->
      <view class="home-indicator"><view class="home-pill" /></view>
      <!-- #endif -->
    </view>

  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { themes, records, themeCount, themeHours, setThemeDesc, confirmRemove, monthDay, weekday, hm } from '../../store'

const themeId = ref(1)
const tag = ref('')

const statusBarHeight = ref(20)
const navStyle = ref('')
const editStyle = ref('')
// #ifndef H5
const sys = uni.getSystemInfoSync()
statusBarHeight.value = sys.statusBarHeight || 20
// #endif
// #ifdef MP
// 小程序右上角是系统胶囊按钮：导航栏与胶囊等高对齐，“编辑”让到胶囊左侧
const cap = uni.getMenuButtonBoundingClientRect()
if (cap && cap.width) {
  const gap = cap.top - statusBarHeight.value
  navStyle.value = `height:${cap.height + gap * 2}px;`
  editStyle.value = `right:${sys.windowWidth - cap.left + 8}px;`
}
// #endif

onLoad((q) => {
  const id = Number(q && q.id)
  if (themes.value.some((t) => t.id === id)) themeId.value = id
})

const theme = computed(() => themes.value.find((t) => t.id === themeId.value))
const mine = computed(() => records.value.filter((r) => r.themeId === themeId.value))
const count = computed(() => themeCount(theme.value))
const hours = computed(() => themeHours(theme.value))
const list = computed(() => (tag.value ? mine.value.filter((r) => (r.tags || []).includes(tag.value)) : mine.value))

// 筛选标签：主题预设的在前，再补上用户自己记录里用过的；没有预设时取出现最多的三个
const tagOptions = computed(() => {
  const preset = theme.value.tags || []
  const m = {}
  mine.value
    .filter((r) => !preset.length || !String(r.id).startsWith('seed-'))
    .forEach((r) => (r.tags || []).forEach((t) => (m[t] = (m[t] || 0) + 1)))
  const rest = Object.keys(m)
    .filter((t) => !preset.includes(t))
    .sort((a, b) => m[b] - m[a])
  return preset.length ? [...preset, ...rest] : rest.slice(0, 3)
})

// 图片高度（设计稿像素）换算成 rpx
const imgHeight = (r) => ((r.imageH || 155) * 750) / 852 + 'rpx'

function back() {
  if (getCurrentPages().length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/index/index' })
}

function preview(r) {
  const urls = r.images && r.images.length ? r.images : [r.imageWide || r.image]
  uni.previewImage({ urls })
}

function addNew() {
  uni.navigateTo({ url: '/pages/edit/edit?themeId=' + themeId.value })
}

function review() {
  uni.reLaunch({ url: '/pages/index/index?tab=2' })
}

function editDesc() {
  uni.showModal({
    title: '修改主题简介',
    editable: true,
    content: theme.value.desc,
    placeholderText: '一句话描述这个主题',
    confirmColor: '#f9844e',
    success: (res) => {
      const text = (res.content || '').trim()
      if (res.confirm && text) setThemeDesc(theme.value.id, text.slice(0, 30))
    },
  })
}
</script>

<style lang="scss" scoped>
$bg2: #fcf8f4;

.page {
  width: 750rpx;
  min-height: 100vh;
  margin: 0 auto;
  background: $bg2;
}
.top-gap {
  height: p(28);
}

/* ---------- 导航栏 ---------- */
.nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: p(86);
  margin-bottom: p(6);
}
.nav-back {
  position: absolute;
  left: p(22);
  top: 50%;
  width: p(66);
  height: p(66);
  margin-top: p(-33);
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-back-icon {
  width: p(50);
  height: p(50);
}
.nav-title {
  font-size: p(34.5);
  font-weight: 500;
  color: $ink;
}
.nav-edit {
  position: absolute;
  right: p(40);
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  font-size: p(27.5);
  color: #6f7375;
}
.nav-edit-icon {
  width: p(48);
  height: p(48);
  margin-right: p(8);
}

/* ---------- 封面与标题 ---------- */
.cover {
  display: block;
  width: p(788);
  height: p(246);
  margin: 0 auto;
  border-radius: p(30);
}
.head {
  position: relative;
  height: p(223);
}
.title {
  position: absolute;
  left: p(35);
  top: p(29);
  font-size: p(50);
  line-height: p(64);
  font-weight: 500;
  color: #1a3029;
  white-space: nowrap;
}
.title-brush {
  position: absolute;
  left: p(30);
  top: p(94);
  width: p(364);
  height: p(22);
}
.title-spark {
  position: absolute;
  left: p(760);
  top: p(24);
  width: p(58);
  height: p(58);
}
.start-icon {
  position: absolute;
  left: p(34);
  top: p(115);
  width: p(42);
  height: p(42);
}
.start {
  position: absolute;
  left: p(84);
  top: p(119);
  font-size: p(28.5);
  line-height: p(34);
  color: #4d5251;
  white-space: nowrap;
}
.desc-wrap {
  position: absolute;
  left: p(34);
  top: p(163);
  padding: 0 p(8);
}
.desc {
  display: block;
  font-size: p(27);
  line-height: p(34);
  color: #3c403f;
  white-space: nowrap;
}
.desc-line {
  height: p(4);
  margin: 0 p(-8);
  border-radius: p(2);
  background: linear-gradient(90deg, #e3dfda, #dcd8d3 80%, rgba(220, 216, 211, 0.3));
}

/* ---------- 统计条 ---------- */
.stats {
  position: relative;
  display: flex;
  align-items: center;
  height: p(80);
  margin: 0 p(32);
  border-radius: p(30);
  background: #fef2e5;
}
.stat {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: p(14);
}
.stat-r {
  padding-left: p(20);
}
.stat-icon {
  width: p(50);
  height: p(50);
  margin-right: p(16);
}
.stat-n {
  margin-right: p(11);
  font-size: p(28.5);
  font-weight: 600;
  color: $ink;
}
.stat-n.mid {
  margin-left: p(11);
}
.stat-l {
  font-size: p(27);
  color: #6b6f6d;
}
.stat-div {
  position: absolute;
  left: 50%;
  top: p(26);
  width: 1px;
  height: p(28);
  background: #d9d3ca;
}

/* ---------- 标签筛选 ---------- */
.chips {
  margin-top: p(27);
  white-space: nowrap;
}
.chips-in {
  display: inline-flex;
  padding: 0 p(36);
}
.chip {
  flex: none;
  height: p(60);
  margin-right: p(20);
  padding: 0 p(27);
  border: 1px solid #e8e4de;
  border-radius: p(30);
  background: #fdf9f5;
  font-size: p(27);
  line-height: p(58);
  color: #55595a;
}
.chip.on {
  padding: 0 p(34);
  border-color: transparent;
  background: linear-gradient(90deg, #fdb06e, #fe8a50);
  color: #fff;
  font-weight: 600;
  box-shadow: 0 p(4) p(10) rgba(249, 132, 78, 0.22);
}

/* ---------- 时间线 ---------- */
.timeline {
  margin-top: p(26);
}
.item {
  position: relative;
  margin-bottom: p(25);
  padding: 0 p(34) 0 p(258);
}
.item-line {
  position: absolute;
  left: p(46);
  top: p(31);
  bottom: p(-56);
  width: p(2.4);
  background: #f6dece;
}
.item-dot {
  position: absolute;
  left: p(38);
  top: p(22);
  width: p(18);
  height: p(18);
  border-radius: 50%;
  background: #fb864c;
}
.item-date {
  position: absolute;
  left: p(82);
  top: p(14);
  font-size: p(27);
  line-height: p(34);
  font-weight: 600;
  color: #24403a;
}
.item-time {
  position: absolute;
  left: p(82);
  top: p(54);
  font-size: p(22.5);
  line-height: p(30);
  color: #8b918d;
}
.rec {
  padding: p(17) p(16) p(11);
  border-radius: p(22);
  background: #fff;
  box-shadow: 0 p(2) p(12) rgba(90, 70, 40, 0.07);
}
.rec-text {
  display: block;
  padding: 0 p(6);
  font-size: p(28);
  line-height: p(42);
  color: $text;
}
.rec-tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: p(7);
  padding: 0 p(6);
}
.rec-tag {
  height: p(36);
  margin-right: p(14);
  padding: 0 p(16);
  border-radius: p(18);
  background: #dfeedd;
  color: #2e6a4b;
  font-size: p(21.5);
  line-height: p(36);
  white-space: nowrap;
}
.rec-img {
  display: block;
  width: 100%;
  margin-top: p(12);
  border-radius: p(16);
}
.rec-sync {
  display: flex;
  align-items: center;
  margin-top: p(10);
  padding: 0 p(6);
  font-size: p(21);
  line-height: p(30);
  color: $grey;
}
.rec-sync-icon {
  width: p(26);
  height: p(26);
  margin-right: p(11);
}
.empty {
  padding: p(80) 0;
  text-align: center;
  font-size: p(26);
  color: #a6a39c;
}

/* ---------- 底部操作栏 ---------- */
.bar-space {
  height: calc(#{p(150)} + env(safe-area-inset-bottom));
}
.bar {
  position: fixed;
  left: 50%;
  width: 750rpx;
  margin-left: -375rpx;
  bottom: 0;
  z-index: 10;
  background: #fdfaf5;
  border-top: 1px solid #f1ede8;
  padding-bottom: env(safe-area-inset-bottom);
}
.bar-btns {
  display: flex;
  padding: p(16) p(32) p(20);
}
.btn-review,
.btn-add {
  display: flex;
  align-items: center;
  justify-content: center;
  height: p(76);
  border-radius: p(38);
  font-size: p(27);
  font-weight: 500;
}
.btn-review {
  flex: none;
  width: p(259);
  margin-right: p(21);
  border: 1px solid #e9e4dd;
  background: #fcf8f3;
  color: $ink;
}
.btn-add {
  flex: 1;
  background: linear-gradient(90deg, #fa8b55, #f8854f);
  color: #fff;
}
.btn-icon {
  width: p(56);
  height: p(56);
  margin-right: p(14);
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
</style>
