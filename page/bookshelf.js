/**
 * 书架主界面 — 圆形屏分页书架
 * 每屏只绘制少量卡片，降低控件数量并避免列表溢出。
 */

import { createWidget, widget, align, event, prop, deleteWidget } from '@zos/ui'
import { push } from '@zos/router'
import { localStorage } from '@zos/storage'
import { rmSync } from '@zos/fs'
import { getDeviceInfo } from '@zos/device'

var W = 480
var SAFE = { L: 78, R: 402, T: 65, B: 415 }
var PAGE_SIZE = 4

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

var shelfPage = 0
var shelfWidgets = []
var shelfAlive = true

function trimText(text, max) {
  text = String(text || '')
  return text.length > max ? text.substring(0, max - 1) + '…' : text
}

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key, JSON.stringify(fallback))) } catch (e) { return fallback }
}

function loadDownloadedBooks() {
  return readJson('dl_books', [])
}

function loadHidden() {
  return readJson('hidden_books', {})
}

function progressMap() { return readJson('reading_progress', {}) }

function getAllBooks() {
  var all = []
  var hidden = loadHidden()
  var dl = loadDownloadedBooks()
  for (var i = 0; i < LIBRARY.length; i++) {
    if (!hidden[String(LIBRARY[i].id)]) all.push(LIBRARY[i])
  }
  for (var j = 0; j < dl.length; j++) all.push(dl[j])
  // 最近阅读置顶（按 reading_progress.ts 降序，未读保持原序）
  var prog = progressMap()
  all.sort(function (a, b) {
    var pa = prog[String(a.id)], pb = prog[String(b.id)]
    return ((pb && pb.ts) || 0) - ((pa && pa.ts) || 0)
  })
  return all
}

function addShelfWidget(w) {
  shelfWidgets.push(w)
  return w
}

function clearShelf() {
  for (var i = 0; i < shelfWidgets.length; i++) {
    try { deleteWidget(shelfWidgets[i]) } catch (e) {}
  }
  shelfWidgets = []
}

function openBook(book) {
  push({ url: 'page/reader', params: { bookId: String(book.id), downloaded: book.downloaded ? '1' : '0' } })
}

// ── 删除已下载书籍 ──
var confirmWidgets = []

function clearConfirm() {
  for (var i = 0; i < confirmWidgets.length; i++) {
    try { deleteWidget(confirmWidgets[i]) } catch (e) {}
  }
  confirmWidgets = []
}

function normalizeDataPath(path) {
  if (!path) return ''
  if (path.indexOf('/data/') === 0) return path.substring(6)
  if (path.indexOf('data://') === 0) return path.substring(7)
  return path
}

function removeKey(key) {
  try {
    if (localStorage.removeItem) localStorage.removeItem(key)
    else localStorage.setItem(key, '')
  } catch (e) {}
}

function doDelete(book) {
  var isBuiltin = book.file && book.file.indexOf('raw/') === 0

  if (isBuiltin) {
    // 内置书无法删文件，记入隐藏表，不再显示
    var hidden = loadHidden()
    hidden[String(book.id)] = 1
    try { localStorage.setItem('hidden_books', JSON.stringify(hidden)) } catch (e) {}
  } else {
    // 已下载书：移出 dl_books 并删除文件
    var dl = loadDownloadedBooks()
    var next = []
    for (var i = 0; i < dl.length; i++) {
      if (String(dl[i].id) !== String(book.id)) next.push(dl[i])
    }
    try { localStorage.setItem('dl_books', JSON.stringify(next)) } catch (e) {}
    if (book.file) { try { rmSync({ path: normalizeDataPath(book.file) }) } catch (e) {} }
  }

  // 清理阅读进度 + 页索引缓存
  try {
    var all = JSON.parse(localStorage.getItem('reading_progress', '{}'))
    if (all[String(book.id)]) { delete all[String(book.id)]; localStorage.setItem('reading_progress', JSON.stringify(all)) }
  } catch (e) {}
  removeKey('idx_' + book.id)

  clearConfirm()
  shelfPage = 0
  renderShelf()
}

// 透明触摸层最后建（盖文字之上），保证点得到
function cBtn(x, y, w, h, label, bg, fg, ts, onClick) {
  confirmWidgets.push(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: 10, color: bg }))
  confirmWidgets.push(createWidget(widget.TEXT, { x: x, y: y, w: w, h: h, text: label, text_size: ts, color: fg, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var t = createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: 10, color: 0x000000, alpha: 0 })
  t.addEventListener(event.CLICK_DOWN, onClick)
  confirmWidgets.push(t)
}

function showDeleteConfirm(book) {
  clearConfirm()
  var isBuiltin = book.file && book.file.indexOf('raw/') === 0
  var verb = isBuiltin ? '隐藏' : '删除'

  // 背景吸收点击，避免误触下层书卡
  var bg = createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: 0x000000, alpha: 205 })
  bg.addEventListener(event.CLICK_DOWN, function () { clearConfirm() })
  confirmWidgets.push(bg)

  confirmWidgets.push(createWidget(widget.FILL_RECT, { x: 96, y: 150, w: 288, h: 184, radius: 18, color: 0x272727 }))
  confirmWidgets.push(createWidget(widget.TEXT, {
    x: 112, y: 168, w: 256, h: 24, text: verb + '这本书？',
    text_size: 17, color: 0xF2F2F2, align_h: align.CENTER_H
  }))
  confirmWidgets.push(createWidget(widget.TEXT, {
    x: 112, y: 198, w: 256, h: 36, text: trimText(book.title, 22),
    text_size: 13, color: 0x9A9A9A, align_h: align.CENTER_H
  }))

  cBtn(116, 278, 110, 46, '取消', 0x3C3C3C, 0xEEEEEE, 16, function () { clearConfirm() })
  cBtn(254, 278, 110, 46, verb, isBuiltin ? 0x4A4A2C : 0xC0392B, 0xFFFFFF, 16, (function (b) { return function () { doDelete(b) } })(book))
}

var COVER_PAL = [0x3A4A6B, 0x5A3E5E, 0x3E5E4A, 0x6B4A3A, 0x44476B, 0x5E5A3E, 0x3E5A5E, 0x5E3E4A]
function coverColor(book) {
  var s = String(book.title || ''), h = 0
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff
  return COVER_PAL[h % COVER_PAL.length]
}

// 封面网格瓦片
var TILE_W = 148, TILE_H = 140, COVER_H = 92
function drawTile(book, x, y) {
  var prog = progressMap()[String(book.id)]
  addShelfWidget(createWidget(widget.FILL_RECT, { x: x, y: y, w: TILE_W, h: COVER_H, radius: 12, color: coverColor(book) }))
  addShelfWidget(createWidget(widget.TEXT, {
    x: x + 8, y: y + 8, w: TILE_W - 16, h: COVER_H - 16, text: trimText(book.title, 22),
    text_size: 15, color: 0xF4F4F4, align_h: align.CENTER_H, align_v: align.CENTER_V
  }))
  // 进度条
  if (prog && prog.percent) {
    addShelfWidget(createWidget(widget.FILL_RECT, { x: x, y: y + COVER_H - 4, w: Math.floor(TILE_W * prog.percent / 100), h: 4, color: 0xD8924B }))
  }
  // 底部：进度 / 作者
  var sub = prog && prog.percent ? ('已读 ' + prog.percent + '%') : trimText(book.author || (book.downloaded ? '线上' : '内置'), 12)
  addShelfWidget(createWidget(widget.TEXT, {
    x: x, y: y + COVER_H + 4, w: TILE_W - 26, h: 20, text: sub, text_size: 11,
    color: prog && prog.percent ? 0xD8924B : 0x888888, align_h: align.LEFT, align_v: align.CENTER_V
  }))
  // 打开
  var open = addShelfWidget(createWidget(widget.FILL_RECT, { x: x, y: y, w: TILE_W, h: TILE_H, radius: 12, color: 0x000000, alpha: 0 }))
  open.addEventListener(event.CLICK_DOWN, (function (b) { return function () { openBook(b) } })(book))
  // 删除（右上角 ×，盖在打开层之上）
  addShelfWidget(createWidget(widget.FILL_RECT, { x: x + TILE_W - 28, y: y + 4, w: 24, h: 24, radius: 12, color: 0x000000, alpha: 130 }))
  addShelfWidget(createWidget(widget.TEXT, { x: x + TILE_W - 28, y: y + 4, w: 24, h: 24, text: '×', text_size: 16, color: 0xEEEEEE, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var del = addShelfWidget(createWidget(widget.FILL_RECT, { x: x + TILE_W - 32, y: y, w: 32, h: 32, color: 0x000000, alpha: 0 }))
  del.addEventListener(event.CLICK_DOWN, (function (b) { return function () { showDeleteConfirm(b) } })(book))
}

function drawNav(totalPages) {
  var y = 388
  addShelfWidget(createWidget(widget.TEXT, {
    x: 200, y: y + 6, w: 80, h: 18, text: (shelfPage + 1) + '/' + totalPages,
    text_size: 11, color: 0x666666, align_h: align.CENTER_H
  }))
  if (shelfPage > 0) {
    var prev = addShelfWidget(createWidget(widget.FILL_RECT, { x: 130, y: y, w: 54, h: 30, radius: 8, color: 0x252525 }))
    addShelfWidget(createWidget(widget.TEXT, { x: 130, y: y + 5, w: 54, h: 18, text: '<', text_size: 16, color: 0x999999, align_h: align.CENTER_H }))
    prev.addEventListener(event.CLICK_DOWN, function () { shelfPage--; renderShelf() })
  }
  if (shelfPage < totalPages - 1) {
    var next = addShelfWidget(createWidget(widget.FILL_RECT, { x: 296, y: y, w: 54, h: 30, radius: 8, color: 0x252525 }))
    addShelfWidget(createWidget(widget.TEXT, { x: 296, y: y + 5, w: 54, h: 18, text: '>', text_size: 16, color: 0x999999, align_h: align.CENTER_H }))
    next.addEventListener(event.CLICK_DOWN, function () { shelfPage++; renderShelf() })
  }
}

function renderShelf() {
  clearShelf()
  var allBooks = getAllBooks()

  // 「＋在线上传」入口
  addShelfWidget(createWidget(widget.FILL_RECT, { x: 178, y: 62, w: 124, h: 28, radius: 14, color: 0x2B3A47 }))
  addShelfWidget(createWidget(widget.TEXT, { x: 178, y: 62, w: 124, h: 28, text: '＋ 在线上传', text_size: 12, color: 0xAFD2EE, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var upTap = addShelfWidget(createWidget(widget.FILL_RECT, { x: 178, y: 62, w: 124, h: 28, radius: 14, color: 0x000000, alpha: 0 }))
  upTap.addEventListener(event.CLICK_DOWN, function () { showUploadHelp() })

  if (allBooks.length === 0) {
    addShelfWidget(createWidget(widget.TEXT, {
      x: 80, y: 210, w: 320, h: 24, text: '暂无书籍，点上方「＋在线上传」', text_size: 14, color: 0x777777, align_h: align.CENTER_H
    }))
    return
  }

  var totalPages = Math.ceil(allBooks.length / PAGE_SIZE)
  if (shelfPage >= totalPages) shelfPage = totalPages - 1
  if (shelfPage < 0) shelfPage = 0

  // 2 列网格（按屏宽居中）
  var gapX = 16, gapY = 12
  var gx = Math.round((W - (2 * TILE_W + gapX)) / 2), gy = 100
  var start = shelfPage * PAGE_SIZE
  var end = Math.min(allBooks.length, start + PAGE_SIZE)
  for (var i = start; i < end; i++) {
    var k = i - start
    var col = k % 2, row = Math.floor(k / 2)
    drawTile(allBooks[i], gx + col * (TILE_W + gapX), gy + row * (TILE_H + gapY))
  }

  drawNav(totalPages)
}

// ── 接收进度浮层（百分比 + 进度条），数据来自 app.js 写入的 _recv ──
var recvWidgets = []
var recvBarFill = null, recvPctText = null, recvTitleText = null, recvShown = false
var RB_X = 100, RB_W = 280

function clearRecv() {
  for (var i = 0; i < recvWidgets.length; i++) { try { deleteWidget(recvWidgets[i]) } catch (e) {} }
  recvWidgets = []
  recvBarFill = recvPctText = recvTitleText = null
  recvShown = false
}
function showRecv(name, pct, label, color) {
  if (!recvShown) {
    clearRecv()
    recvWidgets.push(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: 0x000000, alpha: 225 }))
    recvWidgets.push(createWidget(widget.TEXT, { x: 80, y: 150, w: 320, h: 24, text: '正在接收', text_size: 16, color: 0xFFD29A, align_h: align.CENTER_H }))
    recvTitleText = createWidget(widget.TEXT, { x: 80, y: 180, w: 320, h: 22, text: '', text_size: 13, color: 0xCCCCCC, align_h: align.CENTER_H })
    recvWidgets.push(recvTitleText)
    recvWidgets.push(createWidget(widget.FILL_RECT, { x: RB_X, y: 224, w: RB_W, h: 10, radius: 5, color: 0x333333 }))
    recvBarFill = createWidget(widget.FILL_RECT, { x: RB_X, y: 224, w: 2, h: 10, radius: 5, color: 0x4FC3F7 })
    recvWidgets.push(recvBarFill)
    recvPctText = createWidget(widget.TEXT, { x: 80, y: 244, w: 320, h: 26, text: '', text_size: 18, color: 0xFFFFFF, align_h: align.CENTER_H })
    recvWidgets.push(recvPctText)
    recvShown = true
  }
  var w = Math.floor(RB_W * pct / 100); if (w < 2) w = 2; if (w > RB_W) w = RB_W
  try { recvBarFill.setProperty(prop.MORE, { x: RB_X, y: 224, w: w, h: 10, radius: 5, color: color || 0x4FC3F7 }) } catch (e) {}
  try { recvTitleText.setProperty(prop.TEXT, trimText(name, 18)) } catch (e) {}
  try { recvPctText.setProperty(prop.TEXT, label || (pct + '%')) } catch (e) {}
}

// 返回 true 表示当前有接收活动（用于自适应轮询提速）
function checkRecv() {
  var r = null
  try { r = JSON.parse(localStorage.getItem('_recv', 'null')) } catch (e) {}
  if (!r || (Date.now() - (r.t || 0)) > 60000) { if (recvShown) clearRecv(); return false }
  if (r.s === 'recv') { showRecv(r.n, r.p || 0); return true }
  if (r.s === 'done') {
    showRecv(r.n, 100, '完成 ✓', 0x1F9D55)
    try { localStorage.removeItem('_recv') } catch (e) {}
    setTimeout(function () { if (!shelfAlive) return; clearRecv(); shelfPage = 0; renderShelf() }, 1200)
    return true
  }
  if (r.s === 'error') {
    showRecv(r.n, 0, '接收失败', 0xCC3333)
    try { localStorage.removeItem('_recv') } catch (e) {}
    setTimeout(function () { if (shelfAlive) clearRecv() }, 1500)
    return true
  }
  return false
}

// ── 自动刷新：app.js 在后台收书写入 dl_books，这里轮询数量变化自动重绘 ──
var pollTimer = null
var lastCount = -1

function pollNewBooks() {
  var active = checkRecv()
  var c = loadDownloadedBooks().length
  if (c !== lastCount && !recvShown) {
    lastCount = c
    shelfPage = 0
    renderShelf()
  } else {
    lastCount = c
  }
  // 有接收活动时 800ms 提速，空闲时 2.5s 省电
  pollTimer = setTimeout(pollNewBooks, (active || recvShown) ? 800 : 2500)
}

function startPoll() {
  stopPoll()
  lastCount = loadDownloadedBooks().length
  pollTimer = setTimeout(pollNewBooks, 1000)
}
function stopPoll() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
}

// ── 在线上传说明（手表端发现入口）──
var helpWidgets = []
function clearHelp() {
  for (var i = 0; i < helpWidgets.length; i++) { try { deleteWidget(helpWidgets[i]) } catch (e) {} }
  helpWidgets = []
}
function showUploadHelp() {
  clearHelp()
  var bg = createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: 0x000000, alpha: 220 })
  bg.addEventListener(event.CLICK_DOWN, function () {})  // 吸收背景点击
  helpWidgets.push(bg)
  helpWidgets.push(createWidget(widget.TEXT, {
    x: 70, y: 60, w: 340, h: 28, text: '在线上传小说', text_size: 18, color: 0xFFD29A, align_h: align.CENTER_H
  }))
  helpWidgets.push(createWidget(widget.TEXT, {
    x: 78, y: 100, w: 324, h: 240,
    text: '需在手机操作（手表无法打字）：\n\n1. 打开 Zepp App\n2. 我的 → 我的设备 → 你的手表\n3. 找到本应用 → 应用设置\n4. 填书名 + 粘贴下载直链\n5. 点「开始上传到手表」\n6. 保持 App 前台，回到此书架等待接收',
    text_size: 14, color: 0xDDDDDD, align_h: align.LEFT, align_v: align.TOP
  }))
  // 知道了按钮（透明触摸层最后建）
  helpWidgets.push(createWidget(widget.FILL_RECT, { x: 150, y: 356, w: 180, h: 48, radius: 12, color: 0x33414F }))
  helpWidgets.push(createWidget(widget.TEXT, { x: 150, y: 356, w: 180, h: 48, text: '知道了', text_size: 17, color: 0xCFE6FF, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var okT = createWidget(widget.FILL_RECT, { x: 150, y: 356, w: 180, h: 48, radius: 12, color: 0x000000, alpha: 0 })
  okT.addEventListener(event.CLICK_DOWN, function () { clearHelp() })
  helpWidgets.push(okT)
}

// ── 改密码（表上设置，无需旧密码）──
var pwdWidgets = []
var pwdInput = ''
function clearPwd() {
  for (var i = 0; i < pwdWidgets.length; i++) { try { deleteWidget(pwdWidgets[i]) } catch (e) {} }
  pwdWidgets = []
  pwdInput = ''
}
function pwdAdd(w) { pwdWidgets.push(w); return w }
function updatePwdDisp() {
  if (pwdWidgets[2]) { try { pwdWidgets[2].setProperty(prop.TEXT, pwdInput || '____') } catch (e) {} }
}
function pwdKey(x, y, w, h, label, bg, fg, onClick) {
  pwdAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: 10, color: bg }))
  pwdAdd(createWidget(widget.TEXT, { x: x, y: y, w: w, h: h, text: label, text_size: 20, color: fg, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var t = pwdAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: 10, color: 0x000000, alpha: 0 }))
  t.addEventListener(event.CLICK_DOWN, onClick)
}
function showPwdPanel() {
  clearPwd()
  var bg = createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: 0x000000, alpha: 225 })
  bg.addEventListener(event.CLICK_DOWN, function () {})
  pwdWidgets.push(bg)
  pwdWidgets.push(createWidget(widget.TEXT, { x: 60, y: 58, w: 360, h: 24, text: '设置新密码（4-8位数字）', text_size: 15, color: 0xFFD29A, align_h: align.CENTER_H }))
  // index 2 = display
  pwdWidgets.push(createWidget(widget.TEXT, { x: 60, y: 88, w: 360, h: 34, text: '____', text_size: 26, color: 0xFFFFFF, align_h: align.CENTER_H, align_v: align.CENTER_V }))

  var gx = 138, gy = 134, bw = 60, bh = 50, gp = 8
  var keys = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['←', '0', 'OK']]
  for (var r = 0; r < 4; r++) {
    for (var c = 0; c < 3; c++) {
      var lb = keys[r][c]
      var x = gx + c * (bw + gp), y = gy + r * (bh + gp)
      var isOK = lb === 'OK', isDel = lb === '←'
      var col = isOK ? 0x1F7A4A : (isDel ? 0x444444 : 0x2E2E34)
      var fcol = isOK ? 0xFFFFFF : 0xEEEEEE
      ;(function (label, ok, del) {
        pwdKey(x, y, bw, bh, label, col, fcol, function () {
          if (ok) {
            if (pwdInput.length >= 4) {
              try { localStorage.setItem('calc_pwd', pwdInput) } catch (e) {}
              clearPwd()
              toast('密码已更新')
            }
          } else if (del) {
            pwdInput = pwdInput.slice(0, -1); updatePwdDisp()
          } else {
            if (pwdInput.length < 8) { pwdInput += label; updatePwdDisp() }
          }
        })
      })(lb, isOK, isDel)
    }
  }
}

// 轻量提示
var toastWidgets = []
function toast(text) {
  for (var i = 0; i < toastWidgets.length; i++) { try { deleteWidget(toastWidgets[i]) } catch (e) {} }
  toastWidgets = []
  toastWidgets.push(createWidget(widget.FILL_RECT, { x: 120, y: 210, w: 240, h: 56, radius: 14, color: 0x222226 }))
  toastWidgets.push(createWidget(widget.TEXT, { x: 120, y: 210, w: 240, h: 56, text: text, text_size: 16, color: 0xFFD29A, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  setTimeout(function () {
    for (var j = 0; j < toastWidgets.length; j++) { try { deleteWidget(toastWidgets[j]) } catch (e) {} }
    toastWidgets = []
  }, 1300)
}

// ── 关于 ──
var aboutWidgets = []
function clearAbout() {
  for (var i = 0; i < aboutWidgets.length; i++) { try { deleteWidget(aboutWidgets[i]) } catch (e) {} }
  aboutWidgets = []
}
function aAdd(w) { aboutWidgets.push(w); return w }
function showAbout() {
  clearAbout()
  var bg = aAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: 0x000000, alpha: 232 }))
  bg.addEventListener(event.CLICK_DOWN, function () {})
  // 圆角图标（橙底 + 白色迷你计算器）
  var ix = 205, iy = 88, isz = 70
  aAdd(createWidget(widget.FILL_RECT, { x: ix, y: iy, w: isz, h: isz, radius: 18, color: 0xEF7A2C }))
  aAdd(createWidget(widget.FILL_RECT, { x: ix + 14, y: iy + 13, w: isz - 28, h: 14, radius: 4, color: 0xFFFFFF }))
  var dxs = [ix + 18, ix + 33, ix + 48], dys = [iy + 38, iy + 53]
  for (var r = 0; r < 2; r++) for (var c = 0; c < 3; c++) {
    var col = (r === 1 && c === 2) ? 0xEF7A2C : 0xFFFFFF   // 留个空感
    aAdd(createWidget(widget.FILL_RECT, { x: dxs[c], y: dys[r], w: 7, h: 7, radius: 4, color: 0xFFFFFF }))
  }
  aAdd(createWidget(widget.TEXT, { x: 60, y: 178, w: 360, h: 28, text: '隐藏阅读器', text_size: 21, color: 0xFFD29A, align_h: align.CENTER_H }))
  aAdd(createWidget(widget.TEXT, { x: 60, y: 210, w: 360, h: 22, text: 'v2.0.0', text_size: 15, color: 0x9AA0A6, align_h: align.CENTER_H }))
  aAdd(createWidget(widget.TEXT, { x: 50, y: 248, w: 380, h: 26, text: '请勿沉迷小说阅读喵', text_size: 16, color: 0xCFE0CF, align_h: align.CENTER_H }))
  aAdd(createWidget(widget.FILL_RECT, { x: 170, y: 320, w: 140, h: 42, radius: 11, color: 0x33414F }))
  aAdd(createWidget(widget.TEXT, { x: 170, y: 320, w: 140, h: 42, text: '关闭', text_size: 15, color: 0xCFE6FF, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var cl = aAdd(createWidget(widget.FILL_RECT, { x: 170, y: 320, w: 140, h: 42, radius: 11, color: 0x000000, alpha: 0 }))
  cl.addEventListener(event.CLICK_DOWN, function () { clearAbout() })
}

Page({
  build() {
    shelfAlive = true
    try { var di = getDeviceInfo(); if (di && di.width) W = di.width } catch (e) {}
    createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: W, color: 0x111111 })
    createWidget(widget.TEXT, {
      x: 140, y: SAFE.T - 32, w: 200, h: 28,
      text: '书架', text_size: 19, color: 0xF5F5F5,
      align_h: align.CENTER_H
    })
    // 左上角改密码入口
    createWidget(widget.FILL_RECT, { x: 120, y: 30, w: 58, h: 30, radius: 15, color: 0x242424 })
    createWidget(widget.TEXT, { x: 120, y: 30, w: 58, h: 30, text: '改密', text_size: 13, color: 0x9AA0A6, align_h: align.CENTER_H, align_v: align.CENTER_V })
    var lockBtn = createWidget(widget.FILL_RECT, { x: 118, y: 28, w: 62, h: 34, radius: 15, color: 0x000000, alpha: 0 })
    lockBtn.addEventListener(event.CLICK_DOWN, function () { showPwdPanel() })
    // 右上角关于
    createWidget(widget.FILL_RECT, { x: 302, y: 30, w: 58, h: 30, radius: 15, color: 0x242424 })
    createWidget(widget.TEXT, { x: 302, y: 30, w: 58, h: 30, text: '关于', text_size: 13, color: 0x9AA0A6, align_h: align.CENTER_H, align_v: align.CENTER_V })
    var aboutBtn = createWidget(widget.FILL_RECT, { x: 300, y: 28, w: 62, h: 34, radius: 15, color: 0x000000, alpha: 0 })
    aboutBtn.addEventListener(event.CLICK_DOWN, function () { showAbout() })

    renderShelf()
    startPoll()
  },

  onDestroy() {
    shelfAlive = false
    stopPoll()
    clearRecv()
    clearHelp()
    clearConfirm()
    clearPwd()
    clearAbout()
    clearShelf()
  }
})
