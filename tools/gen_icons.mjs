// 生成 SVG 图标（小程序不支持内联 svg，统一用 <image> 引用文件）。用法: node tools/gen_icons.mjs
import { writeFileSync } from 'node:fs'
const GREY = '#7b7f82', ORANGE = '#f9844e'
const svg = (body, c, w = 1.8, fill = 'none') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill}" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`
const shapes = {
  'chevron-right': '<path d="M9 5l7 7-7 7"/>',
  'chevron-down': '<path d="M5 9l7 7 7-7"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8.3 12.3l2.5 2.5 4.9-5.3"/>',
  home: '<path d="M2.6 11.4 12 3.2l9.4 8.2"/><path d="M5 9.8v9.4c0 .7.6 1.3 1.3 1.3H10v-5.6h4v5.6h3.7c.7 0 1.3-.6 1.3-1.3V9.8"/>',
  tag: '<g transform="matrix(-1 0 0 1 24 0)"><path d="M3.5 12.4V5.2c0-.94.76-1.7 1.7-1.7h7.2c.45 0 .88.18 1.2.5l6.4 6.4c.66.66.66 1.74 0 2.4l-7.2 7.2c-.66.66-1.74.66-2.4 0L4 13.6c-.32-.32-.5-.75-.5-1.2Z"/><circle cx="8" cy="8" r="1.3"/></g>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  user: '<circle cx="12" cy="7.8" r="4.3"/><path d="M4 20.5c0-3.6 3.6-5.6 8-5.6s8 2 8 5.6Z"/>',
}
// 选中态：实心图标，细节用白色镂空
const W = 'stroke="#fff"'
const filled = {
  tag: '<g transform="matrix(-1 0 0 1 24 0)"><path d="M3.5 12.4V5.2c0-.94.76-1.7 1.7-1.7h7.2c.45 0 .88.18 1.2.5l6.4 6.4c.66.66.66 1.74 0 2.4l-7.2 7.2c-.66.66-1.74.66-2.4 0L4 13.6c-.32-.32-.5-.75-.5-1.2Z"/><circle cx="8" cy="8" r="1.5" fill="#fff" stroke="none"/></g>',
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2" fill="none" ${W}/>`,
  user: '<circle cx="12" cy="7.8" r="4.3"/><path d="M4 20.5c0-3.6 3.6-5.6 8-5.6s8 2 8 5.6Z"/>',
}
const homeFill = '<path d="M12 3.2 2.6 11.4 5 11.4V19.2c0 .7.6 1.3 1.3 1.3H10v-5.6h4v5.6h3.7c.7 0 1.3-.6 1.3-1.3V11.4l2.4 0Z"/>'
const out = (n, s) => writeFileSync(`src/static/icons/${n}.svg`, s)
out('chevron-right', svg(shapes['chevron-right'], GREY, 2))
out('chevron-down', svg(shapes['chevron-down'], GREY, 2))
out('check', svg(shapes.check, GREY, 1.7))
for (const n of ['home', 'tag', 'clock', 'user']) {
  out(`tab-${n}`, svg(shapes[n], GREY, 1.8))
  out(`tab-${n}-fill`, svg(n === 'home' ? homeFill : filled[n], ORANGE, 1.8, ORANGE))
}

// 主题详情页
const INK = '#1f302c'
out('back', svg('<path d="M15 4.5 7.5 12l7.5 7.5"/>', INK, 2.2))
out('pencil', svg('<path d="M4.2 19.8l.9-4.3L16.6 4a2.1 2.1 0 0 1 3 0l.4.4a2.1 2.1 0 0 1 0 3L8.5 18.9l-4.3.9Z"/><path d="M14.6 6l3.4 3.4"/>', GREY, 1.8))
out('calendar', svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.8"/><path d="M8 3v4M16 3v4M3.5 10h17M9 15.2l2 2 3.6-3.8"/>', GREY, 1.7))
out('doc', svg('<rect x="4.5" y="3.5" width="15" height="17" rx="2.8"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4"/>', GREY, 1.7))
out('clock', svg(shapes.clock, GREY, 1.7))
out('history', svg('<path d="M4.6 12.6a7.6 7.6 0 1 0 2-5.8L4.4 9"/><path d="M4.2 4.8V9h4.2"/><path d="M12 8.2v4.2l2.8 1.7"/>', GREY, 1.8))
out('plus-white', svg('<path d="M12 4.5v15M4.5 12h15"/>', '#fff', 2.4))

// 记录编辑页
const INK2 = '#3c4a47', SOFT = '#9a9d9b'
out('tag-ink', svg(shapes.tag, INK2, 1.7))
out('clock-ink', svg(shapes.clock, INK2, 1.7))
out('heart', svg('<path d="M12 20.2S3.8 15.4 3.8 9.4A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 8.2 2.2c0 6-8.2 10.8-8.2 10.8Z"/>', INK, 1.8))
out('coins', svg('<ellipse cx="13.5" cy="8" rx="6" ry="2.6"/><path d="M7.5 8v3c0 1.4 2.7 2.6 6 2.6s6-1.200 6-2.6V8"/><ellipse cx="10" cy="14.6" rx="6" ry="2.6"/><path d="M4 14.600v3c0 1.4 2.7 2.600 6 2.600s6-1.200 6-2.600v-3"/>', GREY, 1.6))
out('smile', svg('<circle cx="12" cy="12" r="9"/><path d="M8.300 14c.9 1.500 2.200 2.300 3.700 2.300s2.800-.8 3.700-2.300"/><path d="M9 9.600v.6M15 9.600v.6"/>', INK2, 1.7))
out('camera', svg('<path d="M4.500 8.500c0-.900.700-1.600 1.600-1.600h1.700l1.200-1.900h6l1.200 1.900h1.700c.9 0 1.600.7 1.600 1.600v8.600c0 .9-.7 1.600-1.600 1.600H6.100c-.9 0-1.600-.7-1.600-1.600Z"/><circle cx="12" cy="12.700" r="3"/>', GREY, 1.7))
out('x-white', svg('<path d="M7 7l10 10M17 7 7 17"/>', '#fff', 2.6))
out('x-green', svg('<path d="M6.500 6.500l11 11M17.500 6.500l-11 11"/>', '#2e6a4b', 2.2))
out('plus-grey', svg('<path d="M12 5v14M5 12h14"/>', GREY, 2))
const eyes = '<path d="M9 9.700v.5M15 9.700v.5"/>'
const faces = [
  eyes + '<path d="M7.800 13.200h8.400c-.3 2.300-2 3.900-4.200 3.900s-3.900-1.600-4.200-3.900Z"/>',
  eyes + '<path d="M8.300 14c.9 1.500 2.200 2.300 3.700 2.300s2.800-.8 3.700-2.300"/>',
  eyes + '<path d="M8.600 15h6.800"/>',
  eyes + '<path d="M8.300 16.200c.9-1.500 2.200-2.300 3.700-2.300s2.800.8 3.700 2.300"/>',
  '<path d="M8 8.800l2.200 1.200L8 11.200M16 8.800l-2.200 1.200 2.200 1.200"/><path d="M8.400 16l1.800-1.200 1.800 1.200 1.800-1.200 1.800 1.200"/>',
]
faces.forEach((f, i) => {
  out(`face-${i + 1}`, svg('<circle cx="12" cy="12" r="9"/>' + f, SOFT, 1.6))
  out(`face-${i + 1}-fill`, svg('<circle cx="12" cy="12" r="9"/>' + f, ORANGE, 1.9))
})

// 标签 / 回顾 / 我的 / 分享 / 主题编辑
const GREEN = '#2e8b47', RED = '#e0502f', DKGREEN = '#2e6a4b'
out('search', svg('<circle cx="11" cy="11" r="6.500"/><path d="M16 16l4 4"/>', GREY, 1.8))
out('mic', svg('<rect x="9" y="3.500" width="6" height="10.500" rx="3"/><path d="M5.800 11.500a6.200 6.200 0 0 0 12.400 0M12 17.700v3M9 20.700h6"/>', GREY, 1.7))
out('camera-ink', svg('<path d="M4.500 8.500c0-.900.700-1.600 1.600-1.600h1.700l1.200-1.900h6l1.200 1.900h1.700c.9 0 1.600.7 1.600 1.600v8.600c0 .9-.7 1.600-1.600 1.600H6.100c-.9 0-1.600-.7-1.600-1.600Z"/><circle cx="12" cy="12.700" r="3"/>', INK2, 1.8))
out('cloud', svg('<path d="M7 18.500a4.300 4.300 0 0 1-.6-8.560A5.800 5.800 0 0 1 17.600 9.600 4.500 4.500 0 0 1 17.300 18.500Z"/><path d="M9.300 13.400l2 2 3.600-3.800"/>', INK, 1.7))
out('eye-off', svg('<path d="M3 12s3.300-6 9-6 9 6 9 6-3.300 6-9 6-9-6-9-6Z"/><circle cx="12" cy="12" r="2.800"/><path d="M5 4.500l14 15"/>', GREY, 1.6))
out('eye', svg('<path d="M3 12s3.300-6 9-6 9 6 9 6-3.300 6-9 6-9-6-9-6Z"/><circle cx="12" cy="12" r="2.800"/>', GREY, 1.6))
out('export', svg('<path d="M10.500 5H6.800C5.800 5 5 5.800 5 6.800v10.400c0 1 .8 1.800 1.800 1.800h10.400c1 0 1.800-.8 1.800-1.800v-3.700"/><path d="M14 4h6v6M20 4l-8.500 8.500"/>', INK, 1.7))
out('shield', svg('<path d="M12 3.200 5 5.800v5.400c0 4.400 2.900 7.700 7 9.600 4.100-1.900 7-5.200 7-9.600V5.800Z"/><path d="M9 11.800l2.200 2.200 4-4.200"/>', INK, 1.7))
out('trash-red', svg('<path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l.8 12c.05.8.7 1.500 1.500 1.500h6.400c.8 0 1.450-.7 1.500-1.500l.8-12M10 11v5.500M14 11v5.500"/>', RED, 1.7))
out('refresh', svg('<path d="M19.500 12a7.500 7.500 0 0 1-12.900 5.200M4.500 12a7.500 7.500 0 0 1 12.900-5.200"/><path d="M17.800 3.500v3.600h-3.600M6.200 20.500v-3.600h3.600"/>', INK, 1.8))
out('share-white', svg('<path d="M13.500 5.500 20 11.500l-6.500 6v-3.700c-4.500-.2-7.500 1.200-9.500 4.200.6-5.300 3.800-8.600 9.500-9Z"/>', '#fff', 1.8))
out('nodes-white', svg('<circle cx="17.500" cy="5.500" r="2.500"/><circle cx="6.500" cy="12" r="2.500"/><circle cx="17.500" cy="18.500" r="2.500"/><path d="M8.700 10.700l6.600-3.900M8.700 13.300l6.600 3.900"/>', '#fff', 1.8))
out('download', svg('<path d="M12 4v11M7.500 10.500 12 15l4.500-4.500M5 19.500h14"/>', INK, 1.9))
out('lock', svg('<rect x="5.500" y="10.500" width="13" height="10" rx="2" fill="#8c8f8d"/><path d="M8.500 10.500V8a3.500 3.500 0 0 1 7 0v2.500"/>', '#8c8f8d', 1.9))
out('check-green', svg('<circle cx="12" cy="12" r="9.500" fill="#2e8b47" stroke="none"/><path d="M7.800 12.300l2.900 2.900 5.600-6" stroke="#fff"/>', GREEN, 2.2))
out('check-dk', svg('<path d="M5.500 12.500l4.200 4.200 8.800-9.400"/>', DKGREEN, 2))
out('circle-check-dk', svg(shapes.check, DKGREEN, 1.7))
out('clock-dk', svg(shapes.clock, DKGREEN, 1.7))
out('plus-dk', svg('<path d="M12 5v14M5 12h14"/>', DKGREEN, 2))
out('chevron-right-ink', svg(shapes['chevron-right'], INK, 2.2))
out('chevron-down-ink', svg(shapes['chevron-down'], '#4d5251', 2.2))
out('tabs-plus', svg('<path d="M12 5.500v13M5.500 12h13"/>', '#fff', 2.6))
