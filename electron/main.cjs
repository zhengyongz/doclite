const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { registerUpdater } = require('./updater.cjs')

// GPU 兼容性开关（保留 --no-sandbox 用于 Electron 渲染进程兼容性）
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('disable-software-rasterizer')

// ---------- 文件关联：双击/打开方式传入的文件路径 ----------
// 从 argv 提取待打开文件（过滤掉 Electron/Chromium 开关与隐臧 -- 开头参数）
function extractFilePathFromArgv(argv) {
  const supported = ['.pdf', '.docx', '.xlsx', '.pptx', '.mobi', '.azw3']
  for (const arg of argv) {
    if (arg.startsWith('-')) continue
    if (arg.endsWith('.js') || arg.endsWith('.cjs')) continue
    const lower = arg.toLowerCase()
    if (supported.some(ext => lower.endsWith(ext))) return arg
  }
  return null
}

let pendingFilePath = null
const initialFile = extractFilePathFromArgv(process.argv)
if (initialFile) pendingFilePath = initialFile

// 单实例：后续双击文件时把路径传给已有实例，避免开两个窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const f = extractFilePathFromArgv(argv)
    if (f) {
      pendingFilePath = f
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
        notifyRenderer()
      }
    }
  })
}

let mainWindow = null
function notifyRenderer() {
  if (!mainWindow || pendingFilePath == null) return
  // renderer 启动后轮询/事件双通道：优先 invoke 拉取，拉不到时窗口 focus 补拉
  mainWindow.webContents.send('doclite:open-file-changed')
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '轻快文档工具箱',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  // 安全加固：拦截新窗口，用外部浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 安全加固：阻止页面内导航到外部 URL
  win.webContents.on('will-navigate', (e) => {
    e.preventDefault()
  })

  // 加载本地构建产物
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  // 移除默认菜单栏
  Menu.setApplicationMenu(null)
  return win
}

// IPC：当前应用版本号（侧边栏"版本信息"展示用）
ipcMain.handle('app:get-version', () => app.getVersion())

// IPC：renderer 拉取待打开文件（读 Buffer 后清空，避免重复加载）
ipcMain.handle('doclite:get-open-file', async () => {
  if (pendingFilePath == null) return null
  try {
    const data = await fs.promises.readFile(pendingFilePath)
    const info = {
      name: path.basename(pendingFilePath),
      size: data.length,
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    }
    pendingFilePath = null // 消费后清空
    return info
  } catch (err) {
    console.error('[main] 读取待打开文件失败:', err)
    pendingFilePath = null
    return null
  }
})

app.whenReady().then(() => {
  mainWindow = createWindow()

  // 自动升级模块：注册 IPC（检查/下载/剪贴板/打开安装包）+ 启动 3 秒后静默检查
  registerUpdater()

  // 冒烟测试模式（DOCLITE_SMOKE=1，仅源码环境）：转发渲染层日志，6 秒时截图后自动退出，用于无头回归验证
  if (process.env.DOCLITE_SMOKE === '1' && !app.isPackaged) {
    mainWindow.webContents.on('console-message', (_e, _level, message) => {
      console.log('[renderer]', message)
    })
    setTimeout(async () => {
      try {
        const img = await mainWindow.webContents.capturePage()
        const out = path.join(app.getPath('temp'), 'doclite-smoke.png')
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, img.toPNG())
        console.log('[smoke] 截图已保存:', out)
      } catch (e) {
        console.log('[smoke] 截图失败:', e.message)
      }
      console.log('[smoke] 完成，正常退出')
      app.quit()
    }, 6000)
  }

  // macOS open-file 事件处理
  app.on('open-file', (e, filePath) => {
    e.preventDefault()
    const lower = filePath.toLowerCase()
    if (['.pdf', '.docx', '.xlsx', '.pptx', '.mobi', '.azw3'].some(ext => lower.endsWith(ext))) {
      pendingFilePath = filePath
      if (mainWindow) notifyRenderer()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
