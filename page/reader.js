/**
 * 小说阅读器 v6 — 轻量零扫描版
 * 关键：不再扫描全文建索引（手表 CPU 扛不住会卡死）。
 *  - 打开瞬间完成：只渲染当前一页。
 *  - 翻页：顺序读取，用回退栈记录看过的页起点，上一页直接出栈。
 *  - 进度：按字节偏移算百分比（精确、零成本）。
 *  - 页码：用"每页约多少字节"(bpp) 估算，页码是偏移的单调函数，
 *          所以跳页/翻页一致、不再混乱（虽是约数但不跳变）。
 *  - 跳页：按页码 → 目标字节 = (页-1)*bpp，对齐到行首再渲染。
 */

import { createWidget, widget, align, event, prop, deleteWidget } from '@zos/ui'
import { back } from '@zos/router'
import { onDigitalCrown, KEY_HOME, offDigitalCrown } from '@zos/interaction'
import { localStorage } from '@zos/storage'
import { setWakeUpRelaunch, setBrightness, getBrightness } from '@zos/display'
import { Time, Battery } from '@zos/sensor'
import { getDeviceInfo } from '@zos/device'
import {
  openAssetsSync, statAssetsSync,
  openSync, statSync,
  O_RDONLY, readSync, closeSync
} from '@zos/fs'

var W = 480, H = 480

// 圆形屏阅读区（尽量大又不裁切，正文用最大内接区域）
var READ_X = 64
var READ_W = 352          // 64 ~ 416
var READ_Y = 56
var READ_BOTTOM = 392
var READ_H = READ_BOTTOM - READ_Y   // 336
var TOP_PCT_Y = 32        // 顶部居中百分比
var META_Y = 396          // 底部居中页码（点开菜单）
var BAR_Y = 418
var BAR_X = 140, BAR_W = 200
var STEP = 2048           // 渲染读取步长

// --LIBRARY-DATA-- (由 import_books.py 自动替换，请勿手动编辑)
var LIBRARY = [
  {
    id: 0,
    title: "测试小说",
    author: "作者A",
    file: "raw/books/测试小说_作者A.txt",
  },
  {
    id: 1,
    title: "邻家天使",
    author: "未知作者",
    file: "raw/books/邻家天使.txt",
  },
]

var FONT_SIZES = (function () { var a = []; for (var s = 12; s <= 36; s++) a.push(s); return a })()  // 逐号可调
var SPACINGS = [1.0, 1.18, 1.36, 1.58]
var SPACING_LABELS = ['紧', '中', '松', '大']

// 配色主题：bg 背景 / fg 正文 / sub 次要 / bar 进度 / barbg 进度底
var THEMES = [
  { name: '夜', bg: 0x0E0E0E, fg: 0xE8E8E8, sub: 0x8A8A8A, bar: 0xD8924B, barbg: 0x2A2A2A },
  { name: '护眼', bg: 0x12211A, fg: 0xCBE3CE, sub: 0x6E8F76, bar: 0x5AAE78, barbg: 0x24382C },
  { name: '纸', bg: 0xE9E0CB, fg: 0x3A352A, sub: 0x8C8064, bar: 0xB5772E, barbg: 0xCFC3A6 },
  { name: '黑', bg: 0x000000, fg: 0xC6C6C6, sub: 0x707070, bar: 0xC07A33, barbg: 0x1C1C1C }
]
var AUTO_SECS = [0, 12, 7, 4]            // 自动翻页：关/慢/中/快
var AUTO_LABELS = ['关', '慢', '中', '快']

var bookId = 0, book = null, isDownloaded = false
var fontIdx = 8
var spacingIdx = 1
var brightVal = 75              // 5% 步进，5~100
var themeIdx = 0
var autoIdx = 0
var scrollMode = false         // 滚动阅读（表冠逐行无缝滚动）
var savedBrightness = -1
var source = null
var curStart = 0, curInfo = null
var backStack = []
var bpp = 600, estTotal = 1

var bgRect = null, barBgRect = null
var lineWidgets = [], tapWidgets = []
var pageNumWidget = null, topPctWidget = null
var readProgressWidget = null
var clockTimer = null, sessionStart = 0, baseReadSec = 0
var autoTimer = null
var timeSensor = null, battSensor = null, lastBatt = -1, charging = false
var crownAccum = 0, THRESHOLD = 48
var jump = { active: false, input: '', widgets: [] }
var menu = { active: false, widgets: [], fontText: null, spacingText: null, brightText: null, themeText: null, autoText: null, scrollText: null, timerText: null }

function theme() { return THEMES[themeIdx] }

function cfgNow() {
  var size = FONT_SIZES[fontIdx]
  return { size: size, lh: Math.round(size * SPACINGS[spacingIdx]), label: String(size) }
}

// 按真实屏幕尺寸等比缩放布局（适配 466/480 等圆屏），基准为 480 设计
function computeLayout() {
  var di; try { di = getDeviceInfo() } catch (e) { di = null }
  W = (di && di.width) ? di.width : 480
  H = (di && di.height) ? di.height : 480
  var S = W / 480
  READ_X = Math.round(64 * S); READ_W = W - 2 * READ_X
  READ_Y = Math.round(56 * S); READ_BOTTOM = H - Math.round(88 * S); READ_H = READ_BOTTOM - READ_Y
  TOP_PCT_Y = Math.round(32 * S)
  META_Y = H - Math.round(84 * S)
  BAR_W = Math.round(200 * S); BAR_X = Math.round((W - BAR_W) / 2); BAR_Y = H - Math.round(62 * S)
}

function normalizeDataPath(path) {
  if (!path) return ''
  if (path.indexOf('/data/') === 0) return path.substring(6)
  if (path.indexOf('data://') === 0) return path.substring(7)
  return path
}

function openBookSource(filePath) {
  try {
    var fd, st, path = filePath || ''
    if (path.indexOf('raw/') === 0) {
      st = statAssetsSync({ path: path })
      fd = openAssetsSync({ path: path, flag: O_RDONLY })
      return { fd: fd, size: st && st.size ? st.size : 0, asset: true, path: path }
    }
    path = normalizeDataPath(path)
    st = statSync({ path: path })
    fd = openSync({ path: path, flag: O_RDONLY })
    return { fd: fd, size: st && st.size ? st.size : 0, asset: false, path: path }
  } catch (e) { return null }
}

function closeBookSource() {
  if (source && source.fd !== undefined && source.fd !== null) {
    try { closeSync({ fd: source.fd }) } catch (e) {}
  }
  source = null
}

function readBytesAt(offset, length) {
  if (!source || offset >= source.size) return { bytes: null, len: 0 }
  if (offset + length > source.size) length = source.size - offset
  if (length <= 0) return { bytes: null, len: 0 }
  try {
    var buf = new ArrayBuffer(length)
    var n = readSync({ fd: source.fd, buffer: buf, options: { offset: 0, length: length, position: offset } })
    if (!n || n <= 0) return { bytes: null, len: 0 }
    return { bytes: new Uint8Array(buf), len: n }
  } catch (e) { return { bytes: null, len: 0 } }
}

function cpByteLen(b) {
  return b < 0x80 ? 1 : ((b & 0xE0) === 0xC0 ? 2 : ((b & 0xF0) === 0xE0 ? 3 : ((b & 0xF8) === 0xF0 ? 4 : 1)))
}

function pageLimits(cfg) {
  var cpl = Math.floor(READ_W / (cfg.size * 1.02))
  var maxLines = Math.floor(READ_H / cfg.lh)
  if (cpl < 4) cpl = 4
  if (maxLines < 1) maxLines = 1
  return { cpl: cpl, maxLines: maxLines }
}

// 渲染从 startOffset 开始的一页，返回 {text,end,eof}。只读一页，开销很小。
function renderPage(startOffset, cfg) {
  if (!source) return { text: '(读取失败)', start: 0, end: 0, eof: true }
  var lim = pageLimits(cfg)
  var lines = [], line = '', lineLen = 0
  var pos = startOffset

  while (lines.length < lim.maxLines && pos < source.size) {
    var got = readBytesAt(pos, STEP)
    if (got.len <= 0) break
    var bytes = got.bytes, len = got.len
    var atEOF = (pos + len >= source.size)
    var i = 0, full = false
    while (i < len) {
      var b = bytes[i]
      var blen = cpByteLen(b)
      if (i + blen > len) { if (atEOF) { i = len } ; break }
      var cp
      if (blen === 1) cp = b
      else if (blen === 2) cp = ((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F)
      else if (blen === 3) cp = ((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F)
      else cp = 0x3F
      i += blen
      if (cp === 0x0D) continue
      if (cp === 0x0A) {
        lines.push(line); line = ''; lineLen = 0
        if (lines.length >= lim.maxLines) { full = true; break }
      } else {
        line += String.fromCharCode(cp); lineLen++
        if (lineLen >= lim.cpl) {
          lines.push(line); line = ''; lineLen = 0
          if (lines.length >= lim.maxLines) { full = true; break }
        }
      }
    }
    pos += i
    if (full) break
  }
  if (lines.length < lim.maxLines && line.length > 0) lines.push(line)
  return { lines: lines, start: startOffset, end: pos, eof: pos >= source.size }
}

// 估算每页字节数 + 约总页数（仅一次 4KB 采样，零卡顿）
function estimateLayout(cfg) {
  var lim = pageLimits(cfg)
  var ratio = 2.6
  if (source && source.size > 0) {
    var at = source.size > 8192 ? Math.floor(source.size / 3) : 0
    var got = readBytesAt(at, Math.min(4096, source.size))
    if (got.len > 0) {
      var chars = 0, i = 0
      while (i < got.len) {
        var bl = cpByteLen(got.bytes[i])
        if (i + bl > got.len) break
        chars++; i += bl
      }
      if (chars > 0) ratio = i / chars
    }
  }
  bpp = Math.max(64, Math.round(lim.maxLines * lim.cpl * ratio * 0.9))
  estTotal = source ? Math.max(1, Math.ceil(source.size / bpp)) : 1
}

function snapToLineStart(approx) {
  if (approx <= 0) return 0
  var winStart = Math.max(0, approx - 512)
  var got = readBytesAt(winStart, approx - winStart)
  if (got.len <= 0) return approx
  for (var i = got.len - 1; i >= 0; i--) {
    if (got.bytes[i] === 0x0A) return winStart + i + 1
  }
  return winStart
}

function displayPage() {
  if (curInfo && curInfo.eof) return estTotal
  var p = Math.floor(curStart / bpp) + 1
  if (p < 1) p = 1
  if (p > estTotal) p = estTotal
  return p
}

function percent() {
  if (!source || source.size <= 0) return 0
  var end = curInfo ? curInfo.end : curStart
  var pct = Math.floor(end * 100 / source.size)
  if (pct < 0) pct = 0
  if (pct > 100) pct = 100
  return pct
}

function refreshProgressBar() {
  try { if (readProgressWidget) deleteWidget(readProgressWidget) } catch (e) {}
  readProgressWidget = null
  var pct = percent()
  var w = Math.floor(BAR_W * pct / 100)
  if (pct > 0 && w < 2) w = 2
  if (w > BAR_W) w = BAR_W
  readProgressWidget = createWidget(widget.FILL_RECT, { x: BAR_X, y: BAR_Y, w: w, h: 3, color: theme().bar })
}

function battStr() {
  try {
    if (!battSensor) battSensor = new Battery()
    var b = battSensor.getCurrent()
    if (typeof b !== 'number') return ''
    if (lastBatt >= 0 && b > lastBatt) charging = true
    else if (lastBatt >= 0 && b < lastBatt) charging = false
    lastBatt = b
    return (charging ? '充' : '') + b + '%'
  } catch (e) { return '' }
}
function topText() { return nowHHMM() + '  ' + percent() + '%  ' + battStr() }

function two(n) { return n < 10 ? '0' + n : '' + n }
function nowHHMM() {
  try {
    if (!timeSensor) timeSensor = new Time()
    return two(timeSensor.getHours()) + ':' + two(timeSensor.getMinutes())
  } catch (e) { return '' }
}

function updateMeta() {
  if (pageNumWidget) pageNumWidget.setProperty(prop.TEXT, displayPage() + ' / ~' + estTotal)
  if (topPctWidget) topPctWidget.setProperty(prop.TEXT, topText())
}

// 主题换肤：背景/正文/页码/进度条配色
function applyChromeColors() {
  var th = theme()
  try { if (bgRect) bgRect.setProperty(prop.MORE, { x: 0, y: 0, w: W, h: H, color: th.bg }) } catch (e) {}
  try { if (pageNumWidget) pageNumWidget.setProperty(prop.MORE, { x: Math.round((W - 200) / 2), y: META_Y, w: 200, h: 22, text: displayPage() + ' / ~' + estTotal, text_size: 15, color: th.sub, align_h: align.CENTER_H }) } catch (e) {}
  try { if (topPctWidget) topPctWidget.setProperty(prop.MORE, { x: Math.round((W - 180) / 2), y: TOP_PCT_Y, w: 180, h: 20, text: topText(), text_size: 13, color: th.sub, align_h: align.CENTER_H }) } catch (e) {}
  try { if (barBgRect) barBgRect.setProperty(prop.MORE, { x: BAR_X, y: BAR_Y, w: BAR_W, h: 3, color: th.barbg }) } catch (e) {}
}

// ── 亮度（系统会在亮屏时重置，故定时/翻页时反复重申）──
function applyBrightness() {
  try { setBrightness({ brightness: brightVal }) } catch (e) {}
}

// ── 阅读计时 ──
function currentReadSec() {
  var s = baseReadSec
  if (sessionStart) s += Math.floor((Date.now() - sessionStart) / 1000)
  return s
}
function fmtMin(sec) {
  var m = Math.floor(sec / 60)
  if (m < 60) return m + '分'
  return Math.floor(m / 60) + '时' + (m % 60) + '分'
}
function flushReadTime() {
  try {
    var all = {}
    try { all = JSON.parse(localStorage.getItem('read_time', '{}')) } catch (e) {}
    all[String(bookId)] = currentReadSec()
    localStorage.setItem('read_time', JSON.stringify(all))
  } catch (e) {}
}
function loadReadTime(bid) {
  try {
    var all = JSON.parse(localStorage.getItem('read_time', '{}'))
    return all[String(bid)] || 0
  } catch (e) { return 0 }
}
function startClock() {
  stopClock()
  function tick() {
    if (topPctWidget) topPctWidget.setProperty(prop.TEXT, topText())
    if (menu.active && menu.timerText) {
      try { menu.timerText.setProperty(prop.TEXT, '本次 ' + fmtMin(currentReadSec() - baseReadSec) + ' · 累计 ' + fmtMin(currentReadSec())) } catch (e) {}
    }
    applyBrightness()    // 反复重申，抵抗系统亮屏重置
    flushReadTime()
    clockTimer = setTimeout(tick, 30000)
  }
  clockTimer = setTimeout(tick, 30000)
}
function stopClock() {
  if (clockTimer) { clearTimeout(clockTimer); clockTimer = null }
}

// ── 逐行渲染 + 控件池：每行一个固定 TEXT，y 按 lh 精确定位（行距可调、
//    最后一行不被裁）。控件池只在字号/行距变化时重建，翻页只 setProperty
//    刷新文字 → 大幅减少弱 CPU 的控件创建/销毁开销。──
var poolLh = 0, poolSize = 0

function clearLines() {
  for (var i = 0; i < lineWidgets.length; i++) { try { deleteWidget(lineWidgets[i]) } catch (e) {} }
  lineWidgets = []
  poolLh = 0; poolSize = 0
}
function clearTaps() {
  for (var i = 0; i < tapWidgets.length; i++) { try { deleteWidget(tapWidgets[i]) } catch (e) {} }
  tapWidgets = []
}
function buildPageWidgets(cfg) {
  clearLines(); clearTaps()
  var n = Math.floor(READ_H / cfg.lh)
  for (var i = 0; i < n; i++) {
    lineWidgets.push(createWidget(widget.TEXT, {
      x: READ_X, y: READ_Y + i * cfg.lh, w: READ_W, h: cfg.lh,
      text: '', text_size: cfg.size, color: theme().fg,
      align_h: align.LEFT, align_v: align.CENTER_V
    }))
  }
  // 触摸层盖在文字之上（TEXT 会挡点击）
  var half = Math.floor(READ_W / 2)
  var L = createWidget(widget.FILL_RECT, { x: READ_X, y: READ_Y, w: half, h: READ_H, color: 0x000000, alpha: 0 })
  L.addEventListener(event.CLICK_DOWN, function () { goPrev() })
  tapWidgets.push(L)
  var R = createWidget(widget.FILL_RECT, { x: READ_X + half, y: READ_Y, w: READ_W - half, h: READ_H, color: 0x000000, alpha: 0 })
  R.addEventListener(event.CLICK_DOWN, function () { goNext() })
  tapWidgets.push(R)
  poolLh = cfg.lh; poolSize = cfg.size
}
function drawPage() {
  if (!source) return
  var cfg = cfgNow()
  if (lineWidgets.length === 0 || poolLh !== cfg.lh || poolSize !== cfg.size) buildPageWidgets(cfg)
  curInfo = renderPage(curStart, cfg)
  var lines = curInfo.lines, n = lineWidgets.length
  for (var i = 0; i < n; i++) {
    var txt = i < lines.length ? (lines[i] || '') : ''
    try { lineWidgets[i].setProperty(prop.TEXT, txt) } catch (e) {}
  }
  updateMeta()
  refreshProgressBar()
}
function refreshDisplay() { drawPage() }

function saveProgress() {
  try {
    var all = {}
    try { all = JSON.parse(localStorage.getItem('reading_progress', '{}')) } catch (e) {}
    all[String(bookId)] = {
      offset: curStart,
      page: displayPage(),
      total: estTotal,
      percent: percent(),
      fontSize: FONT_SIZES[fontIdx],
      spacingIdx: spacingIdx,
      brightVal: brightVal,
      themeIdx: themeIdx,
      autoIdx: autoIdx,
      scrollMode: scrollMode,
      ts: Date.now()
    }
    localStorage.setItem('reading_progress', JSON.stringify(all))
  } catch (e) {}
}

function loadProgress(bid) {
  try {
    var all = JSON.parse(localStorage.getItem('reading_progress', '{}'))
    return all[String(bid)] || null
  } catch (e) { return null }
}

function anyPanel() { return jump.active || menu.active || bm.active || sch.active }

// 翻页频繁，进度写入做防抖（1s 合并一次），省电；离开/熄屏前会即时落盘
var saveTimer = null
function saveProgressSoon() {
  if (saveTimer) return
  saveTimer = setTimeout(function () { saveTimer = null; saveProgress() }, 1000)
}

function goNext() {
  if (anyPanel()) return
  if (curInfo && curInfo.eof) return
  backStack.push(curStart)
  if (backStack.length > 5000) backStack.shift()
  curStart = curInfo ? curInfo.end : curStart
  refreshDisplay()
  saveProgressSoon()
}

function goPrev() {
  if (anyPanel()) return
  if (backStack.length > 0) curStart = backStack.pop()
  else {
    if (curStart <= 0) return
    curStart = snapToLineStart(curStart - bpp)
  }
  refreshDisplay()
  saveProgressSoon()
}

// ── 逐行无缝滚动 ──
// 返回 start 后第一行结束（下一行起点）的精确字节偏移
function lineEndOffset(start, cfg) {
  var lim = pageLimits(cfg)
  var pos = start, lineLen = 0
  while (pos < source.size) {
    var got = readBytesAt(pos, STEP)
    if (got.len <= 0) break
    var bytes = got.bytes, len = got.len
    var atEOF = (pos + len >= source.size)
    var i = 0, done = false
    while (i < len) {
      var b = bytes[i]
      var blen = b < 0x80 ? 1 : ((b & 0xE0) === 0xC0 ? 2 : ((b & 0xF0) === 0xE0 ? 3 : ((b & 0xF8) === 0xF0 ? 4 : 1)))
      if (i + blen > len) { if (atEOF) { i = len } ; break }
      var cp
      if (blen === 1) cp = b
      else if (blen === 2) cp = ((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F)
      else if (blen === 3) cp = ((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F)
      else cp = 0x3F
      i += blen
      if (cp === 0x0D) continue
      if (cp === 0x0A) { done = true; break }
      lineLen++
      if (lineLen >= lim.cpl) { done = true; break }
    }
    pos += i
    if (done) break
  }
  return pos
}
function scrollDown() {
  if (anyPanel()) return
  if (curInfo && curInfo.eof) return
  var ne = lineEndOffset(curStart, cfgNow())
  if (ne <= curStart) return
  curStart = ne
  refreshDisplay()
  saveProgressSoon()
}
function scrollUp() {
  if (anyPanel()) return
  if (curStart <= 0) return
  var lim = pageLimits(cfgNow())
  var oneLine = Math.max(2, Math.round(bpp / lim.maxLines))
  curStart = snapToLineStart(Math.max(0, curStart - oneLine))
  refreshDisplay()
  saveProgressSoon()
}
function toggleScroll() {
  scrollMode = !scrollMode
  if (menu.scrollText) { try { menu.scrollText.setProperty(prop.TEXT, scrollMode ? '开' : '关') } catch (e) {} }
  saveProgress()
}

function relayout() {
  curStart = snapToLineStart(curStart)   // 仍是行首
  backStack = []
  estimateLayout(cfgNow())
  drawPage()                              // 逐行重绘（会重建正文+触摸层）
  saveProgress()
  if (menu.active) { closeMenu(); openMenu() }   // 把菜单重新升到最上层
}

function changeFont(delta) {
  var ni = fontIdx + delta
  if (ni < 0) ni = 0
  if (ni > FONT_SIZES.length - 1) ni = FONT_SIZES.length - 1   // 到顶/到底不循环
  if (ni === fontIdx) return
  fontIdx = ni
  relayout()
}

function changeSpacing(delta) {
  var ni = spacingIdx + delta
  if (ni < 0) ni = 0
  if (ni > SPACINGS.length - 1) ni = SPACINGS.length - 1
  if (ni === spacingIdx) return
  spacingIdx = ni
  relayout()
}

function changeBright(delta) {
  brightVal += delta * 5            // 每次 5%
  if (brightVal < 5) brightVal = 5
  if (brightVal > 100) brightVal = 100
  applyBrightness()
  if (menu.brightText) { try { menu.brightText.setProperty(prop.TEXT, brightVal + '%') } catch (e) {} }
  saveProgress()
}

function changeTheme(delta) {
  themeIdx = (themeIdx + delta + THEMES.length) % THEMES.length
  applyChromeColors()
  poolLh = 0          // 强制重建行控件池以换正文色
  drawPage()
  saveProgress()
  if (menu.active) { closeMenu(); openMenu() }   // 正文重建在菜单之上，重新升菜单
}

// ── 自动翻页 ──
function stopAuto() { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null } }
function startAuto() {
  stopAuto()
  var secs = AUTO_SECS[autoIdx]
  if (secs <= 0) return
  autoTimer = setTimeout(function loop() {
    if (anyPanel()) { autoTimer = setTimeout(loop, 1500); return }  // 操作面板时暂缓
    if (curInfo && curInfo.eof) { autoIdx = 0; return }            // 到尾停止
    goNext()
    autoTimer = setTimeout(loop, AUTO_SECS[autoIdx] * 1000)
  }, secs * 1000)
}
function changeAuto(delta) {
  autoIdx = (autoIdx + delta + AUTO_SECS.length) % AUTO_SECS.length
  startAuto()
  if (menu.autoText) { try { menu.autoText.setProperty(prop.TEXT, AUTO_LABELS[autoIdx]) } catch (e) {} }
  saveProgress()
}

// ── 轻量提示 ──
var toastWidgets = []
function toast(text) {
  for (var i = 0; i < toastWidgets.length; i++) { try { deleteWidget(toastWidgets[i]) } catch (e) {} }
  toastWidgets = []
  toastWidgets.push(createWidget(widget.FILL_RECT, { x: 130, y: 214, w: 220, h: 52, radius: 14, color: 0x222226 }))
  toastWidgets.push(createWidget(widget.TEXT, { x: 130, y: 214, w: 220, h: 52, text: text, text_size: 16, color: 0xFFD29A, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  setTimeout(function () {
    for (var j = 0; j < toastWidgets.length; j++) { try { deleteWidget(toastWidgets[j]) } catch (e) {} }
    toastWidgets = []
  }, 1100)
}

// ── 书签 ──
function loadBookmarks() { try { return JSON.parse(localStorage.getItem('bookmarks', '{}')) } catch (e) { return {} } }
function bookmarksOf() { var all = loadBookmarks(); return all[String(bookId)] || [] }
function saveBookmarks(list) { var all = loadBookmarks(); all[String(bookId)] = list; try { localStorage.setItem('bookmarks', JSON.stringify(all)) } catch (e) {} }
function addBookmark() {
  var list = bookmarksOf()
  for (var i = 0; i < list.length; i++) if (Math.abs(list[i].offset - curStart) < 4) { toast('本页已有书签'); return }
  list.push({ offset: curStart, page: displayPage(), pct: percent(), ts: Date.now() })
  if (list.length > 50) list.shift()
  saveBookmarks(list)
  toast('已加书签')
}

var bm = { active: false, widgets: [] }
function closeBookmarks() {
  for (var i = 0; i < bm.widgets.length; i++) { try { deleteWidget(bm.widgets[i]) } catch (e) {} }
  bm.widgets = []; bm.active = false
}
function bmAdd(w) { bm.widgets.push(w); return w }
function openBookmarks() {
  if (bm.active) return
  bm.active = true; bm.widgets = []
  bmAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000, alpha: 215 }))
  bmAdd(createWidget(widget.TEXT, { x: 70, y: 40, w: 340, h: 24, text: '书签', text_size: 17, color: 0xFFD29A, align_h: align.CENTER_H }))
  // 加书签按钮
  bmAdd(createWidget(widget.FILL_RECT, { x: 150, y: 70, w: 180, h: 40, radius: 10, color: 0x33414F }))
  bmAdd(createWidget(widget.TEXT, { x: 150, y: 70, w: 180, h: 40, text: '＋ 在此页加书签', text_size: 14, color: 0xCFE6FF, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var addT = bmAdd(createWidget(widget.FILL_RECT, { x: 150, y: 70, w: 180, h: 40, radius: 10, color: 0x000000, alpha: 0 }))
  addT.addEventListener(event.CLICK_DOWN, function () { addBookmark(); closeBookmarks(); openBookmarks() })

  var list = bookmarksOf()
  var startY = 120, rowH = 42, maxRows = 5
  var n = Math.min(list.length, maxRows)
  for (var i = 0; i < n; i++) {
    var it = list[list.length - 1 - i]   // 最近优先
    var y = startY + i * rowH
    bmAdd(createWidget(widget.FILL_RECT, { x: 80, y: y, w: 320, h: rowH - 6, radius: 8, color: 0x242424 }))
    bmAdd(createWidget(widget.TEXT, { x: 94, y: y, w: 230, h: rowH - 6, text: '第' + it.page + '页 · ' + it.pct + '%', text_size: 14, color: 0xE0E0E0, align_v: align.CENTER_V }))
    var jt = bmAdd(createWidget(widget.FILL_RECT, { x: 80, y: y, w: 264, h: rowH - 6, radius: 8, color: 0x000000, alpha: 0 }))
    jt.addEventListener(event.CLICK_DOWN, (function (off) { return function () { closeBookmarks(); curStart = off; backStack = []; refreshDisplay(); saveProgress() } })(it.offset))
    // 删除 ×
    bmAdd(createWidget(widget.TEXT, { x: 350, y: y, w: 44, h: rowH - 6, text: '×', text_size: 20, color: 0xB05A52, align_h: align.CENTER_H, align_v: align.CENTER_V }))
    var dt = bmAdd(createWidget(widget.FILL_RECT, { x: 346, y: y, w: 52, h: rowH - 6, color: 0x000000, alpha: 0 }))
    dt.addEventListener(event.CLICK_DOWN, (function (ts) { return function () {
      var l = bookmarksOf(); var nl = []
      for (var k = 0; k < l.length; k++) if (l[k].ts !== ts) nl.push(l[k])
      saveBookmarks(nl); closeBookmarks(); openBookmarks()
    } })(it.ts))
  }
  if (n === 0) bmAdd(createWidget(widget.TEXT, { x: 80, y: 150, w: 320, h: 24, text: '还没有书签', text_size: 14, color: 0x777777, align_h: align.CENTER_H }))
  // 关闭
  bmAdd(createWidget(widget.FILL_RECT, { x: 170, y: 392, w: 140, h: 38, radius: 10, color: 0x2C2C2C }))
  bmAdd(createWidget(widget.TEXT, { x: 170, y: 392, w: 140, h: 38, text: '关闭', text_size: 14, color: 0xAAAAAA, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var ct = bmAdd(createWidget(widget.FILL_RECT, { x: 170, y: 392, w: 140, h: 38, radius: 10, color: 0x000000, alpha: 0 }))
  ct.addEventListener(event.CLICK_DOWN, function () { closeBookmarks() })
}

// ── 书内搜索（输入小写字母/数字；中文受手表输入限制，主要适合英文/数字）──
function utf8Bytes(str) {
  var out = []
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)) }
    else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)) }
  }
  return out
}
function indexOfBytes(bytes, len, q) {
  var ql = q.length
  for (var i = 0; i + ql <= len; i++) {
    var ok = true
    for (var j = 0; j < ql; j++) if (bytes[i + j] !== q[j]) { ok = false; break }
    if (ok) return i
  }
  return -1
}
function runSearch(query) {
  if (!query || !source) return
  var qb = utf8Bytes(query)
  var ql = qb.length
  function scanFrom(start) {
    var BLK = 8192, pos = start
    while (pos < source.size) {
      var got = readBytesAt(pos, BLK)
      if (got.len <= 0) break
      var idx = indexOfBytes(got.bytes, got.len, qb)
      if (idx >= 0) return pos + idx
      pos += (got.len > ql ? got.len - ql + 1 : got.len)
    }
    return -1
  }
  var off = scanFrom(curStart + 1)
  if (off < 0) off = scanFrom(0)   // 回绕
  if (off < 0) { toast('未找到「' + query + '」'); return }
  curStart = snapToLineStart(off); backStack = []; refreshDisplay(); saveProgress()
  toast('已跳到匹配处')
}

var sch = { active: false, widgets: [], input: '', disp: null }
function closeSearch() {
  for (var i = 0; i < sch.widgets.length; i++) { try { deleteWidget(sch.widgets[i]) } catch (e) {} }
  sch.widgets = []; sch.active = false; sch.input = ''; sch.disp = null
}
function schAdd(w) { sch.widgets.push(w); return w }
function schUpdate() { if (sch.disp) { try { sch.disp.setProperty(prop.TEXT, sch.input || '_') } catch (e) {} } }
function openSearch() {
  if (sch.active) return
  sch.active = true; sch.widgets = []; sch.input = ''
  schAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000, alpha: 220 }))
  sch.disp = schAdd(createWidget(widget.TEXT, { x: 70, y: 44, w: 300, h: 30, text: '_', text_size: 20, color: 0xFFFFFF, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  schAdd(createWidget(widget.TEXT, { x: 70, y: 22, w: 340, h: 18, text: '搜索（字母/数字）', text_size: 11, color: 0x888888, align_h: align.CENTER_H }))

  // 紧凑键盘：a-z 6 列 + 0-9 + 控制
  var keys = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
  var cols = 6, kw = 50, kh = 34, gx = 90, gy = 80, gp = 4
  for (var i = 0; i < keys.length; i++) {
    var r = Math.floor(i / cols), c = i % cols
    var x = gx + c * (kw + gp), y = gy + r * (kh + gp)
    schAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: kw, h: kh, radius: 6, color: 0x2A2A30 }))
    schAdd(createWidget(widget.TEXT, { x: x, y: y, w: kw, h: kh, text: keys[i], text_size: 16, color: 0xEEEEEE, align_h: align.CENTER_H, align_v: align.CENTER_V }))
    var kt = schAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: kw, h: kh, radius: 6, color: 0x000000, alpha: 0 }))
    kt.addEventListener(event.CLICK_DOWN, (function (ch) { return function () { if (sch.input.length < 20) { sch.input += ch; schUpdate() } } })(keys[i]))
  }
  // 控制行
  var by = gy + 7 * (kh + gp) + 2
  function ctrl(x, w, label, color, fn) {
    schAdd(createWidget(widget.FILL_RECT, { x: x, y: by, w: w, h: 40, radius: 8, color: color }))
    schAdd(createWidget(widget.TEXT, { x: x, y: by, w: w, h: 40, text: label, text_size: 15, color: 0xFFFFFF, align_h: align.CENTER_H, align_v: align.CENTER_V }))
    var t = schAdd(createWidget(widget.FILL_RECT, { x: x, y: by, w: w, h: 40, radius: 8, color: 0x000000, alpha: 0 }))
    t.addEventListener(event.CLICK_DOWN, fn)
  }
  ctrl(88, 80, '删', 0x444444, function () { sch.input = sch.input.slice(0, -1); schUpdate() })
  ctrl(176, 70, '取消', 0x3A3A3A, function () { closeSearch() })
  ctrl(258, 84, '搜索', 0x1F7A4A, function () { var q = sch.input; closeSearch(); runSearch(q) })
}

// ── 菜单（底部页码点出）──
function closeMenu() {
  if (!menu.active) return
  for (var i = 0; i < menu.widgets.length; i++) { try { deleteWidget(menu.widgets[i]) } catch (e) {} }
  menu.widgets = []
  menu.fontText = menu.spacingText = menu.brightText = menu.themeText = menu.autoText = menu.scrollText = menu.timerText = null
  menu.active = false
}

function mAdd(w) { menu.widgets.push(w); return w }
var MPX = 72, MPW = 336

// 关键：透明触摸层必须最后创建（盖在文字之上），否则 TEXT 会挡住点击。
function menuBtn(x, y, w, h, label, bg, fg, ts, onClick) {
  mAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: 10, color: bg }))
  mAdd(createWidget(widget.TEXT, { x: x, y: y, w: w, h: h, text: label, text_size: ts, color: fg, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var t = mAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: 10, color: 0x000000, alpha: 0 }))
  t.addEventListener(event.CLICK_DOWN, onClick)
  return t
}

function menuStepper(y, label, value, onMinus, onPlus) {
  mAdd(createWidget(widget.TEXT, { x: MPX + 36, y: y, w: 56, h: 40, text: label, text_size: 15, color: 0xAAAAAA, align_v: align.CENTER_V }))
  menuBtn(MPX + 98, y, 50, 40, '−', 0x3C3C3C, 0xFFFFFF, 22, onMinus)
  var vt = mAdd(createWidget(widget.TEXT, { x: MPX + 150, y: y, w: 56, h: 40, text: value, text_size: 18, color: 0xFFD29A, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  menuBtn(MPX + 208, y, 50, 40, '＋', 0x3C3C3C, 0xFFFFFF, 22, onPlus)
  return vt
}

function openMenu() {
  if (menu.active || jump.active || bm.active || sch.active) return
  menu.active = true
  menu.widgets = []

  mAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000, alpha: 210 }))
  var closeBg = mAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000, alpha: 0 }))
  closeBg.addEventListener(event.CLICK_DOWN, function () { closeMenu() })

  var panelBg = mAdd(createWidget(widget.FILL_RECT, { x: MPX, y: 54, w: MPW, h: 358, radius: 18, color: 0x242424 }))
  panelBg.addEventListener(event.CLICK_DOWN, function () {})  // 吸收点击，避免误关

  mAdd(createWidget(widget.TEXT, {
    x: MPX, y: 62, w: MPW, h: 20, text: displayPage() + ' / ~' + estTotal + '  ' + percent() + '%  ' + nowHHMM(),
    text_size: 14, color: 0xCFCFCF, align_h: align.CENTER_H
  }))
  menu.timerText = mAdd(createWidget(widget.TEXT, {
    x: MPX, y: 83, w: MPW, h: 18, text: '本次 ' + fmtMin(currentReadSec() - baseReadSec) + ' · 累计 ' + fmtMin(currentReadSec()),
    text_size: 11, color: 0x8A8A8A, align_h: align.CENTER_H
  }))

  // 字号
  mAdd(createWidget(widget.TEXT, { x: MPX + 36, y: 104, w: 56, h: 38, text: '字号', text_size: 15, color: 0xAAAAAA, align_v: align.CENTER_V }))
  menuBtn(MPX + 98, 104, 50, 38, 'A-', 0x3C3C3C, 0xFFFFFF, 18, function () { changeFont(-1) })
  menu.fontText = mAdd(createWidget(widget.TEXT, { x: MPX + 150, y: 104, w: 56, h: 38, text: cfgNow().label, text_size: 18, color: 0xFFD29A, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  menuBtn(MPX + 208, 104, 50, 38, 'A+', 0x3C3C3C, 0xFFFFFF, 18, function () { changeFont(1) })

  menu.spacingText = menuStepper(146, '行距', SPACING_LABELS[spacingIdx], function () { changeSpacing(-1) }, function () { changeSpacing(1) })
  menu.brightText = menuStepper(186, '亮度', brightVal + '%', function () { changeBright(-1) }, function () { changeBright(1) })
  menu.themeText = menuStepper(226, '主题', theme().name, function () { changeTheme(-1) }, function () { changeTheme(1) })
  menu.autoText = menuStepper(266, '自动', AUTO_LABELS[autoIdx], function () { changeAuto(-1) }, function () { changeAuto(1) })

  // 书签 / 搜索 / 滚动开关
  menuBtn(MPX + 12, 308, 100, 40, '书签', 0x33414F, 0xCFE6FF, 15, function () { closeMenu(); openBookmarks() })
  menuBtn(MPX + 118, 308, 100, 40, '搜索', 0x3A2E5A, 0xD7CFF2, 15, function () { closeMenu(); openSearch() })
  mAdd(createWidget(widget.TEXT, { x: MPX + 224, y: 300, w: 100, h: 16, text: '滚动', text_size: 11, color: 0x999999, align_h: align.CENTER_H }))
  mAdd(createWidget(widget.FILL_RECT, { x: MPX + 224, y: 316, w: 100, h: 32, radius: 10, color: 0x2E4A3E }))
  menu.scrollText = mAdd(createWidget(widget.TEXT, { x: MPX + 224, y: 316, w: 100, h: 32, text: scrollMode ? '开' : '关', text_size: 16, color: 0xBFEDD0, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var scT = mAdd(createWidget(widget.FILL_RECT, { x: MPX + 224, y: 316, w: 100, h: 32, radius: 10, color: 0x000000, alpha: 0 }))
  scT.addEventListener(event.CLICK_DOWN, function () { toggleScroll() })

  // 跳页 / 返回 / 关闭
  menuBtn(MPX + 12, 356, 100, 40, '跳页', 0x3C3C3C, 0xEEEEEE, 15, function () { closeMenu(); openJumpPanel() })
  menuBtn(MPX + 118, 356, 100, 40, '返回', 0x3C3C3C, 0xEEEEEE, 15, function () { closeMenu(); back() })
  menuBtn(MPX + 224, 356, 100, 40, '关闭', 0x2C2C2C, 0xAAAAAA, 15, function () { closeMenu() })
}

// ── 跳页数字键盘 ──
function closeJumpPanel() {
  if (!jump.active) return
  for (var i = 0; i < jump.widgets.length; i++) { try { deleteWidget(jump.widgets[i]) } catch (e) {} }
  jump.widgets = []
  jump.active = false
  jump.input = ''
}

function updateJumpDisplay() {
  var disp = jump.widgets[3]
  if (disp) { try { disp.setProperty(prop.TEXT, jump.input || '___') } catch (e) {} }
}

function addJumpDigit(d) { if (jump.input.length < 6) { jump.input += d; updateJumpDisplay() } }
function jumpBackspace() { if (jump.input.length > 0) { jump.input = jump.input.slice(0, -1); updateJumpDisplay() } }

function jumpConfirm() {
  var page = parseInt(jump.input) || 1
  closeJumpPanel()
  if (page < 1) page = 1
  if (page > estTotal) page = estTotal
  var target = (page - 1) * bpp
  if (target > source.size - 1) target = Math.max(0, source.size - 1)
  curStart = snapToLineStart(target)
  backStack = []
  refreshDisplay()
  saveProgress()
}

function openJumpPanel() {
  if (jump.active) return
  jump.active = true
  jump.input = ''
  jump.widgets = []

  var px = 140, py = 96, pw = 200, ph = 244
  var padX = px + 18, padY0 = py + 72
  var bW = 50, bH = 34, bGap = 6

  jump.widgets.push(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000, alpha: 190 }))
  jump.widgets.push(createWidget(widget.FILL_RECT, { x: px, y: py, w: pw, h: ph, radius: 14, color: 0x2A2A2A }))
  jump.widgets.push(createWidget(widget.TEXT, {
    x: px + 8, y: py + 6, w: pw - 40, h: 22, text: '跳页 / 约' + estTotal + '页',
    text_size: 13, color: 0xAAAAAA, align_h: align.CENTER_H
  }))
  jump.widgets.push(createWidget(widget.TEXT, {
    x: px + 16, y: py + 32, w: pw - 32, h: 26, text: '___', text_size: 22, color: 0xFFFFFF,
    align_h: align.CENTER_H, align_v: align.CENTER_V
  }))
  jump.widgets.push(createWidget(widget.FILL_RECT, { x: px + 16, y: py + 62, w: pw - 32, h: 1, color: 0x444444 }))

  var closeBtn = createWidget(widget.FILL_RECT, { x: px + pw - 32, y: py + 4, w: 28, h: 24, color: 0x000000, alpha: 0 })
  closeBtn.addEventListener(event.CLICK_DOWN, closeJumpPanel)
  jump.widgets.push(closeBtn)
  jump.widgets.push(createWidget(widget.TEXT, {
    x: px + pw - 32, y: py + 4, w: 28, h: 24, text: '×', text_size: 18, color: 0x888888,
    align_h: align.CENTER_H, align_v: align.CENTER_V
  }))

  var btns = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['←', '0', 'OK']]
  for (var row = 0; row < 4; row++) {
    for (var col = 0; col < 3; col++) {
      var label = btns[row][col]
      var bx = padX + col * (bW + bGap)
      var by = padY0 + row * (bH + 4)
      var isOK = label === 'OK', isDel = label === '←'
      jump.widgets.push(createWidget(widget.FILL_RECT, {
        x: bx, y: by, w: bW, h: bH, radius: 8, color: isOK ? 0xFF9500 : (isDel ? 0x444444 : 0x3A3A3A)
      }))
      jump.widgets.push(createWidget(widget.TEXT, {
        x: bx, y: by, w: bW, h: bH, text: label, text_size: isOK ? 14 : 18, color: 0xFFFFFF,
        align_h: align.CENTER_H, align_v: align.CENTER_V
      }))
      var touch = createWidget(widget.FILL_RECT, { x: bx, y: by, w: bW, h: bH, radius: 8, color: 0x000000, alpha: 0 })
      if (isOK) touch.addEventListener(event.CLICK_DOWN, function () { jumpConfirm() })
      else if (isDel) touch.addEventListener(event.CLICK_DOWN, function () { jumpBackspace() })
      else touch.addEventListener(event.CLICK_DOWN, (function (d) { return function () { addJumpDigit(d) } })(label))
      jump.widgets.push(touch)
    }
  }
}

function parseParams(params) {
  if (!params) return {}
  try { return JSON.parse(params) } catch (e) { return {} }
}

function findBook() {
  if (isDownloaded) {
    var dlBooks = []
    try { dlBooks = JSON.parse(localStorage.getItem('dl_books', '[]')) } catch (e) {}
    for (var i = 0; i < dlBooks.length; i++) {
      if (String(dlBooks[i].id) === String(bookId)) return dlBooks[i]
    }
    return { title: '未知', author: '', file: '' }
  }
  var idx = parseInt(bookId) || 0
  if (idx < 0 || idx >= LIBRARY.length) idx = 0
  return LIBRARY[idx]
}

function defaultFontIdx() {
  for (var i = 0; i < FONT_SIZES.length; i++) if (FONT_SIZES[i] === 21) return i
  return Math.floor(FONT_SIZES.length / 2)
}

Page({
  onInit(params) {
    var p = parseParams(params)
    if (p.bookId !== undefined && p.bookId !== null && p.bookId !== '') {
      bookId = p.bookId
      isDownloaded = (p.downloaded === '1')
    } else {
      // 熄屏重启回到本页时 params 可能丢失，用持久化兜底
      try {
        var r = JSON.parse(localStorage.getItem('_reading', 'null'))
        if (r) { bookId = r.bookId; isDownloaded = !!r.downloaded }
      } catch (e) {}
    }
    fontIdx = defaultFontIdx()
  },

  onDestroy() {
    stopClock()
    stopAuto()
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    saveProgress()       // 即时落盘最新进度
    flushReadTime()
    try { if (savedBrightness >= 0) setBrightness({ brightness: savedBrightness }) } catch (e) {}
    try { setWakeUpRelaunch({ relaunch: false }) } catch (e) {}  // 离开阅读页恢复正常熄屏行为
    closeJumpPanel()
    closeMenu()
    closeBookmarks()
    closeSearch()
    clearLines()
    clearTaps()
    try { if (readProgressWidget) deleteWidget(readProgressWidget) } catch (e) {}
    readProgressWidget = null
    closeBookSource()
    try { offDigitalCrown() } catch (e) {}
  },

  build() {
    computeLayout()   // 适配屏幕尺寸
    book = findBook()
    source = openBookSource(book.file)

    // 记录当前在读，配合熄屏重启回到本书
    try { localStorage.setItem('_reading', JSON.stringify({ bookId: bookId, downloaded: isDownloaded })) } catch (e) {}
    try { setWakeUpRelaunch({ relaunch: true }) } catch (e) {}

    var saved = loadProgress(bookId)
    if (saved && saved.fontSize) {
      for (var i = 0; i < FONT_SIZES.length; i++) if (FONT_SIZES[i] === saved.fontSize) fontIdx = i
    }
    if (saved && saved.spacingIdx !== undefined && saved.spacingIdx >= 0 && saved.spacingIdx < SPACINGS.length) spacingIdx = saved.spacingIdx
    if (saved && saved.brightVal !== undefined && saved.brightVal >= 5 && saved.brightVal <= 100) brightVal = saved.brightVal
    if (saved && saved.themeIdx !== undefined && saved.themeIdx >= 0 && saved.themeIdx < THEMES.length) themeIdx = saved.themeIdx
    if (saved && saved.autoIdx !== undefined && saved.autoIdx >= 0 && saved.autoIdx < AUTO_SECS.length) autoIdx = saved.autoIdx
    scrollMode = !!(saved && saved.scrollMode)
    curStart = saved && saved.offset ? saved.offset : 0
    backStack = []
    crownAccum = 0
    lastBatt = -1; charging = false

    // 亮度：记住原值，离开时恢复
    try { var gb = getBrightness(); savedBrightness = (gb && gb.brightness !== undefined) ? gb.brightness : gb } catch (e) {}
    applyBrightness()

    // 阅读计时
    baseReadSec = loadReadTime(bookId)
    sessionStart = Date.now()

    var cfg = cfgNow()
    var th = theme()
    bgRect = createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: th.bg })

    topPctWidget = createWidget(widget.TEXT, {
      x: Math.round((W - 180) / 2), y: TOP_PCT_Y, w: 180, h: 20, text: '', text_size: 13, color: th.sub, align_h: align.CENTER_H
    })

    pageNumWidget = createWidget(widget.TEXT, {
      x: Math.round((W - 200) / 2), y: META_Y, w: 200, h: 22, text: '...', text_size: 15, color: th.sub, align_h: align.CENTER_H
    })
    barBgRect = createWidget(widget.FILL_RECT, { x: BAR_X, y: BAR_Y, w: BAR_W, h: 3, color: th.barbg })

    // 底部页码点出菜单（建在正文之前；翻页时正文/触摸层会重建在其上方，
    // 但 metaTap 主体在正文区下方，互不影响）
    var metaTap = createWidget(widget.FILL_RECT, { x: Math.round((W - 260) / 2), y: META_Y - 4, w: 260, h: 36, color: 0x000000, alpha: 0 })
    metaTap.addEventListener(event.CLICK_DOWN, function () { openMenu() })

    if (source) {
      estimateLayout(cfg)
      drawPage()             // 逐行渲染正文 + 翻页触摸层
      saveProgress()
    } else {
      createWidget(widget.TEXT, {
        x: READ_X, y: READ_Y, w: READ_W, h: 60, text: '(读取失败: ' + book.file + ')',
        text_size: 16, color: 0xCC6666, align_h: align.LEFT, align_v: align.TOP
      })
    }
    startClock()
    startAuto()

    offDigitalCrown()
    onDigitalCrown({
      callback: function (key, degree) {
        if (key !== KEY_HOME || anyPanel()) return
        crownAccum += degree
        var guard = 12
        if (scrollMode) {
          // 滚动模式：逐行无缝滚动
          while (crownAccum > THRESHOLD && guard-- > 0) { crownAccum -= THRESHOLD; scrollUp() }
          while (crownAccum < -THRESHOLD && guard-- > 0) { crownAccum += THRESHOLD; scrollDown() }
        } else {
          // 翻页模式（保留余量，避免一次一页一次两页）
          while (crownAccum > THRESHOLD && guard-- > 0) { crownAccum -= THRESHOLD; goPrev() }
          while (crownAccum < -THRESHOLD && guard-- > 0) { crownAccum += THRESHOLD; goNext() }
        }
      }
    })
  }
})
