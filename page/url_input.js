/**
 * URL 输入页 — T9 风格，适配圆形屏
 * 用于输入 OPENLIST 直链
 * 点击 OK 后写入 settingsStorage，触发 Side Service 下载
 */

import { createWidget, widget, align, event, prop } from '@zos/ui'
import { push, pop } from '@zos/router'

var W = 480, H = 480
var SAFE = { L: 78, R: 402, T: 65, B: 415 }

// @zos/settings — 用于写入 settingsStorage 触发下载
var _settings = null
try {
  _settings = require('@zos/settings')
} catch (e) {
  console.log('[URLInput] require settings failed:', e.message)
}

// T9 键盘映射
var T9_MAP = {
  1: '1',
  2: 'abc2',
  3: 'def3',
  4: 'ghi4',
  5: 'jkl5',
  6: 'mno6',
  7: 'pqrs7',
  8: 'tuv8',
  9: 'wxyz9',
  0: '0.:/-_~% ',
}

var state = {
  url: '',
  t9Key: -1,
  t9Idx: 0,
  t9Timer: null,
}

var widgets = []

function build() {
  // 正确销毁：调用 widget 对象的 deleteWidget() 方法
  for (var i = 0; i < widgets.length; i++) {
    try { widgets[i].deleteWidget() } catch (e) {}
  }
  widgets = []

  // ── 标题 ──
  widgets.push(createWidget(widget.TEXT, {
    x: SAFE.L, y: SAFE.T,
    w: SAFE.R - SAFE.L, h: 28,
    text: '输入下载链接',
    text_size: 16, color: 0xFFFFFF,
    align_h: align.CENTER_H,
  }))

  // ── URL 显示区 ──
  var urlView = state.url
  if (urlView.length > 44) urlView = '...' + urlView.substring(urlView.length - 41)
  widgets.push(createWidget(widget.TEXT, {
    x: SAFE.L + 4, y: SAFE.T + 34,
    w: SAFE.R - SAFE.L - 8, h: 26,
    text: urlView || '(空)',
    text_size: 13, color: urlView ? 0xAAEEFF : 0x555555,
    align_h: align.LEFT,
  }))

  // ── 光标指示 ──
  widgets.push(createWidget(widget.FILL_RECT, {
    x: SAFE.L, y: SAFE.T + 62,
    w: SAFE.R - SAFE.L, h: 1,
    color: 0x3388CC,
  }))

  // ── T9 键盘 ──
  var keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, -1, 0, -2]
  var keyW = 88, keyH = 52, gapX = 6, gapY = 5
  var startX = SAFE.L + 4, startY = SAFE.T + 75

  for (var r = 0; r < 4; r++) {
    for (var c = 0; c < 3; c++) {
      var idx = r * 3 + c
      var key = keys[idx]
      var kx = startX + c * (keyW + gapX)
      var ky = startY + r * (keyH + gapY)

      if (key === -1) {
        // 删除键
        widgets.push(createWidget(widget.FILL_RECT, {
          x: kx, y: ky, w: keyW, h: keyH,
          radius: 8, color: 0x3A2A2A,
        }))
        widgets.push(createWidget(widget.TEXT, {
          x: kx, y: ky, w: keyW, h: keyH,
          text: 'DEL', text_size: 15, color: 0xFF8888,
          align_h: align.CENTER_H, align_v: align.CENTER_V,
        }))
        // 触摸层（最后创建 = 最上层）
        var delTouch = createWidget(widget.FILL_RECT, {
          x: kx, y: ky, w: keyW, h: keyH,
          radius: 8, color: 0x000000, alpha: 0,
        })
        delTouch.addEventListener(event.CLICK_DOWN, function () {
          state.url = state.url.substring(0, state.url.length - 1)
          clearTimer()
          build()
        })
        widgets.push(delTouch)

      } else if (key === -2) {
        // 确认键
        widgets.push(createWidget(widget.FILL_RECT, {
          x: kx, y: ky, w: keyW, h: keyH,
          radius: 8, color: 0x1A3A1A,
        }))
        widgets.push(createWidget(widget.TEXT, {
          x: kx, y: ky, w: keyW, h: keyH,
          text: 'OK', text_size: 15, color: 0x88FF88,
          align_h: align.CENTER_H, align_v: align.CENTER_V,
        }))
        var okTouch = createWidget(widget.FILL_RECT, {
          x: kx, y: ky, w: keyW, h: keyH,
          radius: 8, color: 0x000000, alpha: 0,
        })
        okTouch.addEventListener(event.CLICK_DOWN, function () {
          if (state.url.length < 5) return
          if (_settings && _settings.settingsStorage) {
            _settings.settingsStorage.setItem('_dl_title', extractTitle(state.url))
            _settings.settingsStorage.setItem('_dl_author', '')
            _settings.settingsStorage.setItem('_dl_url', state.url)
          }
          pop()
        })
        widgets.push(okTouch)

      } else {
        // 数字/字母键 — 用局部变量捕获 key 值
        var label = String(key)
        var sub = T9_MAP[key]
        widgets.push(createWidget(widget.FILL_RECT, {
          x: kx, y: ky, w: keyW, h: keyH,
          radius: 8, color: 0x2A2A2A,
        }))
        widgets.push(createWidget(widget.TEXT, {
          x: kx, y: ky + 2, w: keyW, h: 20,
          text: label,
          text_size: 16, color: 0xFFFFFF,
          align_h: align.CENTER_H,
        }))
        widgets.push(createWidget(widget.TEXT, {
          x: kx, y: ky + 22, w: keyW, h: 16,
          text: sub,
          text_size: 9, color: 0x888888,
          align_h: align.CENTER_H,
        }))
        // 触摸层（最后创建 = 最上层）
        var keyTouch = createWidget(widget.FILL_RECT, {
          x: kx, y: ky, w: keyW, h: keyH,
          radius: 8, color: 0x000000, alpha: 0,
        })
        // 用闭包捕获当前 key 值
        ;(function (k) {
          keyTouch.addEventListener(event.CLICK_DOWN, function () { onT9Key(k) })
        })(key)
        widgets.push(keyTouch)
      }
    }
  }

  // ── 提示文字 ──
  widgets.push(createWidget(widget.TEXT, {
    x: SAFE.L, y: SAFE.B - 18,
    w: SAFE.R - SAFE.L, h: 16,
    text: '短按切换字符 · 输入5位以上后点OK',
    text_size: 9, color: 0x444444,
    align_h: align.CENTER_H,
  }))
}

function onT9Key(key) {
  clearTimer()

  if (state.t9Key === key) {
    state.t9Idx = (state.t9Idx + 1) % T9_MAP[key].length
  } else {
    if (state.t9Key >= 0) {
      var prevMap = T9_MAP[state.t9Key]
      state.url += prevMap[state.t9Idx]
    }
    state.t9Key = key
    state.t9Idx = 0
  }

  var map = T9_MAP[key]
  var ch = map[state.t9Idx]
  if (state.t9Key === key && state.t9Idx > 0) {
    state.url = state.url.substring(0, state.url.length - 1) + ch
  } else if (state.t9Idx === 0) {
    state.url += ch
  }

  state.t9Timer = setTimeout(function () {
    state.t9Key = -1
    state.t9Idx = 0
    state.t9Timer = null
  }, 800)

  build()
}

function clearTimer() {
  if (state.t9Timer) {
    clearTimeout(state.t9Timer)
    state.t9Timer = null
  }
}

function extractTitle(url) {
  try {
    var parts = url.split('/')
    var file = parts[parts.length - 1] || '未知书籍'
    file = file.split('?')[0]
    file = file.split('#')[0]
    if (file.endsWith('.txt')) file = file.substring(0, file.length - 4)
    try { return decodeURIComponent(file) } catch (e) { return file }
  } catch (e) {
    return '未知书籍'
  }
}

Page({
  onInit() {
    state.url = ''
    state.t9Key = -1
    state.t9Idx = 0
  },
  build() {
    build()
  },
  onDestroy() {
    clearTimer()
    for (var i = 0; i < widgets.length; i++) {
      try { widgets[i].deleteWidget() } catch (e) {}
    }
    widgets = []
  },
})
