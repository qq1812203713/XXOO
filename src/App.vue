<script>
import { startSync, syncNow } from './sync'

export default {
  onLaunch() {
    startSync()
  },
  onShow() {
    // 回到前台时再拉一次，拿到其它设备上的改动
    syncNow()
  },
}
</script>

<style lang="scss">
page {
  background: $bg;
  color: $text;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
}
view,
text,
image,
textarea {
  box-sizing: border-box;
}
</style>
