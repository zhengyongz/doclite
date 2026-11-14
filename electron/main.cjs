const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { registerUpdater } = require('./updater.cjs')
const { registerConvertersComponent } = require('./converters-component.cjs')

// GPU 兼容性开关（--no-sandbox 由 CLI 传入：electron:dev 脚本与 .desktop executableArgs，
// 用于 Ubuntu 24.04 AppArmor 拦截 user namespace 的环境；正式 deb 由 postinst 处理 chrome-sandbox SUID）
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('disable-software-rasterizer')

// ---------- 文件关联：双击/打开方式传入的文件路径 ----------
// 从 argv 提取待打开文件（过滤掉 Electron/Chromium 开关与隐臧 -- 开头参数）
function extractFilePathFromArgv(argv) {
  const supported = ['.pdf', '.docx', '.xlsx', '.xls', '.pptx', '.mobi', '.azw3', '.md', '.markdown']
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
  // isDestroyed 必判：macOS 关窗不退出，mainWindow 引用可能仍非空但 webContents 已销毁，
  // 此时向它 send 会抛 "Object has been destroyed"（workbuddy M5）
  if (!mainWindow || mainWindow.isDestroyed() || pendingFilePath == null) return
  // renderer 启动后轮询/事件双通道：优先 invoke 拉取，拉不到时窗口 focus 补拉
  mainWindow.webContents.send('doclite:open-file-changed')
}

// macOS open-file 事件处理（模块顶层注册：macOS 双击文件启动时该事件早于 whenReady 触发，
// 注册在 whenReady 内会丢失首个事件，表现为“应用打开了但文件没载入”）
app.on('open-file', (e, filePath) => {
  e.preventDefault()
  const lower = filePath.toLowerCase()
  if (['.pdf', '.docx', '.xlsx', '.xls', '.pptx', '.mobi', '.azw3', '.md', '.markdown'].some(ext => lower.endsWith(ext))) {
    pendingFilePath = filePath
    if (mainWindow) notifyRenderer()
  }
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '轻快文档工具箱',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    // macOS 平台风格（v0.7.0+）：标题栏并入界面（保留红绿灯按钮），窗口底色透明以透出
    // 毛玻璃 vibrancy；Windows/Linux 保持系统标题栏不动
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      vibrancy: 'under-window',
      backgroundColor: '#00000000',
    } : {}),
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

  // 窗口关闭后置空引用（macOS 关窗不退出应用，否则 open-file 会打到已销毁窗口）
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  return win
}

// IPC：当前应用版本号（侧边栏"版本信息"展示用）
ipcMain.handle('app:get-version', () => app.getVersion())

// IPC：用系统默认浏览器打开外链（MdRenderer 文档内 http/https 链接）
// 安全：仅放行 http/https 白名单，拒绝 file:/javascript: 等自定义 scheme（workbuddy M3）
ipcMain.handle('doclite:open-external', (_e, url) => {
  const u = typeof url === 'string' ? url : ''
  if (/^https?:\/\//i.test(u)) {
    shell.openExternal(u)
    return true
  }
  return false
})

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

  // 冷启动时 open-file（顶层监听）可能已设置待打开文件：窗口就绪后补推一次，
  // 供渲染层拉取消费（拉取通道消费即清空，不会双载）
  if (pendingFilePath) notifyRenderer()

  // 自动升级模块：注册 IPC（检查/下载/剪贴板/打开安装包）+ 启动 3 秒后静默检查
  registerUpdater()

  // 可选转换组件：注册 IPC（状态检测/应用内安装/卸载/解压回传）
  registerConvertersComponent()

  // 冒烟测试模式（DOCLITE_SMOKE=1，仅源码环境）：转发渲染层日志，6 秒时截图后自动退出，用于无头回归验证
  // DOCLITE_SMOKE_INTERACT=1（附加）：截第一张后模拟鼠标移到屏幕左缘，验证沉浸侧栏滑出（v0.7.0 沉浸交互）
  // DOCLITE_SMOKE_DARWIN=1（附加）：再给页面手动挂 platform-darwin 类，静态预览 macOS 布局（无真机时的兜底检查）
  if (process.env.DOCLITE_SMOKE === '1' && !app.isPackaged) {
    mainWindow.webContents.on('console-message', (_e, _level, message) => {
      console.log('[renderer]', message)
    })
    setTimeout(async () => {
      const work = mainWindow.webContents
      const shoot = async (name) => {
        try {
          const img = await work.capturePage()
          const out = path.join(app.getPath('temp'), name)
          fs.mkdirSync(path.dirname(out), { recursive: true })
          fs.writeFileSync(out, img.toPNG())
          console.log('[smoke] 截图已保存:', out)
        } catch (e) {
          console.log('[smoke] 截图失败:', e.message)
        }
      }
      await shoot('doclite-smoke.png')

      // 模拟真实鼠标路径：左缘热区 → 移入侧栏内部 → 移出到文档区 → 应防抖收起。
      // 注意：sendInputEvent 是离散跳变，必须分步路径让 Chromium 对侧栏产生 enter/leave
      // 事件（真实移动天然连续，此处模拟还原）；直接瞬移到右侧不会触发侧栏 mouseleave。
      if (process.env.DOCLITE_SMOKE_INTERACT === '1') {
        work.sendInputEvent({ type: 'mouseMove', x: 4, y: 500 })
        await new Promise((r) => setTimeout(r, 700))
        await shoot('doclite-smoke-sidebar-open.png')
        work.sendInputEvent({ type: 'mouseMove', x: 200, y: 500 }) // 进入侧栏内部
        await new Promise((r) => setTimeout(r, 300))
        work.sendInputEvent({ type: 'mouseMove', x: 700, y: 500 }) // 离开侧栏到文档
        await new Promise((r) => setTimeout(r, 800))
        // DOM 实测：读侧栏 computed transform（视觉之外的硬证据；收起 ≈ translateX(-336px)）
        const tf = await work.executeJavaScript(
          "getComputedStyle(document.querySelector('.app-sidebar')).transform"
        ).catch(() => 'N/A')
        console.log('[smoke] 收起态 .app-sidebar transform =', tf)
        await shoot('doclite-smoke-sidebar-closed.png')
      }

      // 手动切 platform-darwin 类 → 预览 macOS 布局（标题栏留白等）
      if (process.env.DOCLITE_SMOKE_DARWIN === '1') {
        await work.executeJavaScript(
          "document.documentElement.className = document.documentElement.className.replace(/platform-\\w+/, 'platform-darwin')"
        ).catch(() => {})
        await new Promise((r) => setTimeout(r, 300))
        await shoot('doclite-smoke-darwin.png')
      }

      console.log('[smoke] 完成，正常退出')
      app.quit()
    }, 6000)
  }

// macOS activate：dock 图标点击重建窗口（配合下方 window-all-closed 不退出）
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

// macOS 惯例：关窗不退出应用（dock 图标保留，点击可重新激活）；其余平台退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
