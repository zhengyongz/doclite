// src/components/UpdateDialog.jsx
// 自动更新弹窗：检查中 / 有新版本 / 已最新 / 下载进度 / 安装引导（Linux sudo 命令 / Windows 启动安装器）
import { useMemo } from 'react'

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
  const { open, phase, info, progress, errorMsg, filePath, setOpen, check, download, copyInstallCmd, openInstaller } = updater

  const isLinux = useMemo(() => info?.platform === 'linux', [info])

  if (!open) return null

  const installCmd = filePath ? `sudo dpkg -i "${filePath}"` : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-ink-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-ink-900 text-white">
          <h2 className="text-sm font-semibold tracking-wide">软件更新</h2>
          <button
            className="w-6 h-6 rounded hover:bg-white/10 text-white/80 text-sm leading-none"
            onClick={() => setOpen(false)}
            title="关闭"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          {phase === 'checking' && (
            <div className="flex items-center gap-3 py-6">
              <span className="w-4 h-4 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
              <span className="text-sm text-ink-600">正在检查更新…</span>
            </div>
          )}

          {phase === 'error' && (
            <div className="py-4">
              <p className="text-sm text-ink-700">{errorMsg || '检查更新失败'}</p>
              <p className="text-xs text-ink-400 mt-1.5">网络异常时请稍后重试，不影响软件正常使用。</p>
              <div className="mt-4 flex justify-end gap-2">
                <button className="px-3 py-1.5 rounded-lg border border-ink-300 text-xs" onClick={() => setOpen(false)}>关闭</button>
                <button className="px-3 py-1.5 rounded-lg bg-ink-900 text-white text-xs hover:bg-ink-700" onClick={check}>重试</button>
              </div>
            </div>
          )}

          {phase === 'upToDate' && (
            <div className="py-4">
              <p className="text-sm text-ink-700">
                已是最新版本 <span className="font-semibold">v{info?.currentVersion}</span>
              </p>
              <div className="mt-4 flex justify-end">
                <button className="px-3 py-1.5 rounded-lg bg-ink-900 text-white text-xs hover:bg-ink-700" onClick={() => setOpen(false)}>好的</button>
              </div>
            </div>
          )}

          {phase === 'available' && info && (
            <div className="py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold text-ink-900">v{info.latestVersion}</span>
                <span className="text-xs text-ink-400">当前 v{info.currentVersion}</span>
                {info.publishedAt && <span className="text-xs text-ink-400 ml-auto">{fmtDate(info.publishedAt)}</span>}
              </div>
              {info.asset && (
                <p className="mt-2 text-xs text-ink-500">安装包：{info.asset.name}（{fmtMB(info.asset.size)} MB）</p>
              )}
              {info.releaseNotes && (
                <div className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-ink-50 border border-ink-200 p-3 text-xs text-ink-700 whitespace-pre-wrap break-words leading-relaxed">
                  {info.releaseNotes}
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button className="px-3 py-1.5 rounded-lg border border-ink-300 text-xs" onClick={() => setOpen(false)}>稍后再说</button>
                <button className="px-3 py-1.5 rounded-lg bg-accent-500 text-white text-xs font-medium hover:bg-accent-600" onClick={download}>
                  下载更新
                </button>
              </div>
            </div>
          )}

          {phase === 'downloading' && (
            <div className="py-4">
              <p className="text-sm text-ink-700">正在下载 v{info?.latestVersion}…</p>
              <div className="mt-3 h-2 rounded-full bg-ink-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent-500 transition-all"
                  style={{ width: `${pct(progress?.received, progress?.total)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-ink-400">
                {fmtMB(progress?.received)} MB / {fmtMB(progress?.total || info?.asset?.size)} MB（{pct(progress?.received, progress?.total || info?.asset?.size)}%）
              </p>
            </div>
          )}

          {phase === 'ready' && (
            <div className="py-4">
              <p className="text-sm text-ink-700">v{info?.latestVersion} 已下载完成</p>
              {isLinux ? (
                <div className="mt-3">
                  <p className="text-xs text-ink-500 mb-1.5">
                    文件已保存至：<span className="text-ink-700 break-all">{filePath}</span>
                  </p>
                  <p className="text-xs text-ink-500 mb-1.5">Linux 安装需管理员权限，请在终端执行：</p>
                  <div className="flex items-center gap-2 rounded-lg bg-ink-50 border border-ink-200 p-2">
                    <code className="flex-1 text-xs text-ink-800 break-all font-mono">{installCmd}</code>
                    <button
                      className="px-2 py-1 rounded bg-ink-900 text-white text-[11px] hover:bg-ink-700"
                      onClick={() => copyInstallCmd()}
                    >
                      复制
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <p className="text-xs text-ink-500 mb-1.5">
                    文件已保存至：<span className="text-ink-700 break-all">{filePath}</span>
                  </p>
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button className="px-3 py-1.5 rounded-lg border border-ink-300 text-xs" onClick={() => setOpen(false)}>关闭</button>
                <button
                  className="px-3 py-1.5 rounded-lg bg-ink-900 text-white text-xs hover:bg-ink-700"
                  onClick={() => openInstaller()}
                >
                  {isLinux ? '在文件管理器中查看' : '打开安装程序'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
