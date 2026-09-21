// preload：在 contextIsolation 下向 renderer 暴露最小 API（文件关联打开）
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
})
