/**
 * 伪装科学计算器 v2 — 三页（基础 / 函数 / 三角）
 * 表达式求值，真实可用；输入密码(默认123456)按 = 进入隐藏书架。
 * UI 为圆角方钮 + 分类配色，自成一套（非圆形钮风格）。
 */

import { createWidget, widget, align, event, prop, deleteWidget } from '@zos/ui'
import { push } from '@zos/router'
import { onDigitalCrown, KEY_HOME, offDigitalCrown, onGesture, offGesture, GESTURE_LEFT, GESTURE_RIGHT, GESTURE_UP } from '@zos/interaction'
import { localStorage } from '@zos/storage'
import { getDeviceInfo } from '@zos/device'

var W = 480, H = 480

// 配色（分类）
var COL_BG = 0x0A0A0D
var COL_NUM = 0x26262D
var COL_NUM_T = 0xF2F2F4
var COL_OP = 0x2E4A63
var COL_OP_T = 0xCFE3F5
var COL_FN = 0x35305A
var COL_FN_T = 0xD7CFF2
var COL_DEL = 0x4A2C2C
var COL_DEL_T = 0xE7A6A6
var COL_EQ = 0xE08A3C
var COL_EQ_T = 0xFFFFFF
var COL_DISP = 0xF4F4F6
var COL_SUB = 0x6A6A72

// 网格：5 列 4 行，居中（computeLayout 按屏幕尺寸缩放）
var COLS = 5
var CELL = 62, GAP = 8, STEP = CELL + GAP
var GRID_X = 69, GRID_Y = 112, DOTS_Y = 392
function computeLayout() {
  var di; try { di = getDeviceInfo() } catch (e) { di = null }
  W = (di && di.width) ? di.width : 480
  H = (di && di.height) ? di.height : 480
  var S = W / 480
  CELL = Math.round(62 * S); GAP = Math.round(8 * S); STEP = CELL + GAP
  GRID_X = Math.round((W - (COLS * CELL + (COLS - 1) * GAP)) / 2)
  GRID_Y = Math.round(112 * S)
  DOTS_Y = H - Math.round(88 * S)
}

// 按钮类别
var NUM = 0, OP = 1, FN = 2, DEL = 3, EQ = 4, CV = 5

// d=显示串 p=求值串 c=类别 (act 特殊：clear/neg/conv；cv=换算函数)
function B(l, d, p, c, act, cv) { return { l: l, d: d, p: p === undefined ? d : p, c: c, act: act, cv: cv } }
function C(l, fn) { return { l: l, c: CV, act: 'conv', cv: fn } }   // 换算钮

// 标签用 ASCII 安全字符（手表系统字体可能不含上标/√），同时与参考圆钮风格区分
var PAGES = [
  // 基础
  [
    B('×', '×', '×', OP), B('7', '7'), B('8', '8'), B('9', '9'), B('+', '+', '+', OP),
    B('÷', '÷', '÷', OP), B('4', '4'), B('5', '5'), B('6', '6'), B('-', '-', '-', OP),
    B('±', '-', '-', OP, 'neg'), B('1', '1'), B('2', '2'), B('3', '3'), B('=', '', '', EQ, 'eq'),
    B('C', '', '', DEL, 'clear'), B('0', '0'), B('.', '.'), null, null
  ],
  // 函数
  [
    B('(', '(', '(', FN), B(')', ')', ')', FN), B('π', 'π', 'π', FN), B('e', 'e', 'e', FN), B('|x|', 'abs(', 'abs(', FN),
    B('x^2', '^2', '^2', FN), B('x^y', '^', '^', FN), B('ln', 'ln(', 'ln(', FN), B('log', 'log(', 'log(', FN), B('floor', 'floor(', 'floor(', FN),
    B('x^3', '^3', '^3', FN), B('x!', '!', '!', FN), B('sqrt', 'sqrt(', 'sqrt(', FN), B('cbrt', 'cbrt(', 'cbrt(', FN), B('ceil', 'ceil(', 'ceil(', FN),
    B('ans', 'ans', 'ans', FN), B('exp', 'exp(', 'exp(', FN), B('mod', '%', '%', OP), null, null
  ],
  // 三角
  [
    B('sin', 'sin(', 'sin(', FN), B('sec', 'sec(', 'sec(', FN), B('sinh', 'sinh(', 'sinh(', FN), B('sech', 'sech(', 'sech(', FN), B('asin', 'asin(', 'asin(', FN),
    B('cos', 'cos(', 'cos(', FN), B('csc', 'csc(', 'csc(', FN), B('cosh', 'cosh(', 'cosh(', FN), B('csch', 'csch(', 'csch(', FN), B('acos', 'acos(', 'acos(', FN),
    B('tan', 'tan(', 'tan(', FN), B('cot', 'cot(', 'cot(', FN), B('tanh', 'tanh(', 'tanh(', FN), B('coth', 'coth(', 'coth(', FN), B('atan', 'atan(', 'atan(', FN),
    B('asinh', 'asinh(', 'asinh(', FN), B('acosh', 'acosh(', 'acosh(', FN), B('atanh', 'atanh(', 'atanh(', FN), null, null
  ],
  // 单位换算（取当前数值，点一下即换算）
  [
    C('m>ft', function (v) { return v * 3.28084 }), C('ft>m', function (v) { return v / 3.28084 }), C('cm>in', function (v) { return v / 2.54 }), C('in>cm', function (v) { return v * 2.54 }), C('km>mi', function (v) { return v * 0.621371 }),
    C('mi>km', function (v) { return v / 0.621371 }), C('kg>lb', function (v) { return v * 2.20462 }), C('lb>kg', function (v) { return v / 2.20462 }), C('g>oz', function (v) { return v * 0.035274 }), C('oz>g', function (v) { return v / 0.035274 }),
    C('C>F', function (v) { return v * 9 / 5 + 32 }), C('F>C', function (v) { return (v - 32) * 5 / 9 }), C('L>gal', function (v) { return v * 0.264172 }), C('gal>L', function (v) { return v / 0.264172 }), C('km/h>m/s', function (v) { return v / 3.6 }),
    null, null, null, null, null
  ]
]

var tokens = []          // {d,p}
var cursor = 0           // 光标位置（插入点，0..tokens.length）
var lastAns = 0
var page = 0
var slots = []           // 按钮控件池
var dots = []            // 圆点控件池
var displayWidget = null
var crownAccum = 0
var lastCrownTs = 0

function getPwd() {
  try { var v = localStorage.getItem('calc_pwd', ''); if (v) return String(v) } catch (e) {}
  return '123456'
}

function dispStr(withCaret) {
  var s = ''
  for (var i = 0; i < tokens.length; i++) {
    if (withCaret && i === cursor) s += '|'
    s += tokens[i].d
  }
  if (withCaret && cursor >= tokens.length) s += '|'
  return s
}
function parseStr() {
  var s = ''
  for (var i = 0; i < tokens.length; i++) s += tokens[i].p
  return s
}

function updateDisplay(text) {
  var s = text !== undefined ? text : (tokens.length === 0 ? '0' : dispStr(true))
  var size = 38
  if (s.length > 7) size = 30
  if (s.length > 11) size = 22
  if (s.length > 16) size = 17
  if (s.length > 22) { size = 14; s = '…' + s.substring(s.length - 21) }
  if (displayWidget) {
    displayWidget.setProperty(prop.MORE, {
      x: 64, y: 60, w: 286, h: 46, text: s, text_size: size, color: COL_DISP,
      align_h: align.RIGHT, align_v: align.CENTER_V
    })
  }
}

function moveCursor(d) {
  var nc = cursor + d
  if (nc < 0) nc = 0
  if (nc > tokens.length) nc = tokens.length
  if (nc === cursor) return
  cursor = nc
  updateDisplay()
}

// ── 表达式求值（递归下降）──
function fact(n) {
  if (n < 0 || Math.floor(n) !== n) return NaN
  var r = 1; for (var i = 2; i <= n; i++) r *= i; return r
}
var FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  sec: function (x) { return 1 / Math.cos(x) }, csc: function (x) { return 1 / Math.sin(x) },
  cot: function (x) { return 1 / Math.tan(x) },
  sech: function (x) { return 1 / Math.cosh(x) }, csch: function (x) { return 1 / Math.sinh(x) },
  coth: function (x) { return 1 / Math.tanh(x) },
  ln: Math.log, log: function (x) { return Math.log(x) / Math.LN10 },
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, exp: Math.exp
}

function evaluate(str) {
  var s = str, pos = 0
  function skip() { while (s.charAt(pos) === ' ') pos++ }
  function E() {
    var v = T()
    for (; ;) {
      skip(); var c = s.charAt(pos)
      if (c === '+') { pos++; v += T() }
      else if (c === '−' || c === '-') { pos++; v -= T() }
      else return v
    }
  }
  function T() {
    var v = P()
    for (; ;) {
      skip(); var c = s.charAt(pos)
      if (c === '×' || c === '*') { pos++; v *= P() }
      else if (c === '÷' || c === '/') { pos++; v /= P() }
      else if (c === '%') { pos++; v = v % P() }
      else return v
    }
  }
  function P() {  // power 右结合
    var v = U()
    skip()
    if (s.charAt(pos) === '^') { pos++; return Math.pow(v, P()) }
    return v
  }
  function U() {
    skip(); var c = s.charAt(pos)
    if (c === '−' || c === '-') { pos++; return -U() }
    if (c === '+') { pos++; return U() }
    return Post()
  }
  function Post() {
    var v = Prim()
    for (; ;) { skip(); if (s.charAt(pos) === '!') { pos++; v = fact(v) } else return v }
  }
  function Prim() {
    skip(); var c = s.charAt(pos)
    if (c === '(') { pos++; var v = E(); skip(); if (s.charAt(pos) === ')') pos++; return v }
    if (c === 'π') { pos++; return Math.PI }
    if ((c >= '0' && c <= '9') || c === '.') {
      var st = pos
      while (pos < s.length && ((s.charAt(pos) >= '0' && s.charAt(pos) <= '9') || s.charAt(pos) === '.')) pos++
      return parseFloat(s.substring(st, pos))
    }
    if ((c >= 'a' && c <= 'z')) {
      var st2 = pos
      while (pos < s.length && s.charAt(pos) >= 'a' && s.charAt(pos) <= 'z') pos++
      var name = s.substring(st2, pos)
      if (name === 'e') return Math.E
      if (name === 'pi') return Math.PI
      if (name === 'ans') return lastAns
      var fn = FUNCS[name]
      skip()
      if (s.charAt(pos) === '(') { pos++; var a = E(); skip(); if (s.charAt(pos) === ')') pos++; return fn ? fn(a) : NaN }
      return fn ? fn(0) : NaN
    }
    pos++   // 跳过未知
    return 0
  }
  var r = E()
  return r
}

function fmtResult(v) {
  if (v === undefined || v === null || (typeof v === 'number' && (isNaN(v) || !isFinite(v)))) return 'Error'
  var n = +v
  if (Math.abs(n) >= 1e12 || (Math.abs(n) < 1e-9 && n !== 0)) return n.toExponential(6)
  var s = (Math.round(n * 1e9) / 1e9).toString()
  if (s.length > 14) s = n.toPrecision(10)
  return s
}

function pushToken(b) { tokens.splice(cursor, 0, { d: b.d, p: b.p }); cursor++; updateDisplay() }
function doClear() { tokens = []; cursor = 0; updateDisplay() }
function doDelete() { if (cursor > 0) { tokens.splice(cursor - 1, 1); cursor-- } updateDisplay() }
function doNeg() { tokens.splice(cursor, 0, { d: '-', p: '-' }); cursor++; updateDisplay() }

function saveHistory(expr, result) {
  try {
    var h = []
    try { h = JSON.parse(localStorage.getItem('calc_history', '[]')) } catch (e) {}
    h.push({ e: expr, r: result })
    if (h.length > 20) h = h.slice(h.length - 20)
    localStorage.setItem('calc_history', JSON.stringify(h))
  } catch (e) {}
}

function doEquals() {
  var ps = parseStr()
  if (ps === getPwd()) { tokens = []; cursor = 0; push({ url: 'page/bookshelf' }); return }
  if (tokens.length === 0) return
  try {
    var expr = dispStr(false)
    var v = evaluate(ps)
    var out = fmtResult(v)
    if (out === 'Error') { updateDisplay('Error'); tokens = []; cursor = 0; return }
    lastAns = +v
    saveHistory(expr, String(out))
    setResultTokens(out)
  } catch (e) { updateDisplay('Error'); tokens = []; cursor = 0 }
}

function currentValue() {
  if (tokens.length === 0) return lastAns
  try { var v = evaluate(parseStr()); return isFinite(v) ? v : 0 } catch (e) { return 0 }
}
function setResultTokens(out) {
  tokens = []
  var s = String(out)
  for (var i = 0; i < s.length; i++) tokens.push({ d: s.charAt(i), p: s.charAt(i) })
  cursor = tokens.length
  updateDisplay()
}
function doConv(b) {
  var r = b.cv(currentValue())
  var out = fmtResult(r)
  if (out === 'Error') { updateDisplay('Error'); tokens = []; cursor = 0; return }
  lastAns = +r
  setResultTokens(out)
}

function onButton(b) {
  if (!b) return
  if (b.act === 'eq') doEquals()
  else if (b.act === 'clear') doClear()
  else if (b.act === 'neg') doNeg()
  else if (b.act === 'conv') doConv(b)
  else pushToken(b)
}

// ── 绘制 ──
function btnColors(c) {
  if (c === NUM) return [COL_NUM, COL_NUM_T]
  if (c === OP) return [COL_OP, COL_OP_T]
  if (c === FN) return [COL_FN, COL_FN_T]
  if (c === DEL) return [COL_DEL, COL_DEL_T]
  if (c === CV) return [0x1E5A52, 0xBFEDE5]   // 换算：青绿
  return [COL_EQ, COL_EQ_T]
}

function fsOf(label) {
  return label.length >= 5 ? 13 : (label.length >= 3 ? 16 : (label === '=' ? 26 : 22))
}

// 控件池：20 个槽位只建一次，切页只 setProperty 改文字/颜色 → 翻页流畅
function buildSlots() {
  for (var i = 0; i < slots.length; i++) { try { deleteWidget(slots[i].bg); deleteWidget(slots[i].txt); deleteWidget(slots[i].touch) } catch (e) {} }
  slots = []
  for (var idx = 0; idx < COLS * 4; idx++) {
    var row = Math.floor(idx / COLS), col = idx % COLS
    var x = GRID_X + col * STEP, y = GRID_Y + row * STEP
    var bg = createWidget(widget.FILL_RECT, { x: x, y: y, w: CELL, h: CELL, radius: 16, color: COL_BG })
    var txt = createWidget(widget.TEXT, { x: x, y: y, w: CELL, h: CELL, text: '', text_size: 20, color: 0xFFFFFF, align_h: align.CENTER_H, align_v: align.CENTER_V })
    var touch = createWidget(widget.FILL_RECT, { x: x, y: y, w: CELL, h: CELL, radius: 16, color: 0x000000, alpha: 0 })
    var slot = { bg: bg, txt: txt, touch: touch, x: x, y: y, base: COL_BG }
    touch.addEventListener(event.CLICK_DOWN, (function (s, i) {
      return function () {
        var b = PAGES[page][i]
        if (!b) return
        pressFlash(s.bg, s.base, s.x, s.y)
        onButton(b)
      }
    })(slot, idx))
    slots.push(slot)
  }
}

function applyPage() {
  var defs = PAGES[page]
  for (var idx = 0; idx < slots.length; idx++) {
    var s = slots[idx], b = defs[idx]
    if (b) {
      var cc = btnColors(b.c)
      s.base = cc[0]
      try { s.bg.setProperty(prop.MORE, { x: s.x, y: s.y, w: CELL, h: CELL, radius: 16, color: cc[0] }) } catch (e) {}
      try { s.txt.setProperty(prop.MORE, { x: s.x, y: s.y, w: CELL, h: CELL, text: b.l, text_size: fsOf(b.l), color: cc[1], align_h: align.CENTER_H, align_v: align.CENTER_V }) } catch (e) {}
    } else {
      s.base = COL_BG
      try { s.bg.setProperty(prop.MORE, { x: s.x, y: s.y, w: CELL, h: CELL, radius: 16, color: COL_BG }) } catch (e) {}
      try { s.txt.setProperty(prop.TEXT, '') } catch (e) {}
    }
  }
}

function clearGrid() {
  for (var i = 0; i < slots.length; i++) { try { deleteWidget(slots[i].bg); deleteWidget(slots[i].txt); deleteWidget(slots[i].touch) } catch (e) {} }
  slots = []
  for (var j = 0; j < dots.length; j++) { try { deleteWidget(dots[j].d); deleteWidget(dots[j].t) } catch (e) {} }
  dots = []
}

// 按下高亮：瞬时提亮按钮底色，120ms 后还原
function lighten(c) {
  var r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF
  r = Math.min(255, r + 50); g = Math.min(255, g + 50); b = Math.min(255, b + 50)
  return (r << 16) | (g << 8) | b
}
function flashColor(bw, color, gx, gy) {
  try { bw.setProperty(prop.MORE, { x: gx, y: gy, w: CELL, h: CELL, radius: 16, color: color }) } catch (e) {}
}
function pressFlash(bw, base, gx, gy) {
  flashColor(bw, lighten(base), gx, gy)
  setTimeout(function () { flashColor(bw, base, gx, gy) }, 120)
}

// 圆点也用池：只建一次，切页改宽度/颜色
function buildDots() {
  for (var i = 0; i < dots.length; i++) { try { deleteWidget(dots[i].d) } catch (e) {} }
  dots = []
  var n = PAGES.length, dw = 8, dgap = 14, totalW = n * dw + (n - 1) * dgap
  var sx = Math.round((W - totalW) / 2), y = DOTS_Y
  for (var p = 0; p < n; p++) {
    var dx = sx + p * (dw + dgap)
    var d = createWidget(widget.FILL_RECT, { x: dx, y: y, w: dw, h: dw, radius: 4, color: 0x444450 })
    var t = createWidget(widget.FILL_RECT, { x: dx - 8, y: y - 12, w: dw + 16, h: 32, color: 0x000000, alpha: 0 })
    t.addEventListener(event.CLICK_DOWN, (function (pp) { return function () { setPage(pp) } })(p))
    dots.push({ d: d, t: t, x: dx, y: y })
  }
}
function applyDots() {
  for (var p = 0; p < dots.length; p++) {
    var active = p === page
    try { dots[p].d.setProperty(prop.MORE, { x: dots[p].x, y: dots[p].y, w: active ? 18 : 8, h: 8, radius: 4, color: active ? COL_EQ : 0x444450 }) } catch (e) {}
  }
}

function setPage(p) {
  page = (p + PAGES.length) % PAGES.length
  applyPage()
  applyDots()
}

// ── 历史记录（上滑打开）──
var hist = { active: false, widgets: [] }
function closeHistory() {
  for (var i = 0; i < hist.widgets.length; i++) { try { deleteWidget(hist.widgets[i]) } catch (e) {} }
  hist.widgets = []; hist.active = false
}
function hAdd(w) { hist.widgets.push(w); return w }
function openHistory() {
  if (hist.active) return
  hist.active = true; hist.widgets = []
  var h = []; try { h = JSON.parse(localStorage.getItem('calc_history', '[]')) } catch (e) {}
  var bg = hAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000, alpha: 222 }))
  bg.addEventListener(event.CLICK_DOWN, function () {})   // 吸收点击，避免穿透到按钮
  hAdd(createWidget(widget.TEXT, { x: 70, y: 40, w: 340, h: 22, text: '历史记录', text_size: 16, color: 0xFFD29A, align_h: align.CENTER_H }))

  var startY = 72, rowH = 44, maxRows = 5
  var n = Math.min(h.length, maxRows)
  for (var i = 0; i < n; i++) {
    var it = h[h.length - 1 - i]
    var y = startY + i * rowH
    hAdd(createWidget(widget.FILL_RECT, { x: 70, y: y, w: 340, h: rowH - 6, radius: 8, color: 0x242428 }))
    hAdd(createWidget(widget.TEXT, { x: 84, y: y + 3, w: 312, h: 16, text: trim(it.e, 26), text_size: 12, color: 0x9AA0A6 }))
    hAdd(createWidget(widget.TEXT, { x: 84, y: y + 18, w: 312, h: 18, text: '= ' + trim(it.r, 22), text_size: 15, color: 0xF0F0F2 }))
    var t = hAdd(createWidget(widget.FILL_RECT, { x: 70, y: y, w: 340, h: rowH - 6, radius: 8, color: 0x000000, alpha: 0 }))
    t.addEventListener(event.CLICK_DOWN, (function (res) { return function () { closeHistory(); insertText(res) } })(it.r))
  }
  if (n === 0) hAdd(createWidget(widget.TEXT, { x: 70, y: 150, w: 340, h: 24, text: '暂无历史', text_size: 14, color: 0x777777, align_h: align.CENTER_H }))

  hAdd(createWidget(widget.FILL_RECT, { x: 96, y: 392, w: 130, h: 38, radius: 9, color: 0x4A2C2C }))
  hAdd(createWidget(widget.TEXT, { x: 96, y: 392, w: 130, h: 38, text: '清空', text_size: 14, color: 0xE7A6A6, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var clr = hAdd(createWidget(widget.FILL_RECT, { x: 96, y: 392, w: 130, h: 38, radius: 9, color: 0x000000, alpha: 0 }))
  clr.addEventListener(event.CLICK_DOWN, function () { try { localStorage.setItem('calc_history', '[]') } catch (e) {} closeHistory(); openHistory() })
  hAdd(createWidget(widget.FILL_RECT, { x: 254, y: 392, w: 130, h: 38, radius: 9, color: 0x2C2C2C }))
  hAdd(createWidget(widget.TEXT, { x: 254, y: 392, w: 130, h: 38, text: '关闭', text_size: 14, color: 0xAAAAAA, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var cl = hAdd(createWidget(widget.FILL_RECT, { x: 254, y: 392, w: 130, h: 38, radius: 9, color: 0x000000, alpha: 0 }))
  cl.addEventListener(event.CLICK_DOWN, function () { closeHistory() })
}
function trim(s, m) { s = String(s); return s.length > m ? s.substring(0, m - 1) + '…' : s }
function insertText(s) {
  for (var i = 0; i < s.length; i++) { tokens.splice(cursor, 0, { d: s.charAt(i), p: s.charAt(i) }); cursor++ }
  updateDisplay()
}

Page({
  onInit() {
    tokens = []; cursor = 0; page = 0; lastAns = 0; crownAccum = 0; lastCrownTs = 0
  },
  onDestroy() {
    closeHistory()
    clearGrid()
    try { offDigitalCrown() } catch (e) {}
    try { offGesture() } catch (e) {}
  },
  build() {
    computeLayout()   // 适配屏幕尺寸
    createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: COL_BG })

    // 顶部显示（带光标） + 删除键
    displayWidget = createWidget(widget.TEXT, {
      x: 64, y: 60, w: 286, h: 46, text: '0', text_size: 38, color: COL_DISP,
      align_h: align.RIGHT, align_v: align.CENTER_V
    })
    createWidget(widget.FILL_RECT, { x: 356, y: 64, w: 42, h: 36, radius: 10, color: 0x2A2A30 })
    createWidget(widget.TEXT, { x: 356, y: 64, w: 42, h: 36, text: 'DEL', text_size: 13, color: COL_SUB, align_h: align.CENTER_H, align_v: align.CENTER_V })
    var delTouch = createWidget(widget.FILL_RECT, { x: 352, y: 60, w: 50, h: 44, radius: 10, color: 0x000000, alpha: 0 })
    delTouch.addEventListener(event.CLICK_DOWN, function () { doDelete() })

    buildSlots()
    buildDots()
    applyPage()
    applyDots()

    // 左右滑动切页
    try {
      offGesture()
      onGesture({
        callback: function (e) {
          if (hist.active) { if (e === GESTURE_LEFT || e === GESTURE_RIGHT) { closeHistory(); return true } return false }
          if (e === GESTURE_UP) { openHistory(); return true }      // 上滑看历史
          if (e === GESTURE_LEFT) { setPage(page + 1); return true }
          if (e === GESTURE_RIGHT) { setPage(page - 1); return true }
          return false
        }
      })
    } catch (err) {}

    // 表冠移动光标（带去抖，避免一次跳两格）
    offDigitalCrown()
    onDigitalCrown({
      callback: function (key, degree) {
        if (key !== KEY_HOME || hist.active) return
        var now = Date.now()
        crownAccum += degree
        if (Math.abs(crownAccum) < 40) return
        if (now - lastCrownTs < 130) { crownAccum = 0; return }
        lastCrownTs = now
        var dir = crownAccum > 0 ? 1 : -1
        crownAccum = 0
        moveCursor(dir)
      }
    })
  }
})
