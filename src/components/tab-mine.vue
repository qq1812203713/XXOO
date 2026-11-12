<template>
  <view class="wrap">
    <view class="me">
      <image class="me-spark" src="/static/img/edit-spark.png" />
      <image class="me-avatar" :src="profile.avatar" mode="aspectFill" />
      <text class="me-name">{{ profile.name }}</text>
      <text class="me-days">已记录 {{ profile.days }} 天</text>
      <image class="me-brush" src="/static/img/brush.png" />
      <view class="me-stats">
        <view class="me-stat"><text class="me-n">{{ recordCount }}</text><text class="me-l">条经历</text></view>
        <view class="me-div" />
        <view class="me-stat"><text class="me-n">{{ themes.length }}</text><text class="me-l">个主题</text></view>
        <view class="me-div" />
        <view class="me-stat"><text class="me-n">{{ tagCount }}</text><text class="me-l">个标签</text></view>
      </view>
    </view>

    <view class="sec"><view class="sec-bar" /><text class="sec-title">同步</text></view>
    <view class="card sync" @tap="retry">
      <image class="sync-icon" src="/static/icons/cloud.svg" />
      <text class="sync-label">云端同步</text>
      <text class="sync-state" :class="sync.cls">{{ sync.text }}</text>
      <text class="sync-time">{{ sync.side }}</text>
    </view>

    <view class="sec"><view class="sec-bar" /><text class="sec-title">AI 配置</text><text class="sec-opt">（选填）</text></view>
    <view class="card ai">
      <view class="field">
        <text class="field-label">服务地址</text>
        <input class="field-input" :value="ai.base" placeholder="https://api.example.com/v1" placeholder-class="mine-ph" @input="set('base', $event)" />
      </view>
      <view class="field">
        <text class="field-label">API Key</text>
        <input class="field-input" :value="ai.key" :password="!showKey" placeholder="sk-••••••••••3f9a" placeholder-class="mine-ph" @input="set('key', $event)" />
        <image class="field-eye" :src="showKey ? '/static/icons/eye.svg' : '/static/icons/eye-off.svg'" @tap="showKey = !showKey" />
      </view>
      <view class="field last">
        <text class="field-label">模型名称</text>
        <input class="field-input" :value="ai.model" placeholder="gpt-4o-mini" placeholder-class="mine-ph" @input="set('model', $event)" />
      </view>
      <view class="test">
        <text class="test-btn" @tap="test">{{ testing ? '测试中…' : '测试连接' }}</text>
        <template v-if="result">
          <image v-if="result.ok" class="test-icon" src="/static/icons/check-green.svg" />
          <text class="test-text" :class="{ bad: !result.ok }">{{ result.text }}</text>
        </template>
      </view>
    </view>

    <view class="sec"><view class="sec-bar" /><text class="sec-title">数据</text></view>
    <view class="card data">
      <view class="item" @tap="doExport">
        <image class="item-icon" src="/static/icons/export.svg" />
        <text class="item-label">导出我的数据</text>
        <image class="item-chev" src="/static/icons/chevron-right.svg" />
      </view>
      <view class="item" @tap="privacy">
        <image class="item-icon" src="/static/icons/shield.svg" />
        <text class="item-label">隐私说明</text>
        <image class="item-chev" src="/static/icons/chevron-right.svg" />
      </view>
      <view class="item" @tap="wipe">
        <image class="item-icon" src="/static/icons/trash-red.svg" />
        <text class="item-label red">删除全部数据</text>
        <image class="item-chev" src="/static/icons/chevron-right.svg" />
      </view>
    </view>

    <text class="ver">值了吗 1.0.0</text>
  </view>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { syncState } from '../api'
import { syncNow } from '../sync'
import { profile, themes, themeCount, allTags, aiConfig, saveAiConfig, testAi, exportData, wipeAll } from '../store'

const ai = aiConfig
const showKey = ref(false)
const testing = ref(false)
const result = ref(null)

// 每 20 秒刷新一次“刚刚 / N 分钟前”
const now = ref(Date.now())
const tick = setInterval(() => (now.value = Date.now()), 20000)
onBeforeUnmount(() => clearInterval(tick))

const ago = (ts) => {
  const min = Math.floor((now.value - ts) / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return min + ' 分钟前'
  return Math.floor(min / 60) + ' 小时前'
}
const sync = computed(() => {
  const s = syncState.value
  if (s.status === 'ok') return { text: '已全部同步', side: ago(s.at), cls: 'ok' }
  if (s.status === 'syncing') return { text: '同步中…', side: '', cls: '' }
  if (s.status === 'error') return { text: '同步失败', side: '点这里重试', cls: 'bad' }
  return { text: '尚未接入', side: '仅存本机', cls: '' }
})

function retry() {
  if (syncState.value.status !== 'error') return
  if (syncState.value.message) uni.showToast({ title: syncState.value.message, icon: 'none' })
  syncNow()
}

const recordCount = computed(() => themes.value.reduce((n, t) => n + themeCount(t), 0))
const tagCount = computed(() => allTags().length)

function set(field, e) {
  saveAiConfig({ [field]: e.detail.value.trim() })
  result.value = null
}

async function test() {
  if (testing.value) return
  testing.value = true
  result.value = null
  try {
    await testAi()
    result.value = { ok: true, text: '连接正常' }
  } catch (e) {
    result.value = { ok: false, text: e.message }
  }
  testing.value = false
}

function doExport() {
  const json = exportData()
  // #ifdef H5
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  a.download = '值了吗-导出.json'
  a.click()
  // #endif
  // #ifndef H5
  uni.setClipboardData({ data: json, success: () => uni.showToast({ title: '已复制到剪贴板', icon: 'none' }) })
  // #endif
}

function privacy() {
  uni.showModal({
    title: '隐私说明',
    content: syncState.value.status === 'off' ? '目前所有记录、照片和 AI 配置都只保存在这台设备上，不会上传。使用 AI 回顾时，所选主题的记录文字会发送到你自己填写的服务地址。' : '你的记录和照片会同步到云端，只有你自己能看到；只有你确认公开的分享内容，别人才能凭链接查看。AI 的 API Key 只保存在这台设备上，使用 AI 回顾时，它和所选主题的记录文字会经由服务器转发到你填写的服务地址，服务器不保存。',
    showCancel: false,
    confirmText: '知道了',
    confirmColor: '#f9844e',
  })
}

function wipe() {
  uni.showModal({
    title: '删除全部数据？',
    content: '你写的记录、主题、标签、AI 配置和已发出的分享都会被删除（包括云端），恢复成初始的示例内容，无法撤销。',
    confirmText: '全部删除',
    confirmColor: '#e0502f',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await wipeAll()
      } catch (e) {
        uni.showToast({ title: '云端数据删除失败，请联网后再试', icon: 'none' })
        return
      }
      // #ifdef H5
      location.reload()
      // #endif
      // #ifndef H5
      uni.reLaunch({ url: '/pages/index/index' })
      // #endif
    },
  })
}
</script>

<style lang="scss" scoped>
/* 设计稿里手机屏幕宽 618px（图片两侧有留白，横坐标需减去 115） */
@function d($px) {
  @return dw($px, 618);
}

.wrap {
  padding: d(40) d(24) d(24);
}
.me {
  position: relative;
  height: d(260);
  border-radius: d(26);
  background: #fde6d0;
}
.me-spark {
  position: absolute;
  left: d(117);
  top: d(-10);
  width: d(40);
  height: d(40);
}
.me-avatar {
  position: absolute;
  left: d(24);
  top: d(24);
  width: d(106);
  height: d(106);
  border: d(3) solid #fff;
  border-radius: 50%;
}
.me-name {
  position: absolute;
  left: d(156);
  top: d(40);
  font-size: d(38);
  line-height: d(44);
  font-weight: 600;
  color: #1f302c;
}
.me-days {
  position: absolute;
  left: d(156);
  top: d(88);
  font-size: d(24);
  line-height: d(30);
  color: #777b7d;
}
.me-brush {
  position: absolute;
  left: d(154);
  top: d(120);
  width: d(160);
  height: d(16);
}
.me-stats {
  position: absolute;
  left: 0;
  right: 0;
  top: d(168);
  display: flex;
  align-items: center;
}
.me-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.me-n {
  font-size: d(36);
  line-height: d(40);
  font-weight: 600;
  color: #1f302c;
}
.me-l {
  font-size: d(24);
  line-height: d(32);
  color: #2b2f2e;
}
.me-div {
  width: 1px;
  height: d(32);
  margin-top: d(18);
  background: #e3c3a2;
}

.sec {
  position: relative;
  display: flex;
  align-items: center;
  height: d(40);
  margin-top: d(38);
  padding-left: d(24);
}
.sec-bar {
  position: absolute;
  left: 0;
  top: d(5);
  width: d(6);
  height: d(30);
  border-radius: d(3);
  background: #f9844e;
}
.sec-title {
  font-size: d(30);
  font-weight: 600;
  color: #1f302c;
}
.sec-opt {
  margin-left: d(4);
  font-size: d(23);
  color: #7b7f82;
}
.card {
  margin-top: d(14);
  border-radius: d(24);
  background: #fff;
  box-shadow: 0 d(2) d(12) rgba(90, 70, 40, 0.07);
}

.sync {
  display: flex;
  align-items: center;
  height: d(86);
  padding: 0 d(23) 0 d(22);
}
.sync-icon {
  width: d(42);
  height: d(42);
  margin-right: d(10);
}
.sync-label {
  width: d(141);
  font-size: d(27);
  color: #1c1b1c;
}
.sync-state {
  flex: 1;
  font-size: d(25);
  color: #b0763f;
}
.sync-state.ok {
  color: #2e8b47;
}
.sync-state.bad {
  color: #e0502f;
}
.sync-time {
  font-size: d(25);
  color: #8c8f8d;
}

.ai {
  padding: d(6) d(23) d(24) d(24);
}
.field {
  display: flex;
  align-items: center;
  height: d(78);
  border-bottom: 1px solid #ece9e4;
}
.field.last {
  border-bottom: 0;
}
.field-label {
  flex: none;
  width: d(188);
  font-size: d(26);
  color: #1c1b1c;
}
.field-input {
  flex: 1;
  height: d(52);
  font-size: d(26);
  color: #1c1b1c;
}
.field-eye {
  flex: none;
  margin-left: d(12);
  width: d(34);
  height: d(34);
}
.test {
  display: flex;
  align-items: center;
  min-height: d(52);
  margin-top: d(14);
}
.test-btn {
  flex: none;
  height: d(52);
  padding: 0 d(26);
  border: 1px solid #f08a55;
  border-radius: d(23);
  font-size: d(25);
  line-height: d(50);
  color: #ea6f37;
}
.test-icon {
  flex: none;
  width: d(26);
  height: d(26);
  margin: 0 d(10) 0 d(24);
}
.test-text {
  font-size: d(24);
  line-height: d(32);
  color: #2e8b47;
}
.test-text.bad {
  margin-left: d(20);
  color: #e0502f;
}

.data {
  padding: d(8) 0;
}
.item {
  display: flex;
  align-items: center;
  height: d(76);
  padding: 0 d(19) 0 d(22);
}
.item-icon {
  width: d(34);
  height: d(34);
  margin-right: d(14);
}
.item-label {
  flex: 1;
  font-size: d(26);
  color: #1c1b1c;
}
.item-label.red {
  color: #e0502f;
}
.item-chev {
  width: d(26);
  height: d(26);
}
.ver {
  display: block;
  margin-top: d(28);
  text-align: center;
  font-size: d(21);
  line-height: d(30);
  color: #8c8f8d;
}
</style>

<style lang="scss">
.mine-ph {
  color: #b0b2af;
}
</style>
