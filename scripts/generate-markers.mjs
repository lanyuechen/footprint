/**
 * 按时间轴地点类型生成地图针脚 PNG。
 *
 * 默认读取 place-axis.ts 里的 color + marker，覆盖写出 src/assets/markers。
 * 额外指定时：
 *   node scripts/generate-markers.mjs utensils #f97316
 *   node scripts/generate-markers.mjs --icon cafe --color #f97316 --lucide utensils
 *
 * lucide 图标名对应 node_modules/lucide-react-taro/dist/esm/icons/<name>.js
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const axisFile = path.join(root, 'src/pages/plan-view/place-axis.ts')
const iconDir = path.join(root, 'node_modules/lucide-react-taro/dist/esm/icons')
const outDir = path.join(root, 'src/assets/markers')
const SIZE = 160
/** 24 坐标系下的图标缩放。15 在 40px 针脚上只有约 14px，读不清 */
const ICON_SCALE = 21
const ICON_STROKE = 2
/** 四周留白，让外发光不被裁掉。针尖仍按原图 (512, 1018.56) */
const PAD = { left: 200, top: 200, right: 200, bottom: 220 }
const TIP = { x: 512, y: 1018.56 }

function lighten(hex) {
  const n = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(n)) {
    throw new Error(`颜色需为 #rrggbb：${hex}`)
  }
  const channels = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
  return (
    '#' +
    channels
      .map((c) => Math.round(c + (255 - c) * 0.82).toString(16).padStart(2, '0'))
      .join('')
  )
}

function readAxisMarkers() {
  const src = fs.readFileSync(axisFile, 'utf8')
  const marks = new Map()
  const re = /color:\s*'(#[0-9a-fA-F]{6})'\s*,\s*marker:\s*'([^']+)'/g
  for (const match of src.matchAll(re)) {
    marks.set(match[2], { name: match[2], color: match[1], lucide: match[2] })
  }
  if (marks.size === 0) throw new Error(`未从 ${axisFile} 解析到 marker`)
  return [...marks.values()]
}

function parseArgs(argv) {
  const extras = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--icon') {
      const name = argv[++i]
      let color
      let lucide = name
      while (argv[i + 1] === '--color' || argv[i + 1] === '--lucide') {
        const flag = argv[++i]
        const value = argv[++i]
        if (flag === '--color') color = value
        else lucide = value
      }
      if (!name || !color) {
        throw new Error('用法：--icon <文件名> --color <#rrggbb> [--lucide <图标名>]')
      }
      extras.push({ name, color, lucide })
      continue
    }
    if (arg.startsWith('--')) {
      throw new Error(`未知参数：${arg}`)
    }
    const color = argv[++i]
    if (!color || color.startsWith('--')) {
      throw new Error(`缺少颜色：${arg} <#rrggbb>`)
    }
    extras.push({ name: arg, color, lucide: arg })
  }
  return extras
}

function iconInner(lucide, color) {
  const file = path.join(iconDir, `${lucide}.js`)
  if (!fs.existsSync(file)) {
    throw new Error(`找不到 lucide 图标 ${lucide}：${file}`)
  }
  const src = fs.readFileSync(file, 'utf8')
  const match = src.match(/createIcon\('([\s\S]*?)',\s*"/)
  if (!match) throw new Error(`无法解析图标 ${lucide}`)
  return match[1].replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/currentColor/g, color)
}

function centerMark(mark, color, inner) {
  // 默认类型本身就是针脚，再套一层 map-pin 会重复。只留外层，中间点一个圆。
  if (mark.lucide === 'map-pin' || mark.name === 'map-pin') {
    return `<g transform="translate(512 389.44) scale(${ICON_SCALE}) translate(-12 -12)" fill="none" stroke="${color}" stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
    </g>`
  }
  return `<g transform="translate(512 389.44) scale(${ICON_SCALE}) translate(-12 -12)" fill="none" stroke="${color}" stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round">
      ${inner}
    </g>`
}

function pinSvg(color, mark, inner) {
  const fill = lighten(color)
  const width = 1024 + PAD.left + PAD.right
  const height = 1024 + PAD.top + PAD.bottom
  const outH = Math.round((SIZE * height) / width)
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-PAD.left} ${-PAD.top} ${width} ${height}" width="${SIZE}" height="${outH}">
  <defs>
    <filter id="pin-glow" x="-70%" y="-50%" width="240%" height="220%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="22" result="tight"/>
      <feGaussianBlur in="SourceAlpha" stdDeviation="64" result="soft"/>
      <feFlood flood-color="#111111" flood-opacity="0.9" result="ink"/>
      <feComposite in="ink" in2="tight" operator="in" result="tightGlow"/>
      <feFlood flood-color="#111111" flood-opacity="0.5" result="inkSoft"/>
      <feComposite in="inkSoft" in2="soft" operator="in" result="softGlow"/>
      <feMerge>
        <feMergeNode in="softGlow"/>
        <feMergeNode in="tightGlow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <g filter="url(#pin-glow)">
    <path fill="${color}" d="M512 1018.56c-24.32 0-46.72-10.56-62.08-29.12C223.68 714.24 118.08 523.84 118.08 389.44c0-211.84 176.64-384 393.92-384s393.92 172.16 393.92 384c0 134.08-105.6 324.8-331.84 600-15.36 18.56-37.76 29.12-62.08 29.12z m0-979.52c-198.72 0-360.32 157.12-360.32 350.4 0 124.16 105.92 313.28 324.16 578.56 8.64 10.56 22.08 16.96 36.16 16.96 14.08 0 27.2-6.08 36.16-16.96 218.24-265.28 324.16-454.4 324.16-578.56 0-193.28-161.6-350.4-360.32-350.4z"/>
    <path fill="${fill}" d="M560.96 978.88c-25.28 30.72-72.96 30.72-98.24 0C244.48 713.6 134.72 520.96 134.72 389.44 134.72 186.56 303.68 22.4 512 22.4s377.28 164.48 377.28 367.36c0 131.2-109.76 323.84-328.32 589.12z"/>
    ${centerMark(mark, color, inner)}
  </g>
</svg>`,
    outH,
  }
}

function writeMarker(mark) {
  const inner =
    mark.lucide === 'map-pin' || mark.name === 'map-pin'
      ? ''
      : iconInner(mark.lucide, mark.color)
  const { svg } = pinSvg(mark.color, mark, inner)
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } }).render().asPng()
  const file = path.join(outDir, `${mark.name}.png`)
  fs.writeFileSync(file, png)
  console.log(`${mark.name}.png  ${mark.color}  fill ${lighten(mark.color)}`)
}

const extras = parseArgs(process.argv.slice(2))
const marks = extras.length > 0 ? extras : readAxisMarkers()
fs.mkdirSync(outDir, { recursive: true })
for (const mark of marks) writeMarker(mark)
