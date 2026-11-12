<template>
  <view class="rec" @longpress="$emit('remove')">
    <image v-if="thumb" class="rec-img" :src="thumb" mode="aspectFill" />
    <view class="rec-body" :class="{ wide: !thumb }">
      <text class="rec-meta">{{ meta }}</text>
      <text class="rec-text">{{ body }}</text>
      <view v-if="record.tags && record.tags.length" class="rec-tags">
        <text v-for="t in record.tags" :key="t" class="rec-tag"># {{ t }}</text>
      </view>
      <view class="rec-sync">
        <image class="rec-sync-icon" src="/static/icons/check.svg" />
        <text>{{ record.synced ? '已同步' : '已保存在本机' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { themes, formatTime } from '../store'

const props = defineProps({ record: { type: Object, required: true } })
defineEmits(['remove'])

const thumb = computed(() => props.record.image || props.record.imageWide || '')
// 首页卡片较窄，正文自然折行，去掉为详情页准备的手动换行
const body = computed(() => props.record.text.replace(/\n/g, ''))
const meta = computed(() => {
  const theme = themes.value.find((t) => t.id === props.record.themeId)
  return formatTime(props.record.time) + (theme ? ' · ' + theme.title : '')
})
</script>

<style lang="scss" scoped>
.rec {
  display: flex;
  margin-bottom: p(24);
  padding: p(13) 0 p(9) p(20);
  border-radius: p(24);
  background: #fff;
  box-shadow: 0 p(2) p(12) rgba(90, 70, 40, 0.07);
}
.rec-img {
  flex: none;
  width: p(268);
  height: p(224);
  margin-right: p(22);
  border-radius: p(16);
}
.rec-body {
  width: p(410);
  padding-top: p(9);
}
.rec-body.wide {
  width: p(700);
}
.rec-meta {
  display: block;
  font-size: p(22);
  line-height: p(30);
  color: $grey;
  white-space: nowrap;
}
.rec-text {
  display: block;
  margin-top: p(7);
  font-size: p(30);
  line-height: p(40.5);
  color: $text;
}
.rec-tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: p(1);
}
.rec-tag {
  height: p(36);
  margin-right: p(11);
  padding: 0 p(16);
  border-radius: p(18);
  background: #dfeedd;
  color: #2e6a4b;
  font-size: p(21.5);
  line-height: p(36);
  white-space: nowrap;
}
.rec-sync {
  display: flex;
  align-items: center;
  margin-top: p(13);
  font-size: p(21);
  line-height: p(30);
  color: $grey;
}
.rec-sync-icon {
  width: p(26);
  height: p(26);
  margin-right: p(11);
}
</style>
