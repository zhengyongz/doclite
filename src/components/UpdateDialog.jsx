// src/components/UpdateDialog.jsx
// 自动更新弹窗：检查中 / 有新版本 / 已最新 / 下载进度 / 安装引导（Linux sudo 命令 / Windows 启动安装器）
import { useMemo } from 'react'
import { useI18n } from '../i18n'

function fmtMB(n) {
  return ((n || 0) / 1024 / 1024).toFixed(1)
}

function pct(received, total) {
  if (!total) return 0
  return Math.min(100, Math.round((received / total) * 100))
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function UpdateDialog({ updater }) {
  const { t, ts } = useI18n()
  const { open, phase, info, progress, errorMsg, filePath, installNote, setOpen, check, download, copyInstallCmd, openInstaller, install, relaunch } = updater

  const isLinux = useMemo(() => info?.platform === 'linux', [info])

  if (!open) return null

  const installCmd = filePath ? `sudo dpkg -i "${filePath}"` : ''
  const showReadyUi = phase === 'ready' || phase === 'installing' || phase === 'installed'
  // macOS（一期）不支持自动更新：主进程已在检查时标记 manualDownload；下载入口被拦截并抛
  // “macOS 暂不支持自动更新”错误。两种情况都应当给“前往下载”引导，而不是报错/重试。
  // 判定收窄（workbuddy L3）：标记精确等于 true，或错误消息以固定前缀开头，避免误伤普通网络错误
  const isMacManual = info?.manualDownload === true
    || /^macOS\s*暂不支持自动更新/.test(errorMsg || '')
  // 前往下载：用主进程下发的 releasePageUrl（单一来源，workbuddy L1）；点完顺手关弹窗（L2）
  const openRelease = () => {
    setOpen(false)
    const url = info?.releasePageUrl
    if (url) window.doclite?.openExternal?.(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-ink-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-ink-900 text-white">
          <h2 className="text-sm font-semibold tracking-wide">{t('update.title')}</h2>
          <button
            className="w-6 h-6 rounded hover:bg-white/10 text-white/80 text-sm leading-none"
            onClick={() => setOpen(false)}
            title={t('update.close')}
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          {phase === 'checking' && (
            <div className="flex items-center gap-3 py-6">
              <span className="w-4 h-4 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
              <span className="text-sm text-ink-600">{t('update.checking')}</span>
            </div>
          )}

          {/* macOS 手动更新引导：不报错、不重试，直接给“前往下载” */}
          {phase === 'error' && isMacManual && (
            <div className="py-4">
              <p className="text-sm font-medium text-ink-800">{t('update.macManualTitle')}</p>
              <p className="text-xs text-ink-500 mt-1.5 leading-relaxed">{t('update.macManualHint')}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button className="px-3 py-1.5 rounded-lg border border-ink-300 text-xs" onClick={() => setOpen(false)}>{t('update.close')}</button>
                <button className="px-3 py-1.5 rounded-lg bg-accent-500 text-white text-xs font-medium hover:bg-accent-600" onClick={openRelease}>
                  {t('update.goDownload')}
                </button>
              </div>
            </div>
          )}

          {phase === 'error' && !isMacManual && (
            <div className="py-4">
              <p className="text-sm text-ink-700">{ts(errorMsg) || t('update.error')}</p>
              <p className="text-xs text-ink-400 mt-1.5">{t('update.errorHint')}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button className="px-3 py-1.5 rounded-lg border border-ink-300 text-xs" onClick={() => setOpen(false)}>{t('update.close')}</button>
                <button className="px-3 py-1.5 rounded-lg bg-ink-900 text-white text-xs hover:bg-ink-700" onClick={check}>{t('update.retry')}</button>
              </div>
            </div>
          )}

          {phase === 'upToDate' && (
            <div className="py-4">
              <p className="text-sm text-ink-700">
                {t('update.upToDate', { version: info?.currentVersion })}
              </p>
              <div className="mt-4 flex justify-end">
                <button className="px-3 py-1.5 rounded-lg bg-ink-900 text-white text-xs hover:bg-ink-700" onClick={() => setOpen(false)}>{t('update.ok')}</button>
              </div>
            </div>
          )}

          {phase === 'available' && info && (
            <div className="py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold text-ink-900">v{info.latestVersion}</span>
                <span className="text-xs text-ink-400">{t('update.current', { version: info.currentVersion })}</span>
                {info.publishedAt && <span className="text-xs text-ink-400 ml-auto">{fmtDate(info.publishedAt)}</span>}
              </div>
              {info.asset && !isMacManual && (
                <p className="mt-2 text-xs text-ink-500">{t('update.package', { name: info.asset.name, size: fmtMB(info.asset.size) })}</p>
              )}
              {info.releaseNotes && (
                <div className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-ink-50 border border-ink-200 p-3 text-xs text-ink-700 whitespace-pre-wrap break-words leading-relaxed">
                  {info.releaseNotes}
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button className="px-3 py-1.5 rounded-lg border border-ink-300 text-xs" onClick={() => setOpen(false)}>{t('update.later')}</button>
                {isMacManual ? (
                  <button className="px-3 py-1.5 rounded-lg bg-accent-500 text-white text-xs font-medium hover:bg-accent-600" onClick={openRelease}>
                    {t('update.goDownload')}
                  </button>
                ) : (
                  <button className="px-3 py-1.5 rounded-lg bg-accent-500 text-white text-xs font-medium hover:bg-accent-600" onClick={download}>
                    {t('update.download')}
                  </button>
                )}
              </div>
            </div>
          )}

          {phase === 'downloading' && (
            <div className="py-4">
              <p className="text-sm text-ink-700">{t('update.downloading', { version: info?.latestVersion })}</p>
              <div className="mt-3 h-2 rounded-full bg-ink-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent-500 transition-all"
                  style={{ width: `${pct(progress?.received, progress?.total)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-ink-400">
                {fmtMB(progress?.received)} MB / {fmtMB(progress?.total || info?.asset?.size)} MB（{pct(progress?.received, progress?.total || info?.asset?.size)}%）
              </p>
              {progress?.source && (
                <p className="mt-1.5 text-[11px] text-ink-400">
                  {t('update.source', { source: ts(progress.source) })}
                  {progress?.note && <span className="text-accent-600">（{ts(progress.note)}）</span>}
                </p>
              )}
            </div>
          )}

          {showReadyUi && (
            <div className="py-4">
              {phase === 'installed' ? (
                /* —— 安装完成：一键重启 —— */
                <div>
                  <p className="text-sm font-medium text-green-600">{t('update.installed', { version: info?.latestVersion })}</p>
                  <p className="text-xs text-ink-400 mt-1">{t('update.installedHint')}</p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="px-3 py-1.5 rounded-lg border border-ink-300 text-xs" onClick={() => setOpen(false)}>{t('update.restartLater')}</button>
                    <button
                      className="px-3 py-1.5 rounded-lg bg-accent-500 text-white text-xs font-medium hover:bg-accent-600"
                      onClick={relaunch}
                    >
                      {t('update.restartNow')}
                    </button>
                  </div>
                </div>
              ) : isLinux ? (
                /* —— Linux：一键安装（pkexec 弹系统密码框）+ 命令兜底 —— */
                <div>
                  <p className="text-sm text-ink-700">{t('update.downloaded', { version: info?.latestVersion })}</p>
                  <p className="text-xs text-ink-500 mt-1.5">
                    {t('update.savedTo')}<span className="text-ink-700 break-all">{filePath}</span>
                  </p>
                  {phase === 'installing' ? (
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-accent-50 border border-accent-200 px-3 py-2.5">
                      <span className="w-4 h-4 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
                      <span className="text-xs text-accent-700">{t('update.installingHint')}</span>
                    </div>
                  ) : (
                    <>
                      {installNote && (
                        <p className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">{ts(installNote)}</p>
                      )}
                      <div className="mt-3">
                        <button
                          className="w-full px-3 py-2 rounded-lg bg-accent-500 text-white text-xs font-medium hover:bg-accent-600 transition"
                          onClick={install}
                        >
                          {t('update.installNow')}
                        </button>
                      </div>
                      <details className="mt-2">
                        <summary className="text-[11px] text-ink-400 cursor-pointer select-none hover:text-ink-600">{t('update.manualFail')}</summary>
                        <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-ink-50 border border-ink-200 p-2">
                          <code className="flex-1 text-xs text-ink-800 break-all font-mono">{installCmd}</code>
                          <button
                            className="px-2 py-1 rounded bg-ink-900 text-white text-[11px] hover:bg-ink-700 shrink-0"
                            onClick={() => copyInstallCmd()}
                          >
                            {t('update.copy')}
                          </button>
                        </div>
                      </details>
                    </>
                  )}
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="px-3 py-1.5 rounded-lg border border-ink-300 text-xs" onClick={() => setOpen(false)}>{t('update.close')}</button>
                    <button
                      className="px-3 py-1.5 rounded-lg bg-ink-900 text-white text-xs hover:bg-ink-700"
                      onClick={() => openInstaller()}
                    >
                      {t('update.openInFileManager')}
                    </button>
                  </div>
                </div>
              ) : (
                /* —— Windows：直接启动安装器 —— */
                <div>
                  <p className="text-sm text-ink-700">{t('update.downloaded', { version: info?.latestVersion })}</p>
                  <p className="text-xs text-ink-500 mt-1.5">
                    {t('update.savedTo')}<span className="text-ink-700 break-all">{filePath}</span>
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="px-3 py-1.5 rounded-lg border border-ink-300 text-xs" onClick={() => setOpen(false)}>{t('update.close')}</button>
                    <button
                      className="px-3 py-1.5 rounded-lg bg-accent-500 text-white text-xs font-medium hover:bg-accent-600"
                      onClick={() => openInstaller()}
                    >
                      {t('update.openInstaller')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}