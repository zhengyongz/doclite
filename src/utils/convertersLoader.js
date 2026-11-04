// src/utils/convertersLoader.js
// 转换组件装载器：主包默认只有浏览功能，转换实现打包为独立 IIFE 组件
// （window.DocLiteConverters），由主进程检测安装位置后动态 <script> 注入。
// 注：应用内安装的解压与写盘已全部收归主进程（v0.5.1 起），本模块仅负责加载。
let scriptPromise = null // script 注入去重（多次 loadConvertersApi 复用）

// ---------- 加载组件 API（未安装 → null；加载失败 → throw） ----------
export async function loadConvertersApi() {
  if (window.DocLiteConverters) return window.DocLiteConverters
  const status = await window.doclite?.getConvertersStatus?.()
  if (!status || !status.installed) return null
  if (!scriptPromise) {
    scriptPromise = injectScript(status.scriptUrl, status.version)
      .then(() => {
        if (!window.DocLiteConverters) {
          throw new Error('转换组件脚本无法加载（缺少全局导出）')
        }
        return window.DocLiteConverters
      })
      .catch((e) => {
        scriptPromise = null // 失败允许重试
        throw e
      })
  }
  return scriptPromise
}

// ---------- 重置已加载组件（安装/卸载成功后必须调用） ----------
// 组件是 IIFE，注入后挂在 window.DocLiteConverters 上；不重置会导致：
// 用户更新组件后界面显示新版本号，但 convert() 仍跑旧 bundle（如 .xls 一直报“不支持”），
// 直到重启应用才恢复（workbuddy M1）。
export function resetConvertersApi() {
  try {
    delete window.DocLiteConverters
  } catch {
    window.DocLiteConverters = undefined
  }
  scriptPromise = null
  document.querySelectorAll('script[data-doclite-converters]').forEach((s) => s.remove())
}

function injectScript(url, version) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    // 拼版本号破缓存：同路径覆盖安装后，浏览器可能仍用旧脚本缓存
    s.src = version ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}` : url
    s.dataset.docliteConverters = '1'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('转换组件脚本加载失败'))
    document.head.appendChild(s)
  })
}