// src/useUpdater.js
// 自动升级状态管理：订阅主进程推送（自动检查/下载进度），暴露手动检查/下载/复制命令等动作。
// 安全说明：copyInstallCmd / openInstaller 均无参（主进程记账，不跨信任边界传路径）。
import { useCallback, useEffect, useRef, useState } from 'react'

export function useUpdater() {
  const [open, setOpen] = useState(false) // 弹窗开关（关闭不销毁状态，进度保留）
  const [phase, setPhase] = useState('idle') // idle|checking|available|upToDate|error|downloading|ready
  const [info, setInfo] = useState(null) // { currentVersion, latestVersion, publishedAt, releaseNotes, platform, asset }
  const [progress, setProgress] = useState(null) // { received, total }
  const [errorMsg, setErrorMsg] = useState('')
  const [filePath, setFilePath] = useState(null)
  const [appVersion, setAppVersion] = useState('') // 当前应用版本号（侧边栏"版本信息"展示用）
  const startingRef = useRef(false) // M2：同步防重入锁（React state 更新有延迟，不能只靠 phase）

  // 初始化拉取应用版本号（主进程 app.getVersion）
  useEffect(() => {
    window.doclite?.getVersion?.().then((v) => {
      if (v) setAppVersion(String(v))
    }).catch(() => {})
  }, [])

  const applyCheck = useCallback((r) => {
    setInfo(r)
    if (!r.ok) {
      setPhase('error')
      setErrorMsg(r.error || '检查失败')
    } else if (r.hasUpdate) {
      setPhase('available')
    } else {
      setPhase('upToDate')
    }
  }, [])

  // 订阅主进程推送：自动检查发现新版 / 手动检查结果 / 下载进度与结果
  useEffect(() => {
    const off = window.doclite?.onUpdateStatus?.((s) => {
      if (s.type === 'check-result' || s.type === 'available') {
        applyCheck(s)
      } else if (s.type === 'downloading') {
        setPhase('downloading')
        setProgress({ received: s.received, total: s.total })
      } else if (s.type === 'downloaded') {
        setPhase('ready')
        setFilePath(s.filePath)
        setProgress({ received: s.received, total: s.total })
      } else if (s.type === 'error') {
        setPhase('error')
        setErrorMsg(s.message)
      }
    })
    return () => { if (off) off() }
  }, [applyCheck])

  const check = useCallback(async () => {
    setPhase('checking')
    const r = await window.doclite?.checkUpdate?.()
    if (r) applyCheck(r)
  }, [applyCheck])

  const download = useCallback(async () => {
    // M2：同步锁防重入；"下载已在进行中"属主进程互斥的正常答复，不切 error（避免 UI 闪红）
    if (startingRef.current) return
    startingRef.current = true
    try {
      setPhase('downloading')
      const r = await window.doclite?.startDownload?.()
      if (r && !r.ok && r.error !== '下载已在进行中') {
        setPhase('error')
        setErrorMsg(r.error)
      }
    } finally {
      startingRef.current = false
    }
  }, [])

  const openDialog = useCallback(() => {
    setOpen(true)
    // 首次打开且还没检查过才自动触发检查
    if (phase === 'idle') check()
  }, [phase, check])

  const copyInstallCmd = useCallback(() => {
    window.doclite?.copyInstallCmd?.()
  }, [])

  const openInstaller = useCallback(() => {
    window.doclite?.openInstaller?.()
  }, [])

  return {
    open, setOpen,
    phase, info, progress, errorMsg, filePath, appVersion,
    check, download, openDialog, copyInstallCmd, openInstaller,
  }
}