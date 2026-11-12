<template>
  <view class="wrap">
    <view class="head">
      <text class="title">回顾</text>
      <image class="spark" src="/static/img/title-spark.png" />
      <image class="brush" src="/static/img/title-brush.png" />
      <text class="sub">回头看看，这些投入值了吗。</text>
    </view>

    <view class="pickers">
      <view class="pick pick-theme" @tap="pickTheme">
        <image class="pick-img" :src="theme.cover" mode="aspectFill" />
        <text class="pick-text">{{ theme.title }}</text>
        <image class="pick-chev" src="/static/icons/chevron-down-ink.svg" />
      </view>
      <view class="pick pick-range" @tap="pickRange">
        <text class="pick-text">{{ reviewRanges[range].label }}</text>
        <image class="pick-chev" src="/static/icons/chevron-down-ink.svg" />
      </view>
    </view>

    <view class="stats">
      <view class="stat">
        <text class="stat-n">{{ count }}</text>
        <text class="stat-l">条经历</text>
      </view>
      <view class="stat-div" />
      <view class="stat">
        <view class="stat-n">{{ hours }}<text class="stat-unit"> 小时</text></view>
        <text class="stat-l">累计用时</text>
      </view>
      <view class="stat-div" />
      <view class="stat">
        <text class="stat-n">¥{{ cost }}</text>
        <text class="stat-l">累计花费</text>
      </view>
    </view>

    <view class="card ai">
      <view class="ai-head">
        <view class="ai-title">
          <text>AI 回顾</text>
          <image class="ai-spark" src="/static/img/edit-spark.png" />
        </view>
        <text v-if="review" class="ai-time">{{ review.by === 'local' ? '自动统计于' : '生成于' }} {{ monthDay(review.at) }} {{ hm(review.at) }}</text>
      </view>
      <text v-if="review" class="ai-text" @tap="editText">{{ review.text }}</text>
      <text v-else class="ai-text ai-empty">这个范围还没有回顾。点下面的“生成回顾”，整理这段时间的记录。</text>
      <text v-if="review && review.by === 'local'" class="ai-note">还没有配置 AI，以上是按记录自动统计的。可以在“我的”里填写 AI 配置。</text>
      <view v-if="tagCounts.length" class="ai-tags">
        <text v-for="t in tagCounts" :key="t.name" class="ai-tag"># {{ t.name }} ×{{ t.count }}</text>
      </view>
    </view>

    <view class="card src">
      <view class="src-head">
        <text class="src-title">依据的记录</text>
        <text class="src-count">{{ shown.length }} / {{ count }}</text>
      </view>
      <view v-for="r in shown" :key="r.id" class="src-row" @tap="openTheme">
        <image v-if="r.image || r.imageWide" class="src-img" :src="r.image || r.imageWide" mode="aspectFill" />
        <view class="src-body" :class="{ full: !(r.image || r.imageWide) }">
          <text class="src-date">{{ monthDay(r.time) }}</text>
          <text class="src-text">{{ r.text.replace(/\n/g, '') }}</text>
        </view>
      </view>
      <view v-if="!shown.length" class="src-none">这段时间没有可以逐条查看的记录</view>
      <text class="src-all" @tap="openTheme">查看全部</text>
    </view>

    <view class="btns">
      <view class="btn btn-again" @tap="generate">
        <image class="btn-icon" src="/static/icons/refresh.svg" />
        <text>{{ review ? '重新生成' : '生成回顾' }}</text>
      </view>
      <view class="btn btn-share" @tap="share">
        <image class="btn-icon" src="/static/icons/share-white.svg" />
        <text>编辑并分享</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { themes, reviews, reviewRanges, recordsInRange, generateReview, setReviewText, themeHours, themeCost, themeTagCounts, monthDay, hm } from '../store'

const themeId = ref(themes.value[0].id)
const range = ref(1)

const theme = computed(() => themes.value.find((t) => t.id === themeId.value) || themes.value[0])
const key = computed(() => `${theme.value.id}-${range.value}`)
const review = computed(() => reviews.value[key.value])
const inRange = computed(() => recordsInRange(theme.value.id, range.value))
// 示例主题带有未逐条保存的历史数量（base），一并计入
const count = computed(() => theme.value.base + inRange.value.length)
const hours = computed(() => themeHours(theme.value))
const cost = computed(() => themeCost(theme.value))
const tagCounts = computed(() => themeTagCounts(theme.value).slice(0, 3))
const shown = computed(() => inRange.value.slice(0, 3))

function pickTheme() {
  uni.showActionSheet({
    itemList: themes.value.map((t) => t.title),
    success: (res) => (themeId.value = themes.value[res.tapIndex].id),
  })
}

function pickRange() {
  uni.showActionSheet({
    itemList: reviewRanges.map((r) => r.label),
    success: (res) => (range.value = res.tapIndex),
  })
}

async function generate() {
  uni.showLoading({ title: '整理中…', mask: true })
  try {
    await generateReview(theme.value, range.value)
    uni.hideLoading()
  } catch (e) {
    uni.hideLoading()
    uni.showModal({ title: 'AI 生成失败', content: e.message || '请检查 AI 配置后重试', showCancel: false, confirmColor: '#f9844e' })
  }
}

function editText() {
  uni.showModal({
    title: '修改回顾',
    editable: true,
    content: review.value.text,
    confirmColor: '#f9844e',
    success: (res) => {
      const text = (res.content || '').trim()
      if (res.confirm && text) setReviewText(key.value, text)
    },
  })
}

function openTheme() {
  uni.navigateTo({ url: '/pages/theme/theme?id=' + theme.value.id })
}

function share() {
  uni.navigateTo({ url: `/pages/share/preview?themeId=${theme.value.id}&range=${range.value}` })
}
</script>

<style lang="scss" scoped>
@function d($px) {
  @return dw($px, 768);
}

.wrap {
  padding: 0 d(78) d(20) d(79);
}
.head {
  position: relative;
  height: d(199);
}
.title {
  position: absolute;
  left: d(1);
  top: d(33);
  font-size: d(62);
  line-height: d(72);
  font-weight: 700;
  color: #1f302c;
}
.spark {
  position: absolute;
  left: d(124);
  top: d(6);
  width: d(46);
  height: d(46);
}
.brush {
  position: absolute;
  left: 0;
  top: d(101);
  width: d(152);
  height: d(18);
}
.sub {
  position: absolute;
  left: d(1);
  top: d(129);
  font-size: d(31);
  line-height: d(40);
  color: #777b7d;
  white-space: nowrap;
}

.pickers {
  display: flex;
}
.pick {
  display: flex;
  align-items: center;
  height: d(64);
  border: 1px solid #e3dfd9;
  border-radius: d(22);
  background: #fff;
  box-shadow: 0 d(2) d(8) rgba(90, 70, 40, 0.06);
}
.pick-theme {
  flex: none;
  width: d(375);
  margin-right: d(14);
  padding: 0 d(24) 0 d(8);
}
.pick-range {
  flex: 1;
  padding: 0 d(24) 0 d(22);
}
.pick-img {
  flex: none;
  width: d(52);
  height: d(48);
  margin-right: d(18);
  border-radius: d(12);
}
.pick-text {
  flex: 1;
  font-size: d(29);
  font-weight: 500;
  color: #1c1b1c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pick-chev {
  flex: none;
  width: d(30);
  height: d(30);
}

.stats {
  display: flex;
  align-items: center;
  height: d(106);
  margin-top: d(23);
  border-radius: d(24);
  background: #fde6d0;
}
.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.stat-n {
  font-size: d(36);
  line-height: d(42);
  font-weight: 600;
  color: #1c1b1c;
}
.stat-unit {
  font-size: d(25);
  font-weight: 500;
}
.stat-l {
  margin-top: d(2);
  font-size: d(23);
  line-height: d(30);
  color: #2b2f2e;
}
.stat-div {
  width: 1px;
  height: d(46);
  background: #e3c3a2;
}

.card {
  border-radius: d(24);
  background: #fff;
  box-shadow: 0 d(2) d(12) rgba(90, 70, 40, 0.07);
}
.ai {
  margin-top: d(21);
  padding: d(22) d(26) d(22);
}
.ai-head {
  display: flex;
  align-items: center;
  height: d(44);
}
.ai-title {
  position: relative;
  font-size: d(32);
  font-weight: 500;
  color: #1c1b1c;
}
.ai-spark {
  position: absolute;
  right: d(-30);
  top: d(-12);
  width: d(30);
  height: d(30);
}
.ai-time {
  flex: 1;
  text-align: right;
  font-size: d(21);
  color: #6f7375;
}
.ai-text {
  display: block;
  margin-top: d(11);
  font-size: d(25.5);
  line-height: d(34);
  color: #1c1b1c;
}
.ai-empty {
  color: #8c8f8d;
}
.ai-note {
  display: block;
  margin-top: d(10);
  font-size: d(21);
  line-height: d(30);
  color: #b0763f;
}
.ai-tags {
  display: flex;
  flex-wrap: wrap;
  margin: d(15) d(-10) d(-10) 0;
}
.ai-tag {
  height: d(36);
  margin: 0 d(14) d(10) 0;
  padding: 0 d(17);
  border-radius: d(18);
  background: #dcecd9;
  font-size: d(23);
  line-height: d(36);
  color: #24523b;
  white-space: nowrap;
}

.src {
  margin-top: d(14);
  padding: d(12) d(18) d(15) d(26);
}
.src-head {
  display: flex;
  align-items: center;
  height: d(44);
  margin-bottom: d(12);
  padding-right: d(8);
}
.src-title {
  flex: 1;
  font-size: d(32);
  font-weight: 600;
  color: #1c1b1c;
}
.src-count {
  font-size: d(22);
  color: #6f7375;
}
.src-row {
  display: flex;
  align-items: center;
  height: d(72);
  margin-bottom: d(12);
}
.src-img {
  flex: none;
  width: d(126);
  height: d(72);
  margin-right: d(15);
  border-radius: d(12);
}
.src-body {
  flex: 1;
  width: 0;
}
.src-date {
  display: block;
  font-size: d(21);
  line-height: d(30);
  color: #5a5e5d;
}
.src-text {
  display: block;
  font-size: d(24.5);
  line-height: d(36);
  color: #1c1b1c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.src-none {
  padding: d(20) 0 d(30);
  text-align: center;
  font-size: d(24);
  color: #a6a39c;
}
.src-all {
  display: block;
  margin-top: d(-3);
  text-align: center;
  font-size: d(23);
  line-height: d(30);
  color: #5a5e5d;
}

.btns {
  display: flex;
  margin-top: d(23);
}
.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: d(63);
  border-radius: d(32);
  font-size: d(29);
  font-weight: 500;
}
.btn-again {
  flex: none;
  width: d(297);
  margin-right: d(15);
  border: 1px solid #a9aeaa;
  background: #fbf8f3;
  color: #1f302c;
}
.btn-share {
  flex: 1;
  background: linear-gradient(90deg, #fa8b55, #f8854f);
  color: #fff;
}
.btn-icon {
  width: d(38);
  height: d(38);
  margin-right: d(12);
}
</style>
