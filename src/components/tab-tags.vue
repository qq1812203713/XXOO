<template>
  <view class="wrap">
    <view class="head">
      <text class="title">标签</text>
      <image class="spark" src="/static/img/title-spark.png" />
      <text class="sub">给经历贴上自己的说法。</text>
      <image class="brush" src="/static/img/title-brush.png" />
    </view>

    <view class="search-row">
      <view class="search">
        <image class="search-icon" src="/static/icons/search.svg" />
        <input v-model="keyword" class="search-input" placeholder="搜索标签" placeholder-class="tags-ph" confirm-type="search" />
      </view>
      <view class="plus" @tap="create"><image class="plus-icon" src="/static/icons/tabs-plus.svg" /></view>
    </view>

    <view class="sec">
      <view class="sec-bar" />
      <text class="sec-title">常用标签</text>
      <text class="sec-more">共 {{ all.length }} 个</text>
    </view>
    <view class="card">
      <view v-for="t in active" :key="t.name" class="row" @tap="menu(t)">
        <text class="tag"># {{ t.name }}</text>
        <text class="row-count">{{ t.count }} 条经历</text>
        <image class="row-chev" src="/static/icons/chevron-right-ink.svg" />
      </view>
      <view v-if="!active.length" class="empty">{{ keyword ? '没有找到这个标签' : '还没有标签，点右上角加号新建' }}</view>
    </view>

    <template v-if="disabled.length">
      <view class="sec sec-2">
        <view class="sec-bar" />
        <text class="sec-title">已停用</text>
      </view>
      <view class="card card-2">
        <view v-for="t in disabled" :key="t.name" class="row row-2">
          <text class="tag grey"># {{ t.name }}</text>
          <text class="row-off">已停用</text>
          <text class="restore" @tap="setTagDisabled(t.name, false)">恢复</text>
        </view>
      </view>
    </template>

    <!-- 关联记录 -->
    <view v-if="viewing" class="mask" @tap="viewing = ''">
      <view class="sheet" @tap.stop>
        <text class="sheet-title"># {{ viewing }}</text>
        <scroll-view class="sheet-list" scroll-y>
          <view v-for="r in related" :key="r.id" class="sheet-item">
            <text class="sheet-date">{{ monthDay(r.time) }} · {{ themeName(r.themeId) }}</text>
            <text class="sheet-text">{{ r.text }}</text>
          </view>
          <view v-if="!related.length" class="empty">示例数据里的历史记录没有逐条保存，这里只显示你能看到的记录。</view>
        </scroll-view>
        <view class="sheet-close" @tap="viewing = ''">关闭</view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { allTags, addTag, renameTag, setTagDisabled, records, themes, monthDay } from '../store'

const keyword = ref('')
const viewing = ref('')

const all = computed(() => allTags())
const match = (t) => !keyword.value.trim() || t.name.includes(keyword.value.trim())
const active = computed(() => all.value.filter((t) => !t.disabled && match(t)))
const disabled = computed(() => all.value.filter((t) => t.disabled && match(t)))
const related = computed(() => records.value.filter((r) => (r.tags || []).includes(viewing.value)))
const themeName = (id) => (themes.value.find((t) => t.id === id) || {}).title || ''

const tip = (msg) => msg && uni.showToast({ title: msg, icon: 'none' })

function ask(title, content, done) {
  uni.showModal({
    title,
    editable: true,
    content,
    placeholderText: '最多 6 个字',
    confirmColor: '#f9844e',
    success: (res) => res.confirm && done(res.content || ''),
  })
}

function create() {
  ask('新建标签', '', (name) => tip(addTag(name)))
}

function menu(t) {
  uni.showActionSheet({
    itemList: ['查看关联记录', '重命名', '停用'],
    success: (res) => {
      if (res.tapIndex === 0) viewing.value = t.name
      if (res.tapIndex === 1) ask('重命名标签', t.name, (name) => tip(renameTag(t.name, name)))
      if (res.tapIndex === 2) setTagDisabled(t.name, true)
    },
  })
}
</script>

<style lang="scss" scoped>
@function d($px) {
  @return dw($px, 768);
}

.head {
  position: relative;
  height: d(235);
}
.title {
  position: absolute;
  left: d(38);
  top: d(51);
  font-size: d(80);
  line-height: d(90);
  font-weight: 700;
  color: #1f302c;
}
.spark {
  position: absolute;
  left: d(198);
  top: d(20);
  width: d(52);
  height: d(52);
}
.sub {
  position: absolute;
  left: d(38);
  top: d(154);
  font-size: d(31);
  line-height: d(40);
  color: #777b7d;
  white-space: nowrap;
}
.brush {
  position: absolute;
  left: d(38);
  top: d(193);
  width: d(330);
  height: d(20);
}

.search-row {
  display: flex;
  align-items: center;
  padding: 0 d(36) 0 d(32);
}
.search {
  flex: 1;
  display: flex;
  align-items: center;
  height: d(71);
  margin-right: d(26);
  padding: 0 d(24) 0 d(28);
  border: 1px solid #e3dfd9;
  border-radius: d(36);
  background: #fff;
}
.search-icon {
  flex: none;
  width: d(40);
  height: d(40);
  margin-right: d(16);
}
.search-input {
  flex: 1;
  height: d(60);
  font-size: d(31);
  color: #1c1b1c;
}
.plus {
  flex: none;
  width: d(72);
  height: d(72);
  border-radius: 50%;
  background: linear-gradient(160deg, #fb8d57, #f57a45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.plus-icon {
  width: d(46);
  height: d(46);
}

.sec {
  position: relative;
  display: flex;
  align-items: center;
  height: d(44);
  margin-top: d(41);
  padding: 0 d(32) 0 d(66);
}
.sec-bar {
  position: absolute;
  left: d(32);
  top: d(5);
  width: d(7);
  height: d(34);
  border-radius: d(4);
  background: #f9844e;
}
.sec-title {
  flex: 1;
  font-size: d(35);
  font-weight: 600;
  color: #1f302c;
}
.sec-more {
  font-size: d(27);
  color: #6f7375;
}

.card {
  margin: d(16) d(32) 0;
  padding: d(11.6) 0 d(10);
  border-radius: d(26);
  background: #fff;
  box-shadow: 0 d(2) d(12) rgba(90, 70, 40, 0.07);
}
.card-2 {
  margin-top: d(15);
  padding: d(12) 0;
}
.row {
  display: flex;
  align-items: center;
  height: d(76.7);
  padding: 0 d(30) 0 d(31);
}
.row-2 {
  height: d(74);
  padding-right: d(31);
}
.tag {
  height: d(50);
  padding: 0 d(22);
  border-radius: d(25);
  background: #cfe6cc;
  font-size: d(29);
  line-height: d(50);
  font-weight: 500;
  color: #1f302c;
  white-space: nowrap;
}
.tag.grey {
  background: #cbcbc9;
}
.row-count,
.row-off {
  flex: 1;
  text-align: right;
  font-size: d(27);
  color: #2b2f2e;
}
.row-chev {
  width: d(30);
  height: d(30);
  margin-left: d(14);
}
.restore {
  height: d(40);
  margin-left: d(20);
  padding: 0 d(20);
  border: 1px solid #6b4f3a;
  border-radius: d(20);
  font-size: d(26);
  line-height: d(38);
  color: #5a4232;
}
.empty {
  padding: d(40) d(40);
  text-align: center;
  font-size: d(26);
  line-height: d(38);
  color: #a6a39c;
}

.mask {
  position: fixed;
  left: 50%;
  width: 750rpx;
  margin-left: -375rpx;
  top: 0;
  height: 100%;
  z-index: 30;
  display: flex;
  align-items: flex-end;
  background: rgba(30, 25, 20, 0.4);
}
.sheet {
  width: 100%;
  padding: d(40) d(36) calc(#{d(30)} + env(safe-area-inset-bottom));
  border-radius: d(34) d(34) 0 0;
  background: #fbf8f3;
}
.sheet-title {
  display: block;
  font-size: d(35);
  font-weight: 600;
  color: #1f302c;
}
.sheet-list {
  max-height: 50vh;
  margin-top: d(20);
}
.sheet-item {
  margin-bottom: d(16);
  padding: d(20) d(24);
  border-radius: d(20);
  background: #fff;
}
.sheet-date {
  display: block;
  font-size: d(23);
  color: #7b7f82;
}
.sheet-text {
  display: block;
  margin-top: d(6);
  font-size: d(28);
  line-height: d(40);
  color: #1c1b1c;
}
.sheet-close {
  margin-top: d(20);
  height: d(80);
  border-radius: d(40);
  border: 1px solid #e3dfd9;
  background: #fff;
  text-align: center;
  font-size: d(29);
  line-height: d(78);
  color: #1f302c;
}
</style>

<style lang="scss">
.tags-ph {
  color: #8c8f8d;
}
</style>
