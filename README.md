# 值了吗

「把生活，记成自己的答案。」——一个记录生活小事的小程序，用 uni-app（Vue 3）编写，同一份代码可输出 H5 和微信小程序。

首页按设计稿 `design/home.png`、主题详情页按 `design/theme-detail.png` 1:1 还原。

## 运行

```bash
npm install

# H5 预览（浏览器打开 http://localhost:5173）
npm run dev:h5

# H5 正式构建并本地托管（在线预览用这个，加载更快更稳）
npm run preview:h5

# 微信小程序：编译后用「微信开发者工具」导入 dist/dev/mp-weixin
npm run dev:mp-weixin
# 发布用的构建，输出到 dist/build/mp-weixin
npm run build:mp-weixin
```

上传小程序前，在 `src/manifest.json` 的 `mp-weixin.appid` 填入自己的 AppID。

## 目录

| 路径 | 说明 |
|---|---|
| `src/pages/index/index.vue` | 首页、标签、回顾、我的（四个 tab）与写记录弹层 |
| `src/pages/theme/theme.vue` | 主题详情页 |
| `src/components/record-card.vue` | 首页的记录卡片 |
| `src/components/record-editor.vue` | 写记录弹层，首页和详情页共用 |
| `src/store.js` | 主题与记录数据，记录保存在本地存储 |
| `src/uni.scss` | 颜色变量与 `p()` 换算函数 |
| `src/static/img` | 从设计稿切出的图片 |
| `src/static/icons` | SVG 图标 |
| `tools/` | 素材生成脚本 |

## 还原方式

- 设计稿宽 852px（iPhone 15）。样式里统一写 `p(设计稿像素)`，自动换算为 rpx，在不同机型上等比缩放。
- 图片素材由 `python3 tools/extract_assets.py design/home.png` 和 `python3 tools/extract_theme_assets.py design/theme-detail.png` 从设计稿切出（需要 Pillow 和 numpy）。
- 图标由 `node tools/gen_icons.mjs` 生成。
- H5 下会画一条假的底部横条，方便和设计稿对比；小程序里使用系统真实的状态栏和安全区。
- 设计稿里的假状态栏和右上角设置图标已按要求去掉。
