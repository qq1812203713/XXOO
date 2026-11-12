<template>
  <view class="page">
    <!-- 顶部留白：小程序为系统状态栏高度，H5 为固定间距 -->
    <!-- #ifdef H5 -->
    <view class="top-gap" />
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <view :style="{ height: statusBarHeight + 'px' }" />
    <!-- #endif -->

    <!-- ================= 首页 ================= -->
    <view v-if="tab === 0">
      <view class="hero">
        <image class="logo" src="/static/img/logo.png" />
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
        <view v-for="t in themeList" :key="t.id" class="card" @tap="openTheme(t.id)">
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
        <record-card v-for="r in filtered" :key="r.id" :record="r" @remove="confirmRemove(r)" />
        <view v-if="!filtered.length" class="empty">这段时间还没有记录</view>
      </view>
    </view>

    <tab-tags v-else-if="tab === 1" />
    <tab-review v-else-if="tab === 2" />
    <tab-mine v-else />

    <view class="tabbar-space" />

    <!-- ================= 底部导航 ================= -->
    <view class="tabbar">
      <view class="tabs">
        <view v-for="(t, i) in tabs" :key="t.key" class="tab" @tap="tab = i">
          <image class="tab-icon" :src="`/static/icons/tab-${t.key}${tab === i ? '-fill' : ''}.svg`" />
          <text class="tab-label" :class="{ on: tab === i }">{{ t.label }}</text>
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
import RecordCard from '../../components/record-card.vue'
import TabTags from '../../components/tab-tags.vue'
import TabReview from '../../components/tab-review.vue'
import TabMine from '../../components/tab-mine.vue'
import { themes, records, ranges, inRange, themeCount, confirmRemove } from '../../store'

const tabs = [
  { key: 'home', label: '首页' },
  { key: 'tag', label: '标签' },
  { key: 'clock', label: '回顾' },
  { key: 'user', label: '我的' },
]
const tab = ref(0)
const range = ref(0)

const statusBarHeight = ref(20)
// #ifndef H5
statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 20
// #endif

// 从其它页面带 ?tab=2 回来时直接切到对应标签页
onLoad((q) => {
  const i = Number(q && q.tab)
  if (i >= 0 && i < tabs.length) tab.value = i
})

const themeList = computed(() => themes.value.map((t) => ({ ...t, count: themeCount(t) })))
const filtered = computed(() => records.value.filter((r) => inRange(r.time, range.value)))

function openEditor() {
  uni.navigateTo({ url: '/pages/edit/edit' })
}

function openTheme(id) {
  uni.navigateTo({ url: '/pages/theme/theme?id=' + id })
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
.top-gap {
  height: p(28);
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
.empty {
  padding: p(80) 0;
  text-align: center;
  font-size: p(26);
  color: #a6a39c;
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
</style>
