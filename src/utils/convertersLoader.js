// src/utils/convertersLoader.js
// 转换组件装载器：主包默认只有浏览功能，转换实现打包为独立 IIFE 组件
// （window.DocLiteConverters），由主进程检测安装位置后动态 <script> 注入。
// 同时承担"应用内安装组件"的解压环节（fflate，主 bundle 带的唯一个小依赖）。
import { unzipSync } from 'fflate'

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

// ---------- 注册"主进程 → 渲染层解压 → 回传"管线（应用内安装组件用） ----------
// 主进程刻意不依赖任何 npm 包（node_modules 已从安装包排除），zip 解压由渲染层完成
export function registerUnzipHandler(onDone) {
  const off = window.doclite?.onUnzipRequest?.(async (buffer, zipInfo) => {
    let files = null
    let error = null
    try {
      files = unzipSync(new Uint8Array(buffer))
    } catch (e) {
      error = e.message || '解压失败'
      files = {}
    }
    try {
      await window.doclite.unzipResult(files, error ? null : zipInfo)
    } catch { /* 主进程侧已处理 */ }
    if (!error && onDone) onDone()
    if (error) console.error('[convertersLoader] 组件解压失败:', error)
  })
  return off || (() => {})
}
