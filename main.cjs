const { app, BrowserWindow, Menu } = require('electron')
const path = require('path')

// 禁用 GPU 沙箱，兼容更多 Linux 桌面环境
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('disable-software-rasterizer')

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
    },
  })

  // 加载本地构建产物
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  // 移除默认菜单栏
  Menu.setApplicationMenu(null)
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  app.quit()
})