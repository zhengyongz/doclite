// src/useConverters.js
// 转换组件状态管理：检测（安装/版本/来源）、应用内安装、卸载、懒加载组件 API
import { useCallback, useEffect, useState } from 'react'
import { loadConvertersApi } from './utils/convertersLoader'

export function useConverters() {
  const [status, setStatus] = useState(null) // null=检测中；{ installed, version, source }
  const [api, setApi] = useState(null) // 组件 API（已安装时懒加载）
  const [busy, setBusy] = useState(false) // 安装/卸载进行中
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('') // 成功反馈（安装/卸载完成）
  const [appVersion, setAppVersion] = useState('')

  const refresh = useCallback(async () => {
    try {
      const s = await window.doclite?.getConvertersStatus?.()
      setStatus(s || { installed: false, version: null, source: null })
    } catch {
      setStatus({ installed: false, version: null, source: null })
    }
  }, [])

  useEffect(() => {
    refresh()
    window.doclite?.getVersion?.().then((v) => { if (v) setAppVersion(String(v)) }).catch(() => {})
  }, [refresh])

  // 已安装时预载组件 API（用户点转换按钮时零等待）
  useEffect(() => {
    let cancelled = false
    if (status?.installed) {
      loadConvertersApi()
        .then((m) => { if (!cancelled) setApi(m) })
        .catch((e) => setError(`转换组件加载失败：${e.message}`))
    } else {
      setApi(null)
    }
    return () => { cancelled = true }
  }, [status])

  const install = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const r = await window.doclite?.installConverters?.()
      if (!r || !r.ok) {
        setError((r && r.error) || '安装失败')
      } else {
        setNotice(`转换组件 v${r.version || ''} 安装成功`)
        await refresh() // status 变化触发 API 预载
      }
    } finally {
      setBusy(false)
    }
  }, [busy])

  const uninstall = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const r = await window.doclite?.uninstallConverters?.()
      if (!r || !r.ok) setError((r && r.error) || '卸载失败')
      else {
        setNotice('转换组件已移除（浏览功能不受影响）')
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }, [busy])

  // 转换入口（供 ConvertPanel 调用；组件未安装时 throw）
  const convert = useCallback(async (file, ext, key, onProgress, opts) => {
    const m = api || (await loadConvertersApi())
    if (!m) throw new Error('文件转换功能未安装')
    return m.convertFile(file, ext, key, onProgress, opts)
  }, [api])

  // 组件版本落后于主程序（升级后提示更新组件）
  const outdated = !!(
    status?.installed && appVersion && status.version &&
    status.version.split('.').length === 3 && appVersion.split('.').length === 3 &&
    compareSemver(status.version, appVersion) < 0
  )

  return {
    status, api, busy, error, notice, appVersion, outdated,
    setError, install, uninstall, convert, refresh,
  }
}

// 轻量三点版本比较（仅 UI 提示用；主进程侧有完整实现）
function compareSemver(a, b) {
  const pa = String(a).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1
  }
  return 0
}