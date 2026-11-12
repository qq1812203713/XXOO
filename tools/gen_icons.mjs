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
  out(`tab-${n}-on`, svg(n === 'home' ? homeFill : filled[n], ORANGE, 1.8, ORANGE))
}
