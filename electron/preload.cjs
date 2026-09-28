// preload：在 contextIsolation 下向 renderer 暴露最小 API（文件关联打开 + 自动升级）
// 安全说明：升级相关 IPC 均不接受渲染层传入路径/命令（由主进程记账），详见 updater.cjs
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('doclite', {
  // 拉取启动参数中待打开的文件（返回 { name, size, data: ArrayBuffer } 或 null）
  getOpenFile: () => ipcRenderer.invoke('doclite:get-open-file'),
  // 主进程推送"又有新文件要打开"（单实例二次启动场景）
  onOpenFileChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('doclite:open-file-changed', listener)
    return () => ipcRenderer.removeListener('doclite:open-file-changed', listener)
  },

  // ---------- 自动升级 ----------
  // 当前应用版本号（侧边栏"版本信息"展示用）
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  // 手动检查更新，返回 { ok, currentVersion, hasUpdate, latestVersion, publishedAt, releaseNotes, asset, error }
  checkUpdate: () => ipcRenderer.invoke('updater:check'),
  // 开始下载最新安装包（进度/完成/错误经 onUpdateStatus 推送）
  startDownload: () => ipcRenderer.invoke('updater:download'),
  // 把主进程记账的安装命令复制到剪贴板（Linux）
  copyInstallCmd: () => ipcRenderer.invoke('updater:copy-install-cmd'),
  // 打开主进程记账的安装包（Windows 启动安装器 / Linux 在文件管理器中显示）
  openInstaller: () => ipcRenderer.invoke('updater:open-installer'),
  // 订阅升级状态：{ type: 'check-result'|'available'|'downloading'|'downloaded'|'error', ... }
  onUpdateStatus: (cb) => {
    const listener = (_e, status) => cb(status)
    ipcRenderer.on('updater:status', listener)
    return () => ipcRenderer.removeListener('updater:status', listener)
  },
})
