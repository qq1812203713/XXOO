// 生成 SVG 图标（小程序不支持内联 svg，统一用 <image> 引用文件）。用法: node tools/gen_icons.mjs
import { writeFileSync } from 'node:fs'
const INK = '#1f302c', GREY = '#7b7f82', ORANGE = '#f9844e'
const svg = (body, c, w = 1.8, fill = 'none') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill}" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`
const shapes = {
  gear: '<path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><circle cx="12" cy="12" r="3"/>',
  'chevron-right': '<path d="M9 5l7 7-7 7"/>',
  'chevron-down': '<path d="M5 9l7 7 7-7"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8.3 12.3l2.5 2.5 4.9-5.3"/>',
  home: '<path d="M2.6 11.4 12 3.2l9.4 8.2"/><path d="M5 9.8v9.4c0 .7.6 1.3 1.3 1.3H10v-5.6h4v5.6h3.7c.7 0 1.3-.6 1.3-1.3V9.8"/>',
  tag: '<g transform="matrix(-1 0 0 1 24 0)"><path d="M3.5 12.4V5.2c0-.94.76-1.7 1.7-1.7h7.2c.45 0 .88.18 1.2.5l6.4 6.4c.66.66.66 1.74 0 2.4l-7.2 7.2c-.66.66-1.74.66-2.4 0L4 13.6c-.32-.32-.5-.75-.5-1.2Z"/><circle cx="8" cy="8" r="1.3"/></g>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  user: '<circle cx="12" cy="7.8" r="4.3"/><path d="M4 20.5c0-3.6 3.6-5.6 8-5.6s8 2 8 5.6Z"/>',
}
const homeFill = '<path d="M12 3.2 2.6 11.4 5 11.4V19.2c0 .7.6 1.3 1.3 1.3H10v-5.6h4v5.6h3.7c.7 0 1.3-.6 1.3-1.3V11.4l2.4 0Z"/>'
const out = (n, s) => writeFileSync(`src/static/icons/${n}.svg`, s)
out('gear', svg(shapes.gear, INK, 1.85))
out('chevron-right', svg(shapes['chevron-right'], GREY, 2))
out('chevron-down', svg(shapes['chevron-down'], GREY, 2))
out('check', svg(shapes.check, GREY, 1.7))
for (const n of ['home', 'tag', 'clock', 'user']) {
  out(`tab-${n}`, svg(shapes[n], GREY, 1.8))
  out(`tab-${n}-on`, n === 'home' ? svg(homeFill, ORANGE, 1.8, ORANGE) : svg(shapes[n], ORANGE, 1.8))
}
