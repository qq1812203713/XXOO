<template>
  <view class="page">
    <!-- #ifdef H5 -->
    <view class="top-gap" />
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <view :style="{ height: statusBarHeight + 'px' }" />
    <!-- #endif -->

    <view class="top">
      <image class="logo" src="/static/img/logo.png" mode="widthFix" />
      <text class="from">来自朋友的分享</text>
    </view>

    <view v-if="!snap" class="gone">
      <text class="gone-title">这份分享看不到了</text>
      <text class="gone-text">它可能已被对方撤回，或者还没有同步到云端。</text>
    </view>

    <template v-else>
      <view class="author">
        <image class="author-avatar" :src="snap.avatar" mode="aspectFill" />
        <view>
          <text class="author-name">{{ snap.author }}</text>
          <text class="author-days">记录了 {{ snap.days }} 天</text>
        </view>
      </view>

      <template v-if="snap.opts.cover">
        <image class="cover" :src="snap.cover" mode="aspectFill" />
        <view class="title">
          <text class="title-text">{{ snap.title }}</text>
          <image class="title-brush" src="/static/img/title-brush.png" />
        </view>
        <text class="start">开始于 {{ ymdCn(snap.startAt) }}</text>
      </template>

      <view class="stats">
        <view class="stat">
          <image class="stat-icon" src="/static/icons/doc.svg" />
          <text class="stat-n">{{ snap.count }}</text><text class="stat-u">条经历</text>
        </view>
        <view class="stat-div" />
        <view class="stat">
          <image class="stat-icon" src="/static/icons/clock.svg" />
          <text class="stat-u">累计</text><text class="stat-n">{{ snap.hours }}</text><text class="stat-u">小时</text>
        </view>
        <template v-if="snap.opts.cost">
          <view class="stat-div" />
          <view class="stat"><text class="stat-u">花费</text><text class="stat-n">¥{{ snap.cost }}</text></view>
        </template>
      </view>

      <view v-if="snap.opts.text && snap.text" class="box quote">
        <text class="quote-mark">“</text>
        <text class="quote-text">{{ snap.text }}</text>
        <view class="quote-tags">
          <text v-for="t in snap.tags" :key="t" class="quote-tag"># {{ t }}</text>
        </view>
      </view>

      <view v-if="list.length" class="box pub">
        <text class="pub-title">公开的经历</text>
        <view v-for="(r, i) in list" :key="i" class="pub-row">
          <text class="pub-date">{{ monthDay(r.time) }}</text>
          <view class="pub-main" :class="{ line: i > 0 }">
            <text class="pub-text">{{ r.text }}</text>
            <image v-if="snap.opts.photos && r.image" class="pub-img" :src="r.image" mode="aspectFill" />
          </view>
        </view>
      </view>

      <view class="note">
        <image class="note-icon" src="/static/icons/lock.svg" />
        <text>仅展示对方选择公开的内容</text>
      </view>
    </template>

    <view class="cta" @tap="start">
      <image class="cta-icon" src="/static/icons/tabs-plus.svg" />
      <text>我也记一件</text>
    </view>
    <text class="slogan">把生活，记成自己的答案。</text>

    <!-- #ifdef H5 -->
    <view class="home-indicator"><view class="home-pill" /></view>
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <view class="safe-bottom" />
    <!-- #endif -->
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { loadSnapshot, buildSnapshot, themes, monthDay, ymdCn } from '../../store'

const SAMPLE_SHARE_TEXT = '这个月我出门拍了 8 次，多数在傍晚的河边。重新注意到了熟悉的城市。'

const snap = ref(null)
const statusBarHeight = ref(20)
// #ifndef H5
statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 20
// #endif

onLoad((q) => {
  if (q && q.id) snap.value = loadSnapshot(q.id)
  // 不带 id 打开时展示一份示例，方便预览页面样式
  else snap.value = buildSnapshot(themes.value[0].id, { cover: true, text: true, cost: false, photos: true }, SAMPLE_SHARE_TEXT)
})

const list = computed(() => (snap.value ? snap.value.records.slice(0, 2) : []))

function start() {
  uni.reLaunch({ url: '/pages/index/index' })
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
  padding: 0 d(27);
  box-sizing: border-box;
  background: #fcf9f5;
}
.top-gap {
  height: d(22);
}
.top {
  display: flex;
  align-items: center;
  height: d(100);
}
.logo {
  width: d(175);
  margin-left: d(8);
}
.from {
  flex: 1;
  margin-right: d(6);
  text-align: right;
  font-size: d(24);
  color: #7b7f82;
}

.author {
  display: flex;
  align-items: center;
  height: d(72);
  margin: d(14) 0 0 d(10);
}
.author-avatar {
  width: d(70);
  height: d(70);
  margin-right: d(16);
  border-radius: 50%;
}
.author-name {
  display: block;
  font-size: d(28);
  line-height: d(36);
  font-weight: 600;
  color: #1c1b1c;
}
.author-days {
  display: block;
  font-size: d(24);
  line-height: d(34);
  color: #6f7375;
}

.cover {
  display: block;
  width: 100%;
  height: d(230);
  margin-top: d(26);
  border-radius: d(26);
}
.title {
  position: relative;
  height: d(84);
  margin: d(34) 0 0 d(6);
}
.title-text {
  position: relative;
  z-index: 1;
  font-size: d(47);
  line-height: d(64);
  font-weight: 700;
  color: #1c1b1c;
  white-space: nowrap;
}
.title-brush {
  position: absolute;
  left: 0;
  top: d(56);
  width: d(330);
  height: d(20);
}
.start {
  display: block;
  margin: d(2) 0 0 d(6);
  font-size: d(25);
  line-height: d(36);
  color: #4d5150;
}

.stats {
  display: flex;
  align-items: center;
  height: d(80);
  margin-top: d(28);
  border-radius: d(26);
  background: #fde9d6;
}
.stat {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: d(24);
  color: #3a3d3c;
}
.stat-icon {
  width: d(34);
  height: d(34);
  margin-right: d(16);
}
.stat-n {
  margin: 0 d(7);
  font-weight: 600;
  color: #1c1b1c;
}
.stat-div {
  width: 1px;
  height: d(28);
  background: #dcc3a8;
}

.box {
  margin-top: d(27);
  border-radius: d(26);
  background: #fff;
  box-shadow: 0 d(2) d(12) rgba(90, 70, 40, 0.07);
}
.quote {
  position: relative;
  padding: d(32) d(26) d(32) d(70);
}
.quote-mark {
  position: absolute;
  left: d(24);
  top: d(20);
  font-size: d(76);
  line-height: d(76);
  font-family: Georgia, serif;
  font-weight: 700;
  color: #e3cdb8;
}
.quote-text {
  display: block;
  font-size: d(26);
  line-height: d(42);
  color: #1c1b1c;
}
.quote-tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: d(18);
}
.quote-tag {
  height: d(36);
  margin-right: d(12);
  padding: 0 d(16);
  border-radius: d(18);
  background: #dcecd9;
  font-size: d(21);
  line-height: d(36);
  color: #24523b;
}

.pub {
  margin-top: d(27);
  padding: d(32) d(26) d(14) d(27);
}
.pub-title {
  display: block;
  margin-bottom: d(8);
  font-size: d(28);
  line-height: d(38);
  font-weight: 600;
  color: #1c1b1c;
}
.pub-row {
  display: flex;
}
.pub-date {
  flex: none;
  width: d(140);
  padding-top: d(24);
  font-size: d(25);
  line-height: d(36);
  color: #1c1b1c;
}
.pub-main {
  flex: 1;
  display: flex;
  min-height: d(130);
  padding: d(24) 0 d(25);
  box-sizing: border-box;
}
.pub-main.line {
  border-top: 1px solid #ece9e4;
}
.pub-text {
  flex: 1;
  max-height: d(72);
  font-size: d(25.5);
  line-height: d(36);
  color: #1c1b1c;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pub-img {
  flex: none;
  width: d(81);
  height: d(81);
  margin-left: d(18);
  border-radius: d(12);
}

.note {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: d(28);
  font-size: d(23);
  line-height: d(32);
  color: #5a5e5d;
}
.note-icon {
  width: d(28);
  height: d(28);
  margin-right: d(8);
}
.gone {
  padding: d(160) 0 d(120);
  text-align: center;
}
.gone-title {
  display: block;
  font-size: d(34);
  font-weight: 600;
  color: #1f302c;
}
.gone-text {
  display: block;
  margin-top: d(16);
  font-size: d(25);
  color: #7b7f82;
}

.cta {
  display: flex;
  align-items: center;
  justify-content: center;
  height: d(84);
  margin-top: d(40);
  border-radius: d(38);
  background: #f67f47;
  font-size: d(30);
  font-weight: 500;
  color: #fff;
}
.cta-icon {
  width: d(42);
  height: d(42);
  margin-right: d(10);
}
.slogan {
  display: block;
  margin-top: d(19);
  text-align: center;
  font-size: d(23);
  line-height: d(32);
  color: #3a3d3c;
}
.home-indicator {
  height: d(60);
  padding-top: d(38);
}
.home-pill {
  width: d(250);
  height: d(8);
  margin: 0 auto;
  border-radius: d(4);
  background: #000;
}
.safe-bottom {
  height: calc(#{d(30)} + env(safe-area-inset-bottom));
}
</style>
