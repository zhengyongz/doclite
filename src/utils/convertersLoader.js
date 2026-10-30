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
    scriptPromise = injectScript(status.scriptUrl)
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

function injectScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = url
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('转换组件脚本加载失败'))
    document.head.appendChild(s)
  })
}