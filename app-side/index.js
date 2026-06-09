/**
 * 计算器 - Side Service
 * 设置页触发后，手机下载 TXT 到 data://download，再用 TransferFile 发给手表。
 */

function getStorage() {
  try {
    if (settings && settings.settingsStorage) return settings.settingsStorage
  } catch (e) {}
  return null
}

function setStatus(text) {
  var ss = getStorage()
  if (ss) ss.setItem('_bk_status', text)
}

function setProgress(phase, progress, text) {
  var ss = getStorage()
  if (!ss) return
  ss.setItem('_bk_phase', phase || 'idle')
  ss.setItem('_bk_progress', String(progress || 0))
  ss.setItem('_bk_status', text || '')
}

function cleanTitle(title) {
  return String(title || '未命名小说').replace(/[\\/:*?"<>|]/g, '_').substring(0, 48)
}

function getOutbox() {
  // 参考 Falcon：实测可用的是 transferFile.outbox 属性；兼容方法式写法
  if (typeof transferFile === 'undefined' || !transferFile) return null
  if (transferFile.outbox) return transferFile.outbox
  if (transferFile.getOutBox) return transferFile.getOutBox()
  if (transferFile.getOutbox) return transferFile.getOutbox()
  return null
}

function transferToWatch(filePath, task) {
  try {
    var outbox = getOutbox()
    if (!outbox) {
      setProgress('error', 0, '传输不可用：固件不支持 TransferFile')
      return
    }
    var fileObject = outbox.enqueueFile(filePath, {
      type: 'book',
      title: task.title,
      author: '线上导入',
      ts: Date.now()
    })

    fileObject.on('progress', function(event) {
      var data = event && event.data ? event.data : {}
      if (data.fileSize) {
        var pct = Math.floor(data.loadedSize * 100 / data.fileSize)
        setProgress('transfer', pct, '传输到手表 ' + pct + '%')
      }
    })

    fileObject.on('change', function(event) {
      var state = event && event.data ? event.data.readyState : ''
      if (state === 'transferred') setProgress('done', 100, '已传到手表，请打开隐藏书架')
      else if (state === 'error') setProgress('error', 0, '传输失败，请保持手表连接后重试')
      else if (state === 'canceled') setProgress('error', 0, '传输已取消')
    })
  } catch (e) {
    setProgress('error', 0, '传输启动失败: ' + (e.message || 'TransferFile不可用'))
  }
}

function startDownload(task) {
  if (!task || !task.url) return

  task.title = cleanTitle(task.title)
  var filePath = 'data://download/' + task.title + '_' + Date.now() + '.txt'
  setProgress('download', 2, '下载中...')

  try {
    if (typeof network === 'undefined' || !network || !network.downloader) {
      setProgress('error', 0, '网络模块不可用')
      return
    }
    var dl = network.downloader.downloadFile({
      url: task.url,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' },
      timeout: 180000,
      filePath: filePath
    })

    dl.onProgress = function(ev) {
      if (ev && ev.total) {
        var pct = Math.floor(ev.loaded * 100 / ev.total)
        if (pct > 95) pct = 95
        if (pct < 2) pct = 2
        setProgress('download', pct, '下载中 ' + pct + '%')
      } else {
        setProgress('download', 5, '下载中...')
      }
    }

    dl.onSuccess = function(ev) {
      var path = (ev && (ev.filePath || ev.tempFilePath)) || filePath
      setProgress('transfer', 96, '下载完成，开始传输到手表')
      transferToWatch(path, task)
    }

    dl.onFail = function(ev) {
      var msg = (ev && (ev.message || ev.code)) || '网络错误'
      setProgress('error', 0, '下载失败: ' + msg)
    }

    dl.onComplete = function() {}
  } catch (e) {
    setProgress('error', 0, '下载启动失败: ' + (e.message || '网络不可用'))
  }
}

// 按 ts 去重，避免重复处理；同时兼容"服务在写入之后才启动"的竞态
function processTrigger(raw) {
  if (!raw) return
  var task
  try { task = JSON.parse(raw) } catch (e) { setProgress('error', 0, '任务解析失败'); return }
  if (!task || !task.url) return

  var ss = getStorage()
  var seen = ss ? (ss.getItem('_dl_seen') || '') : ''
  if (String(task.ts) && String(task.ts) === seen) return   // 已处理过
  if (ss) ss.setItem('_dl_seen', String(task.ts || ''))

  setProgress('queued', 1, '任务已提交，开始下载')
  startDownload(task)
}

function checkExistingTrigger() {
  var ss = getStorage()
  if (!ss) return
  try { processTrigger(ss.getItem('_dl_trigger')) } catch (e) {}
}

AppSideService({
  onInit() {
    var ss = getStorage()
    if (!ss) return

    ss.addListener('change', function(evt) {
      if (!evt || evt.key !== '_dl_trigger' || !evt.newValue) return
      processTrigger(evt.newValue)
    })

    // 竞态修复：服务可能在设置页写入之后才启动，错过 change 事件，
    // 这里主动补查一次当前 trigger。
    checkExistingTrigger()
  },

  onRun() {
    checkExistingTrigger()
  },

  onDestroy() {}
})
