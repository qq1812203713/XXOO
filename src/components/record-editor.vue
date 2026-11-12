<template>
  <view v-if="show" class="mask" @tap="$emit('close')">
    <view class="sheet" @tap.stop>
      <text class="sheet-title">今天想记点什么？</text>
      <textarea v-model="text" class="sheet-input" placeholder="一段经历，一个念头，都可以。" maxlength="300" :show-confirm-bar="false" />
      <text class="sheet-label">放进哪个主题</text>
      <view class="chips">
        <view v-for="t in themes" :key="t.id" class="chip" :class="{ on: picked === t.id }" @tap="picked = t.id">{{ t.title }}</view>
      </view>
      <text class="sheet-label">标签（空格分隔，可不填）</text>
      <input v-model="tags" class="sheet-tags" placeholder="小确幸 留给自己" />
      <view class="sheet-btn" :class="{ off: !text.trim() }" @tap="save">记下来</view>
    </view>
  </view>
</template>

<script setup>
import { ref, watch } from 'vue'
import { themes, addRecord } from '../store'

const props = defineProps({
  show: Boolean,
  themeId: { type: Number, default: 1 },
})
const emit = defineEmits(['close'])

const text = ref('')
const tags = ref('')
const picked = ref(props.themeId)

// 每次打开时清空，并选中传入的主题
watch(
  () => props.show,
  (v) => {
    if (!v) return
    text.value = ''
    tags.value = ''
    picked.value = props.themeId
  }
)

function save() {
  const body = text.value.trim()
  if (!body) return
  addRecord({
    text: body,
    themeId: picked.value,
    tags: tags.value.split(/[\s,，#]+/).filter(Boolean).slice(0, 3),
  })
  emit('close')
}
</script>

<style lang="scss" scoped>
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
