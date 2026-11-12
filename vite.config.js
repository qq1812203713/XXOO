import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

export default defineConfig({
  plugins: [uni()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // 允许通过在线预览域名访问开发服务
    allowedHosts: true,
  },
})
